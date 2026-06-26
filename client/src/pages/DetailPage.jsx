import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate, formatDateTime, STATUS_MAP } from '../components/StatusBadge';

const DELIVERY_LABELS = { remote: '🖥 リモート', onsite: '🚗 現地訪問' };

export default function DetailPage({ projectId, onBack, addToast, onRefresh }) {
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 候補日追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ date: '', time: '' });
  const [conflicts, setConflicts] = useState(null);

  const load = () => {
    setLoading(true);
    api.getProject(projectId).then(setProject).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  const handleConfirm = async (candidate) => {
    if (!confirm(`「${formatDate(candidate.candidate_date)}${candidate.candidate_time ? ' ' + candidate.candidate_time : ''}」で納品日を確定しますか？`)) return;
    setBusy(true);
    try {
      const updated = await api.confirmProject(projectId, {
        confirmed_date: candidate.candidate_date,
        confirmed_time: candidate.candidate_time,
      });
      setProject(updated);
      addToast('納品日を確定しました！');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const handleStatusChange = async (newStatus) => {
    setBusy(true);
    try {
      const updated = await api.updateProject(projectId, { status: newStatus });
      setProject(updated);
      addToast(`ステータスを「${STATUS_MAP[newStatus]?.label}」に変更しました`);
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const handleDeleteCandidate = async (candidateId) => {
    if (!confirm('この候補日を削除しますか？')) return;
    setBusy(true);
    try {
      const updatedCands = await api.deleteCandidate(projectId, candidateId);
      setProject(p => ({ ...p, candidates: updatedCands }));
      addToast('候補日を削除しました');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const checkConflict = async (date, time) => {
    if (!date) { setConflicts(null); return; }
    const result = await api.getConflicts(date, time, projectId).catch(() => null);
    setConflicts(result);
  };

  const handleAddCandidate = async (e) => {
    e.preventDefault();
    if (conflicts?.blocked || conflicts?.sales_reps?.length >= 2) {
      addToast('この日程は登録できません', 'error'); return;
    }
    setBusy(true);
    try {
      const updatedCands = await api.addCandidate(projectId, newCandidate);
      setProject(p => ({ ...p, candidates: updatedCands }));
      setNewCandidate({ date: '', time: '' });
      setConflicts(null);
      setShowAddForm(false);
      addToast('候補日を追加しました');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
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
  const isOwner = project.sales_rep === user.name;
  const canEditCandidates = (isOwner || isAdmin) && project.status !== 'confirmed' && project.status !== 'delivered';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← 戻る</button>
        <StatusBadge status={project.status} />
      </div>

      <div className="page-title">{project.project_name}</div>
      <div className="page-sub">{project.client_name}</div>

      {project.confirmed_date && (
        <div className="confirmed-banner">
          <span style={{ fontSize: '1.2rem' }}>✅</span>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginBottom: 2 }}>納品確定日</div>
            <div className="date-text">{formatDateTime(project.confirmed_date)}</div>
          </div>
        </div>
      )}

      <div className="detail-meta">
        <div className="meta-item">
          <div className="meta-label">担当営業</div>
          <div className="meta-value">{project.sales_rep}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">納品方法</div>
          <div className="meta-value">{DELIVERY_LABELS[project.delivery_method] || '—'}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">ステータス</div>
          <div className="meta-value">{STATUS_MAP[project.status]?.label ?? project.status}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">最終更新</div>
          <div className="meta-value">{formatDateTime(project.updated_at)}</div>
        </div>
      </div>

      {project.memo && (
        <div className="card">
          <div className="section-title">メモ・備考</div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.memo}</div>
        </div>
      )}

      {/* 候補日 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>候補日</div>
          {canEditCandidates && (project.candidates?.length || 0) < 3 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(v => !v)}>
              {showAddForm ? '閉じる' : '+ 追加'}
            </button>
          )}
        </div>

        {/* 候補日追加フォーム */}
        {showAddForm && (
          <form onSubmit={handleAddCandidate} style={{ marginBottom: 12, padding: 12, background: 'rgba(59,130,246,0.06)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginBottom: 8 }}>候補日を追加（第{(project.candidates?.length || 0)+1}候補）</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="date" style={{ flex: 1 }} value={newCandidate.date}
                onChange={e => { setNewCandidate(c => ({ ...c, date: e.target.value })); checkConflict(e.target.value, newCandidate.time); }}
                required />
              <input type="time" style={{ width: 110, flexShrink: 0 }} value={newCandidate.time}
                onChange={e => { setNewCandidate(c => ({ ...c, time: e.target.value })); checkConflict(newCandidate.date, e.target.value); }} />
            </div>
            {conflicts && (
              conflicts.blocked ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginBottom: 8 }}>
                  🚫 管理者により予定不可{conflicts.blockedInfo?.reason ? `（${conflicts.blockedInfo.reason}）` : ''}
                </div>
              ) : conflicts.sales_reps?.length >= 2 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginBottom: 8 }}>
                  ⛔ {conflicts.sales_reps.join('さんと ')}さんが抑えているため登録不可
                </div>
              ) : conflicts.sales_reps?.length === 1 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--warning)', marginBottom: 8 }}>
                  ⚠️ {conflicts.sales_reps[0]}さんが仮抑え中（登録は可能）
                </div>
              ) : null
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowAddForm(false); setConflicts(null); }}>キャンセル</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || conflicts?.blocked || conflicts?.sales_reps?.length >= 2}>追加する</button>
            </div>
          </form>
        )}

        {(!project.candidates || project.candidates.length === 0) ? (
          <div className="text-sub">候補日が登録されていません</div>
        ) : (
          project.candidates.map(c => (
            <div key={c.id} className="confirm-card">
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', marginBottom: 2 }}>{c.label}</div>
                <div className="confirm-date">
                  {formatDate(c.candidate_date)}{c.candidate_time && ` ${c.candidate_time}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {isAdmin && (
                  <button className="btn btn-success btn-sm" onClick={() => handleConfirm(c)} disabled={busy}>確定</button>
                )}
                {canEditCandidates && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteCandidate(c.id)} disabled={busy}
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>削除</button>
                )}
              </div>
            </div>
          ))
        )}
        {!isAdmin && project.candidates?.length > 0 && (
          <div className="text-sub mt-8">管理者が候補日から確定します</div>
        )}
      </div>

      {isAdmin && (
        <div className="card">
          <div className="section-title">ステータス変更</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_MAP).map(([key, { label }]) =>
              key !== project.status && (
                <button key={key} className="btn btn-ghost btn-sm" onClick={() => handleStatusChange(key)} disabled={busy}>
                  {label}へ変更
                </button>
              )
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>案件を削除</button>
        </div>
      )}
    </>
  );
}
