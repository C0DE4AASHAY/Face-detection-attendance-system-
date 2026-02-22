const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        date: {
            type: String, // "2026-02-21" format for easy duplicate checking
            required: true,
        },

        checkIn: {
            time: Date,
            confidence: Number,
            method: {
                type: String,
                enum: ["face_scan", "manual_admin"],
                default: "face_scan",
            },
            liveness: Boolean,
        },

        checkOut: {
            time: Date,
            confidence: Number,
            method: {
                type: String,
                enum: ["face_scan", "manual_admin"],
                default: "face_scan",
            },
            liveness: Boolean,
        },

        status: {
            type: String,
            enum: ["present", "late", "half-day", "absent"],
            default: "present",
        },
    },
    {
        timestamps: true,
    }
);

// Compound unique index: prevents duplicate attendance for same user on same day
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
