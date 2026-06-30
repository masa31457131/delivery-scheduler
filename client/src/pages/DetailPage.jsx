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

  // キャンセルモーダル
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = () => {
    setLoading(true);
    api.getProject(projectId).then(setProject).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  // 仮スケジュール確定（営業が実行）
  const handleConfirmSchedule = async (candidate) => {
    const dateStr = `${formatDate(candidate.candidate_date)}${candidate.candidate_time ? ' ' + candidate.candidate_time : ''}`;
    if (!confirm(`「${dateStr}」でスケジュールを確定しますか？\n確定後はキャンセル以外の変更ができません。`)) return;
    setBusy(true);
    try {
      const updated = await api.confirmSchedule(projectId, {
        confirmed_date: candidate.candidate_date,
        confirmed_time: candidate.candidate_time,
      });
      setProject(updated);
      addToast('スケジュールを確定しました！');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // キャンセル
  const handleCancel = async () => {
    if (!cancelReason.trim()) { addToast('キャンセル理由を入力してください', 'error'); return; }
    setBusy(true);
    try {
      const updated = await api.cancelProject(projectId, { reason: cancelReason });
      setProject(updated);
      addToast('案件をキャンセルしました');
      setShowCancelModal(false);
      setCancelReason('');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // リマインドメール
  const handleRemind = async () => {
    if (!confirm('CS部管理者と自身にリマインドメールを送信しますか？')) return;
    setBusy(true);
    try {
      await api.sendReminder(projectId);
      addToast('リマインドメールを送信しました');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // 候補日の重複チェック
  const checkConflict = async (date, time) => {
    if (!date) { setConflicts(null); return; }
    const result = await api.getConflicts(date, time, projectId).catch(() => null);
    setConflicts(result);
  };

  // 候補日追加
  const handleAddCandidate = async (e) => {
    e.preventDefault();
    if (conflicts?.blocked || conflicts?.sales_reps?.length >= 2) {
      addToast('この日程は登録できません', 'error'); return;
    }
    setBusy(true);
    try {
      const updatedCands = await api.addCandidate(projectId, newCandidate);
      setProject(p => ({ ...p, candidates: updatedCands, status: updatedCands.length > 0 ? 'scheduled' : 'pending' }));
      setNewCandidate({ date: '', time: '' });
      setConflicts(null);
      setShowAddForm(false);
      addToast('候補日を追加しました');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // 候補日削除
  const handleDeleteCandidate = async (candidateId) => {
    if (!confirm('この候補日を削除しますか？')) return;
    setBusy(true);
    try {
      const updatedCands = await api.deleteCandidate(projectId, candidateId);
      setProject(p => ({ ...p, candidates: updatedCands, status: updatedCands.length === 0 ? 'pending' : 'scheduled' }));
      addToast('候補日を削除しました');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // 管理者ステータス変更
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
  const isCancelled = project.status === 'cancelled';
  const isConfirmed = project.status === 'confirmed';
  const isDelivered = project.status === 'delivered';
  const isPending = project.status === 'pending';
  const isScheduled = project.status === 'scheduled';

  // 候補日の追加・削除：管理者のみ（営業は候補日を設定できない）
  const canEditCandidates = isAdmin && !isCancelled && !isDelivered;
  // 確定ボタン表示：候補日が1件以上ある状態で、担当営業または管理者なら誰でも確定可能
  // （ステータスが scheduled になっていなくても、候補日が存在すれば確定できるようにする）
  const hasAnyCandidates = (project.candidates?.length || 0) > 0;
  const canConfirm = hasAnyCandidates && (isOwner || isAdmin) && !isCancelled && !isConfirmed && !isDelivered;
  // リマインドボタン：候補日待ち（pending）のときのみ、担当営業または管理者
  const canRemind = isPending && (isOwner || isAdmin);
  // キャンセルボタン：キャンセル・納品済み以外なら誰でも
  const canCancel = !isCancelled && !isDelivered;

  return (
    <>
      {/* キャンセルモーダル */}
      {showCancelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8, color: 'var(--danger)' }}>
              ⚠️ キャンセル確認
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-sub)', marginBottom: 16, lineHeight: 1.6 }}>
              キャンセルすると元に戻せません。<br />
              再スケジュールが必要な場合は新規案件として再申請してください。
            </div>
            <div className="form-group">
              <label>キャンセル理由 *</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="キャンセルの理由を入力してください"
                style={{ minHeight: 80 }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowCancelModal(false); setCancelReason(''); }}>
                戻る
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleCancel}
                disabled={busy || !cancelReason.trim()}>
                {busy ? '処理中...' : 'キャンセルする'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← 戻る</button>
        <StatusBadge status={project.status} />
      </div>

      <div className="page-title">{project.project_type || '—'}</div>
      <div className="page-sub">{project.client_name}</div>

      {/* 確定日バナー */}
      {isConfirmed && project.confirmed_date && (
        <div className="confirmed-banner">
          <span style={{ fontSize: '1.2rem' }}>✅</span>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginBottom: 2 }}>確定日</div>
            <div className="date-text">{formatDateTime(project.confirmed_date)}</div>
          </div>
        </div>
      )}

      {/* キャンセルバナー */}
      {isCancelled && (
        <div style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 16,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginBottom: 4 }}>キャンセル済み</div>
          <div style={{ fontSize: '0.88rem', color: 'var(--text)' }}>
            理由：{project.cancel_reason || '—'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: 6 }}>
            再スケジュールが必要な場合は新規案件として再申請してください
          </div>
        </div>
      )}

      {/* メタ情報 */}
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
          <div className="meta-label">希望候補日数</div>
          <div className="meta-value">{project.candidate_days || 1}日</div>
        </div>
        {project.confirmed_date && (
          <div className="meta-item" style={{ gridColumn: '1 / -1' }}>
            <div className="meta-label">確定日時</div>
            <div className="meta-value">{formatDateTime(project.confirmed_date)}</div>
          </div>
        )}
        <div className="meta-item" style={{ gridColumn: '1 / -1' }}>
          <div className="meta-label">最終更新</div>
          <div className="meta-value">{formatDateTime(project.updated_at)}</div>
        </div>
      </div>

      {project.memo && (
        <div className="card">
          <div className="section-title">備考</div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>{project.memo}</div>
        </div>
      )}

      {/* 候補日セクション */}
      {!isCancelled && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              {isConfirmed ? '確定スケジュール' : '候補日'}
            </div>
            {canEditCandidates && !isConfirmed && (project.candidates?.length || 0) < 3 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(v => !v)}>
                {showAddForm ? '閉じる' : '+ 追加'}
              </button>
            )}
          </div>

          {/* 候補日追加フォーム */}
          {showAddForm && !isConfirmed && (
            <form onSubmit={handleAddCandidate} style={{ marginBottom: 12, padding: 12,
              background: 'rgba(59,130,246,0.06)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginBottom: 8 }}>
                第{(project.candidates?.length || 0) + 1}候補を追加
              </div>
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
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setShowAddForm(false); setConflicts(null); }}>キャンセル</button>
                <button type="submit" className="btn btn-primary btn-sm"
                  disabled={busy || conflicts?.blocked || conflicts?.sales_reps?.length >= 2}>追加する</button>
              </div>
            </form>
          )}

          {/* 確定済みの日付表示 */}
          {isConfirmed && project.confirmed_date && (
            <div style={{ padding: '12px 14px', borderRadius: 8,
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--success)' }}>
                {formatDateTime(project.confirmed_date)}
              </div>
            </div>
          )}

          {/* 候補日一覧 */}
          {!isConfirmed && (!project.candidates || project.candidates.length === 0) && (
            <div style={{ color: 'var(--text-sub)', fontSize: '0.85rem' }}>
              {isPending ? '🗓 管理者が候補日を設定します（営業からの設定はできません）' : '候補日がありません'}
            </div>
          )}
          {!isConfirmed && project.candidates?.map(c => (
            <div key={c.id} className="confirm-card">
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', marginBottom: 2 }}>{c.label}</div>
                <div className="confirm-date">
                  {formatDate(c.candidate_date)}{c.candidate_time && ` ${c.candidate_time}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* 確定ボタン：営業担当または管理者 */}
                {canConfirm && (
                  <button className="btn btn-success btn-sm" onClick={() => handleConfirmSchedule(c)} disabled={busy}>
                    確定
                  </button>
                )}
                {canEditCandidates && (
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => handleDeleteCandidate(c.id)} disabled={busy}
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
                    削除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* アクションボタン */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>

        {/* リマインドボタン：候補日待ちのとき */}
        {canRemind && (
          <button className="btn btn-ghost btn-full" onClick={handleRemind} disabled={busy}
            style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
            🔔 リマインドを送信（CS部管理者・自身へメール）
          </button>
        )}

        {/* キャンセルボタン */}
        {canCancel && !isCancelled && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCancelModal(true)} disabled={busy}
            style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)', alignSelf: 'flex-start' }}>
            この案件をキャンセル
          </button>
        )}
      </div>

      {/* 管理者専用：ステータス変更 */}
      {isAdmin && !isCancelled && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-title">管理者：ステータス変更</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_MAP).map(([key, { label }]) =>
              key !== project.status && key !== 'cancelled' && (
                <button key={key} className="btn btn-ghost btn-sm"
                  onClick={() => handleStatusChange(key)} disabled={busy}>
                  {label}へ変更
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* 管理者：削除 */}
      {isAdmin && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>案件を削除</button>
        </div>
      )}
    </>
  );
}
