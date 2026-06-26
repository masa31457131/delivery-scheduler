import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

const EMPTY = { date: '', time: '' };

export default function NewProjectPage({ onSaved, addToast }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    client_name: '', project_name: '',
    sales_rep: user.role === 'sales' ? user.name : '',
    memo: '', delivery_method: 'remote',
  });
  const [candidates, setCandidates] = useState([{ ...EMPTY }]);
  const [salesUsers, setSalesUsers] = useState([]);
  const [conflicts, setConflicts] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getUsers().then(setSalesUsers); }, []);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCandidate = () => { if (candidates.length < 3) setCandidates(c => [...c, { ...EMPTY }]); };

  const removeCandidate = (i) => {
    setCandidates(c => c.filter((_, idx) => idx !== i));
    setConflicts(prev => { const n = { ...prev }; delete n[i]; return n; });
  };

  const updateCandidate = async (i, k, v) => {
    const updated = candidates.map((x, idx) => idx === i ? { ...x, [k]: v } : x);
    setCandidates(updated);
    const c = updated[i];
    if (c.date) {
      const result = await api.getConflicts(c.date, c.time || '').catch(() => ({ blocked: false, sales_reps: [] }));
      setConflicts(prev => ({ ...prev, [i]: result }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validCandidates = candidates.filter(c => c.date);
    setLoading(true);
    try {
      await api.createProject({ ...form, candidates: validCandidates });
      addToast('案件を登録しました');
      onSaved();
    } catch (err) {
      addToast(err.message, 'error');
    } finally { setLoading(false); }
  };

  const isHardBlocked = (i) => conflicts[i]?.blocked || (conflicts[i]?.sales_reps?.length >= 2);

  return (
    <>
      <div className="page-title">案件を登録</div>
      <div className="page-sub">仮スケジュール（最大3件）を登録してください</div>
      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="section-title">基本情報</div>
          <div className="form-group">
            <label>顧客名 *</label>
            <input value={form.client_name} onChange={e => setField('client_name', e.target.value)} placeholder="株式会社〇〇" required />
          </div>
          <div className="form-group">
            <label>案件名 *</label>
            <input value={form.project_name} onChange={e => setField('project_name', e.target.value)} placeholder="Webサイトリニューアル" required />
          </div>
          {user.role === 'admin' ? (
            <div className="form-group">
              <label>担当営業 *</label>
              <select value={form.sales_rep} onChange={e => setField('sales_rep', e.target.value)} required>
                <option value="">選択してください</option>
                {salesUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label>担当営業</label>
              <input value={user.name} disabled style={{ opacity: 0.6 }} />
            </div>
          )}
          <div className="form-group">
            <label>納品方法 *</label>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {[{ value: 'remote', label: '🖥 リモート' }, { value: 'onsite', label: '🚗 現地訪問' }].map(opt => (
                <label key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1,
                  background: form.delivery_method === opt.value ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                  border: `1px solid ${form.delivery_method === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '10px 14px', transition: 'all 0.15s',
                }}>
                  <input type="radio" name="delivery_method" value={opt.value}
                    checked={form.delivery_method === opt.value}
                    onChange={e => setField('delivery_method', e.target.value)}
                    style={{ width: 'auto' }} />
                  <span style={{ fontSize: '0.9rem' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>メモ・備考</label>
            <textarea value={form.memo} onChange={e => setField('memo', e.target.value)} placeholder="顧客の要望、注意事項など" />
          </div>
        </div>

        <div className="card">
          <div className="section-title">候補日（最大3件）</div>
          <div className="candidate-list">
            {candidates.map((c, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div className="candidate-row">
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', minWidth: 44 }}>第{i+1}候補</div>
                  <input type="date" style={{ flex: 1 }} value={c.date} onChange={e => updateCandidate(i, 'date', e.target.value)} />
                  <input type="time" className="time-input" value={c.time} onChange={e => updateCandidate(i, 'time', e.target.value)} />
                  {candidates.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCandidate(i)} style={{ padding: '6px 8px', flexShrink: 0 }}>×</button>
                  )}
                </div>
                {conflicts[i] && (
                  conflicts[i].blocked ? (
                    <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
                      🚫 この日程は管理者により予定不可に設定されています
                      {conflicts[i].blockedInfo?.reason ? `（${conflicts[i].blockedInfo.reason}）` : ''}
                    </div>
                  ) : conflicts[i].sales_reps?.length >= 2 ? (
                    <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
                      ⛔ この日程は既に {conflicts[i].sales_reps.join('さんと ')}さんが抑えています（登録不可）
                    </div>
                  ) : conflicts[i].sales_reps?.length === 1 ? (
                    <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--warning)' }}>
                      ⚠️ {conflicts[i].sales_reps[0]}さんがこの日程を仮抑えしています
                    </div>
                  ) : null
                )}
              </div>
            ))}
          </div>
          {candidates.length < 3 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCandidate} style={{ marginTop: 10 }}>+ 候補日を追加</button>
          )}
        </div>

        <button className="btn btn-primary btn-full" type="submit" disabled={loading || candidates.some((_, i) => isHardBlocked(i))}>
          {loading ? '登録中...' : '案件を登録する'}
        </button>
        {candidates.some((_, i) => isHardBlocked(i)) && (
          <div style={{ textAlign: 'center', color: 'var(--danger)', fontSize: '0.8rem', marginTop: 8 }}>
            登録不可の候補日があるため登録できません
          </div>
        )}
      </form>
    </>
  );
}
