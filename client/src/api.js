// API base — same origin in prod, proxied in dev
const BASE = import.meta.env.DEV ? '' : '';

async function req(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'エラーが発生しました' }));
    throw new Error(err.error || 'エラーが発生しました');
  }
  return res.json();
}

export const api = {
  login: (name, password) => req('POST', '/auth/login', { name, password }),
  getUsers: () => req('GET', '/users'),
  getProjects: (params) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/projects${qs ? '?' + qs : ''}`);
  },
  getProject: (id) => req('GET', `/projects/${id}`),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  confirmProject: (id, data) => req('POST', `/projects/${id}/confirm`, data),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),
  getStats: () => req('GET', '/stats'),
};
