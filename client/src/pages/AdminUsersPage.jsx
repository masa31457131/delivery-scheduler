import { useState, useEffect } from 'react';
import { api } from '../api';

export default function AdminUsersPage({ addToast }) {
  const [tab, setTab] = useState('users');
  return (
    <>
      <div className="page-title">管理者設定</div>
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        {[
          { key: 'users',     label: '👤 メンバー' },
          { key: 'admins',    label: '🔑 管理者' },
          { key: 'blocked',   label: '🚫 予定不可日' },
          { key: 'email',     label: '📧 メール設定' },
          { key: 'templates', label: '✏️ メール文面' },
        ].map(t => (
          <button key={t.key} className={`filter-chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'users'     && <UsersTab addToast={addToast} />}
      {tab === 'admins'    && <AdminsTab addToast={addToast} />}
      {tab === 'blocked'   && <BlockedTab addToast={addToast} />}
      {tab === 'email'     && <EmailTab addToast={addToast} />}
      {tab === 'templates' && <TemplatesTab addToast={addToast} />}
    </>
  );
}

// ── メンバー管理（表示名・ログインID・パスワード・メール）────
function UsersTab({ addToast }) {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ display_name: '', login_id: '', password: '', email: '', area: '東京' });
  const [loading, setLoading] = useState(false);

  const load = () => api.getUsers().then(setUsers);
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditTarget(null); setForm({ display_name: '', login_id: '', password: '', email: '', area: '東京' }); setShowForm(true); };
  const openEdit = (u) => { setEditTarget(u); setForm({ display_name: u.display_name, login_id: u.login_id, password: '', email: u.email || '', area: u.area || '東京' }); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditTarget(null); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      if (editTarget) {
        const payload = { display_name: form.display_name, login_id: form.login_id, email: form.email, area: form.area };
        if (form.password) payload.password = form.password;
        await api.updateUser(editTarget.id, payload);
        addToast('更新しました');
      } else {
        await api.createUser(form);
        addToast('追加しました');
      }
      await load(); closeForm();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`「${u.display_name}」を削除しますか？`)) return;
    try { await api.deleteUser(u.id); addToast('削除しました'); await load(); }
    catch (err) { addToast(err.message, 'error'); }
  };

  return (
    <>
      <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={openAdd}>+ 営業担当を追加</button>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 20 }}>
              {editTarget ? '営業担当を編集' : '営業担当を追加'}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>表示名 *</label>
                <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="山田 太郎" required />
              </div>
              <div className="form-group">
                <label>ログインID *</label>
                <input value={form.login_id} onChange={e => setForm(f => ({ ...f, login_id: e.target.value }))}
                  placeholder="yamada" required
                  style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group">
                <label>{editTarget ? '新しいパスワード（変更する場合のみ）' : 'パスワード *'}</label>
                <input type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editTarget ? '変更しない場合は空白' : 'パスワードを入力'}
                  required={!editTarget} />
              </div>
              <div className="form-group">
                <label>メールアドレス（日程確定時に通知）</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="yamada@example.com" />
              </div>
              <div className="form-group">
                <label>エリア *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['東京', '大阪'].map(a => (
                    <label key={a} style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                      background: form.area === a ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                      border: `1px solid ${form.area === a ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <input type="radio" name="area" value={a} checked={form.area === a}
                        onChange={() => setForm(f => ({ ...f, area: a }))} style={{ width: 'auto', margin: 0 }} />
                      <span style={{ fontSize: '0.88rem' }}>📍 {a}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
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
        <div className="empty-state" style={{ padding: '32px 16px' }}>営業担当がいません</div>
      ) : users.map(u => (
        <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
            {u.display_name?.slice(-1) || '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>{u.display_name}</span>
              <span style={{ fontSize: '0.68rem', padding: '1px 7px', borderRadius: 99, background: 'rgba(59,130,246,0.15)', color: 'var(--accent-lt)' }}>
                📍 {u.area || '東京'}
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', fontFamily: 'monospace' }}>
              ID: {u.login_id}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.email ? `📧 ${u.email}` : '📧 未設定'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>編集</button>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>削除</button>
        </div>
      ))}
    </>
  );
}

// ── 予定不可日管理 ────────────────────────────────────────────
// ── 管理者管理（複数管理者・エリア設定）────────────────────────
function AdminsTab({ addToast }) {
  const [admins, setAdmins] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ display_name: '', login_id: '', password: '', email: '', area: '東京' });
  const [loading, setLoading] = useState(false);

  const load = () => api.getAdmins().then(setAdmins);
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditTarget(null); setForm({ display_name: '', login_id: '', password: '', email: '', area: '東京' }); setShowForm(true); };
  const openEdit = (a) => { setEditTarget(a); setForm({ display_name: a.display_name, login_id: a.login_id, password: '', email: a.email || '', area: a.area || '東京' }); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditTarget(null); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      if (editTarget) {
        const payload = { display_name: form.display_name, login_id: form.login_id, email: form.email, area: form.area };
        if (form.password) payload.password = form.password;
        await api.updateAdmin(editTarget.id, payload);
        addToast('管理者情報を更新しました');
      } else {
        await api.createAdmin(form);
        addToast('管理者を追加しました');
      }
      await load(); closeForm();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (a) => {
    if (!confirm(`管理者「${a.display_name}」を削除しますか？`)) return;
    try { await api.deleteAdmin(a.id); addToast('削除しました'); await load(); }
    catch (err) { addToast(err.message, 'error'); }
  };

  return (
    <>
      <div style={{ padding: '10px 12px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, marginBottom: 16, fontSize: '0.78rem', color: 'var(--text-sub)', lineHeight: 1.6 }}>
        管理者は複数登録できます。各管理者にエリア（東京・大阪）を設定すると、ログイン時にデフォルトでそのエリアの案件のみが表示されます。
      </div>

      <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={openAdd}>+ 管理者を追加</button>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 20 }}>
              {editTarget ? '管理者情報を編集' : '管理者を追加'}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>表示名 *</label>
                <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="鈴木 一郎" required />
              </div>
              <div className="form-group">
                <label>ログインID *</label>
                <input value={form.login_id} onChange={e => setForm(f => ({ ...f, login_id: e.target.value }))}
                  placeholder="suzuki" required style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group">
                <label>{editTarget ? '新しいパスワード（変更する場合のみ）' : 'パスワード *'}</label>
                <input type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editTarget ? '変更しない場合は空白' : 'パスワードを入力'}
                  required={!editTarget} />
              </div>
              <div className="form-group">
                <label>メールアドレス</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="suzuki@example.com" />
              </div>
              <div className="form-group">
                <label>担当エリア *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['東京', '大阪'].map(a => (
                    <label key={a} style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                      background: form.area === a ? 'rgba(59,130,246,0.15)' : 'var(--card-bg)',
                      border: `1px solid ${form.area === a ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <input type="radio" name="admin_area" value={a} checked={form.area === a}
                        onChange={() => setForm(f => ({ ...f, area: a }))} style={{ width: 'auto', margin: 0 }} />
                      <span style={{ fontSize: '0.88rem' }}>📍 {a}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={closeForm}>キャンセル</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? '保存中...' : editTarget ? '更新' : '追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {admins.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 16px' }}>管理者がいません</div>
      ) : admins.map(a => (
        <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--navy)',
            border: '1px solid var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
            🔑
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>{a.display_name}</span>
              <span style={{ fontSize: '0.68rem', padding: '1px 7px', borderRadius: 99, background: 'rgba(59,130,246,0.15)', color: 'var(--accent-lt)' }}>
                📍 {a.area || '東京'}
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', fontFamily: 'monospace' }}>
              ID: {a.login_id}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.email ? `📧 ${a.email}` : '📧 未設定'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}>編集</button>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(a)}>削除</button>
        </div>
      ))}
    </>
  );
}

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
            <button type="submit" className="btn btn-danger btn-sm" disabled={loading}>
              {loading ? '設定中...' : '予定不可日を設定'}
            </button>
          </form>
        </div>
      )}
      {blocked.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 16px' }}>予定不可日は設定されていません</div>
      ) : blocked.map(b => (
        <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '0.9rem' }}>
              🚫 {b.date}{b.time_from ? ` ${b.time_from}〜${b.time_to || ''}` : '（終日）'}
            </div>
            {b.reason && <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: 2 }}>{b.reason}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(b.id)}>削除</button>
        </div>
      ))}
    </>
  );
}

// ── メール設定 ────────────────────────────────────────────────
function EmailTab({ addToast }) {
  const [settings, setSettings] = useState({ provider: 'gmail', gmail_user: '', gmail_app_password: '', notify_emails: [], from: '' });
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { api.getEmailSettings().then(setSettings); }, []);

  const setField = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const addEmail = () => {
    const email = newEmail.trim();
    if (!email || !email.includes('@')) { addToast('有効なメールアドレスを入力してください', 'error'); return; }
    if ((settings.notify_emails || []).includes(email)) { addToast('すでに登録されています', 'error'); return; }
    setSettings(s => ({ ...s, notify_emails: [...(s.notify_emails || []), email] }));
    setNewEmail('');
  };
  const removeEmail = (email) => setSettings(s => ({ ...s, notify_emails: (s.notify_emails || []).filter(e => e !== email) }));

  const handleSave = async () => {
    setLoading(true);
    try { await api.updateEmailSettings(settings); addToast('メール設定を保存しました'); }
    catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };
  const handleTest = async () => {
    setTesting(true);
    try { await api.testEmail(); addToast('テストメールを送信しました！'); }
    catch (err) { addToast(`送信失敗：${err.message}`, 'error'); }
    finally { setTesting(false); }
  };

  return (
    <>
      <div className="card">
        <div className="section-title">メール送信方法</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { value: 'gmail', label: '📨 Gmail SMTP', sub: 'ドメイン不要（要Render有料プラン）' },
            { value: 'resend', label: '⚡ Resend API', sub: '独自ドメイン必要' },
          ].map(opt => (
            <label key={opt.value} style={{
              flex: 1, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer',
              padding: '12px 14px', borderRadius: 10,
              background: settings.provider === opt.value ? 'rgba(59,130,246,0.12)' : 'var(--card-bg)',
              border: `1px solid ${settings.provider === opt.value ? 'var(--accent)' : 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="provider" value={opt.value}
                  checked={(settings.provider || 'gmail') === opt.value}
                  onChange={() => setField('provider', opt.value)} style={{ width: 'auto', margin: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{opt.label}</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-sub)', paddingLeft: 22 }}>{opt.sub}</span>
            </label>
          ))}
        </div>
      </div>

      {(settings.provider || 'gmail') === 'gmail' && (
        <div className="card">
          <div className="section-title">Gmail アカウント設定</div>
          <div className="form-group">
            <label>Gmailアドレス *</label>
            <input type="email" value={settings.gmail_user || ''} onChange={e => setField('gmail_user', e.target.value)} placeholder="your-account@gmail.com" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>アプリパスワード * （16文字）</label>
            <input type="password" value={settings.gmail_app_password || ''} onChange={e => setField('gmail_app_password', e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
          </div>
        </div>
      )}

      {settings.provider === 'resend' && (
        <div className="card">
          <div className="section-title">Resend 設定</div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>送信元アドレス（From）</label>
            <input type="email" value={settings.from || ''} onChange={e => setField('from', e.target.value)} placeholder="noreply@your-domain.com" />
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title">通知先メールアドレス（CS部管理者）</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
            placeholder="manager@example.com" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())} style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={addEmail}>追加</button>
        </div>
        {(settings.notify_emails || []).length === 0 ? (
          <div className="text-sub" style={{ fontSize: '0.8rem' }}>通知先が登録されていません</div>
        ) : (settings.notify_emails || []).map(email => (
          <div key={email} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.88rem' }}>📧 {email}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => removeEmail(email)}>削除</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={handleTest} disabled={testing}>{testing ? '送信中...' : '📨 テスト送信'}</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={loading}>{loading ? '保存中...' : '設定を保存'}</button>
      </div>
    </>
  );
}

// ── メールテンプレート編集 ─────────────────────────────────────
const TEMPLATE_LABELS = {
  schedule_proposed:   { label: '📝 新規依頼通知', desc: '営業が案件を登録したとき' },
  schedule_confirmed:  { label: '✅ スケジュール確定', desc: '営業が候補日を確定したとき' },
  schedule_cancelled:  { label: '❌ キャンセル通知', desc: '案件がキャンセルされたとき' },
  reminder:            { label: '🔔 リマインド', desc: '営業がリマインドボタンを押したとき' },
  auto_cancel_warning: { label: '⚠️ 自動キャンセル警告', desc: '強制キャンセル前日の通知' },
  auto_cancelled:      { label: '⏰ 自動キャンセル通知', desc: '10営業日経過で自動キャンセルされたとき' },
};
const AVAILABLE_VARS = {
  schedule_proposed:   ['project_type', 'client_name', 'sales_rep', 'delivery_method', 'candidate_days', 'memo'],
  schedule_confirmed:  ['project_type', 'client_name', 'sales_rep', 'delivery_method', 'confirmed_date'],
  schedule_cancelled:  ['project_type', 'client_name', 'sales_rep', 'confirmed_date', 'cancel_reason'],
  reminder:            ['project_type', 'client_name', 'sales_rep', 'candidate_days', 'created_at'],
  auto_cancel_warning: ['project_type', 'client_name', 'sales_rep', 'deadline_date'],
  auto_cancelled:      ['project_type', 'client_name', 'sales_rep'],
};

function TemplatesTab({ addToast }) {
  const [templates, setTemplates] = useState({});
  const [activeKey, setActiveKey] = useState('schedule_proposed');
  const [loading, setLoading] = useState(false);

  const load = () => api.getEmailTemplates().then(setTemplates);
  useEffect(() => { load(); }, []);

  const current = templates[activeKey] || { subject: '', body: '' };

  const setCurrent = (field, value) => {
    setTemplates(t => ({ ...t, [activeKey]: { ...t[activeKey], [field]: value } }));
  };

  const handleSave = async () => {
    setLoading(true);
    try { await api.updateEmailTemplates(templates); addToast('メール文面を保存しました'); }
    catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!confirm('このメール文面を初期状態に戻しますか？')) return;
    setLoading(true);
    try {
      const defaults = await api.resetEmailTemplates();
      setTemplates(defaults);
      addToast('初期文面に戻しました');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const insertVar = (varName) => {
    setCurrent('body', (current.body || '') + `{{${varName}}}`);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        {Object.entries(TEMPLATE_LABELS).map(([key, { label }]) => (
          <button key={key}
            className={`filter-chip ${activeKey === key ? 'active' : ''}`}
            onClick={() => setActiveKey(key)}
            style={{ flexShrink: 0 }}>
            {label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="section-title">{TEMPLATE_LABELS[activeKey]?.label}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginBottom: 14 }}>
          {TEMPLATE_LABELS[activeKey]?.desc}
        </div>

        <div className="form-group">
          <label>メールタイトル</label>
          <input value={current.subject || ''} onChange={e => setCurrent('subject', e.target.value)} />
        </div>

        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>本文</label>
          <textarea
            value={current.body || ''}
            onChange={e => setCurrent('body', e.target.value)}
            style={{ minHeight: 200, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', marginBottom: 6 }}>挿入できる変数（タップで本文に追加）：</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(AVAILABLE_VARS[activeKey] || []).map(v => (
              <button key={v} type="button" onClick={() => insertVar(v)}
                style={{
                  fontFamily: 'monospace', fontSize: '0.72rem', padding: '4px 8px', borderRadius: 6,
                  background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
                  color: 'var(--accent-lt)', cursor: 'pointer',
                }}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={loading}>初期文面に戻す</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={loading}>
            {loading ? '保存中...' : 'すべての文面を保存'}
          </button>
        </div>
      </div>
    </>
  );
}
