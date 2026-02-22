const express = require("express");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const AdminSettings = require("../models/AdminSettings");
const { verifyToken, requireRole } = require("../middleware/auth");

const router = express.Router();

// Apply middleware to all admin routes
router.use(verifyToken, requireRole("admin"));

// ── U S E R   M A N A G E M E N T ────────────────────────

// 1. Get all students
router.get("/users", async (req, res) => {
    try {
        const users = await User.find({ role: "student" }).sort({ name: 1 });

        const formatted = users.map(u => ({
            id: u._id,
            name: u.name,
            email: u.email,
            employeeId: u.employeeId,
            department: u.department,
            status: u.status,
            hasFace: !!(u.faceEmbedding && u.faceEmbedding.vector && u.faceEmbedding.vector.length > 0),
            thumbnail: u.faceEmbedding?.thumbnail || null,
            registeredAt: u.createdAt,
            lastLogin: u.lastLogin
        }));

        res.json({ success: true, users: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to fetch users." });
    }
});

// 2. Update user status (active, inactive, suspended)
router.put("/users/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!["active", "inactive", "suspended"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value." });
        }

        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        user.status = status;
        await user.save();

        res.json({ success: true, message: `User ${user.name} is now ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update user." });
    }
});

// 3. Delete user and their records
router.delete("/users/:id", async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        // Delete attendance records First
        await Attendance.deleteMany({ userId: user._id });

        // Delete user
        await User.findByIdAndDelete(user._id);

        res.json({ success: true, message: `User ${user.name} and all their attendance records have been removed.` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to delete user." });
    }
});

// ── S Y S T E M   S E T T I N G S ────────────────────────

// 4. Get system config
router.get("/settings", async (req, res) => {
    try {
        let settings = await AdminSettings.findOne();
        if (!settings) {
            // create defaults if they don't exist
            settings = await AdminSettings.create({
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
        }
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to fetch settings." });
    }
});

// 5. Update system config
router.put("/settings", async (req, res) => {
    try {
        const updates = req.body;
        updates.updatedBy = req.user.id;

        let settings = await AdminSettings.findOne();

        if (!settings) {
            settings = await AdminSettings.create(updates);
        } else {
            settings = await AdminSettings.findOneAndUpdate(
                { _id: settings._id },
                { $set: updates },
                { new: true, runValidators: true }
            );
        }

        res.json({ success: true, message: "System settings updated.", settings });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update settings." });
    }
});


// ── L O G S   A N D   E X P O R T S ──────────────────────

// 6. View detailed face recognition log (for auditing)
router.get("/face-logs", async (req, res) => {
    try {
        const records = await Attendance.find()
            .populate("userId", "name employeeId department faceEmbedding.thumbnail")
            .sort({ createdAt: -1 })
            .limit(50); // last 50 events

        const logs = records.map(r => ({
            id: r._id,
            user: r.userId ? {
                name: r.userId.name,
                employeeId: r.userId.employeeId,
                department: r.userId.department
            } : { name: "Deleted User" },
            date: r.date,
            checkInConfidence: r.checkIn?.confidence || 0,
            checkOutConfidence: r.checkOut?.confidence || 0,
            checkInLiveness: r.checkIn?.liveness,
            checkOutLiveness: r.checkOut?.liveness,
            status: r.status
        }));

        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to fetch face logs." });
    }
});


// 7. Export all attendance to CSV
router.get("/export", async (req, res) => {
    try {
        const { start, end } = req.query; // optional date filters

        let query = {};
        if (start || end) {
            query.date = {};
            if (start) query.date.$gte = start;
            if (end) query.date.$lte = end;
        }

        const records = await Attendance.find(query)
            .populate("userId", "name employeeId department")
            .sort({ date: -1 });

        // Generate strict CSV wrapper
        const escapeCsv = (str) => `"${String(str || "").replace(/"/g, '""')}"`;

        let csv = "Name,Employee ID,Department,Date,Check In,Check Out,Status,Confidence Score\n";

        records.forEach(r => {
            const name = r.userId ? r.userId.name : "Deleted User";
            const empId = r.userId?.employeeId || "";
            const dept = r.userId?.department || "";
            const checkInTime = r.checkIn?.time ? new Date(r.checkIn.time).toLocaleTimeString() : "";
            const checkOutTime = r.checkOut?.time ? new Date(r.checkOut.time).toLocaleTimeString() : "";

            const conf = r.checkIn?.confidence || 0;

            csv += `${escapeCsv(name)},${escapeCsv(empId)},${escapeCsv(dept)},${escapeCsv(r.date)},${escapeCsv(checkInTime)},${escapeCsv(checkOutTime)},${escapeCsv(r.status)},${escapeCsv(conf)}\n`;
        });

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=attendance_export_${Date.now()}.csv`);

        res.send(csv);

    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to generate CSV export." });
    }
});

module.exports = router;
