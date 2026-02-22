const express = require("express");
const db = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(verifyToken, requireRole("admin"));

// ── GET /api/admin/users ─────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const users = await db.users.find({ role: "student" }).sort({ name: 1 });
        res.json({
            success: true,
            users: users.map(u => ({
                id: u._id, name: u.name, email: u.email, employeeId: u.employeeId,
                department: u.department, status: u.status,
                hasFace: !!u.faceEmbedding?.vector?.length,
                thumbnail: u.faceEmbedding?.thumbnail,
                registeredAt: u.createdAt, lastLogin: u.lastLogin,
            })),
        });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── PUT /api/admin/users/:id/status ──────────────────────
router.put("/users/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!["active", "inactive", "suspended"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }
        const user = await db.users.findOne({ _id: req.params.id });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        await db.users.update({ _id: req.params.id }, { $set: { status } });
        res.json({ success: true, message: `${user.name} is now ${status}` });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── DELETE /api/admin/users/:id ──────────────────────────
router.delete("/users/:id", async (req, res) => {
    try {
        const user = await db.users.findOne({ _id: req.params.id });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        await db.users.remove({ _id: req.params.id });
        await db.attendance.remove({ userId: req.params.id }, { multi: true });
        res.json({ success: true, message: `${user.name} and their records removed.` });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/admin/settings ──────────────────────────────
router.get("/settings", async (req, res) => {
    try {
        let settings = await db.settings.findOne({});
        if (!settings) {
            settings = await db.settings.insert({
                arrivalTime: "09:00", arrivalDeadline: "09:30",
                departureStart: "17:00", departureEnd: "18:00",
                faceRecognition: { matchThreshold: 0.55, duplicateThreshold: 0.65, livenessRequired: true, maxScanAttempts: 10 },
            });
        }
        res.json({ success: true, settings });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── PUT /api/admin/settings ──────────────────────────────
router.put("/settings", async (req, res) => {
    try {
        let settings = await db.settings.findOne({});
        if (!settings) {
            settings = await db.settings.insert({ ...req.body, updatedBy: req.user.id });
        } else {
            await db.settings.update({ _id: settings._id }, { $set: { ...req.body, updatedBy: req.user.id } });
            settings = await db.settings.findOne({ _id: settings._id });
        }
        res.json({ success: true, message: "Settings updated", settings });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/admin/face-logs ─────────────────────────────
router.get("/face-logs", async (req, res) => {
    try {
        const records = await db.attendance.find({}).sort({ date: -1 }).limit(50);
        const logs = [];
        for (const r of records) {
            const u = await db.users.findOne({ _id: r.userId });
            logs.push({
                id: r._id, user: u ? { name: u.name, employeeId: u.employeeId, department: u.department } : { name: "Unknown" },
                date: r.date,
                checkInConfidence: r.checkIn?.confidence || 0,
                checkOutConfidence: r.checkOut?.confidence || 0,
                checkInLiveness: r.checkIn?.liveness,
                checkOutLiveness: r.checkOut?.liveness,
                status: r.status,
            });
        }
        res.json({ success: true, logs });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/admin/export ────────────────────────────────
router.get("/export", async (req, res) => {
    try {
        const { start, end } = req.query;
        let records = await db.attendance.find({}).sort({ date: -1 });
        if (start) records = records.filter(r => r.date >= start);
        if (end) records = records.filter(r => r.date <= end);

        let csv = "Name,Employee ID,Department,Date,Check In,Check Out,Status,Confidence\n";
        for (const r of records) {
            const u = await db.users.findOne({ _id: r.userId });
            const name = u?.name || "Unknown";
            const empId = u?.employeeId || "";
            const dept = u?.department || "";
            const cin = r.checkIn?.time ? new Date(r.checkIn.time).toLocaleTimeString() : "";
            const cout = r.checkOut?.time ? new Date(r.checkOut.time).toLocaleTimeString() : "";
            const conf = r.checkIn?.confidence || 0;
            csv += `"${name}","${empId}","${dept}","${r.date}","${cin}","${cout}","${r.status}","${conf}"\n`;
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=attendance_${Date.now()}.csv`);
        res.send(csv);
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

module.exports = router;
