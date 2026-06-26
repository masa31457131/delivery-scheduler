import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate, formatDateTime, STATUS_MAP } from '../components/StatusBadge';

export default function DetailPage({ projectId, onBack, addToast, onRefresh }) {
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusChanging, setStatusChanging] = useState(false);

  const load = () => {
    setLoading(true);
    api.getProject(projectId)
      .then(setProject)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const handleConfirm = async (candidate) => {
    if (!confirm(`「${formatDate(candidate.candidate_date)}${candidate.candidate_time ? ' ' + candidate.candidate_time : ''}」で納品日を確定しますか？`)) return;
    setStatusChanging(true);
    try {
      const updated = await api.confirmProject(projectId, {
        confirmed_date: candidate.candidate_date,
        confirmed_time: candidate.candidate_time,
      });
      setProject(updated);
      addToast('納品日を確定しました！');
      onRefresh();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setStatusChanging(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    setStatusChanging(true);
    try {
      const updated = await api.updateProject(projectId, { status: newStatus });
      setProject(updated);
      addToast(`ステータスを「${STATUS_MAP[newStatus]?.label}」に変更しました`);
      onRefresh();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('この案件を削除しますか？')) return;
    await api.deleteProject(projectId);
    addToast('案件を削除しました');
    onRefresh();
    onBack();
  };

  if (loading) return <div className="empty-state">読み込み中...</div>;
  if (!project) return <div className="empty-state">案件が見つかりません</div>;

  const isAdmin = user.role === 'admin';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← 戻る</button>
        <StatusBadge status={project.status} />
      </div>

      <div className="page-title">{project.project_name}</div>
      <div className="page-sub">{project.client_name}</div>

      {/* Confirmed date banner */}
      {project.confirmed_date && (
        <div className="confirmed-banner">
          <span style={{ fontSize: '1.2rem' }}>✅</span>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginBottom: 2 }}>納品確定日</div>
            <div className="date-text">{formatDateTime(project.confirmed_date)}</div>
          </div>
        </div>
      )}

      {/* Meta grid */}
      <div className="detail-meta">
        <div className="meta-item">
          <div className="meta-label">担当営業</div>
          <div className="meta-value">{project.sales_rep}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">ステータス</div>
          <div className="meta-value">{STATUS_MAP[project.status]?.label ?? project.status}</div>
        </div>
        <div className="meta-item" style={{ gridColumn: '1 / -1' }}>
          <div className="meta-label">最終更新</div>
          <div className="meta-value">{formatDateTime(project.updated_at)}</div>
        </div>
      </div>

      {/* Memo */}
      {project.memo && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">メモ・備考</div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.memo}</div>
        </div>
      )}

      {/* Candidates (admin can confirm) */}
      {project.candidates?.length > 0 && (
        <div className="card">
          <div className="section-title">候補日</div>
          {project.candidates.map((c) => (
            <div key={c.id} className="confirm-card">
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', marginBottom: 2 }}>{c.label}</div>
                <div className="confirm-date">
                  {formatDate(c.candidate_date)}
                  {c.candidate_time && ` ${c.candidate_time}`}
                </div>
              </div>
              {isAdmin && (
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => handleConfirm(c)}
                  disabled={statusChanging}
                >
                  確定
                </button>
              )}
            </div>
          ))}
          {!isAdmin && (
            <div className="text-sub mt-8">管理者が候補日から確定します</div>
          )}
        </div>
      )}

      {/* Admin controls */}
      {isAdmin && (
        <div className="card">
          <div className="section-title">ステータス変更</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_MAP).map(([key, { label }]) => (
              key !== project.status && (
                <button
                  key={key}
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleStatusChange(key)}
                  disabled={statusChanging}
                >
                  {label}へ変更
                </button>
              )
            ))}
          </div>
        </div>
      )}

      {/* Delete */}
      {isAdmin && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            案件を削除
          </button>
        </div>
      )}
    </>
  );
}
