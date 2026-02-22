const express = require("express");
const fetch = require("node-fetch");
const db = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const { faceScanLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const FACE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";

// ── POST /api/face/register ──────────────────────────────
router.post("/register", verifyToken, faceScanLimiter, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ success: false, message: "Image is required" });

        const user = await db.users.findOne({ _id: req.user.id });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Duplicate face check
        const allUsers = await db.users.find({ _id: { $ne: user._id }, "faceEmbedding.vector": { $exists: true } });
        const usersWithFace = allUsers.filter(u => u.faceEmbedding?.vector?.length > 0);

        if (usersWithFace.length > 0) {
            const storedEmbeddings = usersWithFace.map(u => ({
                user_id: u._id, name: u.name, embedding: u.faceEmbedding.vector,
            }));

            const dupRes = await fetch(`${FACE_URL}/duplicate-check`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image, stored_embeddings: storedEmbeddings, threshold: 0.65 }),
            });
            const dupData = await dupRes.json();
            if (dupData.is_duplicate) {
                return res.status(409).json({
                    success: false,
                    message: `This face is already registered to ${dupData.existing_name}. One face per user only.`,
                });
            }
        }

        // Generate embedding
        const embedRes = await fetch(`${FACE_URL}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image }),
        });

        if (!embedRes.ok) {
            const err = await embedRes.json();
            return res.status(400).json({ success: false, message: err.detail || "Face processing failed" });
        }

        const embedData = await embedRes.json();

        await db.users.update({ _id: user._id }, {
            $set: {
                faceEmbedding: {
                    vector: embedData.embedding,
                    model: "custom-histogram-v2",
                    registeredAt: new Date(),
                    confidence: embedData.quality?.sharpness || 0,
                    thumbnail: embedData.thumbnail || null,
                },
            },
        });

        res.json({ success: true, message: "Face registered successfully!", thumbnail: embedData.thumbnail });
    } catch (err) {
        console.error("Face register error:", err);
        res.status(500).json({ success: false, message: "Face service error. Ensure the face service is running." });
    }
});

// ── POST /api/face/scan ──────────────────────────────────
router.post("/scan", verifyToken, faceScanLimiter, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ success: false, message: "Image is required" });

        const allUsers = await db.users.find({ status: "active", "faceEmbedding.vector": { $exists: true } });
        const usersWithFace = allUsers.filter(u => u.faceEmbedding?.vector?.length > 0);

        if (usersWithFace.length === 0) {
            return res.status(404).json({ success: false, message: "No faces registered in the system." });
        }

        const storedEmbeddings = usersWithFace.map(u => ({
            user_id: u._id, name: u.name, embedding: u.faceEmbedding.vector,
        }));

        const matchRes = await fetch(`${FACE_URL}/match`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, stored_embeddings: storedEmbeddings, threshold: 0.55 }),
        });

        if (!matchRes.ok) {
            const err = await matchRes.json();
            return res.status(400).json({ success: false, message: err.detail || "Face scan failed" });
        }

        const matchData = await matchRes.json();

        if (!matchData.matched) {
            return res.json({ success: false, message: "Face not recognized.", bestScore: matchData.best_score });
        }

        const matchedUser = usersWithFace.find(u => u._id === matchData.user_id);

        res.json({
            success: true,
            message: "Face recognized!",
            user: {
                id: matchedUser._id, name: matchedUser.name, email: matchedUser.email,
                employeeId: matchedUser.employeeId, department: matchedUser.department,
                thumbnail: matchedUser.faceEmbedding?.thumbnail,
            },
            confidence: matchData.confidence,
            liveness: matchData.liveness,
        });
    } catch (err) {
        console.error("Face scan error:", err);
        res.status(500).json({ success: false, message: "Face service error. Ensure the face service is running." });
    }
});

module.exports = router;
