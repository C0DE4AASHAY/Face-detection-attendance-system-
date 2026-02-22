"""
Database layer for Face Detection Attendance System.
Handles SQLite storage for employees, face encodings, and attendance records.
"""

import sqlite3
import pickle
import os
from datetime import datetime, date

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "attendance.db")


def get_db():
    """Get a database connection with row_factory set."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize the database tables."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            employee_id TEXT UNIQUE NOT NULL,
            department TEXT DEFAULT 'General',
            face_encoding BLOB NOT NULL,
            photo TEXT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_db_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL CHECK(status IN ('check-in', 'check-out')),
            confidence REAL DEFAULT 0.0,
            FOREIGN KEY (employee_db_id) REFERENCES employees(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_attendance_employee
        ON attendance(employee_db_id)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_attendance_timestamp
        ON attendance(timestamp)
    """)

    conn.commit()
    conn.close()


# ── Employee CRUD ──────────────────────────────────────────────

def add_employee(name, employee_id, department, face_encoding, photo=None):
    """Register a new employee with their face encoding."""
    conn = get_db()
    try:
        encoding_blob = pickle.dumps(face_encoding)
        conn.execute(
            """INSERT INTO employees (name, employee_id, department, face_encoding, photo)
               VALUES (?, ?, ?, ?, ?)""",
            (name, employee_id, department, encoding_blob, photo)
        )
        conn.commit()
        return {"success": True, "message": f"Employee {name} registered successfully."}
    except sqlite3.IntegrityError:
        return {"success": False, "message": f"Employee ID '{employee_id}' already exists."}
    finally:
        conn.close()


def get_all_employees():
    """Get all registered employees (without encoding blobs for performance)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, employee_id, department, photo, registered_at FROM employees ORDER BY name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_employee_by_id(db_id):
    """Get a single employee by database ID."""
    conn = get_db()
    row = conn.execute("SELECT * FROM employees WHERE id = ?", (db_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_employee(db_id):
    """Delete an employee and their attendance records."""
    conn = get_db()
    conn.execute("DELETE FROM employees WHERE id = ?", (db_id,))
    conn.commit()
    conn.close()


def get_all_face_encodings():
    """Load all face encodings from the database for matching."""
    conn = get_db()
    rows = conn.execute("SELECT id, name, employee_id, department, face_encoding, photo FROM employees").fetchall()
    conn.close()

    result = []
    for r in rows:
        encoding = pickle.loads(r["face_encoding"])
        result.append({
            "id": r["id"],
            "name": r["name"],
            "employee_id": r["employee_id"],
            "department": r["department"],
            "photo": r["photo"],
            "encoding": encoding
        })
    return result


def update_employee_face(db_id, face_encoding, photo=None):
    """Update an employee's face encoding (re-register)."""
    conn = get_db()
    encoding_blob = pickle.dumps(face_encoding)
    if photo:
        conn.execute(
            "UPDATE employees SET face_encoding = ?, photo = ? WHERE id = ?",
            (encoding_blob, photo, db_id)
        )
    else:
        conn.execute(
            "UPDATE employees SET face_encoding = ? WHERE id = ?",
            (encoding_blob, db_id)
        )
    conn.commit()
    conn.close()


# ── Attendance CRUD ────────────────────────────────────────────

def mark_attendance(employee_db_id, status, confidence):
    """Mark attendance for an employee."""
    conn = get_db()
    conn.execute(
        "INSERT INTO attendance (employee_db_id, status, confidence) VALUES (?, ?, ?)",
        (employee_db_id, status, confidence)
    )
    conn.commit()
    conn.close()


def get_today_attendance(employee_db_id):
    """Get today's attendance records for an employee."""
    conn = get_db()
    today = date.today().isoformat()
    rows = conn.execute(
        """SELECT * FROM attendance
           WHERE employee_db_id = ? AND DATE(timestamp) = ?
           ORDER BY timestamp""",
        (employee_db_id, today)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_attendance_records(start_date=None, end_date=None, employee_id=None):
    """Fetch attendance records with optional filters."""
    conn = get_db()
    query = """
        SELECT a.id, a.timestamp, a.status, a.confidence,
               e.name, e.employee_id, e.department
        FROM attendance a
        JOIN employees e ON a.employee_db_id = e.id
        WHERE 1=1
    """
    params = []

    if start_date:
        query += " AND DATE(a.timestamp) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(a.timestamp) <= ?"
        params.append(end_date)
    if employee_id:
        query += " AND e.employee_id = ?"
        params.append(employee_id)

    query += " ORDER BY a.timestamp DESC"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_analytics_data():
    """Get aggregated analytics data."""
    conn = get_db()
    today = date.today().isoformat()

    # Total employees
    total_employees = conn.execute("SELECT COUNT(*) as c FROM employees").fetchone()["c"]

    # Today's unique attendees
    today_present = conn.execute(
        """SELECT COUNT(DISTINCT employee_db_id) as c FROM attendance
           WHERE DATE(timestamp) = ? AND status = 'check-in'""",
        (today,)
    ).fetchone()["c"]

    # Attendance for last 7 days
    daily_trend = conn.execute(
        """SELECT DATE(timestamp) as day, COUNT(DISTINCT employee_db_id) as count
           FROM attendance WHERE status = 'check-in'
           AND DATE(timestamp) >= DATE('now', '-7 days')
           GROUP BY DATE(timestamp) ORDER BY day"""
    ).fetchall()

    # Department breakdown
    dept_breakdown = conn.execute(
        """SELECT e.department, COUNT(DISTINCT a.employee_db_id) as count
           FROM attendance a JOIN employees e ON a.employee_db_id = e.id
           WHERE DATE(a.timestamp) = ? AND a.status = 'check-in'
           GROUP BY e.department""",
        (today,)
    ).fetchall()

    # Department totals
    dept_totals = conn.execute(
        "SELECT department, COUNT(*) as count FROM employees GROUP BY department"
    ).fetchall()

    conn.close()

    return {
        "total_employees": total_employees,
        "today_present": today_present,
        "today_absent": total_employees - today_present,
        "attendance_rate": round((today_present / total_employees * 100), 1) if total_employees > 0 else 0,
        "daily_trend": [dict(r) for r in daily_trend],
        "department_breakdown": [dict(r) for r in dept_breakdown],
        "department_totals": [dict(r) for r in dept_totals]
    }
