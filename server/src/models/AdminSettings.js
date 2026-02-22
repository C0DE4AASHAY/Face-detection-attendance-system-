const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema(
    {
        arrivalTime: { type: String, default: "09:00" },
        arrivalDeadline: { type: String, default: "09:30" },
        departureStart: { type: String, default: "17:00" },
        departureEnd: { type: String, default: "18:00" },

        faceRecognition: {
            matchThreshold: { type: Number, default: 0.55 },
            duplicateThreshold: { type: Number, default: 0.65 },
            livenessRequired: { type: Boolean, default: true },
            maxScanAttempts: { type: Number, default: 10 },
        },

        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
