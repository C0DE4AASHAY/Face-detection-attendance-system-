/**
 * FaceTrack Pro — Express Server Entry Point
 * Production-ready attendance system with face recognition.
 * Connected to MongoDB Atlas.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// ── Validate required env vars ───────────────────────────
const REQUIRED_ENV = ["MONGODB_URI"];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
}

// Provide fallback secrets for development, but warn
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "dev-fallback-jwt-secret-CHANGE-IN-PRODUCTION";
    console.warn("⚠️  JWT_SECRET not set — using insecure fallback. Set this in production!");
}
if (!process.env.JWT_REFRESH_SECRET) {
    process.env.JWT_REFRESH_SECRET = "dev-fallback-refresh-secret-CHANGE-IN-PRODUCTION";
    console.warn("⚠️  JWT_REFRESH_SECRET not set — using insecure fallback. Set this in production!");
}

const connectDB = require("./src/config/db");
const { apiLimiter } = require("./src/middleware/rateLimiter");

// Models
const User = require("./src/models/User");
const AdminSettings = require("./src/models/AdminSettings");

const app = express();

// ── Security Middleware ──────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(cors({
    origin: function (origin, callback) {
        // Allow any origin — useful for Vercel preview environments
        callback(null, true);
    },
    credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/", apiLimiter);

// ── API Routes ───────────────────────────────────────────
app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/face", require("./src/routes/face.routes"));
app.use("/api/attendance", require("./src/routes/attendance.routes"));
app.use("/api/admin", require("./src/routes/admin.routes"));

// ── Health Check ─────────────────────────────────────────
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "facetrack-server", timestamp: new Date() });
});

// ── 404 Handler for unknown API routes ───────────────────
app.use("/api/*", (req, res) => {
    res.status(404).json({ success: false, message: "API route not found" });
});

// ── Global Error Handler ─────────────────────────────────
app.use((err, req, res, next) => {
    console.error("❌ Error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error" });
});

// ── Seed Admin ───────────────────────────────────────────
async function seedDefaults() {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || "admin@facetrack.com";
        const existing = await User.findOne({ email: adminEmail });

        if (!existing) {
            await User.create({
                name: "Admin",
                email: adminEmail,
                password: process.env.ADMIN_PASSWORD || "Admin@123",
                role: "admin",
                employeeId: "ADMIN-001",
                department: "Management"
            });
            console.log(`👤 Default admin created: ${adminEmail}`);
        }

        const settings = await AdminSettings.findOne();
        if (!settings) {
            await AdminSettings.create({
                arrivalTime: "09:00",
                arrivalDeadline: "09:30",
                departureStart: "17:00",
                departureEnd: "18:00",
                faceRecognition: {
                    matchThreshold: 0.55,
                    duplicateThreshold: 0.65,
                    livenessRequired: true,
                    maxScanAttempts: 10
                }
            });
            console.log("⚙️  Default settings created");
        }
    } catch (err) {
        console.error("Seed error:", err.message);
    }
}

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// Non-blocking warm-up for face recognition service (Render cold starts)
async function warmFaceService() {
    const FACE_URL = process.env.FACE_SERVICE_URL;
    if (!FACE_URL) return;

    console.log("🔄 Warming up face recognition service...");
    try {
        const fetch = require("node-fetch");
        const res = await fetch(`${FACE_URL}/health`, {
            signal: AbortSignal.timeout(60000),
        });
        const data = await res.json();
        console.log(`✅ Face service is ready: ${JSON.stringify(data)}`);
    } catch (err) {
        console.warn("⚠️  Face service warm-up failed (may still be starting):", err.message);
    }
}

(async () => {
    await connectDB();
    await seedDefaults();

    app.listen(PORT, () => {
        console.log(`\n🚀 FaceTrack Pro Server on port ${PORT}`);
        console.log(`   Database: MongoDB Atlas`);
        console.log(`   Face Service: ${process.env.FACE_SERVICE_URL || "(not configured)"}`);
        console.log(`   API: http://localhost:${PORT}/api`);
        console.log("");
    });

    // Fire-and-forget warm-up — don't block the server
    warmFaceService();
})();
