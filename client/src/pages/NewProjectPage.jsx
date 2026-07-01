import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

const PROJECT_TYPES = ['新規納品', '増設納品', 'PC入替え', 'I/O機器納品', '打合せ', '調査'];

export default function NewProjectPage({ onSaved, addToast }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    client_name: '',
    project_type: '',
    sales_rep: user.role === 'sales' ? user.name : '',
    memo: '',
    delivery_method: 'remote',
    candidate_days: 1,
  });
  const [salesUsers, setSalesUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getUsers().then(setSalesUsers); }, []);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleMemo = (v) => {
    if (v.length <= 50) setField('memo', v);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.project_type) { addToast('案件内容を選択してください', 'error'); return; }
    setLoading(true);
    try {
      await api.createProject({ ...form, candidates: [] });
      addToast('案件を登録しました');
      onSaved();
    } catch (err) {
      addToast(err.message, 'error');
    } finally { setLoading(false); }
  };

  const memoLen = form.memo.length;

  return (
    <>
      <div className="page-title">案件を登録</div>
      <div className="page-sub">内容を入力して希望日数を選択してください</div>

      <form onSubmit={handleSubmit}>
        {/* 基本情報 */}
        <div className="card">
          <div className="section-title">基本情報</div>

          <div className="form-group">
            <label>顧客名 *</label>
            <input
              value={form.client_name}
              onChange={e => setField('client_name', e.target.value)}
              placeholder="株式会社〇〇"
              required
            />
          </div>

          <div className="form-group">
            <label>案件内容 *</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 4 }}>
              {PROJECT_TYPES.map(type => (
                <label key={type} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                  background: form.project_type === type ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                  border: `1px solid ${form.project_type === type ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all 0.15s',
                }}>
                  <input
                    type="radio" name="project_type" value={type}
                    checked={form.project_type === type}
                    onChange={() => setField('project_type', type)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  <span style={{ fontSize: '0.88rem' }}>{type}</span>
                </label>
              ))}
            </div>
          </div>

          {user.role === 'admin' ? (
            <div className="form-group">
              <label>担当営業 *</label>
              <select value={form.sales_rep} onChange={e => setField('sales_rep', e.target.value)} required>
                <option value="">選択してください</option>
                {salesUsers.map(u => <option key={u.id} value={u.display_name}>{u.display_name}</option>)}
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
                    onChange={() => setField('delivery_method', opt.value)}
                    style={{ width: 'auto', margin: 0 }} />
                  <span style={{ fontSize: '0.9rem' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>備考</label>
              <span style={{
                fontSize: '0.75rem', fontWeight: 600,
                color: memoLen >= 40 ? (memoLen >= 50 ? 'var(--danger)' : 'var(--warning)') : 'var(--text-sub)',
              }}>
                {memoLen} / 50文字
              </span>
            </div>
            <input
              value={form.memo}
              onChange={e => handleMemo(e.target.value)}
              placeholder="簡潔に記載（50文字以内）"
              maxLength={50}
            />
          </div>
        </div>

        {/* 希望候補日数 */}
        <div className="card">
          <div className="section-title">希望候補日数</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginBottom: 14, lineHeight: 1.6 }}>
            管理者がカレンダーを確認し、何日分の候補日を設定してほしいですか？
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {[1, 2, 3].map(n => (
              <label key={n} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 6, cursor: 'pointer', padding: '18px 8px', borderRadius: 12,
                background: form.candidate_days === n ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                border: `2px solid ${form.candidate_days === n ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}>
                <input type="radio" name="candidate_days" value={n}
                  checked={form.candidate_days === n}
                  onChange={() => setField('candidate_days', n)}
                  style={{ display: 'none' }} />
                <span style={{
                  fontSize: '2.2rem', fontWeight: 700, lineHeight: 1,
                  color: form.candidate_days === n ? 'var(--accent)' : 'var(--text)',
                }}>{n}</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-sub)' }}>日</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-sub)', lineHeight: 1.6 }}>
            ※ 管理者がスケジュールを確認し、候補日を設定します
          </div>
        </div>

        <button
          className="btn btn-primary btn-full"
          type="submit"
          disabled={loading || !form.project_type || !form.client_name}
        >
          {loading ? '登録中...' : '依頼を送信する'}
        </button>
      </form>
    </>
  );
}
