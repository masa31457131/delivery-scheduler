import { useState, useEffect } from 'react';
import { api } from '../api';

// ── Tabs: メンバー管理 / 予定不可日 / メール設定 ──────────────

export default function AdminUsersPage({ addToast }) {
  const [tab, setTab] = useState('users');

  return (
    <>
      <div className="page-title">管理者設定</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'users',   label: '👤 メンバー' },
          { key: 'blocked', label: '🚫 予定不可日' },
          { key: 'email',   label: '📧 メール設定' },
        ].map(t => (
          <button key={t.key} className={`filter-chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'users'   && <UsersTab addToast={addToast} />}
      {tab === 'blocked' && <BlockedTab addToast={addToast} />}
      {tab === 'email'   && <EmailTab addToast={addToast} />}
    </>
  );
}

// ── メンバー管理 ──────────────────────────────────────────────
function UsersTab({ addToast }) {
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
    e.preventDefault(); setLoading(true);
    try {
      if (editTarget) {
        const payload = {};
        if (form.name !== editTarget.name) payload.name = form.name;
        if (form.password) payload.password = form.password;
        await api.updateUser(editTarget.id, payload);
        addToast('更新しました');
      } else {
        await api.createUser({ name: form.name, password: form.password });
        addToast('追加しました');
      }
      await load(); closeForm();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`「${u.name}」を削除しますか？`)) return;
    try { await api.deleteUser(u.id); addToast('削除しました'); await load(); }
    catch (err) { addToast(err.message, 'error'); }
  };

  return (
    <>
      <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={openAdd}>+ 営業担当を追加</button>
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 20 }}>{editTarget ? '営業担当を編集' : '営業担当を追加'}</div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>名前 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="営業 鈴木" required />
              </div>
              <div className="form-group">
                <label>{editTarget ? '新しいパスワード（変更する場合のみ）' : 'パスワード *'}</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editTarget ? '変更しない場合は空白' : 'パスワードを入力'} required={!editTarget} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={closeForm}>キャンセル</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>{loading ? '保存中...' : editTarget ? '更新' : '追加'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {users.map(u => (
        <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
            {u.name.slice(-1)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{u.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>営業担当</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>編集</button>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>削除</button>
        </div>
      ))}
    </>
  );
}

// ── 予定不可日管理 ────────────────────────────────────────────
function BlockedTab({ addToast }) {
  const [blocked, setBlocked] = useState([]);
  const [form, setForm] = useState({ date: '', time_from: '', time_to: '', reason: '' });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => api.getBlockedDates().then(setBlocked);
  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.createBlockedDate(form);
      addToast('予定不可日を設定しました');
      setForm({ date: '', time_from: '', time_to: '', reason: '' });
      setShowForm(false);
      await load();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('この予定不可日を削除しますか？')) return;
    await api.deleteBlockedDate(id);
    addToast('削除しました');
    await load();
  };

  const formatBlocked = (b) => {
    let s = b.date;
    if (b.time_from) s += ` ${b.time_from}〜${b.time_to || ''}`;
    else s += '（終日）';
    if (b.reason) s += ` / ${b.reason}`;
    return s;
  };

  return (
    <>
      <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => setShowForm(v => !v)}>
        {showForm ? '▲ 閉じる' : '+ 予定不可日を追加'}
      </button>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={handleAdd}>
            <div className="form-group">
              <label>日付 *</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>開始時刻（任意）</label>
                <input type="time" value={form.time_from} onChange={e => setForm(f => ({ ...f, time_from: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>終了時刻（任意）</label>
                <input type="time" value={form.time_to} onChange={e => setForm(f => ({ ...f, time_to: e.target.value }))} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>理由（任意）</label>
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="社内行事、定休日など" />
            </div>
            <button type="submit" className="btn btn-danger btn-sm" disabled={loading}>{loading ? '設定中...' : '予定不可日を設定'}</button>
          </form>
        </div>
      )}

      {blocked.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 16px' }}>予定不可日は設定されていません</div>
      ) : (
        blocked.map(b => (
          <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '0.9rem' }}>🚫 {formatBlocked(b)}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(b.id)}>削除</button>
          </div>
        ))
      )}
    </>
  );
}

// ── メール設定 ────────────────────────────────────────────────
function EmailTab({ addToast }) {
  const [settings, setSettings] = useState({ from: '', notify_emails: [] });
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getEmailSettings().then(setSettings); }, []);

  const addEmail = () => {
    const email = newEmail.trim();
    if (!email || !email.includes('@')) { addToast('有効なメールアドレスを入力してください', 'error'); return; }
    if (settings.notify_emails.includes(email)) { addToast('すでに登録されています', 'error'); return; }
    setSettings(s => ({ ...s, notify_emails: [...s.notify_emails, email] }));
    setNewEmail('');
  };

  const removeEmail = (email) => {
    setSettings(s => ({ ...s, notify_emails: s.notify_emails.filter(e => e !== email) }));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await api.updateEmailSettings(settings);
      addToast('メール設定を保存しました');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="card">
        <div className="section-title">送信元アドレス（From）</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginBottom: 10, lineHeight: 1.6 }}>
          Resend で認証済みのメールアドレスを設定してください。<br />
          例：<code style={{ color: 'var(--accent-lt)' }}>delivery@your-domain.com</code>
        </div>
        <input
          type="email"
          value={settings.from}
          onChange={e => setSettings(s => ({ ...s, from: e.target.value }))}
          placeholder="noreply@your-domain.com"
        />
      </div>

      <div className="card">
        <div className="section-title">通知先メールアドレス</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginBottom: 12, lineHeight: 1.6 }}>
          案件登録・日程確定時に通知を送るアドレス（複数登録可）
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="manager@example.com"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={addEmail}>追加</button>
        </div>
        {settings.notify_emails.length === 0 ? (
          <div className="text-sub" style={{ fontSize: '0.8rem' }}>通知先が登録されていません</div>
        ) : (
          settings.notify_emails.map(email => (
            <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.88rem' }}>📧 {email}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => removeEmail(email)}>削除</button>
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--warning)', lineHeight: 1.7 }}>
          <b>⚙️ Resend の設定が必要です</b><br />
          1. <a href="https://resend.com" target="_blank" style={{ color: 'var(--accent-lt)' }}>resend.com</a> で無料登録<br />
          2. API Keys → Create API Key<br />
          3. Render.com の環境変数に <code>RESEND_API_KEY</code> を追加<br />
          4. 送信元ドメインを Resend で認証
        </div>
      </div>

      <button className="btn btn-primary btn-full" onClick={handleSave} disabled={loading} style={{ marginTop: 8 }}>
        {loading ? '保存中...' : '設定を保存'}
      </button>
    </>
  );
}
