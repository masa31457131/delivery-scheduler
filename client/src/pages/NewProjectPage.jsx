import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

const EMPTY_CANDIDATE = { date: '', time: '' };

export default function NewProjectPage({ onSaved, addToast }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    client_name: '',
    project_name: '',
    sales_rep: user.role === 'sales' ? user.name : '',
    memo: '',
  });
  const [candidates, setCandidates] = useState([{ ...EMPTY_CANDIDATE }]);
  const [salesUsers, setSalesUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user.role === 'admin') {
      api.getUsers().then(setSalesUsers);
    }
  }, []);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCandidate = () => {
    if (candidates.length < 3) setCandidates(c => [...c, { ...EMPTY_CANDIDATE }]);
  };

  const removeCandidate = (i) => setCandidates(c => c.filter((_, idx) => idx !== i));

  const updateCandidate = (i, k, v) =>
    setCandidates(c => c.map((x, idx) => idx === i ? { ...x, [k]: v } : x));

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
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-title">案件を登録</div>
      <div className="page-sub">仮スケジュール（最大3件）を登録してください</div>

      <form onSubmit={handleSubmit}>
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
            <label>案件名 *</label>
            <input
              value={form.project_name}
              onChange={e => setField('project_name', e.target.value)}
              placeholder="Webサイトリニューアル"
              required
            />
          </div>
          {user.role === 'admin' ? (
            <div className="form-group">
              <label>担当営業 *</label>
              <select
                value={form.sales_rep}
                onChange={e => setField('sales_rep', e.target.value)}
                required
              >
                <option value="">選択してください</option>
                {salesUsers.map(u => (
                  <option key={u.id} value={u.name}>{u.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label>担当営業</label>
              <input value={user.name} disabled style={{ opacity: 0.6 }} />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>メモ・備考</label>
            <textarea
              value={form.memo}
              onChange={e => setField('memo', e.target.value)}
              placeholder="顧客の要望、注意事項など"
            />
          </div>
        </div>

        <div className="card">
          <div className="section-title">候補日（最大3件）</div>
          <div className="candidate-list">
            {candidates.map((c, i) => (
              <div key={i} className="candidate-row">
                <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', minWidth: 44 }}>
                  第{i + 1}候補
                </div>
                <input
                  type="date"
                  className="time-input"
                  style={{ flex: 1 }}
                  value={c.date}
                  onChange={e => updateCandidate(i, 'date', e.target.value)}
                />
                <input
                  type="time"
                  className="time-input"
                  value={c.time}
                  onChange={e => updateCandidate(i, 'time', e.target.value)}
                />
                {candidates.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeCandidate(i)}
                    style={{ padding: '6px 8px', flexShrink: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {candidates.length < 3 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addCandidate}
              style={{ marginTop: 10 }}
            >
              + 候補日を追加
            </button>
          )}
        </div>

        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? '登録中...' : '案件を登録する'}
        </button>
      </form>
    </>
  );
}
