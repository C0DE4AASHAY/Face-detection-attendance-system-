const express = require("express");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const AdminSettings = require("../models/AdminSettings");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// ── P O S T   /api/attendance/mark ───────────────────────
router.post("/mark", verifyToken, async (req, res) => {
    try {
        const { userId, confidence, liveness, method } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        const todayString = d.toISOString().split("T")[0];

        // Fetch system settings
        let settings = await AdminSettings.findOne();
        if (!settings) settings = { arrivalDeadline: "09:30" }; // fallback

        // Find existing attendance for today
        let attendance = await Attendance.findOne({ userId: user._id, date: todayString });

        // ==== CHECK IN ====
        if (!attendance) {
            // Calculate if late
            const [deadlineH, deadlineM] = (settings.arrivalDeadline || "09:30").split(":").map(Number);
            const isLate = now.getHours() > deadlineH || (now.getHours() === deadlineH && now.getMinutes() > deadlineM);

            attendance = await Attendance.create({
                userId: user._id,
                date: todayString,
                checkIn: {
                    time: now,
                    confidence: confidence || 0,
                    method: method || "face_scan",
                    liveness: liveness?.is_live ?? true
                },
                status: isLate ? "late" : "present"
            });

            return res.json({
                success: true,
                type: "check-in",
                message: `${user.name} — Check In recorded${isLate ? " (LATE)" : ""}!`,
                attendance: {
                    id: attendance._id,
                    status: attendance.status,
                    checkIn: attendance.checkIn,
                    employeeName: user.name,
                    employeeId: user.employeeId,
                    department: user.department,
                    confidence,
                    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                }
            });
        }

        
// ADD THIS COOLDOWN CHECK: Prevent checking out within 5 minutes (300000ms) of checking in
        if (attendance.checkIn && attendance.checkIn.time) {
            const timeDiff = now.getTime() - new Date(attendance.checkIn.time).getTime();
            if (timeDiff < 300000) {
                return res.status(429).json({
                    success: false,
                    message: "Face recognized, but you must wait 5 minutes before checking out."
                });
            }
        }

        attendance.checkOut = {
            
        // ==== CHECK OUT ====
        if (attendance.checkOut && attendance.checkOut.time) {
            return res.status(409).json({
                success: false,
                message: `${user.name} has already checked in and out today.`
            });
        }

        attendance.checkOut = {
            time: now,
            confidence: confidence || 0,
            method: method || "face_scan",
            liveness: liveness?.is_live ?? true
        };

        await attendance.save();

        return res.json({
            success: true,
            type: "check-out",
            message: `${user.name} — Check Out recorded!`,
            attendance: {
                id: attendance._id,
                status: attendance.status,
                employeeName: user.name,
                employeeId: user.employeeId,
                department: user.department,
                confidence,
                time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            }
        });

    } catch (err) {
        console.error("Mark Attendance Error:", err);
        res.status(500).json({ success: false, message: "Server error marking attendance." });
    }
});


// ── G E T   /api/attendance/today ────────────────────────
// Get logged in user's attendance for today
router.get("/today", verifyToken, async (req, res) => {
    try {
        const todayString = new Date().toISOString().split("T")[0];
        const attendance = await Attendance.findOne({
            userId: req.user.id,
            date: todayString
        });

        res.json({
            success: true,
            attendance: attendance || null
        });
    } catch (err) {
        console.error("Fetch Today Error:", err);
        res.status(500).json({ success: false, message: "Server error fetching summary." });
    }
});


// ── G E T   /api/attendance/history ──────────────────────
// Get logged in user's attendance history
router.get("/history", verifyToken, async (req, res) => {
    try {
        const { start, end } = req.query; // YYYY-MM-DD

        let query = { userId: req.user.id };

        if (start || end) {
            query.date = {};
            if (start) query.date.$gte = start;
            if (end) query.date.$lte = end;
        }

        const records = await Attendance.find(query).sort({ date: -1 });

        res.json({
            success: true,
            attendance: records
        });
    } catch (err) {
        console.error("Fetch History Error:", err);
        res.status(500).json({ success: false, message: "Server error fetching history." });
    }
});

// ── G E T   /api/attendance/all ──────────────────────────
// Get all attendance records across the system
router.get("/all", verifyToken, async (req, res) => {
    try {
        const { start, end, limit = 50 } = req.query; // YYYY-MM-DD

        let query = {};
        if (start || end) {
            query.date = {};
            if (start) query.date.$gte = start;
            if (end) query.date.$lte = end;
        }

        const records = await Attendance.find(query)
            .populate("userId", "name email employeeId department")
            .sort({ date: -1 })
            .limit(parseInt(limit));

        res.json({
            success: true,
            records
        });
    } catch (err) {
        console.error("Fetch All Error:", err);
        res.status(500).json({ success: false, message: "Server error fetching records." });
    }
});

// ── G E T   /api/attendance/analytics ────────────────────
// Global analytics payload for admin dashboard
router.get("/analytics", verifyToken, async (req, res) => {
    try {
        const todayString = new Date().toISOString().split("T")[0];

        const totalUsers = await User.countDocuments({ role: "student", status: "active" });
        const todayRecords = await Attendance.find({ date: todayString }).populate("userId", "department");

        const todayPresent = todayRecords.length;
        const lateCount = todayRecords.filter(r => r.status === "late").length;
        const absentCount = Math.max(0, totalUsers - todayPresent);

        const attendanceRate = totalUsers > 0 ? Math.round((todayPresent / totalUsers) * 100) : 0;

        // 7-day trend
        const trend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dayStr = d.toISOString().split("T")[0];
            const count = await Attendance.countDocuments({ date: dayStr });
            trend.push({ day: dayStr, count });
        }

        // Average confidence calculation
        const confScores = todayRecords.filter(r => r.checkIn && r.checkIn.confidence).map(r => r.checkIn.confidence);
        const avgConfidence = confScores.length > 0
            ? confScores.reduce((a, b) => a + b, 0) / confScores.length
            : 0;

        // Department breakdown
        const deptMap = {};
        todayRecords.forEach(r => {
            if (r.userId && r.userId.department) {
                const d = r.userId.department;
                deptMap[d] = (deptMap[d] || 0) + 1;
            }
        });

        const departmentBreakdown = Object.keys(deptMap).map(k => ({
            department: k,
            count: deptMap[k]
        }));

        res.json({
            success: true,
            analytics: {
                totalUsers,
                todayPresent,
                todayAbsent: absentCount,
                attendanceRate,
                lateCount,
                avgConfidence: Math.round(avgConfidence * 100) / 100, // round 2 decimals
                dailyTrend: trend,
                departmentBreakdown
            }
        });

    } catch (err) {
        console.error("Analytics Error:", err);
        res.status(500).json({ success: false, message: "Server error fetching analytics." });
    }
});

module.exports = router;
