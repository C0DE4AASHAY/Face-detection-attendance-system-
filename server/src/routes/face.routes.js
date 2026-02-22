const express = require("express");
const fetch = require("node-fetch");
const User = require("../models/User");
const { verifyToken } = require("../middleware/auth");
const { faceScanLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const FACE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";

// ── P O S T   /api/face/register ─────────────────────────
router.post("/register", verifyToken, faceScanLimiter, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ success: false, message: "Camera image is required for registration." });

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        // Ensure users with existing faces use /face/enroll API (future proofing), block re-registers here
        if (user.faceEmbedding && user.faceEmbedding.vector && user.faceEmbedding.vector.length > 0) {
            return res.status(400).json({ success: false, message: "Face already registered. Contact admin to reset." });
        }

        // 1. Check for duplicates across ALL active users
        const usersWithFaces = await User.find({
            _id: { $ne: user._id },
            "faceEmbedding.vector": { $exists: true, $not: { $size: 0 } }
        }).select("_id name faceEmbedding.vector");

        if (usersWithFaces.length > 0) {
            const storedEmbeddings = usersWithFaces.map(u => ({
                user_id: u._id.toString(),
                name: u.name,
                embedding: u.faceEmbedding.vector
            }));

            // Call face service for duplicate check
            const dupRes = await fetch(`${FACE_URL}/duplicate-check`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image,
                    stored_embeddings: storedEmbeddings,
                    threshold: 0.65 // Tunable duplicate threshold
                }),
            });

            const dupData = await dupRes.json();

            if (dupData.is_duplicate) {
                return res.status(409).json({
                    success: false,
                    message: `Duplicate face detected! This face is already registered to ${dupData.existing_name}. Stop playing games.`
                });
            }
        }

        // 2. Generate new embedding
        const embedRes = await fetch(`${FACE_URL}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image }),
        });

        if (!embedRes.ok) {
            const errorData = await embedRes.json();
            return res.status(400).json({ success: false, message: errorData.detail || "Failed to process face." });
        }

        const embedData = await embedRes.json();

        // 3. Save to user document
        user.faceEmbedding = {
            vector: embedData.embedding,
            model: "custom-histogram-v2",
            registeredAt: new Date(),
            confidence: embedData.quality?.sharpness || 0,
            thumbnail: embedData.thumbnail || null
        };

        await user.save();

        res.json({
            success: true,
            message: "Face registered successfully!",
            thumbnail: embedData.thumbnail
        });

    } catch (err) {
        console.error("Face Register Error:", err);
        res.status(500).json({ success: false, message: "Face service error. Is the Python service running?" });
    }
});


// ── P O S T   /api/face/scan ─────────────────────────────
router.post("/scan", verifyToken, faceScanLimiter, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ success: false, message: "Camera image is required for scanning." });

        // Fetch all active users with faces
        const usersWithFaces = await User.find({
            status: "active",
            "faceEmbedding.vector": { $exists: true, $not: { $size: 0 } }
        }).select("_id name email employeeId department faceEmbedding");

        if (usersWithFaces.length === 0) {
            return res.status(404).json({ success: false, message: "No registered faces in the system." });
        }

        const storedEmbeddings = usersWithFaces.map(u => ({
            user_id: u._id.toString(),
            name: u.name,
            embedding: u.faceEmbedding.vector
        }));

        // Call Face Service for matching
        const matchRes = await fetch(`${FACE_URL}/match`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image,
                stored_embeddings: storedEmbeddings,
                threshold: 0.55 // default match threshold
            }),
        });

        if (!matchRes.ok) {
            const errorData = await matchRes.json();
            return res.status(400).json({ success: false, message: errorData.detail || "Face recognition failed." });
        }

        const matchData = await matchRes.json();

        if (!matchData.matched) {
            return res.json({
                success: false,
                message: "Face not recognized. Please try again.",
                bestScore: matchData.best_score
            });
        }

        // Find the matched user
        const matchedUser = usersWithFaces.find(u => u._id.toString() === matchData.user_id);

        res.json({
            success: true,
            message: "Face successfully recognized!",
            user: {
                id: matchedUser._id,
                name: matchedUser.name,
                email: matchedUser.email,
                employeeId: matchedUser.employeeId,
                department: matchedUser.department,
                thumbnail: matchedUser.faceEmbedding?.thumbnail
            },
            confidence: matchData.confidence,
            liveness: matchData.liveness
        });

    } catch (err) {
        console.error("Face Scan Error:", err);
        res.status(500).json({ success: false, message: "Face service timeout or error. Ensure the Python API is running." });
    }
});

module.exports = router;
