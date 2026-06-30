import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate, relativeTime } from '../components/StatusBadge';

const DELIVERY_ICONS = { remote: '🖥', onsite: '🚗' };

export default function DashboardPage({ onNavigate }) {
  const { user } = useAuth();
  // 営業はデフォルト「mine」、管理者は「all」
  const [filter, setFilter] = useState(user.role === 'sales' ? 'mine' : 'all');
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  // 「全メンバー」は必ず最後に表示
  const FILTERS = user.role === 'sales'
    ? [
        { key: 'mine',      label: '候補日待ち', statusFilter: 'pending' },
        { key: 'mine_sched',label: '仮スケ設定済', statusFilter: 'scheduled' },
        { key: 'mine_conf', label: '確定済み', statusFilter: 'confirmed' },
        { key: 'mine_cancel',label: 'キャンセル', statusFilter: 'cancelled' },
        { key: 'all',       label: '全メンバー' },
      ]
    : [
        { key: 'all_pending',   label: '候補日待ち', statusFilter: 'pending' },
        { key: 'all_sched',     label: '仮スケ設定済', statusFilter: 'scheduled' },
        { key: 'all_confirmed', label: '確定済み', statusFilter: 'confirmed' },
        { key: 'all_delivered', label: '納品済み', statusFilter: 'delivered' },
        { key: 'all_cancelled', label: 'キャンセル', statusFilter: 'cancelled' },
        { key: 'all', label: '全メンバー' },
      ];

  useEffect(() => {
    Promise.all([api.getProjects(), api.getStats()])
      .then(([p, s]) => { setProjects(p); setStats(s); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter(p => {
    if (filter === 'all') return true;
    const def = FILTERS.find(f => f.key === filter);
    if (!def) return true;
    const matchStatus = def.statusFilter ? p.status === def.statusFilter : true;
    // 営業の場合は自分の案件のみに絞る（'all'以外）
    if (user.role === 'sales') {
      return matchStatus && p.sales_rep === user.name;
    }
    return matchStatus;
  });

  const pageSubText = filter === 'all'
    ? '全メンバーの案件'
    : (user.role === 'sales' ? `${user.name}の案件` : '案件一覧');

  return (
    <>
      <div className="page-title">ダッシュボード</div>
      <div className="page-sub">{pageSubText}</div>

      {user.role === 'admin' && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{stats.total ?? '—'}</div><div className="stat-label">総案件数</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--warning)' }}>{stats.pending ?? '—'}</div><div className="stat-label">候補日待ち</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent-lt)' }}>{stats.scheduled ?? '—'}</div><div className="stat-label">仮スケ設定済</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{stats.confirmed ?? '—'}</div><div className="stat-label">確定済み</div></div>
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
          <ProjectCard key={project.id} project={project} onNavigate={onNavigate} showSalesRep={filter === 'all'} />
        ))
      )}
    </>
  );
}

function ProjectCard({ project, onNavigate, showSalesRep }) {
  const hasCandidates = project.candidates?.length > 0;
  const hasConfirmed  = !!project.confirmed_date && project.status === 'confirmed';
  const isCancelled = project.status === 'cancelled';

  return (
    <div className="card" onClick={() => onNavigate('detail', project.id)} style={{ cursor: 'pointer' }}>
      <div className="card-header">
        <div>
          <div className="project-name">{project.project_type || '—'}</div>
          <div className="client-name">{project.client_name}</div>
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span>👤 {project.sales_rep}</span>
        <span>{DELIVERY_ICONS[project.delivery_method] || ''} {project.delivery_method === 'onsite' ? '現地訪問' : 'リモート'}</span>
        <span style={{ marginLeft: 'auto' }}>{relativeTime(project.updated_at)}</span>
      </div>

      {isCancelled && (
        <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.8rem', color: 'var(--danger)' }}>
          理由：{project.cancel_reason || '—'}
        </div>
      )}

      {hasConfirmed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <span>✅</span>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--success)', marginBottom: 1 }}>確定日</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)' }}>{formatDate(project.confirmed_date)}</div>
          </div>
        </div>
      )}

      {hasCandidates && !hasConfirmed && !isCancelled && (
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-sub)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>候補日</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {project.candidates.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--accent-lt)', fontWeight: 700, minWidth: 42 }}>第{i + 1}候補</span>
                <span style={{ fontSize: '0.86rem', color: 'var(--text)' }}>
                  {formatDate(c.candidate_date)}
                  {c.candidate_time && <span style={{ color: 'var(--text-sub)', marginLeft: 8 }}>{c.candidate_time}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasCandidates && !hasConfirmed && !isCancelled && (
        <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.8rem', color: 'var(--warning)' }}>
          🗓 候補日の設定待ち（希望：{project.candidate_days || 1}日）
        </div>
      )}
    </div>
  );
}
