const express = require("express");
const fetch = require("node-fetch");
const User = require("../models/User");
const { verifyToken } = require("../middleware/auth");
const { faceScanLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const FACE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";

// ── Retry helper for face service calls ──────────────────
async function fetchWithRetry(url, options, retries = 1, delayMs = 3000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            // If server error (5xx) and we have retries left, retry
            if (res.status >= 500 && attempt < retries) {
                console.log(`⚠️ Face service returned ${res.status}, retrying in ${delayMs}ms... (attempt ${attempt + 1})`);
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            return res;
        } catch (err) {
            if (attempt < retries) {
                console.log(`⚠️ Face service unreachable, retrying in ${delayMs}ms... (attempt ${attempt + 1})`);
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            throw err;
        }
    }
}

// ── Safe JSON parse helper ───────────────────────────────
async function safeJsonError(res, fallbackMsg) {
    try {
        const data = await res.json();
        return data.detail || fallbackMsg;
    } catch {
        try { return await res.text(); } catch { return fallbackMsg; }
    }
}

// ── G E T   /api/face/health ─────────────────────────────
router.get("/health", async (req, res) => {
    try {
        const healthRes = await fetch(`${FACE_URL}/health`, {
            signal: AbortSignal.timeout(10000),
        });
        const data = await healthRes.json();
        res.json({ success: true, faceService: data });
    } catch (err) {
        res.status(503).json({
            success: false,
            message: "Face service is unavailable. It may be warming up — please try again in 30 seconds.",
        });
    }
});

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
            const dupRes = await fetchWithRetry(`${FACE_URL}/duplicate-check`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image,
                    stored_embeddings: storedEmbeddings,
                    threshold: 0.65
                }),
                signal: AbortSignal.timeout(90000),
            });

            if (!dupRes.ok) {
                const errMsg = await safeJsonError(dupRes, "Duplicate check failed.");
                return res.status(502).json({ success: false, message: errMsg });
            }

            const dupData = await dupRes.json();

            if (dupData.is_duplicate) {
                return res.status(409).json({
                    success: false,
                    message: `Duplicate face detected! This face is already registered to ${dupData.existing_name}. Stop playing games.`
                });
            }
        }

        // 2. Generate new embedding
        const embedRes = await fetchWithRetry(`${FACE_URL}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image }),
            signal: AbortSignal.timeout(90000),
        });

        if (!embedRes.ok) {
            const errMsg = await safeJsonError(embedRes, "Failed to process face.");
            return res.status(502).json({ success: false, message: errMsg });
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
        const isTimeout = err.name === "AbortError" || err.name === "TimeoutError";
        res.status(500).json({
            success: false,
            message: isTimeout
                ? "Face service is slow to respond (cold start). Please try again in 30 seconds."
                : "Face service error. Is the Python service running?"
        });
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

        // Call Face Service for matching — WITH RETRY
        const matchRes = await fetchWithRetry(`${FACE_URL}/match`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image,
                stored_embeddings: storedEmbeddings,
                threshold: 0.55
            }),
            signal: AbortSignal.timeout(90000),
        });

        if (!matchRes.ok) {
            const errMsg = await safeJsonError(matchRes, "Face recognition failed.");
            return res.status(502).json({ success: false, message: errMsg });
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

        if (!matchedUser) {
            return res.status(404).json({ success: false, message: "Matched user not found in database." });
        }

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
        const isTimeout = err.name === "AbortError" || err.name === "TimeoutError";
        res.status(500).json({
            success: false,
            message: isTimeout
                ? "Face service is slow to respond (cold start). Please wait 30 seconds and try again."
                : "Face service error. Please try again."
        });
    }
});

module.exports = router;
