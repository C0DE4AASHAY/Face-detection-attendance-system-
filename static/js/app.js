/**
 * FaceTrack Pro — Main Application JavaScript
 * Handles navigation, camera, API calls, and UI logic.
 */

// ── State ─────────────────────────────────────────────────────
let currentPage = 'dashboard';
let cameraStream = null;
let capturedImage = null;
let trendChart = null;
let deptChart = null;

// ── Navigation ────────────────────────────────────────────────
function navigateTo(page) {
    // Stop any active camera
    stopCamera();

    // Update nav styles
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Show target page
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
    });
    const target = document.getElementById(`page-${page}`);
    if (target) {
        target.classList.add('active');
        // Re-trigger animation
        target.style.animation = 'none';
        target.offsetHeight; // force reflow
        target.style.animation = '';
    }

    currentPage = page;
    capturedImage = null;

    // Page-specific init
    if (page === 'dashboard') loadDashboard();
    if (page === 'register') startCamera('register');
    if (page === 'attendance') startCamera('attendance');
    if (page === 'records') loadRecords();
    if (page === 'employees') loadEmployees();
    if (page === 'analytics') loadAnalytics();
}

// ── Camera ────────────────────────────────────────────────────
async function startCamera(context) {
    const video = document.getElementById(`${context}-video`);
    const statusDot = document.getElementById(`${context}-status-dot`);
    const statusText = document.getElementById(`${context}-cam-status`);

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false
        });
        video.srcObject = cameraStream;
        statusDot.classList.remove('inactive');
        statusText.textContent = 'Camera active';
    } catch (err) {
        statusDot.classList.add('inactive');
        statusText.textContent = 'Camera unavailable';
        showToast('Could not access camera. Please allow camera permissions.', 'error');
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

function captureFrame(context) {
    const video = document.getElementById(`${context}-video`);
    const canvas = document.getElementById(`${context}-canvas`);
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
}

// ── Registration ──────────────────────────────────────────────
function captureForRegister() {
    if (!cameraStream) {
        showToast('Camera is not active.', 'error');
        return;
    }

    const btn = document.getElementById('register-capture-btn');
    btn.classList.add('capturing');
    setTimeout(() => btn.classList.remove('capturing'), 300);

    // Activate scan line
    const scanLine = document.getElementById('register-scan-line');
    scanLine.classList.add('active');
    setTimeout(() => scanLine.classList.remove('active'), 2000);

    capturedImage = captureFrame('register');

    // Show preview
    const preview = document.getElementById('register-preview');
    const previewImg = document.getElementById('register-preview-img');
    previewImg.src = capturedImage;
    preview.style.display = 'block';

    // Enable submit
    document.getElementById('register-submit-btn').disabled = false;
    showToast('Face captured! Fill in the details and submit.', 'success');
}

async function submitRegistration(e) {
    e.preventDefault();

    if (!capturedImage) {
        showToast('Please capture a face first.', 'error');
        return;
    }

    const name = document.getElementById('reg-name').value.trim();
    const employeeId = document.getElementById('reg-id').value.trim();
    const department = document.getElementById('reg-department').value;

    if (!name || !employeeId) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    const btn = document.getElementById('register-submit-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                employee_id: employeeId,
                department,
                image: capturedImage
            })
        });

        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            // Reset form
            document.getElementById('register-form').reset();
            document.getElementById('register-preview').style.display = 'none';
            capturedImage = null;
            btn.disabled = true;
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Server error. Please try again.', 'error');
    } finally {
        btn.classList.remove('loading');
        if (capturedImage) btn.disabled = false;
    }
}

// ── Attendance ────────────────────────────────────────────────
async function captureForAttendance() {
    if (!cameraStream) {
        showToast('Camera is not active.', 'error');
        return;
    }

    const btn = document.getElementById('attendance-capture-btn');
    btn.classList.add('capturing');
    setTimeout(() => btn.classList.remove('capturing'), 300);

    // Activate scan line
    const scanLine = document.getElementById('attendance-scan-line');
    scanLine.classList.add('active');

    const image = captureFrame('attendance');
    const resultDiv = document.getElementById('attendance-result');

    resultDiv.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 48px 28px;">
            <div style="font-size: 2.5rem; margin-bottom: 16px; animation: spin 1s linear infinite;">⏳</div>
            <h3 style="color: var(--text-secondary);">Scanning face...</h3>
            <p style="color: var(--text-muted); font-size: 0.9rem;">Please wait while we identify the face</p>
        </div>
    `;

    try {
        const res = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image })
        });

        const data = await res.json();
        scanLine.classList.remove('active');

        if (data.success) {
            const emp = data.employee;
            const statusClass = emp.status === 'check-in' ? 'badge-checkin' : 'badge-checkout';
            const statusIcon = emp.status === 'check-in' ? '✅' : '🚪';

            resultDiv.innerHTML = `
                <div class="result-card success">
                    <div class="result-icon">${statusIcon}</div>
                    ${emp.photo ? `<img src="${emp.photo}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--accent-green);margin-bottom:12px;">` : ''}
                    <div class="result-name">${emp.name}</div>
                    <div class="result-id">${emp.employee_id}</div>
                    <div class="result-details">
                        <div class="result-detail">
                            <div class="label">Status</div>
                            <div class="value"><span class="badge ${statusClass}">${emp.status.replace('-', ' ').toUpperCase()}</span></div>
                        </div>
                        <div class="result-detail">
                            <div class="label">Confidence</div>
                            <div class="value"><span class="badge badge-confidence">${emp.confidence}%</span></div>
                        </div>
                        <div class="result-detail">
                            <div class="label">Time</div>
                            <div class="value">${emp.time}</div>
                        </div>
                        <div class="result-detail">
                            <div class="label">Department</div>
                            <div class="value">${emp.department}</div>
                        </div>
                    </div>
                </div>
            `;
            showToast(data.message, 'success');
        } else {
            resultDiv.innerHTML = `
                <div class="result-card error">
                    <div class="result-icon">❌</div>
                    <div class="result-name" style="color: var(--accent-red);">${data.message}</div>
                    <p style="color: var(--text-muted); margin-top: 12px; font-size: 0.9rem;">Please try again or register the employee first.</p>
                </div>
            `;
            showToast(data.message, 'error');
        }
    } catch (err) {
        scanLine.classList.remove('active');
        resultDiv.innerHTML = `
            <div class="result-card error">
                <div class="result-icon">⚠️</div>
                <div class="result-name" style="color: var(--accent-red);">Server Error</div>
                <p style="color: var(--text-muted); margin-top: 12px;">Could not connect to the server. Please ensure it is running.</p>
            </div>
        `;
        showToast('Server error. Please check the connection.', 'error');
    }
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const [analyticsRes, recordsRes] = await Promise.all([
            fetch('/api/analytics'),
            fetch('/api/records')
        ]);
        const analytics = await analyticsRes.json();
        const records = await recordsRes.json();

        // Update stats with animation
        animateNumber('stat-total', analytics.total_employees);
        animateNumber('stat-present', analytics.today_present);
        animateNumber('stat-absent', analytics.today_absent);
        document.getElementById('stat-rate').textContent = analytics.attendance_rate + '%';

        // Activity feed (last 10 records)
        const feed = document.getElementById('activity-feed');
        const recent = records.slice(0, 10);

        if (recent.length === 0) {
            feed.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <h3>No activity yet</h3>
                    <p>Attendance records will appear here</p>
                </div>
            `;
            return;
        }

        feed.innerHTML = recent.map((r, i) => `
            <div class="activity-item" style="animation-delay: ${i * 0.05}s">
                <div class="activity-avatar">👤</div>
                <div class="activity-info">
                    <div class="activity-name">${r.name}</div>
                    <div class="activity-detail">${r.department} · <span class="badge ${r.status === 'check-in' ? 'badge-checkin' : 'badge-checkout'}">${r.status.replace('-', ' ')}</span></div>
                </div>
                <div class="activity-time">${formatTime(r.timestamp)}</div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

// ── Records ───────────────────────────────────────────────────
async function loadRecords() {
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;

    let url = '/api/records?';
    if (start) url += `start=${start}&`;
    if (end) url += `end=${end}&`;

    try {
        const res = await fetch(url);
        const records = await res.json();
        const tbody = document.getElementById('records-tbody');

        if (records.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6">
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
                        <h3>No records found</h3>
                        <p>Try adjusting your filters or marking some attendance first</p>
                    </div>
                </td></tr>
            `;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr>
                <td><strong>${r.name}</strong></td>
                <td><code style="color: var(--accent-blue); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">${r.employee_id}</code></td>
                <td>${r.department}</td>
                <td>${formatDateTime(r.timestamp)}</td>
                <td><span class="badge ${r.status === 'check-in' ? 'badge-checkin' : 'badge-checkout'}">${r.status === 'check-in' ? '✅ ' : '🚪 '}${r.status.replace('-', ' ')}</span></td>
                <td><span class="badge badge-confidence">${r.confidence}%</span></td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('Records load error:', err);
    }
}

function clearFilters() {
    document.getElementById('filter-start').value = '';
    document.getElementById('filter-end').value = '';
    loadRecords();
}

// ── Employees ─────────────────────────────────────────────────
async function loadEmployees() {
    try {
        const res = await fetch('/api/employees');
        const employees = await res.json();
        const grid = document.getElementById('employees-grid');

        if (employees.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-icon">👥</div>
                    <h3>No employees registered</h3>
                    <p>Register employees from the "Register Face" page</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = employees.map((emp, i) => `
            <div class="employee-card" style="animation-delay: ${i * 0.05}s">
                <button class="delete-btn" onclick="deleteEmployee(${emp.id}, '${emp.name}')" title="Remove employee">✕</button>
                <div class="avatar">
                    ${emp.photo ? `<img src="${emp.photo}" alt="${emp.name}">` : '👤'}
                </div>
                <div class="emp-name">${emp.name}</div>
                <div class="emp-id">${emp.employee_id}</div>
                <div class="emp-dept">${emp.department}</div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Employees load error:', err);
    }
}

async function deleteEmployee(id, name) {
    if (!confirm(`Remove ${name} from the system? This will also delete their attendance records.`)) return;

    try {
        const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`${name} removed successfully.`, 'success');
            loadEmployees();
        }
    } catch (err) {
        showToast('Failed to remove employee.', 'error');
    }
}

// ── Analytics ─────────────────────────────────────────────────
async function loadAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();

        // Update stats
        animateNumber('a-stat-total', data.total_employees);
        animateNumber('a-stat-present', data.today_present);
        animateNumber('a-stat-absent', data.today_absent);
        document.getElementById('a-stat-rate').textContent = data.attendance_rate + '%';

        // Trend chart
        renderTrendChart(data.daily_trend);

        // Department chart
        renderDeptChart(data.department_breakdown, data.department_totals);

    } catch (err) {
        console.error('Analytics load error:', err);
    }
}

function renderTrendChart(trend) {
    const ctx = document.getElementById('trendChart').getContext('2d');

    if (trendChart) trendChart.destroy();

    const labels = trend.map(t => {
        const d = new Date(t.day);
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    });
    const values = trend.map(t => t.count);

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Employees Present',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#64748b', font: { size: 11 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 11 },
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function renderDeptChart(breakdown, totals) {
    const ctx = document.getElementById('deptChart').getContext('2d');

    if (deptChart) deptChart.destroy();

    const labels = totals.length > 0 ? totals.map(d => d.department) : ['No Data'];
    const values = totals.length > 0 ? totals.map(d => d.count) : [0];
    const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

    deptChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: 'rgba(0,0,0,0.3)',
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        padding: 16,
                        font: { size: 12 }
                    }
                }
            }
        }
    });
}

// ── CSV Export ─────────────────────────────────────────────────
function exportCSV() {
    const start = document.getElementById('filter-start')?.value || '';
    const end = document.getElementById('filter-end')?.value || '';
    let url = '/api/export?';
    if (start) url += `start=${start}&`;
    if (end) url += `end=${end}&`;
    window.open(url, '_blank');
    showToast('Downloading attendance CSV...', 'info');
}

// ── Toast System ──────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Utilities ─────────────────────────────────────────────────
function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    const start = parseInt(el.textContent) || 0;
    const duration = 600;
    const startTime = performance.now();

    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    }) + ' ' + d.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit'
    });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});
