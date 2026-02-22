const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { loginLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

function generateTokens(user) {
    const accessToken = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
    );
    const refreshToken = jwt.sign(
        { id: user._id },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
    );
    return { accessToken, refreshToken };
}

// ── P O S T   /api/auth/register ─────────────────────────
router.post(
    "/register",
    [
        body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name must be 2-100 characters"),
        body("email").isEmail().normalizeEmail().withMessage("Invalid email"),
        body("password").isLength({ min: 6 }).withMessage("Password must be 6+ characters"),
        body("employeeId").trim().notEmpty().withMessage("Employee ID is required"),
        body("department").optional().trim(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const { name, email, password, employeeId, department } = req.body;

            const userExists = await User.findOne({ $or: [{ email }, { employeeId }] });
            if (userExists) {
                return res.status(409).json({ success: false, message: "Email or Employee ID already exists." });
            }

            const user = await User.create({
                name,
                email,
                password, // auto-hashed by Mongoose pre-save
                employeeId,
                department: department || "General"
            });

            const tokens = generateTokens(user);
            user.refreshToken = tokens.refreshToken;
            await user.save();

            res.status(201).json({
                success: true,
                message: "Registration successful",
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    employeeId: user.employeeId,
                    department: user.department,
                    hasFace: false
                },
                ...tokens,
            });
        } catch (err) {
            console.error("Register Error:", err);
            res.status(500).json({ success: false, message: "Server error during registration." });
        }
    }
);

// ── P O S T   /api/auth/login ────────────────────────────
router.post(
    "/login",
    loginLimiter,
    [
        body("email").isEmail().normalizeEmail(),
        body("password").notEmpty(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const { email, password } = req.body;
            const user = await User.findOne({ email });

            if (!user) {
                return res.status(401).json({ success: false, message: "Invalid email or password" });
            }

            // Check account lock
            if (user.lockUntil && user.lockUntil > Date.now()) {
                const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 60000);
                return res.status(423).json({ success: false, message: `Account locked. Try again in ${remainingTime} minutes.` });
            }

            // Check account status
            if (user.status !== "active") {
                return res.status(403).json({ success: false, message: `Account is ${user.status}. Contact administrator.` });
            }

            const isMatch = await user.matchPassword(password);

            if (!isMatch) {
                user.loginAttempts += 1;
                if (user.loginAttempts >= 5) {
                    user.lockUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 mins
                }
                await user.save();
                return res.status(401).json({ success: false, message: "Invalid email or password" });
            }

            // Login successful, reset lock
            user.loginAttempts = 0;
            user.lockUntil = undefined;
            user.lastLogin = Date.now();

            const tokens = generateTokens(user);
            user.refreshToken = tokens.refreshToken;
            await user.save();

            res.json({
                success: true,
                message: "Login successful",
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    employeeId: user.employeeId,
                    department: user.department,
                    hasFace: !!(user.faceEmbedding && user.faceEmbedding.vector && user.faceEmbedding.vector.length > 0),
                    thumbnail: user.faceEmbedding?.thumbnail || null,
                },
                ...tokens,
            });
        } catch (err) {
            console.error("Login Error:", err);
            res.status(500).json({ success: false, message: "Server error during login." });
        }
    }
);

// ── P O S T   /api/auth/refresh ──────────────────────────
router.post("/refresh", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(401).json({ success: false, message: "Refresh token required" });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await User.findById(decoded.id);

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(403).json({ success: false, message: "Invalid refresh token" });
        }

        const tokens = generateTokens(user);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        res.json({ success: true, ...tokens });
    } catch (err) {
        res.status(403).json({ success: false, message: "Invalid or expired refresh token" });
    }
});

// ── P O S T   /api/auth/logout ───────────────────────────
router.post("/logout", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
            await User.findByIdAndUpdate(decoded.id, { refreshToken: null });
        }
    } catch (err) {
        // Ignore invalid tokens on logout
    }
    res.json({ success: true, message: "Logged out successfully" });
});

module.exports = router;
