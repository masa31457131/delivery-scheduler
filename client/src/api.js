const BASE = '';

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
  createUser: (data) => req('POST', '/users', data),
  updateUser: (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser: (id) => req('DELETE', `/users/${id}`),
  getConflicts: (date, time, exclude_project_id) => {
    const params = new URLSearchParams({ date });
    if (time) params.set('time', time);
    if (exclude_project_id) params.set('exclude_project_id', exclude_project_id);
    return req('GET', `/schedule/conflicts?${params}`);
  },
  getProjects: () => req('GET', '/projects'),
  getProject: (id) => req('GET', `/projects/${id}`),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  confirmProject: (id, data) => req('POST', `/projects/${id}/confirm`, data),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),
  getStats: () => req('GET', '/stats'),
};
