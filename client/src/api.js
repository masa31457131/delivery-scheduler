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
  login: (loginId, password) => req('POST', '/auth/login', { name: loginId, password }),

  // 営業
  getUsers: () => req('GET', '/users'),
  createUser: (data) => req('POST', '/users', data),
  updateUser: (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser: (id) => req('DELETE', `/users/${id}`),

  // 管理者（複数管理）
  getAdmins: () => req('GET', '/admins'),
  createAdmin: (data) => req('POST', '/admins', data),
  updateAdmin: (id, data) => req('PUT', `/admins/${id}`, data),
  deleteAdmin: (id) => req('DELETE', `/admins/${id}`),

  getConflicts: (date, time, exclude_project_id, area) => {
    const p = new URLSearchParams({ date });
    if (time) p.set('time', time);
    if (exclude_project_id) p.set('exclude_project_id', exclude_project_id);
    if (area) p.set('area', area);
    return req('GET', `/schedule/conflicts?${p}`);
  },
  getBlockedDates: (area) => req('GET', `/blocked-dates${area ? `?area=${encodeURIComponent(area)}` : ''}`),
  createBlockedDate: (data) => req('POST', '/blocked-dates', data),
  deleteBlockedDate: (id) => req('DELETE', `/blocked-dates/${id}`),
  getEmailSettings: () => req('GET', '/settings/email'),
  updateEmailSettings: (data) => req('PUT', '/settings/email', data),
  testEmail: () => req('POST', '/settings/email/test'),
  getEmailTemplates: () => req('GET', '/settings/email-templates'),
  updateEmailTemplates: (data) => req('PUT', '/settings/email-templates', data),
  resetEmailTemplates: () => req('POST', '/settings/email-templates/reset'),
  getProjects: () => req('GET', '/projects'),
  getProject: (id) => req('GET', `/projects/${id}`),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  addCandidate: (projectId, data) => req('POST', `/projects/${projectId}/candidates`, data),
  finalizeCandidates: (projectId) => req('POST', `/projects/${projectId}/candidates/finalize`),
  deleteCandidate: (projectId, candidateId) => req('DELETE', `/projects/${projectId}/candidates/${candidateId}`),
  confirmSchedule: (id, data) => req('POST', `/projects/${id}/confirm-schedule`, data),
  cancelProject: (id, data) => req('POST', `/projects/${id}/cancel`, data),
  sendReminder: (id, requesterLoginId) => req('POST', `/projects/${id}/remind`, { requester_login_id: requesterLoginId }),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),
  getStats: () => req('GET', '/stats'),
};
