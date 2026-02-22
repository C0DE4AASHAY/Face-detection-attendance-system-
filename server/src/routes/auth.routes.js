const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
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

// ── POST /api/auth/register ──────────────────────────────
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

            const existingEmail = await db.users.findOne({ email });
            if (existingEmail) return res.status(409).json({ success: false, message: "Email already registered" });

            const existingEmp = await db.users.findOne({ employeeId });
            if (existingEmp) return res.status(409).json({ success: false, message: "Employee ID already exists" });

            const salt = await bcrypt.genSalt(12);
            const hashedPassword = await bcrypt.hash(password, salt);

            const user = await db.users.insert({
                name,
                email,
                password: hashedPassword,
                employeeId,
                department: department || "General",
                role: "student",
                status: "active",
                faceEmbedding: null,
                loginAttempts: 0,
                lockUntil: null,
                lastLogin: null,
                createdAt: new Date(),
            });

            const tokens = generateTokens(user);
            await db.users.update({ _id: user._id }, { $set: { refreshToken: tokens.refreshToken } });

            res.status(201).json({
                success: true,
                message: "Registration successful",
                user: { id: user._id, name: user.name, email: user.email, role: user.role, employeeId: user.employeeId, department: user.department, hasFace: false },
                ...tokens,
            });
        } catch (err) {
            console.error("Register error:", err);
            if (err.errorType === "uniqueViolated") return res.status(409).json({ success: false, message: "Email or Employee ID already exists" });
            res.status(500).json({ success: false, message: "Server error" });
        }
    }
);

// ── POST /api/auth/login ─────────────────────────────────
router.post(
    "/login",
    loginLimiter,
    [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

            const { email, password } = req.body;
            const user = await db.users.findOne({ email });

            if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });

            // Check lock
            if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
                return res.status(423).json({ success: false, message: "Account locked. Try again in 15 minutes." });
            }

            if (user.status !== "active") {
                return res.status(403).json({ success: false, message: `Account is ${user.status}. Contact admin.` });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                const attempts = (user.loginAttempts || 0) + 1;
                const updates = { loginAttempts: attempts };
                if (attempts >= 5) updates.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
                await db.users.update({ _id: user._id }, { $set: updates });
                return res.status(401).json({ success: false, message: "Invalid email or password" });
            }

            await db.users.update({ _id: user._id }, { $set: { loginAttempts: 0, lockUntil: null, lastLogin: new Date() } });

            const tokens = generateTokens(user);
            await db.users.update({ _id: user._id }, { $set: { refreshToken: tokens.refreshToken } });

            res.json({
                success: true,
                message: "Login successful",
                user: {
                    id: user._id, name: user.name, email: user.email, role: user.role,
                    employeeId: user.employeeId, department: user.department,
                    hasFace: !!user.faceEmbedding?.vector?.length,
                    thumbnail: user.faceEmbedding?.thumbnail || null,
                },
                ...tokens,
            });
        } catch (err) {
            console.error("Login error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    }
);

// ── POST /api/auth/refresh ───────────────────────────────
router.post("/refresh", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(401).json({ success: false, message: "Refresh token required" });

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await db.users.findOne({ _id: decoded.id });

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(403).json({ success: false, message: "Invalid refresh token" });
        }

        const tokens = generateTokens(user);
        await db.users.update({ _id: user._id }, { $set: { refreshToken: tokens.refreshToken } });
        res.json({ success: true, ...tokens });
    } catch (err) {
        res.status(403).json({ success: false, message: "Invalid or expired refresh token" });
    }
});

// ── POST /api/auth/logout ────────────────────────────────
router.post("/logout", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
            await db.users.update({ _id: decoded.id }, { $set: { refreshToken: null } });
        }
    } catch { /* ignore */ }
    res.json({ success: true, message: "Logged out" });
});

module.exports = router;
