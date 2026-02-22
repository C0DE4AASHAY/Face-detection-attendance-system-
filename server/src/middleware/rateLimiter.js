const rateLimit = require("express-rate-limit");

// Login rate limiter — prevents brute force
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_LOGIN) || 10,
    message: {
        success: false,
        message: "Too many login attempts. Please try again in 15 minutes.",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Face scan rate limiter
const faceScanLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_FACE_SCAN) || 20,
    message: {
        success: false,
        message: "Too many face scan attempts. Please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_API) || 200,
    message: {
        success: false,
        message: "Too many requests. Please slow down.",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { loginLimiter, faceScanLimiter, apiLimiter };
