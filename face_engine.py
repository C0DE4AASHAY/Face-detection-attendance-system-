"""
Face Detection and Recognition Engine.
Uses OpenCV Haar cascades for detection and LBPH for recognition.
No external model downloads required — everything is bundled with OpenCV.
"""

import cv2
import numpy as np
import base64
import os
from io import BytesIO
from PIL import Image

# Path for the Haar cascade (bundled with OpenCV)
CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
face_cascade = cv2.CascadeClassifier(CASCADE_PATH)

# LBPH Face Recognizer
recognizer = cv2.face.LBPHFaceRecognizer_create(radius=2, neighbors=16, grid_x=8, grid_y=8)
_recognizer_trained = False
_label_map = {}  # label_int -> employee data


def base64_to_image(b64_string):
    """Convert a base64-encoded image string to a numpy array (RGB)."""
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    img_bytes = base64.b64decode(b64_string)
    img = Image.open(BytesIO(img_bytes)).convert("RGB")
    return np.array(img)


def image_to_base64(img_array):
    """Convert a numpy array (RGB) to a base64-encoded JPEG string."""
    img = Image.fromarray(img_array)
    buffer = BytesIO()
    img.save(buffer, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("utf-8")


def detect_faces(image_rgb):
    """
    Detect face locations in an RGB image.
    Returns list of (x, y, w, h) tuples.
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(80, 80),
        flags=cv2.CASCADE_SCALE_IMAGE
    )
    return faces if len(faces) > 0 else []


def extract_face_roi(image_rgb, target_size=(200, 200)):
    """
    Extract the face region of interest as a grayscale, resized array.
    Returns (face_roi, error_message).
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80)
    )

    if len(faces) == 0:
        return None, "No face detected in the image."
    if len(faces) > 1:
        return None, "Multiple faces detected. Please ensure only one face is in the frame."

    x, y, w, h = faces[0]
    face_roi = gray[y:y+h, x:x+w]
    face_roi = cv2.resize(face_roi, target_size)

    # Apply histogram equalization for better recognition
    face_roi = cv2.equalizeHist(face_roi)

    return face_roi, None


def encode_face(image_rgb):
    """
    Generate a face 'encoding' — actually the preprocessed grayscale face ROI
    stored as a flat numpy array (serializable via pickle in database.py).
    Returns (encoding, error_message).
    """
    face_roi, error = extract_face_roi(image_rgb)
    if error:
        return None, error
    # Store as flat float32 array
    return face_roi.astype(np.float32).flatten(), None


def train_recognizer(known_data):
    """
    Train the LBPH recognizer with all known face data.
    known_data: list of dicts with 'id', 'name', 'employee_id', 'department', 'encoding', 'photo'
    """
    global _recognizer_trained, _label_map, recognizer

    if not known_data:
        _recognizer_trained = False
        return

    faces = []
    labels = []
    _label_map = {}

    for i, d in enumerate(known_data):
        encoding = d["encoding"]
        # Reshape back to 200x200
        size = int(np.sqrt(len(encoding)))
        face_img = encoding.reshape((size, size)).astype(np.uint8)
        faces.append(face_img)
        labels.append(i)
        _label_map[i] = {
            "id": d["id"],
            "name": d["name"],
            "employee_id": d["employee_id"],
            "department": d["department"],
            "photo": d.get("photo")
        }

    recognizer = cv2.face.LBPHFaceRecognizer_create(radius=2, neighbors=16, grid_x=8, grid_y=8)
    recognizer.train(faces, np.array(labels))
    _recognizer_trained = True


def match_face(unknown_encoding, known_data, threshold=85):
    """
    Compare an unknown face encoding against all known faces.
    Returns the best match with confidence, or None.
    """
    if not known_data:
        return None

    # Train if needed
    train_recognizer(known_data)

    if not _recognizer_trained:
        return None

    # Reshape the unknown face
    size = int(np.sqrt(len(unknown_encoding)))
    face_img = unknown_encoding.reshape((size, size)).astype(np.uint8)

    label, distance = recognizer.predict(face_img)

    # LBPH distance: lower = better match. Convert to confidence %.
    # Typical good matches are < 50, bad matches > 100
    confidence = max(0, min(100, round(100 - distance, 1)))

    if confidence >= (100 - threshold):
        match = _label_map[label].copy()
        match["confidence"] = confidence
        return match

    return None


def validate_image_quality(image_rgb):
    """
    Validate image quality for reliable face detection.
    Returns (is_ok, message).
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

    brightness = np.mean(gray)
    if brightness < 40:
        return False, "Image is too dark. Please improve lighting."
    if brightness > 220:
        return False, "Image is too bright. Please reduce lighting."

    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if laplacian_var < 50:
        return False, "Image is too blurry. Please hold steady."

    return True, "Image quality is acceptable."


def crop_face(image_rgb, padding=40):
    """Crop the first detected face from the image with padding."""
    faces = detect_faces(image_rgb)
    if len(faces) == 0:
        return None

    x, y, w, h = faces[0]
    ih, iw = image_rgb.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(iw, x + w + padding)
    y2 = min(ih, y + h + padding)
    return image_rgb[y1:y2, x1:x2]


def get_face_thumbnail(image_rgb):
    """Get a cropped face thumbnail as base64."""
    cropped = crop_face(image_rgb)
    if cropped is None:
        return None
    return image_to_base64(cropped)
