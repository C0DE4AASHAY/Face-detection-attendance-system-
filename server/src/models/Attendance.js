const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format

    checkIn: {
        time: Date,
        confidence: Number, // Face match score
        method: { type: String, enum: ["face_scan", "manual", "qr"], default: "face_scan" },
        liveness: { type: Boolean, default: true }
    },

    checkOut: {
        time: Date,
        confidence: Number,
        method: { type: String, enum: ["face_scan", "manual", "qr"], default: "face_scan" },
        liveness: { type: Boolean, default: true }
    },

    status: { type: String, enum: ["present", "absent", "late", "half_day"], default: "present" },
    notes: String
}, { timestamps: true });

// Ensure a user can only have one attendance record per day
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
