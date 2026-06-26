import { useState, useEffect } from 'react';
import { api } from '../api';

export default function AdminUsersPage({ addToast }) {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [loading, setLoading] = useState(false);

  const load = () => api.getUsers().then(setUsers);
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditTarget(null); setForm({ name: '', password: '' }); setShowForm(true); };
  const openEdit = (u) => { setEditTarget(u); setForm({ name: u.name, password: '' }); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditTarget(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editTarget) {
        const payload = {};
        if (form.name !== editTarget.name) payload.name = form.name;
        if (form.password) payload.password = form.password;
        await api.updateUser(editTarget.id, payload);
        addToast('ユーザー情報を更新しました');
      } else {
        await api.createUser({ name: form.name, password: form.password });
        addToast('営業担当を追加しました');
      }
      await load();
      closeForm();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (u) => {
    if (!confirm(`「${u.name}」を削除しますか？\n担当案件は残ります。`)) return;
    try {
      await api.deleteUser(u.id);
      addToast(`${u.name}を削除しました`);
      await load();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <>
      <div className="page-title">営業担当管理</div>
      <div className="page-sub">営業スタッフの追加・変更・削除</div>

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={openAdd}>
        + 営業担当を追加
      </button>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--navy-mid)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 360,
          }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 20 }}>
              {editTarget ? '営業担当を編集' : '営業担当を追加'}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>名前 *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="営業 鈴木"
                  required
                />
              </div>
              <div className="form-group">
                <label>{editTarget ? '新しいパスワード（変更する場合のみ）' : 'パスワード *'}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editTarget ? '変更しない場合は空白' : 'パスワードを入力'}
                  required={!editTarget}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={closeForm}>キャンセル</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? '保存中...' : editTarget ? '更新' : '追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div className="empty-state">営業担当がいません</div>
      ) : (
        users.map(u => (
          <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '1rem', flexShrink: 0,
            }}>
              {u.name.slice(-1)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{u.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>営業担当</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>編集</button>
            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>削除</button>
          </div>
        ))
      )}
    </>
  );
}
