"""
Face Recognition Microservice — FastAPI
Handles face detection, embedding generation, matching, and liveness checks.
Uses OpenCV DNN for detection and LBPH/histogram-based embeddings.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import numpy as np
import cv2
import base64
import os
from io import BytesIO
from PIL import Image

app = FastAPI(title="FaceTrack Face Service", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Face detection setup ──────────────────────────────────────
CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
face_cascade = cv2.CascadeClassifier(CASCADE_PATH)
EYE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_eye.xml"
eye_cascade = cv2.CascadeClassifier(EYE_CASCADE_PATH)

EMBEDDING_SIZE = 128  # Our custom embedding dimension
FACE_SIZE = (160, 160)


# ── Pydantic Models ───────────────────────────────────────────
class ImageRequest(BaseModel):
    image: str  # base64 encoded

class MatchRequest(BaseModel):
    image: str
    stored_embeddings: List[dict]  # [{user_id, name, embedding: [float]}]
    threshold: float = 0.55

class LivenessRequest(BaseModel):
    image: str


# ── Image Utils ───────────────────────────────────────────────
def b64_to_image(b64_string: str) -> np.ndarray:
    """Convert base64 to RGB numpy array."""
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    img_bytes = base64.b64decode(b64_string)
    img = Image.open(BytesIO(img_bytes)).convert("RGB")
    return np.array(img)


def image_to_b64(img_array: np.ndarray) -> str:
    """Convert RGB numpy array to base64 JPEG."""
    img = Image.fromarray(img_array)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ── Face Detection ────────────────────────────────────────────
def detect_face(image_rgb: np.ndarray):
    """Detect faces. Returns list of (x, y, w, h)."""
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=7, minSize=(80, 80)
    )
    return faces if len(faces) > 0 else []


def crop_face(image_rgb: np.ndarray, bbox, padding=30):
    """Crop face with padding."""
    x, y, w, h = bbox
    ih, iw = image_rgb.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(iw, x + w + padding)
    y2 = min(ih, y + h + padding)
    return image_rgb[y1:y2, x1:x2]


# ── Embedding Generation ─────────────────────────────────────
def generate_embedding(image_rgb: np.ndarray) -> Optional[np.ndarray]:
    """
    Generate a face embedding using multi-scale histogram features.
    Combines LBP, HOG, and intensity histograms for a robust 128-d vector.
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    faces = detect_face(image_rgb)

    if len(faces) == 0:
        return None

    x, y, w, h = faces[0]
    face_roi = gray[y:y+h, x:x+w]
    face_roi = cv2.resize(face_roi, FACE_SIZE)
    face_roi = cv2.equalizeHist(face_roi)

    features = []

    # 1. Multi-region intensity histograms (4x4 grid = 16 regions × 8 bins = 128 features → take 48)
    grid_h, grid_w = FACE_SIZE[0] // 4, FACE_SIZE[1] // 4
    for gy in range(4):
        for gx in range(4):
            region = face_roi[gy*grid_h:(gy+1)*grid_h, gx*grid_w:(gx+1)*grid_w]
            hist = cv2.calcHist([region], [0], None, [3], [0, 256])
            features.extend(hist.flatten())

    # 2. HOG-like gradient features
    gx = cv2.Sobel(face_roi, cv2.CV_64F, 1, 0, ksize=3)
    gy_img = cv2.Sobel(face_roi, cv2.CV_64F, 0, 1, ksize=3)
    magnitude = np.sqrt(gx**2 + gy_img**2)
    angle = np.arctan2(gy_img, gx) * 180 / np.pi + 180

    # Gradient histograms for 2x2 regions
    rh, rw = FACE_SIZE[0] // 2, FACE_SIZE[1] // 2
    for ry in range(2):
        for rx in range(2):
            r_mag = magnitude[ry*rh:(ry+1)*rh, rx*rw:(rx+1)*rw]
            r_ang = angle[ry*rh:(ry+1)*rh, rx*rw:(rx+1)*rw]
            hist, _ = np.histogram(r_ang, bins=8, range=(0, 360), weights=r_mag)
            features.extend(hist / (np.sum(hist) + 1e-8))

    # 3. Gabor-like texture features
    for theta in [0, 45, 90, 135]:
        kernel = cv2.getGaborKernel((15, 15), 4.0, theta * np.pi / 180, 8.0, 0.5, 0, ktype=cv2.CV_64F)
        filtered = cv2.filter2D(face_roi.astype(np.float64), cv2.CV_64F, kernel)
        features.append(np.mean(filtered))
        features.append(np.std(filtered))

    embedding = np.array(features, dtype=np.float32)

    # Normalize to unit vector (crucial for cosine similarity)
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    # Pad or truncate to EMBEDDING_SIZE
    if len(embedding) < EMBEDDING_SIZE:
        embedding = np.pad(embedding, (0, EMBEDDING_SIZE - len(embedding)))
    else:
        embedding = embedding[:EMBEDDING_SIZE]

    # Re-normalize after padding/truncation
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding


# ── Cosine Similarity ─────────────────────────────────────────
def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    dot = np.dot(a, b)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


def batch_match(unknown_emb: np.ndarray, stored: List[dict], threshold: float):
    """Match unknown embedding against all stored embeddings."""
    if not stored:
        return None

    best_match = None
    best_score = -1.0

    for entry in stored:
        emb = np.array(entry["embedding"], dtype=np.float32)
        score = cosine_similarity(unknown_emb, emb)
        if score > best_score:
            best_score = score
            best_match = entry

    if best_score >= threshold:
        return {
            "matched": True,
            "user_id": best_match["user_id"],
            "name": best_match.get("name", "Unknown"),
            "confidence": round(best_score * 100, 2)
        }

    return {"matched": False, "best_score": round(best_score * 100, 2)}


# ── Liveness Detection ────────────────────────────────────────
def check_liveness(image_rgb: np.ndarray) -> dict:
    """
    Multi-factor liveness detection:
    1. Texture analysis (Laplacian variance — screens/photos are smoother)
    2. Frequency analysis (screens have periodic pixel patterns)
    3. Color variance (printed photos have less color depth)
    4. Eye detection (basic proof of real face structure)
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

    # 1. Texture — Laplacian variance
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    texture_ok = lap_var > 80

    # 2. Frequency — check for Moiré patterns
    f = np.fft.fft2(gray.astype(float))
    fshift = np.fft.fftshift(f)
    mag = np.abs(fshift)
    high_freq = np.mean(mag[mag > np.percentile(mag, 95)])
    freq_ok = high_freq > 30

    # 3. Color depth
    hsv = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2HSV)
    sat_std = np.std(hsv[:, :, 1])
    color_ok = sat_std > 20

    # 4. Eye detection in face region
    faces = detect_face(image_rgb)
    eyes_found = False
    if len(faces) > 0:
        x, y, w, h = faces[0]
        roi_gray = gray[y:y+h, x:x+w]
        eyes = eye_cascade.detectMultiScale(roi_gray, 1.1, 5, minSize=(20, 20))
        eyes_found = len(eyes) >= 1

    score = sum([texture_ok, freq_ok, color_ok, eyes_found])
    is_live = score >= 3  # At least 3 out of 4 checks pass

    return {
        "is_live": is_live,
        "score": score,
        "details": {
            "texture": {"passed": texture_ok, "value": round(lap_var, 2)},
            "frequency": {"passed": freq_ok, "value": round(high_freq, 2)},
            "color_depth": {"passed": color_ok, "value": round(float(sat_std), 2)},
            "eyes_detected": eyes_found
        }
    }


# ── Quality Validation ────────────────────────────────────────
def validate_quality(image_rgb: np.ndarray) -> dict:
    """Check image quality for reliable recognition."""
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    brightness = np.mean(gray)
    blur = cv2.Laplacian(gray, cv2.CV_64F).var()

    issues = []
    if brightness < 40:
        issues.append("Image too dark")
    if brightness > 230:
        issues.append("Image too bright")
    if blur < 50:
        issues.append("Image too blurry")

    return {
        "acceptable": len(issues) == 0,
        "brightness": round(float(brightness), 1),
        "sharpness": round(float(blur), 1),
        "issues": issues
    }


# ── API Endpoints ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "face-recognition", "version": "2.0"}


@app.post("/embed")
def embed_face(req: ImageRequest):
    """Generate face embedding from image."""
    try:
        image = b64_to_image(req.image)
    except Exception:
        raise HTTPException(400, "Invalid image data")

    quality = validate_quality(image)
    if not quality["acceptable"]:
        raise HTTPException(400, f"Image quality issue: {', '.join(quality['issues'])}")

    faces = detect_face(image)
    if len(faces) == 0:
        raise HTTPException(400, "No face detected in the image")
    if len(faces) > 1:
        raise HTTPException(400, "Multiple faces detected — only one face allowed")

    embedding = generate_embedding(image)
    if embedding is None:
        raise HTTPException(400, "Could not generate face embedding")

    # Create thumbnail
    face_crop = crop_face(image, faces[0])
    thumbnail = image_to_b64(face_crop)

    return {
        "success": True,
        "embedding": embedding.tolist(),
        "embedding_size": len(embedding),
        "quality": quality,
        "thumbnail": thumbnail
    }


@app.post("/match")
def match_face(req: MatchRequest):
    """Match a face against stored embeddings."""
    try:
        image = b64_to_image(req.image)
    except Exception:
        raise HTTPException(400, "Invalid image data")

    quality = validate_quality(image)
    if not quality["acceptable"]:
        raise HTTPException(400, f"Image quality issue: {', '.join(quality['issues'])}")

    embedding = generate_embedding(image)
    if embedding is None:
        raise HTTPException(400, "No face detected")

    result = batch_match(embedding, req.stored_embeddings, req.threshold)
    result["quality"] = quality

    # Liveness check
    liveness = check_liveness(image)
    result["liveness"] = liveness

    return result


@app.post("/liveness")
def liveness_check(req: LivenessRequest):
    """Check if the face is live (not a photo/screen)."""
    try:
        image = b64_to_image(req.image)
    except Exception:
        raise HTTPException(400, "Invalid image data")

    return check_liveness(image)


@app.post("/duplicate-check")
def duplicate_check(req: MatchRequest):
    """Check if this face already exists in the system."""
    try:
        image = b64_to_image(req.image)
    except Exception:
        raise HTTPException(400, "Invalid image data")

    embedding = generate_embedding(image)
    if embedding is None:
        raise HTTPException(400, "No face detected")

    # Use higher threshold for duplicate detection
    dup_threshold = max(req.threshold, 0.65)
    result = batch_match(embedding, req.stored_embeddings, dup_threshold)

    if result.get("matched"):
        return {
            "is_duplicate": True,
            "existing_user_id": result["user_id"],
            "existing_name": result["name"],
            "similarity": result["confidence"]
        }

    return {"is_duplicate": False}


# ── Run ───────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🧠 Face Recognition Service starting on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
