import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate, relativeTime } from '../components/StatusBadge';

const DELIVERY_ICONS = { remote: '🖥', onsite: '🚗' };

const FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'mine', label: '自分の案件' },
  { key: 'pending', label: '承認待ち' },
  { key: 'confirmed', label: '確定済み' },
  { key: 'delivered', label: '納品済み' },
];

export default function DashboardPage({ onNavigate }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getProjects(), api.getStats()])
      .then(([p, s]) => { setProjects(p); setStats(s); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter(p => {
    if (filter === 'mine') return p.sales_rep === user.name;
    if (filter === 'all') return true;
    return p.status === filter;
  });

  return (
    <>
      <div className="page-title">ダッシュボード</div>
      <div className="page-sub">全案件一覧</div>

      {user.role === 'admin' && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{stats.total ?? '—'}</div><div className="stat-label">総案件数</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--warning)' }}>{stats.pending ?? '—'}</div><div className="stat-label">承認待ち</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent-lt)' }}>{stats.confirmed ?? '—'}</div><div className="stat-label">確定済み</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{stats.delivered ?? '—'}</div><div className="stat-label">納品済み</div></div>
        </div>
      )}

      <div className="filter-bar">
        {FILTERS.map(f => (
          <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M20 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
            <path d="M16 3H8a2 2 0 00-2 2v2h12V5a2 2 0 00-2-2z"/>
          </svg>
          <div>案件がありません</div>
        </div>
      ) : (
        filtered.map(project => (
          <div key={project.id} className="card" onClick={() => onNavigate('detail', project.id)} style={{ cursor: 'pointer' }}>
            <div className="card-header">
              <div>
                <div className="project-name">{project.project_name}</div>
                <div className="client-name">{project.client_name}</div>
              </div>
              <StatusBadge status={project.status} />
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>👤 {project.sales_rep}</span>
              <span>{DELIVERY_ICONS[project.delivery_method] || ''} {project.delivery_method === 'onsite' ? '現地訪問' : 'リモート'}</span>
              {project.confirmed_date
                ? <span>📅 {formatDate(project.confirmed_date)}</span>
                : project.candidates?.length > 0
                  ? <span>🗓 候補日 {project.candidates.length}件</span>
                  : null}
              <span style={{ marginLeft: 'auto' }}>{relativeTime(project.updated_at)}</span>
            </div>
          </div>
        ))
      )}
    </>
  );
}
