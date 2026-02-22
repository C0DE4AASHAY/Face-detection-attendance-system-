"""
Face Detection Attendance System — Flask Application.
Serves the web UI and REST API endpoints.
"""

import os
import csv
import io
from datetime import date, datetime
from flask import Flask, render_template, request, jsonify, Response
from database import init_db, add_employee, get_all_employees, delete_employee, \
    get_all_face_encodings, mark_attendance, get_today_attendance, \
    get_attendance_records, get_analytics_data
from face_engine import base64_to_image, encode_face, match_face, \
    validate_image_quality, get_face_thumbnail

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB max upload


# ── Pages ──────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── API: Registration ─────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def api_register():
    """Register a new employee face."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No data received."}), 400

    name = data.get("name", "").strip()
    employee_id = data.get("employee_id", "").strip()
    department = data.get("department", "General").strip()
    image_b64 = data.get("image", "")

    if not name or not employee_id or not image_b64:
        return jsonify({"success": False, "message": "Name, Employee ID, and image are required."}), 400

    try:
        image = base64_to_image(image_b64)
    except Exception:
        return jsonify({"success": False, "message": "Invalid image data."}), 400

    # Validate image quality
    is_ok, msg = validate_image_quality(image)
    if not is_ok:
        return jsonify({"success": False, "message": msg}), 400

    # Encode face
    encoding, error = encode_face(image)
    if error:
        return jsonify({"success": False, "message": error}), 400

    # Get face thumbnail
    thumbnail = get_face_thumbnail(image)

    # Save to database
    result = add_employee(name, employee_id, department, encoding, photo=thumbnail)
    return jsonify(result)


# ── API: Attendance ────────────────────────────────────────────

@app.route("/api/attendance", methods=["POST"])
def api_attendance():
    """Scan a face and mark attendance."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No data received."}), 400

    image_b64 = data.get("image", "")
    if not image_b64:
        return jsonify({"success": False, "message": "Image is required."}), 400

    try:
        image = base64_to_image(image_b64)
    except Exception:
        return jsonify({"success": False, "message": "Invalid image data."}), 400

    # Validate quality
    is_ok, msg = validate_image_quality(image)
    if not is_ok:
        return jsonify({"success": False, "message": msg}), 400

    # Encode the scanned face
    encoding, error = encode_face(image)
    if error:
        return jsonify({"success": False, "message": error}), 400

    # Match against database
    known = get_all_face_encodings()
    if not known:
        return jsonify({"success": False, "message": "No employees registered yet."}), 400

    match = match_face(encoding, known)
    if not match:
        return jsonify({"success": False, "message": "Face not recognized. No match found."}), 200

    # Determine check-in or check-out
    today_records = get_today_attendance(match["id"])
    check_ins = [r for r in today_records if r["status"] == "check-in"]
    check_outs = [r for r in today_records if r["status"] == "check-out"]

    if len(check_ins) == 0:
        status = "check-in"
    elif len(check_ins) > len(check_outs):
        status = "check-out"
    else:
        status = "check-in"

    mark_attendance(match["id"], status, match["confidence"])

    return jsonify({
        "success": True,
        "message": f"{match['name']} — {status.replace('-', ' ').title()} recorded!",
        "employee": {
            "name": match["name"],
            "employee_id": match["employee_id"],
            "department": match["department"],
            "photo": match.get("photo"),
            "confidence": match["confidence"],
            "status": status,
            "time": datetime.now().strftime("%I:%M %p")
        }
    })


# ── API: Employees ─────────────────────────────────────────────

@app.route("/api/employees", methods=["GET"])
def api_employees():
    employees = get_all_employees()
    return jsonify(employees)


@app.route("/api/employees/<int:db_id>", methods=["DELETE"])
def api_delete_employee(db_id):
    delete_employee(db_id)
    return jsonify({"success": True, "message": "Employee removed."})


# ── API: Records ───────────────────────────────────────────────

@app.route("/api/records", methods=["GET"])
def api_records():
    start = request.args.get("start")
    end = request.args.get("end")
    emp = request.args.get("employee_id")
    records = get_attendance_records(start, end, emp)
    return jsonify(records)


# ── API: Analytics ─────────────────────────────────────────────

@app.route("/api/analytics", methods=["GET"])
def api_analytics():
    data = get_analytics_data()
    return jsonify(data)


# ── API: CSV Export ────────────────────────────────────────────

@app.route("/api/export", methods=["GET"])
def api_export():
    start = request.args.get("start")
    end = request.args.get("end")
    records = get_attendance_records(start, end)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Employee ID", "Department", "Timestamp", "Status", "Confidence"])
    for r in records:
        writer.writerow([r["name"], r["employee_id"], r["department"],
                         r["timestamp"], r["status"], r["confidence"]])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=attendance_{date.today()}.csv"}
    )


# ── Main ───────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("✅ Database initialized.")
    print("🚀 Starting Face Detection Attendance System...")
    print("   Open http://localhost:5000 in your browser")
    app.run(debug=True, host="0.0.0.0", port=5000)
