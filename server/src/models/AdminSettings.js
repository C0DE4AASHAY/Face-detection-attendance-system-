const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema({
    // Organization settings
    orgName: { type: String, default: "FaceTrack Academy" },

    // Schedule settings
    arrivalTime: { type: String, default: "09:00" }, // Expected arrival (HH:mm)
    arrivalDeadline: { type: String, default: "09:30" }, // Marked late after this
    departureStart: { type: String, default: "17:00" }, // Allowed check-out time
    departureEnd: { type: String, default: "18:00" },

    // Face Recognition Tunings
    faceRecognition: {
        matchThreshold: { type: Number, default: 0.55 }, // Higher means stricter matching
        duplicateThreshold: { type: Number, default: 0.65 }, // Stricter logic for preventing 2 people using same face
        livenessRequired: { type: Boolean, default: true },
        maxScanAttempts: { type: Number, default: 10 }
    },

    // Audit
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
