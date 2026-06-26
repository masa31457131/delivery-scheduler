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
    const p = new URLSearchParams({ date });
    if (time) p.set('time', time);
    if (exclude_project_id) p.set('exclude_project_id', exclude_project_id);
    return req('GET', `/schedule/conflicts?${p}`);
  },
  getBlockedDates: () => req('GET', '/blocked-dates'),
  createBlockedDate: (data) => req('POST', '/blocked-dates', data),
  deleteBlockedDate: (id) => req('DELETE', `/blocked-dates/${id}`),
  getEmailSettings: () => req('GET', '/settings/email'),
  updateEmailSettings: (data) => req('PUT', '/settings/email', data),
  testEmail: () => req('POST', '/settings/email/test'),
  getProjects: () => req('GET', '/projects'),
  getProject: (id) => req('GET', `/projects/${id}`),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  addCandidate: (projectId, data) => req('POST', `/projects/${projectId}/candidates`, data),
  deleteCandidate: (projectId, candidateId) => req('DELETE', `/projects/${projectId}/candidates/${candidateId}`),
  confirmProject: (id, data) => req('POST', `/projects/${id}/confirm`, data),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),
  getStats: () => req('GET', '/stats'),
};
