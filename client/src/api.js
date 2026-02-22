/**
 * API helper — handles fetch calls with JWT token management.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
    return localStorage.getItem('accessToken');
}

function getRefreshToken() {
    return localStorage.getItem('refreshToken');
}

function setTokens(access, refresh) {
    localStorage.setItem('accessToken', access);
    if (refresh) localStorage.setItem('refreshToken', refresh);
}

function clearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
}

async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    const token = getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    let res = await fetch(url, { ...options, headers });

    // If 401, try to refresh
    if (res.status === 401 && getRefreshToken()) {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: getRefreshToken() }),
        });

        if (refreshRes.ok) {
            const data = await refreshRes.json();
            setTokens(data.accessToken, data.refreshToken);
            headers['Authorization'] = `Bearer ${data.accessToken}`;
            res = await fetch(url, { ...options, headers });
        } else {
            clearTokens();
            window.location.href = '/';
            return null;
        }
    }

    return res;
}

export async function apiGet(endpoint) {
    const res = await apiFetch(endpoint);
    return res?.json();
}

export async function apiPost(endpoint, body) {
    const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    return res?.json();
}

export async function apiPut(endpoint, body) {
    const res = await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    return res?.json();
}

export async function apiDelete(endpoint) {
    const res = await apiFetch(endpoint, { method: 'DELETE' });
    return res?.json();
}

export { setTokens, clearTokens, getToken };
