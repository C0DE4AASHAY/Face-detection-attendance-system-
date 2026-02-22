const express = require("express");
const db = require("../config/db");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// ── POST /api/attendance/mark ────────────────────────────
router.post("/mark", verifyToken, async (req, res) => {
    try {
        const { userId, confidence, liveness, method } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: "User ID required" });

        const user = await db.users.findOne({ _id: userId });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const today = new Date().toISOString().split("T")[0];
        const now = new Date();

        let settings = await db.settings.findOne({});
        if (!settings) settings = { arrivalDeadline: "09:30" };

        let attendance = await db.attendance.findOne({ userId, date: today });

        if (!attendance) {
            const [dH, dM] = (settings.arrivalDeadline || "09:30").split(":").map(Number);
            const isLate = now.getHours() > dH || (now.getHours() === dH && now.getMinutes() > dM);

            attendance = await db.attendance.insert({
                userId, date: today,
                checkIn: { time: now, confidence: confidence || 0, method: method || "face_scan", liveness: liveness?.is_live ?? true },
                checkOut: null,
                status: isLate ? "late" : "present",
                createdAt: now,
            });

            return res.json({
                success: true, type: "check-in",
                message: `${user.name} — Check In recorded${isLate ? " (LATE)" : ""}!`,
                attendance: {
                    id: attendance._id, status: attendance.status, checkIn: attendance.checkIn,
                    employeeName: user.name, employeeId: user.employeeId, department: user.department,
                    confidence, time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                },
            });
        }

        if (attendance.checkOut?.time) {
            return res.status(409).json({ success: false, message: `${user.name} has already checked in and out today.` });
        }

        await db.attendance.update({ _id: attendance._id }, {
            $set: { checkOut: { time: now, confidence: confidence || 0, method: method || "face_scan", liveness: liveness?.is_live ?? true } },
        });

        return res.json({
            success: true, type: "check-out",
            message: `${user.name} — Check Out recorded!`,
            attendance: {
                id: attendance._id, status: attendance.status,
                employeeName: user.name, employeeId: user.employeeId, department: user.department,
                confidence, time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            },
        });
    } catch (err) {
        console.error("Attendance error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ── GET /api/attendance/today ────────────────────────────
router.get("/today", verifyToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];
        const attendance = await db.attendance.findOne({ userId: req.user.id, date: today });
        res.json({ success: true, attendance: attendance || null });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/attendance/history ──────────────────────────
router.get("/history", verifyToken, async (req, res) => {
    try {
        const { start, end } = req.query;
        let records = await db.attendance.find({ userId: req.user.id }).sort({ date: -1 });

        if (start) records = records.filter(r => r.date >= start);
        if (end) records = records.filter(r => r.date <= end);

        res.json({ success: true, attendance: records });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/attendance/all ──────────────────────────────
router.get("/all", verifyToken, async (req, res) => {
    try {
        const { start, end, limit = 50 } = req.query;
        let records = await db.attendance.find({}).sort({ date: -1 }).limit(parseInt(limit));

        if (start) records = records.filter(r => r.date >= start);
        if (end) records = records.filter(r => r.date <= end);

        // Populate user info
        for (const r of records) {
            const u = await db.users.findOne({ _id: r.userId });
            r.userId = u ? { _id: u._id, name: u.name, email: u.email, employeeId: u.employeeId, department: u.department } : { name: "Unknown" };
        }

        res.json({ success: true, records });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Server error" }); }
});

// ── GET /api/attendance/analytics ────────────────────────
router.get("/analytics", verifyToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];
        const totalUsers = await db.users.count({ role: "student", status: "active" });
        const todayRecords = await db.attendance.find({ date: today });
        const todayPresent = todayRecords.length;
        const lateCount = todayRecords.filter(r => r.status === "late").length;

        // 7-day trend
        const trend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const ds = d.toISOString().split("T")[0];
            const count = await db.attendance.count({ date: ds });
            trend.push({ day: ds, count });
        }

        // Avg confidence
        const confScores = todayRecords.filter(r => r.checkIn?.confidence > 0).map(r => r.checkIn.confidence);
        const avgConf = confScores.length > 0 ? confScores.reduce((a, b) => a + b, 0) / confScores.length : 0;

        // Department breakdown (populated)
        const deptMap = {};
        for (const r of todayRecords) {
            const u = await db.users.findOne({ _id: r.userId });
            const dept = u?.department || "Unknown";
            deptMap[dept] = (deptMap[dept] || 0) + 1;
        }

        res.json({
            success: true,
            analytics: {
                totalUsers, todayPresent, todayAbsent: totalUsers - todayPresent,
                attendanceRate: totalUsers > 0 ? Math.round((todayPresent / totalUsers) * 100) : 0,
                lateCount, avgConfidence: Math.round(avgConf * 100) / 100,
                dailyTrend: trend,
                departmentBreakdown: Object.entries(deptMap).map(([d, c]) => ({ department: d, count: c })),
            },
        });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Server error" }); }
});

module.exports = router;
