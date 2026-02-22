/**
 * FaceTrack Pro — Express Server Entry Point
 * Production-ready attendance system with face recognition.
 * Uses NeDB (embedded database) — zero external dependencies.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./src/config/db");
const { apiLimiter } = require("./src/middleware/rateLimiter");

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

// ── Serve React Frontend (production) ────────────────────
const clientBuildPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientBuildPath));
app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientBuildPath, "index.html"), (err) => {
        if (err) res.status(404).send("Frontend not built yet. Run: cd client && npm run build");
    });
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
        const existing = await db.users.findOne({ email: adminEmail });
        if (!existing) {
            const salt = await bcrypt.genSalt(12);
            const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || "Admin@123", salt);
            await db.users.insert({
                name: "Admin", email: adminEmail, password: hashed,
                role: "admin", employeeId: "ADMIN-001", department: "Management",
                status: "active", faceEmbedding: null, loginAttempts: 0,
                lockUntil: null, lastLogin: null, createdAt: new Date(),
            });
            console.log(`👤 Default admin: ${adminEmail} / ${process.env.ADMIN_PASSWORD || "Admin@123"}`);
        }

        const settings = await db.settings.findOne({});
        if (!settings) {
            await db.settings.insert({
                arrivalTime: "09:00", arrivalDeadline: "09:30",
                departureStart: "17:00", departureEnd: "18:00",
                faceRecognition: { matchThreshold: 0.55, duplicateThreshold: 0.65, livenessRequired: true, maxScanAttempts: 10 },
            });
            console.log("⚙️  Default settings created");
        }
    } catch (err) { console.error("Seed error:", err.message); }
}

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
(async () => {
    await seedDefaults();
    app.listen(PORT, () => {
        console.log(`\n🚀 FaceTrack Pro Server on port ${PORT}`);
        console.log(`   Database: NeDB (embedded, file-based)`);
        console.log(`   Face Service: ${process.env.FACE_SERVICE_URL || "http://localhost:8000"}`);
        console.log(`   API: http://localhost:${PORT}/api`);
        console.log("");
    });
})();
