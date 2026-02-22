const jwt = require("jsonwebtoken");

/**
 * JWT verification middleware.
 * Extracts token from Authorization header and attaches user payload to req.user.
 */
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, role, email }
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, message: "Token expired. Please refresh." });
        }
        return res.status(403).json({ success: false, message: "Invalid token." });
    }
};

/**
 * Role-based access guard.
 * Usage: requireRole("admin") or requireRole("admin", "student")
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "Insufficient permissions." });
        }
        next();
    };
};

module.exports = { verifyToken, requireRole };
