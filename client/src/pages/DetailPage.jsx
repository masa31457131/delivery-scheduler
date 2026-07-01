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
  const [salesUsers, setSalesUsers] = useState([]);
  const [csMembers, setCsMembers] = useState([]);

  // 候補日追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ date: '', date_to: '', time: '' });
  const [conflicts, setConflicts] = useState(null);

  // 確定モーダル（CS部員選択）
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [selectedCs, setSelectedCs] = useState([]);

  // 設定完了モーダル（不足理由入力）
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [shortageReason, setShortageReason] = useState('');

  // キャンセルモーダル
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = () => {
    setLoading(true);
    api.getProject(projectId).then(p => {
      setProject(p);
      setSelectedCs(p.cs_members || []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api.getUsers().then(setSalesUsers).catch(() => {});
    api.getCsMembers().then(setCsMembers).catch(() => {});
  }, [projectId]);

  const projectArea = (() => {
    if (!project) return null;
    const u = salesUsers.find(u => u.display_name === project.sales_rep);
    return u?.area || '東京';
  })();

  // 営業用：CS選択なしで直接確定
  const handleConfirmDirect = async (candidate) => {
    const dateStr = formatCandDate(candidate);
    if (!confirm(`「${dateStr}」でスケジュールを確定しますか？`)) return;
    setBusy(true);
    try {
      const updated = await api.confirmSchedule(projectId, {
        confirmed_date: candidate.candidate_date,
        confirmed_time: candidate.candidate_time,
        cs_members: project.cs_members || [],   // 管理者が設定済みのCS部員を引き継ぐ
        shortage_reason: project.shortage_reason || '',
      });
      setProject(updated);
      addToast('スケジュールを確定しました！');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  // 管理者用：CS選択モーダルを開く
  const openConfirmModal = (candidate) => {
    setConfirmTarget(candidate);
    setSelectedCs(project.cs_members || []);
    setShortageReason('');
    setShowConfirmModal(true);
  };

  // 仮スケジュール確定（CS部員選択のみ・不足理由は設定完了時に入力済み）
  const handleConfirmSchedule = async () => {
    if (!confirmTarget) return;
    if (selectedCs.length > 2) { addToast('CS部員は最大2名まで選択できます', 'error'); return; }
    setBusy(true);
    try {
      const updated = await api.confirmSchedule(projectId, {
        confirmed_date: confirmTarget.candidate_date,
        confirmed_time: confirmTarget.candidate_time,
        cs_members: selectedCs,
        shortage_reason: project.shortage_reason || '',
      });
      setProject(updated);
      setShowConfirmModal(false);
      addToast('スケジュールを確定しました！');
      onRefresh();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const toggleCs = (name) => {
    setSelectedCs(prev =>
      prev.includes(name) ? prev.filter(n => n !== name)
        : prev.length >= 2 ? (addToast('CS部員は最大2名まで選択できます', 'error'), prev)
        : [...prev, name]
    );
  };

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

  const handleRemind = async () => {
    if (!confirm('CS部管理者と自身にリマインドメールを送信しますか？')) return;
    setBusy(true);
    try {
      await api.sendReminder(projectId, user.login_id);
      addToast('リマインドメールを送信しました');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const checkConflict = async (date, time) => {
    if (!date) { setConflicts(null); return; }
    const result = await api.getConflicts(date, time, projectId, projectArea).catch(() => null);
    setConflicts(result);
  };

  const handleAddCandidate = async (e) => {
    e.preventDefault();
    if (conflicts?.blocked || conflicts?.sales_reps?.length >= 2) { addToast('この日程は登録できません', 'error'); return; }
    const maxDays = project.candidate_days || 1;
    if ((project.candidates?.length || 0) >= maxDays) {
      addToast(`希望候補日数（${maxDays}日）を超えて登録することはできません`, 'error'); return;
    }
    setBusy(true);
    try {
      const updatedCands = await api.addCandidate(projectId, newCandidate);
      setProject(p => ({ ...p, candidates: updatedCands }));
      setNewCandidate({ date: '', date_to: '', time: '' });
      setConflicts(null);
      setShowAddForm(false);
      addToast('候補日を追加しました');
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

  // 設定完了ボタン押下 → 不足チェック → 必要なら理由入力モーダル → API呼び出し
  const handleFinalizeCandidates = () => {
    const maxDays = project.candidate_days || 1;
    const currentCount = project.candidates?.length || 0;
    if (currentCount > maxDays) { addToast(`希望候補日数（${maxDays}日）を超えています。${currentCount - maxDays}件削除してください`, 'error'); return; }
    if (currentCount === 0) { addToast('候補日を1件以上登録してください', 'error'); return; }
    // 不足の場合はモーダルで理由入力 / ちょうどの場合は即確認
    if (currentCount < maxDays) {
      setShortageReason('');
      setShowFinalizeModal(true);
    } else {
      doFinalize('');
    }
  };

  const doFinalize = async (reason) => {
    setBusy(true);
    try {
      // shortage_reason と cs_members を一緒に保存してから finalize
      const patch = {};
      if (reason) patch.shortage_reason = reason;
      if (selectedCs.length > 0) patch.cs_members = selectedCs;
      if (Object.keys(patch).length > 0) {
        await api.updateProject(projectId, patch);
      }
      const updated = await api.finalizeCandidates(projectId);
      setProject({ ...updated, shortage_reason: reason || updated.shortage_reason, cs_members: selectedCs.length ? selectedCs : updated.cs_members });
      setShowFinalizeModal(false);
      setShortageReason('');
      addToast('候補日の設定が完了し、通知メールを送信しました');
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

  const handleDelete = async () => {
    if (!confirm('この案件を削除しますか？')) return;
    await api.deleteProject(projectId);
    addToast('案件を削除しました');
    onRefresh(); onBack();
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

  const canEditCandidates = isAdmin && !isCancelled && !isDelivered && !isConfirmed;
  const hasAnyCandidates = (project.candidates?.length || 0) > 0;
  const canConfirm = hasAnyCandidates && (isOwner || isAdmin) && !isCancelled && !isConfirmed && !isDelivered;
  // リマインドは営業担当が管理者へ候補日設定を促すための機能なので、営業（担当者）のみ
  const canRemind = isPending && isOwner && !isAdmin;
  const canCancel = !isCancelled && !isDelivered;

  const cands = project.candidates || [];
  const maxDays = project.candidate_days || 1;
  const candidatesReady = cands.length === maxDays;
  const candidatesShort = cands.length < maxDays;
  const candidatesOver = cands.length > maxDays;

  const formatCandDate = (c) => {
    let s = formatDate(c.candidate_date);
    if (c.candidate_date_to) s += `〜${formatDate(c.candidate_date_to)}`;
    if (c.candidate_time) s += ` ${c.candidate_time}`;
    return s;
  };

  return (
    <>
      {/* 確定モーダル（管理者用・CS部員は設定完了時に選択済み） */}
      {showConfirmModal && confirmTarget && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
          <div style={{ background:'var(--navy-mid)',border:'1px solid var(--border)',borderRadius:16,padding:24,width:'100%',maxWidth:400 }}>
            <div style={{ fontWeight:700,fontSize:'1.1rem',marginBottom:16 }}>📅 スケジュールを確定</div>

            <div style={{ padding:'10px 12px',background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.25)',borderRadius:8,marginBottom:16 }}>
              <div style={{ fontSize:'0.72rem',color:'var(--success)',marginBottom:2 }}>確定日</div>
              <div style={{ fontWeight:600,color:'var(--success)',fontSize:'1rem' }}>
                {formatCandDate(confirmTarget)}
              </div>
            </div>

            {/* CS部員の確認表示（設定完了時に選択済み） */}
            {(project.cs_members || []).length > 0 && (
              <div style={{ padding:'8px 12px',background:'rgba(59,130,246,0.07)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:8,marginBottom:16,fontSize:'0.82rem' }}>
                <div style={{ fontSize:'0.7rem',color:'var(--text-sub)',marginBottom:4 }}>CS担当者（設定済み）</div>
                {(project.cs_members || []).map(name => (
                  <div key={name} style={{ color:'var(--accent-lt)' }}>✓ {name}</div>
                ))}
              </div>
            )}

            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setShowConfirmModal(false)}>キャンセル</button>
              <button className="btn btn-success" style={{ flex:1 }} onClick={handleConfirmSchedule} disabled={busy}>
                {busy ? '確定中...' : '確定する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 設定完了モーダル（候補日不足時の理由入力） */}
      {showFinalizeModal && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
          <div style={{ background:'var(--navy-mid)',border:'1px solid var(--border)',borderRadius:16,padding:24,width:'100%',maxWidth:400 }}>
            <div style={{ fontWeight:700,fontSize:'1.1rem',marginBottom:8,color:'var(--warning)' }}>
              ⚠️ 候補日が希望日数より少ない状態で設定完了します
            </div>
            <div style={{ fontSize:'0.82rem',color:'var(--text-sub)',marginBottom:16,lineHeight:1.6 }}>
              希望候補日数：{project?.candidate_days || 1}日 ／ 現在の候補日：{project?.candidates?.length || 0}件<br />
              やむを得ない理由がある場合は、以下に理由を入力して設定完了できます。
            </div>
            <div className="form-group">
              <label>不足理由 *</label>
              <textarea
                value={shortageReason}
                onChange={e => setShortageReason(e.target.value)}
                placeholder="希望日数を満たせなかった理由を入力してください"
                style={{ minHeight:80 }}
                autoFocus
              />
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => { setShowFinalizeModal(false); setShortageReason(''); }}>
                キャンセル
              </button>
              <button className="btn btn-warning" style={{ flex:1, background:'var(--warning)', color:'#fff' }}
                onClick={() => { if (!shortageReason.trim()) { alert('不足理由を入力してください'); return; } doFinalize(shortageReason); }}
                disabled={busy}>
                {busy ? '処理中...' : '理由を入力して設定完了'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* キャンセルモーダル */}
      {showCancelModal && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
          <div style={{ background:'var(--navy-mid)',border:'1px solid var(--border)',borderRadius:16,padding:24,width:'100%',maxWidth:380 }}>
            <div style={{ fontWeight:700,fontSize:'1.1rem',marginBottom:8,color:'var(--danger)' }}>⚠️ キャンセル確認</div>
            <div style={{ fontSize:'0.82rem',color:'var(--text-sub)',marginBottom:16,lineHeight:1.6 }}>
              キャンセルすると元に戻せません。<br />再スケジュールが必要な場合は新規案件として再申請してください。
            </div>
            <div className="form-group">
              <label>キャンセル理由 *</label>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                placeholder="キャンセルの理由を入力してください" style={{ minHeight:80 }} autoFocus />
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => { setShowCancelModal(false); setCancelReason(''); }}>戻る</button>
              <button className="btn btn-danger" style={{ flex:1 }} onClick={handleCancel} disabled={busy||!cancelReason.trim()}>
                {busy ? '処理中...' : 'キャンセルする'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← 戻る</button>
        <StatusBadge status={project.status} />
      </div>
      <div className="page-title">{project.project_type || '—'}</div>
      <div className="page-sub">{project.client_name}</div>

      {/* 確定バナー */}
      {isConfirmed && project.confirmed_date && (
        <div className="confirmed-banner">
          <span style={{ fontSize:'1.2rem' }}>✅</span>
          <div>
            <div style={{ fontSize:'0.72rem',color:'var(--success)',marginBottom:2 }}>確定日</div>
            <div className="date-text">{formatDateTime(project.confirmed_date)}</div>
            {(project.cs_members||[]).length > 0 && (
              <div style={{ fontSize:'0.75rem',color:'var(--success)',marginTop:2 }}>CS担当：{project.cs_members.join('、')}</div>
            )}
          </div>
        </div>
      )}

      {/* キャンセルバナー */}
      {isCancelled && (
        <div style={{ padding:'12px 14px',borderRadius:10,marginBottom:16,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ fontSize:'0.72rem',color:'var(--danger)',marginBottom:4 }}>キャンセル済み</div>
          <div style={{ fontSize:'0.88rem' }}>理由：{project.cancel_reason || '—'}</div>
          <div style={{ fontSize:'0.75rem',color:'var(--text-sub)',marginTop:6 }}>再スケジュールが必要な場合は新規案件として再申請してください</div>
        </div>
      )}

      {/* メタ情報 */}
      <div className="detail-meta">
        <div className="meta-item"><div className="meta-label">担当営業</div><div className="meta-value">{project.sales_rep}</div></div>
        <div className="meta-item"><div className="meta-label">納品方法</div><div className="meta-value">{DELIVERY_LABELS[project.delivery_method]||'—'}</div></div>
        <div className="meta-item"><div className="meta-label">ステータス</div><div className="meta-value">{STATUS_MAP[project.status]?.label??project.status}</div></div>
        <div className="meta-item"><div className="meta-label">希望候補日数</div><div className="meta-value">{maxDays}日</div></div>
        {(project.cs_members||[]).length > 0 && (
          <div className="meta-item" style={{ gridColumn:'1/-1' }}>
            <div className="meta-label">CS担当者</div>
            <div className="meta-value">{project.cs_members.join('、')}</div>
          </div>
        )}
        {project.shortage_reason && (
          <div className="meta-item" style={{ gridColumn:'1/-1' }}>
            <div className="meta-label">不足理由</div>
            <div className="meta-value" style={{ color:'var(--warning)' }}>{project.shortage_reason}</div>
          </div>
        )}
        {project.confirmed_date && (
          <div className="meta-item" style={{ gridColumn:'1/-1' }}>
            <div className="meta-label">確定日時</div>
            <div className="meta-value">{formatDateTime(project.confirmed_date)}</div>
          </div>
        )}
        <div className="meta-item" style={{ gridColumn:'1/-1' }}>
          <div className="meta-label">最終更新</div>
          <div className="meta-value">{formatDateTime(project.updated_at)}</div>
        </div>
      </div>

      {project.memo && (
        <div className="card">
          <div className="section-title">備考</div>
          <div style={{ fontSize:'0.9rem',lineHeight:1.6 }}>{project.memo}</div>
        </div>
      )}

      {/* 候補日セクション */}
      {!isCancelled && (
        <div className="card">
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
            <div className="section-title" style={{ marginBottom:0 }}>{isConfirmed ? '確定スケジュール' : '候補日'}</div>
            {canEditCandidates && cands.length < maxDays && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(v => !v)}>
                {showAddForm ? '閉じる' : '+ 追加'}
              </button>
            )}
          </div>

          {/* 候補日追加フォーム */}
          {showAddForm && canEditCandidates && (
            <form onSubmit={handleAddCandidate} style={{ marginBottom:12,padding:12,background:'rgba(59,130,246,0.06)',borderRadius:8,border:'1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontSize:'0.78rem',color:'var(--text-sub)',marginBottom:8 }}>
                第{cands.length+1}候補を追加（希望候補日数：{maxDays}日）
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6 }}>
                <div>
                  <div style={{ fontSize:'0.72rem',color:'var(--text-sub)',marginBottom:4 }}>開始日 *</div>
                  <input type="date" value={newCandidate.date}
                    onChange={e => { setNewCandidate(c => ({ ...c, date: e.target.value })); checkConflict(e.target.value, newCandidate.time); }} required />
                </div>
                <div>
                  <div style={{ fontSize:'0.72rem',color:'var(--text-sub)',marginBottom:4 }}>終了日（期間指定の場合）</div>
                  <input type="date" value={newCandidate.date_to}
                    onChange={e => setNewCandidate(c => ({ ...c, date_to: e.target.value }))}
                    min={newCandidate.date} />
                </div>
              </div>
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:'0.72rem',color:'var(--text-sub)',marginBottom:4 }}>開始時刻（任意）</div>
                <input type="time" style={{ width:130 }} value={newCandidate.time}
                  onChange={e => { setNewCandidate(c => ({ ...c, time: e.target.value })); checkConflict(newCandidate.date, e.target.value); }} />
              </div>
              {conflicts && (
                conflicts.blocked ? (
                  <div style={{ fontSize:'0.78rem',color:'var(--danger)',marginBottom:8 }}>
                    🚫 管理者により予定不可{conflicts.blockedInfo?.reason ? `（${conflicts.blockedInfo.reason}）` : ''}
                  </div>
                ) : conflicts.sales_reps?.length >= 2 ? (
                  <div style={{ fontSize:'0.78rem',color:'var(--danger)',marginBottom:8 }}>
                    ⛔ {conflicts.sales_reps.join('さんと ')}さんが抑えているため登録不可
                  </div>
                ) : conflicts.sales_reps?.length === 1 ? (
                  <div style={{ fontSize:'0.78rem',color:'var(--warning)',marginBottom:8 }}>
                    ⚠️ {conflicts.sales_reps[0]}さんが仮抑え中（登録は可能）
                  </div>
                ) : null
              )}
              <div style={{ display:'flex',gap:8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowAddForm(false); setConflicts(null); }}>キャンセル</button>
                <button type="submit" className="btn btn-primary btn-sm"
                  disabled={busy || conflicts?.blocked || conflicts?.sales_reps?.length >= 2}>追加する</button>
              </div>
            </form>
          )}

          {/* 確定済み表示 */}
          {isConfirmed && project.confirmed_date && (
            <div style={{ padding:'12px 14px',borderRadius:8,background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.25)' }}>
              <div style={{ fontSize:'1rem',fontWeight:600,color:'var(--success)' }}>{formatDateTime(project.confirmed_date)}</div>
            </div>
          )}

          {/* 候補日一覧 */}
          {!isConfirmed && cands.length === 0 && (
            <div style={{ color:'var(--text-sub)',fontSize:'0.85rem' }}>
              {isPending ? '🗓 管理者が候補日を設定します（営業からの設定はできません）' : '候補日がありません'}
            </div>
          )}
          {!isConfirmed && cands.map(c => (
            <div key={c.id} className="confirm-card">
              <div>
                <div style={{ fontSize:'0.72rem',color:'var(--text-sub)',marginBottom:2 }}>{c.label}</div>
                <div className="confirm-date">{formatCandDate(c)}</div>
              </div>
              <div style={{ display:'flex',gap:8 }}>
                {canConfirm && (
                  isAdmin
                    ? <button className="btn btn-success btn-sm" onClick={() => openConfirmModal(c)} disabled={busy}>確定</button>
                    : <button className="btn btn-success btn-sm" onClick={() => handleConfirmDirect(c)} disabled={busy}>確定</button>
                )}
                {canEditCandidates && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteCandidate(c.id)} disabled={busy}
                    style={{ color:'var(--danger)',borderColor:'rgba(239,68,68,0.3)' }}>削除</button>
                )}
              </div>
            </div>
          ))}

          {/* 進捗表示・CS部員選択・設定完了ボタン（管理者のみ） */}
          {!isConfirmed && isAdmin && (isPending || isScheduled) && (
            <div style={{ marginTop:12 }}>
              {/* 進捗バー */}
              <div style={{
                padding:'8px 12px',borderRadius:8,marginBottom:12,fontSize:'0.8rem',
                background: candidatesReady ? 'rgba(16,185,129,0.08)' : candidatesOver ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${candidatesReady ? 'rgba(16,185,129,0.25)' : candidatesOver ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                color: candidatesReady ? 'var(--success)' : candidatesOver ? 'var(--danger)' : 'var(--warning)',
              }}>
                {candidatesReady && `✅ 候補日 ${cands.length}/${maxDays} 件 — 希望日数ちょうどです`}
                {candidatesOver && `⚠️ 候補日 ${cands.length}/${maxDays} 件 — 希望日数を超えています。${cands.length - maxDays}件削除してください`}
                {candidatesShort && `🗓 候補日 ${cands.length}/${maxDays} 件 — あと${maxDays - cands.length}件追加してください`}
              </div>

              {/* CS部員選択（管理者のみ・ここで設定する） */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:'0.78rem',fontWeight:700,color:'var(--text-sub)',letterSpacing:'0.05em',textTransform:'uppercase',marginBottom:8 }}>
                  CS部員を選択（最大2名・東西問わず）
                </div>
                {csMembers.length === 0 ? (
                  <div style={{ fontSize:'0.8rem',color:'var(--text-sub)' }}>
                    CS部員が未登録です（管理者設定 → 🛠 CS部員 から追加してください）
                  </div>
                ) : (
                  <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                    {csMembers.map(m => (
                      <label key={m.id} style={{
                        display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',
                        background: selectedCs.includes(m.display_name) ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                        border:`1px solid ${selectedCs.includes(m.display_name) ? 'var(--accent)' : 'var(--border)'}`,
                      }}>
                        <input type="checkbox" checked={selectedCs.includes(m.display_name)}
                          onChange={() => toggleCs(m.display_name)} style={{ width:'auto',margin:0 }} />
                        <span style={{ flex:1,fontSize:'0.88rem' }}>{m.display_name}</span>
                        <span style={{ fontSize:'0.68rem',padding:'1px 7px',borderRadius:99,background:'rgba(59,130,246,0.12)',color:'var(--accent-lt)' }}>
                          📍{m.area}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {selectedCs.length > 0 && (
                  <div style={{ fontSize:'0.75rem',color:'var(--accent-lt)',marginTop:6 }}>
                    選択中：{selectedCs.join('、')}（{selectedCs.length}/2名）
                  </div>
                )}
              </div>

              <button className="btn btn-success btn-full" onClick={handleFinalizeCandidates}
                disabled={busy || cands.length === 0}>
                候補日の設定完了（通知メールを送信）
              </button>
            </div>
          )}
        </div>
      )}

      {/* アクションボタン */}
      <div style={{ display:'flex',flexDirection:'column',gap:10,marginTop:8 }}>
        {canRemind && (
          <button className="btn btn-ghost btn-full" onClick={handleRemind} disabled={busy}
            style={{ borderColor:'var(--warning)',color:'var(--warning)' }}>
            🔔 リマインドを送信（CS部管理者・自身へメール）
          </button>
        )}
        {canCancel && !isCancelled && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCancelModal(true)} disabled={busy}
            style={{ color:'var(--danger)',borderColor:'rgba(239,68,68,0.3)',alignSelf:'flex-start' }}>
            この案件をキャンセル
          </button>
        )}
      </div>

      {/* 管理者専用：ステータス変更 */}
      {isAdmin && !isCancelled && (
        <div className="card" style={{ marginTop:12 }}>
          <div className="section-title">管理者：ステータス変更</div>
          <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
            {Object.entries(STATUS_MAP).map(([key, { label }]) =>
              key !== project.status && key !== 'cancelled' && (
                <button key={key} className="btn btn-ghost btn-sm" onClick={() => handleStatusChange(key)} disabled={busy}>
                  {label}へ変更
                </button>
              )
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop:8 }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>案件を削除</button>
        </div>
      )}
    </>
  );
}
