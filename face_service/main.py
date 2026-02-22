"""
Face Recognition Microservice — FastAPI (STABLE VERSION)
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

app = FastAPI(title="FaceTrack Face Service", version="2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Face detection setup ───────────────────────────────
CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
EYE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_eye.xml"

face_cascade = cv2.CascadeClassifier(CASCADE_PATH)
eye_cascade = cv2.CascadeClassifier(EYE_CASCADE_PATH)

if face_cascade.empty():
    raise RuntimeError("Failed to load face cascade XML")

if eye_cascade.empty():
    raise RuntimeError("Failed to load eye cascade XML")

EMBEDDING_SIZE = 128
FACE_SIZE = (160, 160)


# ── Models ─────────────────────────────────────────────
class ImageRequest(BaseModel):
    image: str


class MatchRequest(BaseModel):
    image: str
    stored_embeddings: List[dict]
    threshold: float = 0.55


class LivenessRequest(BaseModel):
    image: str


# ── Utils ──────────────────────────────────────────────
def b64_to_image(b64_string: str) -> np.ndarray:
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    try:
        img_bytes = base64.b64decode(b64_string)
        img = Image.open(BytesIO(img_bytes)).convert("RGB")
        return np.array(img)
    except Exception:
        raise ValueError("Invalid base64 image")


def image_to_b64(img_array: np.ndarray) -> str:
    img = Image.fromarray(img_array)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ── Detection ──────────────────────────────────────────
def detect_face(image_rgb: np.ndarray):
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=6, minSize=(80, 80)
    )
    return faces if len(faces) > 0 else []


def crop_face(image_rgb: np.ndarray, bbox, padding=30):
    x, y, w, h = bbox
    ih, iw = image_rgb.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(iw, x + w + padding)
    y2 = min(ih, y + h + padding)
    return image_rgb[y1:y2, x1:x2]


# ── Embedding ──────────────────────────────────────────
def generate_embedding(image_rgb: np.ndarray) -> Optional[np.ndarray]:
    faces = detect_face(image_rgb)
    if len(faces) == 0:
        return None

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    x, y, w, h = faces[0]

    face_roi = gray[y:y+h, x:x+w]
    face_roi = cv2.resize(face_roi, FACE_SIZE)
    face_roi = cv2.equalizeHist(face_roi)

    features = []

    # Histogram features
    grid_h, grid_w = FACE_SIZE[0] // 4, FACE_SIZE[1] // 4
    for gy in range(4):
        for gx in range(4):
            region = face_roi[gy*grid_h:(gy+1)*grid_h, gx*grid_w:(gx+1)*grid_w]
            hist = cv2.calcHist([region], [0], None, [3], [0, 256])
            hist = hist.flatten()
            hist = hist / (np.sum(hist) + 1e-8)
            features.extend(hist)

    # Gradient features
    gx = cv2.Sobel(face_roi, cv2.CV_64F, 1, 0)
    gy_img = cv2.Sobel(face_roi, cv2.CV_64F, 0, 1)
    magnitude = np.sqrt(gx**2 + gy_img**2)
    angle = np.arctan2(gy_img, gx) * 180 / np.pi + 180

    rh, rw = FACE_SIZE[0] // 2, FACE_SIZE[1] // 2
    for ry in range(2):
        for rx in range(2):
            r_mag = magnitude[ry*rh:(ry+1)*rh, rx*rw:(rx+1)*rw]
            r_ang = angle[ry*rh:(ry+1)*rh, rx*rw:(rx+1)*rw]
            hist, _ = np.histogram(r_ang, bins=8, range=(0, 360), weights=r_mag)
            hist = hist / (np.sum(hist) + 1e-8)
            features.extend(hist)

    embedding = np.array(features, dtype=np.float32)

    # Normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding /= norm

    # Force size 128
    if len(embedding) < EMBEDDING_SIZE:
        embedding = np.pad(embedding, (0, EMBEDDING_SIZE - len(embedding)))
    else:
        embedding = embedding[:EMBEDDING_SIZE]

    embedding /= (np.linalg.norm(embedding) + 1e-8)
    return embedding


# ── Matching ───────────────────────────────────────────
def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) != EMBEDDING_SIZE or len(b) != EMBEDDING_SIZE:
        return 0.0

    dot = np.dot(a, b)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


def batch_match(unknown_emb: np.ndarray, stored: List[dict], threshold: float):
    if not stored:
        return {"matched": False, "best_score": 0.0}

    threshold = min(max(threshold, 0.3), 0.85)

    best_match = None
    best_score = -1.0

    for entry in stored:
        emb = np.array(entry.get("embedding", []), dtype=np.float32)
        if len(emb) != EMBEDDING_SIZE:
            continue

        score = cosine_similarity(unknown_emb, emb)
        if score > best_score:
            best_score = score
            best_match = entry

    if best_score >= threshold and best_match:
        return {
            "matched": True,
            "user_id": best_match.get("user_id"),
            "name": best_match.get("name", "Unknown"),
            "confidence": round(best_score * 100, 2)
        }

    return {"matched": False, "best_score": round(best_score * 100, 2)}


# ── Liveness ───────────────────────────────────────────
def check_liveness(image_rgb: np.ndarray):
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    texture_ok = lap_var > 80

    f = np.fft.fft2(gray.astype(float))
    mag = np.abs(np.fft.fftshift(f))
    mask = mag > np.percentile(mag, 95)

    high_freq = float(np.mean(mag[mask])) if np.any(mask) else 0.0
    freq_ok = high_freq > 30

    hsv = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2HSV)
    sat_std = float(np.std(hsv[:, :, 1]))
    color_ok = sat_std > 20

    faces = detect_face(image_rgb)
    eyes_found = False
    if len(faces) > 0:
        x, y, w, h = faces[0]
        roi_gray = gray[y:y+h, x:x+w]
        eyes = eye_cascade.detectMultiScale(roi_gray, 1.1, 5)
        eyes_found = len(eyes) >= 1

    score = sum([texture_ok, freq_ok, color_ok, eyes_found])

    return {
        "is_live": score >= 3,
        "score": score,
        "details": {
            "texture": round(float(lap_var), 2),
            "frequency": round(high_freq, 2),
            "color_depth": round(sat_std, 2),
            "eyes_detected": eyes_found
        }
    }
