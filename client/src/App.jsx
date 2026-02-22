import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, setTokens, clearTokens, getToken } from './api';

/* ══════════════════════════════════════════════════════
   Toast System
   ══════════════════════════════════════════════════════ */
let toastId = 0;
function ToastContainer({ toasts, remove }) {
    return (
        <div className="toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`toast ${t.type} ${t.removing ? 'removing' : ''}`}>
                    <span className="toast-icon">{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
                    <span className="toast-msg">{t.message}</span>
                </div>
            ))}
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Auth Pages
   ══════════════════════════════════════════════════════ */
function LoginPage({ onLogin, switchToRegister, toast }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data = await apiPost('/auth/login', { email, password });
            if (data?.success) {
                setTokens(data.accessToken, data.refreshToken);
                localStorage.setItem('user', JSON.stringify(data.user));
                onLogin(data.user);
                toast('Login successful!', 'success');
            } else {
                toast(data?.message || 'Login failed', 'error');
            }
        } catch { toast('Server error', 'error'); }
        setLoading(false);
    };

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="logo"><div className="logo-icon">🔐</div><div><h1>FaceTrack</h1><span>Pro Attendance</span></div></div>
                <h2>Welcome Back</h2>
                <p className="subtitle">Sign in to your account</p>
                <form onSubmit={handleSubmit}>
                    <div className="form-group"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
                    <div className="form-group"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" required /></div>
                    <button type="submit" className={`btn btn-primary btn-full btn-lg ${loading ? 'loading' : ''}`} disabled={loading}><span className="btn-text">Sign In</span></button>
                </form>
                <p className="form-link">Don't have an account? <a href="#" onClick={e => { e.preventDefault(); switchToRegister(); }}>Register</a></p>
            </div>
        </div>
    );
}

function RegisterPage({ onLogin, switchToLogin, toast }) {
    const [form, setForm] = useState({ name: '', email: '', password: '', employeeId: '', department: 'General' });
    const [loading, setLoading] = useState(false);
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data = await apiPost('/auth/register', form);
            if (data?.success) {
                setTokens(data.accessToken, data.refreshToken);
                localStorage.setItem('user', JSON.stringify(data.user));
                onLogin(data.user);
                toast('Registration successful! Please register your face.', 'success');
            } else {
                toast(data?.message || data?.errors?.[0]?.msg || 'Registration failed', 'error');
            }
        } catch { toast('Server error', 'error'); }
        setLoading(false);
    };

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="logo"><div className="logo-icon">🔐</div><div><h1>FaceTrack</h1><span>Pro Attendance</span></div></div>
                <h2>Create Account</h2>
                <p className="subtitle">Register as a new student</p>
                <form onSubmit={handleSubmit}>
                    <div className="form-group"><label>Full Name</label><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your full name" required /></div>
                    <div className="form-row">
                        <div className="form-group"><label>Employee ID</label><input value={form.employeeId} onChange={e => set('employeeId', e.target.value)} placeholder="STU-001" required /></div>
                        <div className="form-group"><label>Department</label>
                            <select value={form.department} onChange={e => set('department', e.target.value)}>
                                {['General', 'Engineering', 'Design', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Management'].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com" required /></div>
                    <div className="form-group"><label>Password</label><input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 6 characters" required minLength={6} /></div>
                    <button type="submit" className={`btn btn-primary btn-full btn-lg ${loading ? 'loading' : ''}`} disabled={loading}><span className="btn-text">Create Account</span></button>
                </form>
                <p className="form-link">Already have an account? <a href="#" onClick={e => { e.preventDefault(); switchToLogin(); }}>Sign In</a></p>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Camera Hook
   ══════════════════════════════════════════════════════ */
function useCamera(videoRef) {
    const streamRef = useRef(null);
    const [active, setActive] = useState(false);

    const start = useCallback(async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
            if (videoRef.current) { videoRef.current.srcObject = s; }
            streamRef.current = s;
            setActive(true);
        } catch { setActive(false); }
    }, [videoRef]);

    const stop = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setActive(false);
    }, []);

    const capture = useCallback(() => {
        const v = videoRef.current;
        if (!v) return null;
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 640;
        c.height = v.videoHeight || 480;
        c.getContext('2d').drawImage(v, 0, 0);
        return c.toDataURL('image/jpeg', 0.85);
    }, [videoRef]);

    return { start, stop, capture, active };
}

/* ══════════════════════════════════════════════════════
   Dashboard Page (Student)
   ══════════════════════════════════════════════════════ */
function DashboardPage({ user, navigate, toast }) {
    const [today, setToday] = useState(null);
    const [analytics, setAnalytics] = useState(null);

    useEffect(() => {
        apiGet('/attendance/today').then(d => d?.success && setToday(d.attendance));
        apiGet('/attendance/analytics').then(d => d?.success && setAnalytics(d.analytics));
    }, []);

    return (
        <div className="page">
            <div className="page-header">
                <h2>Welcome, {user.name} 👋</h2>
                <p>Your attendance dashboard</p>
            </div>
            <div className="stats-grid">
                <div className="stat-card blue"><div className="stat-icon">📊</div><div className="stat-value">{analytics?.attendanceRate || 0}%</div><div className="stat-label">Attendance Rate</div></div>
                <div className="stat-card green"><div className="stat-icon">✅</div><div className="stat-value">{today?.checkIn ? '✓' : '—'}</div><div className="stat-label">Today Check-In</div></div>
                <div className="stat-card purple"><div className="stat-icon">🚪</div><div className="stat-value">{today?.checkOut ? '✓' : '—'}</div><div className="stat-label">Today Check-Out</div></div>
                <div className="stat-card red"><div className="stat-icon">📋</div><div className="stat-value">{today?.status || 'N/A'}</div><div className="stat-label">Today Status</div></div>
            </div>
            {!user.hasFace && (
                <div className="glass-card" style={{ marginBottom: 20, borderColor: 'rgba(245,158,11,0.3)' }}>
                    <p style={{ color: 'var(--amber)' }}>⚠️ You haven't registered your face yet. <a href="#" onClick={e => { e.preventDefault(); navigate('register-face'); }} style={{ color: 'var(--accent)' }}>Register now</a></p>
                </div>
            )}
            <div className="quick-actions">
                <div className="quick-action" onClick={() => navigate('scan')}><div className="qa-icon">📷</div><div><h4>Mark Attendance</h4><p>Scan your face to check in/out</p></div></div>
                <div className="quick-action" onClick={() => navigate('history')}><div className="qa-icon">📋</div><div><h4>View History</h4><p>See your attendance records</p></div></div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Face Registration Page
   ══════════════════════════════════════════════════════ */
function FaceRegisterPage({ user, setUser, toast }) {
    const videoRef = useRef(null);
    const { start, stop, capture, active } = useCamera(videoRef);
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState(null);
    const scanRef = useRef(null);

    useEffect(() => { start(); return () => stop(); }, [start, stop]);

    const handleCapture = async () => {
        const img = capture();
        if (!img) { toast('Camera not ready', 'error'); return; }
        if (scanRef.current) scanRef.current.classList.add('active');
        setLoading(true);
        try {
            const data = await apiPost('/face/register', { image: img });
            if (data?.success) {
                setPreview(data.thumbnail);
                const updated = { ...user, hasFace: true, thumbnail: data.thumbnail };
                setUser(updated);
                localStorage.setItem('user', JSON.stringify(updated));
                toast('Face registered successfully! 🎉', 'success');
            } else {
                toast(data?.message || 'Face registration failed', 'error');
            }
        } catch (err) { toast(err?.message || 'Server error — face service may be starting up. Try again in 30 seconds.', 'error'); }
        setLoading(false);
        if (scanRef.current) scanRef.current.classList.remove('active');
    };

    return (
        <div className="page">
            <div className="page-header"><h2>Register Your Face</h2><p>Position your face clearly in the camera and click capture</p></div>
            <div className="camera-layout">
                <div>
                    <div className="camera-box">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="scan-overlay"><div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" /></div>
                        <div className="scan-line" ref={scanRef} />
                        <div className="cam-status"><div className={`dot ${active ? '' : 'off'}`} /><span>{active ? 'Camera active' : 'No camera'}</span></div>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 18 }}>
                        <button className="capture-btn" onClick={handleCapture} disabled={loading} title="Capture Face">📸</button>
                    </div>
                </div>
                <div className="glass-card" style={{ textAlign: 'center', padding: 36 }}>
                    {preview ? (
                        <><img src={preview} alt="Face" style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--green)' }} /><p style={{ marginTop: 14, color: 'var(--green)', fontWeight: 600 }}>✅ Face Registered!</p><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>You can now use face scan for attendance</p></>
                    ) : user.hasFace ? (
                        <><div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div><p style={{ color: 'var(--green)', fontWeight: 600 }}>Face already registered</p><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>Capture again to re-register</p></>
                    ) : (
                        <><div style={{ fontSize: '3rem', marginBottom: 12, opacity: 0.3 }}>👤</div><h3 style={{ color: 'var(--text-secondary)' }}>No Face Registered</h3><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>Click the capture button to register your face</p></>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Face Scan / Attendance Page
   ══════════════════════════════════════════════════════ */
function ScanPage({ user, toast }) {
    const videoRef = useRef(null);
    const { start, stop, capture, active } = useCamera(videoRef);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const scanRef = useRef(null);

    useEffect(() => { start(); return () => stop(); }, [start, stop]);

    const handleScan = async () => {
        const img = capture();
        if (!img) { toast('Camera not ready', 'error'); return; }
        if (scanRef.current) scanRef.current.classList.add('active');
        setLoading(true);
        setResult(null);

        try {
            // Step 1: Scan face
            const scanData = await apiPost('/face/scan', { image: img });
            if (!scanData?.success) {
                setResult({ success: false, message: scanData?.message || 'Not recognized' });
                toast(scanData?.message || 'Face not recognized', 'error');
                setLoading(false);
                if (scanRef.current) scanRef.current.classList.remove('active');
                return;
            }

            // Step 2: Mark attendance
            const attendData = await apiPost('/attendance/mark', {
                userId: scanData.user.id,
                confidence: scanData.confidence,
                liveness: scanData.liveness,
                method: 'face_scan',
            });

            if (attendData?.success) {
                setResult({ success: true, type: attendData.type, attendance: attendData.attendance, user: scanData.user, confidence: scanData.confidence, liveness: scanData.liveness });
                toast(attendData.message, 'success');
            } else {
                setResult({ success: false, message: attendData?.message });
                toast(attendData?.message || 'Failed to mark attendance', 'error');
            }
        } catch (err) { toast(err?.message || 'Server error — face service may be warming up. Try again in 30s.', 'error'); setResult({ success: false, message: 'Face service may be starting up. Please retry.' }); }
        setLoading(false);
        if (scanRef.current) scanRef.current.classList.remove('active');
    };

    return (
        <div className="page">
            <div className="page-header"><h2>Mark Attendance</h2><p>Scan your face to check in or check out</p></div>
            <div className="camera-layout">
                <div>
                    <div className="camera-box">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="scan-overlay"><div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" /></div>
                        <div className="scan-line" ref={scanRef} />
                        <div className="cam-status"><div className={`dot ${active ? '' : 'off'}`} /><span>{active ? 'Camera active' : 'No camera'}</span></div>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 18 }}>
                        <button className="capture-btn green" onClick={handleScan} disabled={loading} title="Scan Face">{loading ? '⏳' : '📷'}</button>
                        {loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 8 }}>Analyzing face... This may take a moment on first scan.</p>}
                    </div>
                </div>
                <div>
                    {result ? (
                        result.success ? (
                            <div className="result-card success">
                                <div className="result-icon">{result.type === 'check-in' ? '✅' : '🚪'}</div>
                                {result.user?.thumbnail && <img src={result.user.thumbnail} alt="" style={{ width: 70, height: 70, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--green)', margin: '0 auto 10px', display: 'block' }} />}
                                <div className="result-name">{result.user?.name}</div>
                                <div className="result-id">{result.user?.employeeId}</div>
                                <div className="result-details">
                                    <div className="result-detail"><div className="label">Status</div><div className="value"><span className={`badge ${result.type === 'check-in' ? 'badge-green' : 'badge-amber'}`}>{result.type?.replace('-', ' ').toUpperCase()}</span></div></div>
                                    <div className="result-detail"><div className="label">Confidence</div><div className="value"><span className="badge badge-blue">{result.confidence}%</span></div></div>
                                    <div className="result-detail"><div className="label">Time</div><div className="value">{result.attendance?.time}</div></div>
                                    <div className="result-detail"><div className="label">Liveness</div><div className="value"><span className={`badge ${result.liveness?.is_live ? 'badge-green' : 'badge-red'}`}>{result.liveness?.is_live ? 'LIVE' : 'FAILED'}</span></div></div>
                                </div>
                            </div>
                        ) : (
                            <div className="result-card error">
                                <div className="result-icon">❌</div>
                                <div className="result-name" style={{ color: 'var(--red)' }}>{result.message}</div>
                                <p style={{ color: 'var(--text-muted)', marginTop: 10, fontSize: '0.88rem' }}>Try again or contact admin.</p>
                            </div>
                        )
                    ) : (
                        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
                            <div style={{ fontSize: '3.5rem', marginBottom: 14, opacity: 0.3 }}>📷</div>
                            <h3 style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>Ready to Scan</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Position your face in the frame and click the scan button</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Attendance History Page
   ══════════════════════════════════════════════════════ */
function HistoryPage() {
    const [records, setRecords] = useState([]);
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');

    const load = useCallback(() => {
        let url = '/attendance/history?';
        if (start) url += `start=${start}&`;
        if (end) url += `end=${end}&`;
        apiGet(url).then(d => d?.success && setRecords(d.attendance || []));
    }, [start, end]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="page">
            <div className="page-header"><h2>Attendance History</h2><p>Your personal attendance records</p></div>
            <div className="filter-bar">
                <input type="date" value={start} onChange={e => setStart(e.target.value)} />
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={load}>Apply</button>
                <button className="btn btn-outline btn-sm" onClick={() => { setStart(''); setEnd(''); }}>Clear</button>
            </div>
            <div className="table-wrap">
                <table className="data-table">
                    <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Confidence</th></tr></thead>
                    <tbody>
                        {records.length === 0 ? (
                            <tr><td colSpan={5}><div className="empty"><div className="empty-icon">📋</div><h3>No records</h3></div></td></tr>
                        ) : records.map(r => (
                            <tr key={r._id}>
                                <td>{r.date}</td>
                                <td>{r.checkIn?.time ? new Date(r.checkIn.time).toLocaleTimeString() : '—'}</td>
                                <td>{r.checkOut?.time ? new Date(r.checkOut.time).toLocaleTimeString() : '—'}</td>
                                <td><span className={`badge ${r.status === 'present' ? 'badge-green' : r.status === 'late' ? 'badge-amber' : 'badge-red'}`}>{r.status}</span></td>
                                <td><span className="badge badge-blue">{r.checkIn?.confidence ? r.checkIn.confidence + '%' : '—'}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Admin Dashboard
   ══════════════════════════════════════════════════════ */
function AdminDashboard({ navigate }) {
    const [analytics, setAnalytics] = useState(null);
    const [records, setRecords] = useState([]);

    useEffect(() => {
        apiGet('/attendance/analytics').then(d => d?.success && setAnalytics(d.analytics));
        apiGet('/attendance/all?limit=10').then(d => d?.success && setRecords(d.records || []));
    }, []);

    return (
        <div className="page">
            <div className="page-header"><h2>Admin Dashboard</h2><p>System overview and management</p></div>
            <div className="stats-grid">
                <div className="stat-card blue"><div className="stat-icon">👥</div><div className="stat-value">{analytics?.totalUsers || 0}</div><div className="stat-label">Total Students</div></div>
                <div className="stat-card green"><div className="stat-icon">✅</div><div className="stat-value">{analytics?.todayPresent || 0}</div><div className="stat-label">Present Today</div></div>
                <div className="stat-card red"><div className="stat-icon">❌</div><div className="stat-value">{analytics?.todayAbsent || 0}</div><div className="stat-label">Absent Today</div></div>
                <div className="stat-card purple"><div className="stat-icon">📊</div><div className="stat-value">{analytics?.attendanceRate || 0}%</div><div className="stat-label">Attendance Rate</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
                <div className="glass-card">
                    <div className="card-header"><h3>Recent Attendance</h3></div>
                    {records.length === 0 ? <div className="empty"><div className="empty-icon">📋</div><h3>No records yet</h3></div> : (
                        <table className="data-table"><thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Time</th></tr></thead><tbody>
                            {records.map(r => <tr key={r._id}><td><strong>{r.userId?.name}</strong></td><td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.84rem', color: 'var(--accent)' }}>{r.userId?.employeeId}</td><td><span className={`badge ${r.status === 'present' ? 'badge-green' : r.status === 'late' ? 'badge-amber' : 'badge-red'}`}>{r.status}</span></td><td>{r.checkIn?.time ? new Date(r.checkIn.time).toLocaleTimeString() : '—'}</td></tr>)}
                        </tbody></table>
                    )}
                </div>
                <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 14 }}>Quick Actions</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="quick-action" onClick={() => navigate('admin-users')}><div className="qa-icon">👥</div><div><h4>Manage Users</h4><p>View & manage students</p></div></div>
                        <div className="quick-action" onClick={() => navigate('admin-settings')}><div className="qa-icon">⚙️</div><div><h4>Settings</h4><p>Configure system</p></div></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Admin Users Page
   ══════════════════════════════════════════════════════ */
function AdminUsersPage({ toast }) {
    const [users, setUsers] = useState([]);
    const load = () => apiGet('/admin/users').then(d => d?.success && setUsers(d.users || []));
    useEffect(() => { load(); }, []);

    const toggleStatus = async (id, name, current) => {
        const newStatus = current === 'active' ? 'inactive' : 'active';
        const data = await apiPut(`/admin/users/${id}/status`, { status: newStatus });
        if (data?.success) { toast(`${name} is now ${newStatus}`, 'success'); load(); }
    };

    const deleteUser = async (id, name) => {
        if (!window.confirm(`Delete ${name}? This removes all their records.`)) return;
        const data = await apiDelete(`/admin/users/${id}`);
        if (data?.success) { toast(data.message, 'success'); load(); }
    };

    return (
        <div className="page">
            <div className="page-header"><h2>Manage Users</h2><p>View and manage student accounts</p></div>
            {users.length === 0 ? <div className="empty"><div className="empty-icon">👥</div><h3>No students registered</h3></div> : (
                <div className="emp-grid">
                    {users.map(u => (
                        <div className="emp-card" key={u.id}>
                            <div className="avatar">{u.thumbnail ? <img src={u.thumbnail} alt="" /> : '👤'}</div>
                            <div className="emp-name">{u.name}</div>
                            <div className="emp-id">{u.employeeId}</div>
                            <div className="emp-dept">{u.department}</div>
                            <div style={{ marginTop: 6 }}><span className={`badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}`}>{u.status}</span>{' '}{u.hasFace && <span className="badge badge-blue">Face ✓</span>}</div>
                            <div className="emp-actions">
                                <button className="btn btn-outline btn-sm" onClick={() => toggleStatus(u.id, u.name, u.status)}>{u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                                <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id, u.name)}>Delete</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Admin Settings Page
   ══════════════════════════════════════════════════════ */
function AdminSettingsPage({ toast }) {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        apiGet('/admin/settings').then(d => d?.success && setSettings(d.settings));
    }, []);

    const save = async () => {
        setLoading(true);
        const data = await apiPut('/admin/settings', settings);
        if (data?.success) toast('Settings saved!', 'success');
        else toast('Failed to save', 'error');
        setLoading(false);
    };

    if (!settings) return <div className="page"><p>Loading...</p></div>;

    const set = (k, v) => setSettings(p => ({ ...p, [k]: v }));
    const setFR = (k, v) => setSettings(p => ({ ...p, faceRecognition: { ...p.faceRecognition, [k]: v } }));

    return (
        <div className="page">
            <div className="page-header"><h2>System Settings</h2><p>Configure attendance rules and face recognition</p></div>
            <div className="settings-grid">
                <div className="glass-card">
                    <h3 style={{ marginBottom: 18, fontWeight: 600 }}>⏰ Schedule</h3>
                    <div className="form-row">
                        <div className="form-group"><label>Arrival Time</label><input type="time" value={settings.arrivalTime} onChange={e => set('arrivalTime', e.target.value)} /></div>
                        <div className="form-group"><label>Late Deadline</label><input type="time" value={settings.arrivalDeadline} onChange={e => set('arrivalDeadline', e.target.value)} /></div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Departure Start</label><input type="time" value={settings.departureStart} onChange={e => set('departureStart', e.target.value)} /></div>
                        <div className="form-group"><label>Departure End</label><input type="time" value={settings.departureEnd} onChange={e => set('departureEnd', e.target.value)} /></div>
                    </div>
                </div>
                <div className="glass-card">
                    <h3 style={{ marginBottom: 18, fontWeight: 600 }}>🧠 Face Recognition</h3>
                    <div className="form-group"><label>Match Threshold (0-1)</label><input type="number" step="0.05" min="0.3" max="0.95" value={settings.faceRecognition?.matchThreshold} onChange={e => setFR('matchThreshold', parseFloat(e.target.value))} /></div>
                    <div className="form-group"><label>Duplicate Threshold (0-1)</label><input type="number" step="0.05" min="0.5" max="0.95" value={settings.faceRecognition?.duplicateThreshold} onChange={e => setFR('duplicateThreshold', parseFloat(e.target.value))} /></div>
                    <div className="form-group"><label>Max Scan Attempts</label><input type="number" min="3" max="50" value={settings.faceRecognition?.maxScanAttempts} onChange={e => setFR('maxScanAttempts', parseInt(e.target.value))} /></div>
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input type="checkbox" id="liveness" checked={settings.faceRecognition?.livenessRequired} onChange={e => setFR('livenessRequired', e.target.checked)} />
                        <label htmlFor="liveness" style={{ margin: 0 }}>Require Liveness Detection</label>
                    </div>
                </div>
            </div>
            <div style={{ marginTop: 20 }}>
                <button className={`btn btn-primary btn-lg ${loading ? 'loading' : ''}`} onClick={save} disabled={loading}><span className="btn-text">Save Settings</span></button>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Admin Records Page
   ══════════════════════════════════════════════════════ */
function AdminRecordsPage() {
    const [records, setRecords] = useState([]);
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');

    const load = useCallback(() => {
        let url = '/attendance/all?';
        if (start) url += `start=${start}&`;
        if (end) url += `end=${end}&`;
        apiGet(url).then(d => d?.success && setRecords(d.records || []));
    }, [start, end]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="page">
            <div className="page-header"><h2>Attendance Records</h2><p>All attendance entries across the system</p></div>
            <div className="filter-bar">
                <input type="date" value={start} onChange={e => setStart(e.target.value)} />
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={load}>Filter</button>
                <button className="btn btn-outline btn-sm" onClick={() => { setStart(''); setEnd(''); }}>Clear</button>
                <a href={`/api/admin/export?start=${start}&end=${end}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>⬇ Export CSV</a>
            </div>
            <div className="table-wrap">
                <table className="data-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Dept</th><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Confidence</th></tr></thead><tbody>
                    {records.length === 0 ? <tr><td colSpan={8}><div className="empty"><div className="empty-icon">📋</div><h3>No records</h3></div></td></tr> :
                        records.map(r => <tr key={r._id}><td><strong>{r.userId?.name}</strong></td><td style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', fontSize: '0.84rem' }}>{r.userId?.employeeId}</td><td>{r.userId?.department}</td><td>{r.date}</td><td>{r.checkIn?.time ? new Date(r.checkIn.time).toLocaleTimeString() : '—'}</td><td>{r.checkOut?.time ? new Date(r.checkOut.time).toLocaleTimeString() : '—'}</td><td><span className={`badge ${r.status === 'present' ? 'badge-green' : r.status === 'late' ? 'badge-amber' : 'badge-red'}`}>{r.status}</span></td><td><span className="badge badge-blue">{r.checkIn?.confidence ? Math.round(r.checkIn.confidence) + '%' : '—'}</span></td></tr>)
                    }
                </tbody></table>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Admin Face Logs
   ══════════════════════════════════════════════════════ */
function AdminFaceLogsPage() {
    const [logs, setLogs] = useState([]);
    useEffect(() => { apiGet('/admin/face-logs').then(d => d?.success && setLogs(d.logs || [])); }, []);

    return (
        <div className="page">
            <div className="page-header"><h2>Face Recognition Logs</h2><p>Confidence scores and liveness results</p></div>
            <div className="table-wrap">
                <table className="data-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Date</th><th>Check-In Confidence</th><th>Check-Out Confidence</th><th>Liveness (In)</th><th>Liveness (Out)</th></tr></thead><tbody>
                    {logs.length === 0 ? <tr><td colSpan={7}><div className="empty"><div className="empty-icon">🧠</div><h3>No face scan logs</h3></div></td></tr> :
                        logs.map(l => <tr key={l.id}><td><strong>{l.user?.name}</strong></td><td style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', fontSize: '0.84rem' }}>{l.user?.employeeId}</td><td>{l.date}</td><td><span className="badge badge-blue">{l.checkInConfidence ? Math.round(l.checkInConfidence) + '%' : '—'}</span></td><td><span className="badge badge-blue">{l.checkOutConfidence ? Math.round(l.checkOutConfidence) + '%' : '—'}</span></td><td><span className={`badge ${l.checkInLiveness ? 'badge-green' : 'badge-red'}`}>{l.checkInLiveness != null ? (l.checkInLiveness ? 'LIVE' : 'FAIL') : '—'}</span></td><td><span className={`badge ${l.checkOutLiveness ? 'badge-green' : 'badge-red'}`}>{l.checkOutLiveness != null ? (l.checkOutLiveness ? 'LIVE' : 'FAIL') : '—'}</span></td></tr>)
                    }
                </tbody></table>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════
   Main App
   ══════════════════════════════════════════════════════ */
export default function App() {
    const [user, setUser] = useState(() => {
        try { const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null; } catch { return null; }
    });
    const [page, setPage] = useState(() => {
        if (!user) return 'login';
        return user.role === 'admin' ? 'admin-dashboard' : 'dashboard';
    });
    const [authView, setAuthView] = useState('login');
    const [toasts, setToasts] = useState([]);

    const addToast = (message, type = 'info') => {
        const id = ++toastId;
        setToasts(p => [...p, { id, message, type }]);
        setTimeout(() => setToasts(p => p.map(t => t.id === id ? { ...t, removing: true } : t)), 3500);
        setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3800);
    };

    const handleLogin = (userData) => {
        setUser(userData);
        setPage(userData.role === 'admin' ? 'admin-dashboard' : 'dashboard');
    };

    const handleLogout = () => {
        apiPost('/auth/logout', { refreshToken: localStorage.getItem('refreshToken') });
        clearTokens();
        setUser(null);
        setPage('login');
        setAuthView('login');
    };

    // If not logged in
    if (!user || !getToken()) {
        return (
            <>
                {authView === 'login'
                    ? <LoginPage onLogin={handleLogin} switchToRegister={() => setAuthView('register')} toast={addToast} />
                    : <RegisterPage onLogin={handleLogin} switchToLogin={() => setAuthView('login')} toast={addToast} />
                }
                <ToastContainer toasts={toasts} />
            </>
        );
    }

    const isAdmin = user.role === 'admin';

    const studentNav = [
        { id: 'dashboard', icon: '📊', label: 'Dashboard' },
        { id: 'register-face', icon: '👤', label: 'Register Face' },
        { id: 'scan', icon: '📷', label: 'Mark Attendance' },
        { id: 'history', icon: '📋', label: 'My History' },
    ];

    const adminNav = [
        { id: 'admin-dashboard', icon: '📊', label: 'Dashboard' },
        { id: 'admin-records', icon: '📋', label: 'All Records' },
        { id: 'admin-users', icon: '👥', label: 'Manage Users' },
        { id: 'admin-face-logs', icon: '🧠', label: 'Face Logs' },
        { id: 'admin-settings', icon: '⚙️', label: 'Settings' },
    ];

    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const nav = isAdmin ? adminNav : studentNav;

    const handleNav = (id) => {
        setPage(id);
        setMobileMenuOpen(false);
    };

    const renderPage = () => {
        switch (page) {
            case 'dashboard': return <DashboardPage user={user} navigate={setPage} toast={addToast} />;
            case 'register-face': return <FaceRegisterPage user={user} setUser={setUser} toast={addToast} />;
            case 'scan': return <ScanPage user={user} toast={addToast} />;
            case 'history': return <HistoryPage />;
            case 'admin-dashboard': return <AdminDashboard navigate={setPage} />;
            case 'admin-records': return <AdminRecordsPage />;
            case 'admin-users': return <AdminUsersPage toast={addToast} />;
            case 'admin-settings': return <AdminSettingsPage toast={addToast} />;
            case 'admin-face-logs': return <AdminFaceLogsPage />;
            default: return <DashboardPage user={user} navigate={setPage} toast={addToast} />;
        }
    };

    return (
        <div className="app-layout">
            {/* Mobile Header */}
            <header className="mobile-header">
                <div className="logo"><div className="logo-icon">🔐</div><div><h1>FaceTrack</h1><span>{isAdmin ? 'Admin' : 'Student'}</span></div></div>
                <button className="hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>{mobileMenuOpen ? '✕' : '☰'}</button>
            </header>

            {/* Sidebar Overlay (mobile backdrop) */}
            <div className={`sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)} />

            <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="logo"><div className="logo-icon">🔐</div><div><h1>FaceTrack</h1><span>{isAdmin ? 'Admin Panel' : 'Student Portal'}</span></div></div>
                </div>
                <nav className="sidebar-nav">
                    {nav.map(n => (
                        <div key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => handleNav(n.id)}>
                            <span className="icon">{n.icon}</span><span>{n.label}</span>
                        </div>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="user-avatar">{user.thumbnail ? <img src={user.thumbnail} alt="" /> : '👤'}</div>
                        <div><div className="user-name">{user.name}</div><div className="user-role">{user.role}</div></div>
                    </div>
                    <div className="nav-item" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}><span className="icon">🚪</span><span>Logout</span></div>
                </div>
            </aside>
            <main className="main-content">{renderPage()}</main>
            <ToastContainer toasts={toasts} />
        </div>
    );
}
