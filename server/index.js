const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
// MailerSend は fetch（Node18標準）で呼ぶ — 追加パッケージ不要

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.'); process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Email helpers ─────────────────────────────────────────────
async function getEmailSettings() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='email_settings'");
  if (!rows[0]) return { provider: 'gmail', from: '', notify_emails: [], gmail_user: '', gmail_app_password: '' };
  return JSON.parse(rows[0].value);
}

// Gmail SMTP トランスポーター（呼び出しのたびに最新設定で生成）
function createGmailTransport(gmailUser, gmailAppPassword) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });
}

async function sendEmail({ to, subject, html }) {
  const settings = await getEmailSettings();
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) {
    console.log('[Email skipped - no recipients]', subject);
    return { skipped: true };
  }

  const provider = settings.provider || 'gmail';

  // ── Gmail SMTP ──
  if (provider === 'gmail') {
    const { gmail_user, gmail_app_password } = settings;
    if (!gmail_user || !gmail_app_password) {
      console.log('[Email skipped - Gmail credentials not configured]', subject);
      return { skipped: true };
    }
    try {
      const transporter = createGmailTransport(gmail_user, gmail_app_password);
      await transporter.sendMail({
        from: `"納品スケジューラー" <${gmail_user}>`,
        to: toList,
        subject,
        html,
      });
      console.log('[Gmail sent]', subject, '->', toList.join(', '));
      return { success: true };
    } catch (e) {
      console.error('[Gmail error]', e.message);
      return { error: e.message };
    }
  }

  // ── Resend ──
  if (provider === 'resend') {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) {
      console.log('[Email skipped - RESEND_API_KEY not set]', subject);
      return { skipped: true };
    }
    const from = settings.from || '納品スケジューラー <onboarding@resend.dev>';
    try {
      const result = await resend.emails.send({ from, to: toList, subject, html });
      console.log('[Resend sent]', subject, '->', toList.join(', '));
      return result;
    } catch (e) {
      console.error('[Resend error]', e.message);
      return { error: e.message };
    }
  }

  return { skipped: true };
}

// HTML メールテンプレート
function makeEmailHtml(title, rows, note) {
  const rowsHtml = rows.map(([label, value, highlight]) =>
    `<tr>
      <td style="padding:8px 14px;color:#666;font-size:13px;white-space:nowrap;border-bottom:1px solid #f0f0f0">${label}</td>
      <td style="padding:8px 14px;font-size:13px;border-bottom:1px solid #f0f0f0${highlight ? ';color:#10b981;font-weight:700;font-size:15px' : ''}">${value}</td>
    </tr>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2332;padding:24px 28px">
      <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:0.1em;margin-bottom:6px">納品スケジューラー</div>
      <div style="color:#fff;font-size:20px;font-weight:700">${title}</div>
    </div>
    <div style="padding:8px 0">
      <table style="width:100%;border-collapse:collapse">${rowsHtml}</table>
    </div>
    ${note ? `<div style="padding:16px 28px;background:#f8fafc;font-size:11px;color:#999">${note}</div>` : ''}
  </div></body></html>`;
}

// ── DB Init ───────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL UNIQUE,
        role     TEXT NOT NULL DEFAULT 'sales',
        password TEXT NOT NULL,
        email    TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS projects (
        id              TEXT PRIMARY KEY,
        client_name     TEXT NOT NULL,
        project_type    TEXT NOT NULL DEFAULT '新規納品',
        sales_rep       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        memo            TEXT DEFAULT '',
        delivery_method TEXT DEFAULT 'remote',
        candidate_days  INTEGER DEFAULT 1,
        confirmed_date  TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS schedule_candidates (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        candidate_date TEXT NOT NULL,
        candidate_time TEXT DEFAULT '',
        label          TEXT
      );
      CREATE TABLE IF NOT EXISTS blocked_dates (
        id         TEXT PRIMARY KEY,
        date       TEXT NOT NULL,
        time_from  TEXT DEFAULT '',
        time_to    TEXT DEFAULT '',
        reason     TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrations
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'remote'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT '新規納品'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS candidate_days INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`);

    const { rows } = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(rows[0].c) === 0) {
      await client.query(
        `INSERT INTO users (id,name,role,password,email) VALUES ($1,'管理者','admin','admin123',''),($2,'営業 山田','sales','sales123',''),($3,'営業 田中','sales','sales456','')`,
        [uuidv4(), uuidv4(), uuidv4()]
      );
    }

    const { rows: sets } = await client.query("SELECT key FROM settings WHERE key='email_settings'");
    if (!sets[0]) {
      await client.query("INSERT INTO settings (key,value) VALUES ('email_settings',$1)",
        [JSON.stringify({ from: '', notify_emails: [] })]);
    }

    console.log('✅ DB initialized');
  } finally {
    client.release();
  }
}

app.use(cors());
app.use(express.json());

const CLIENT_BUILD = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_BUILD)) app.use(express.static(CLIENT_BUILD));

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { name, password } = req.body;
  const { rows } = await pool.query('SELECT id,name,role FROM users WHERE name=$1 AND password=$2', [name, password]);
  if (!rows[0]) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  res.json(rows[0]);
});

// ── Users ─────────────────────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  const { rows } = await pool.query("SELECT id,name,role,email FROM users WHERE role='sales' ORDER BY name");
  res.json(rows);
});

app.post('/api/users', async (req, res) => {
  const { name, password, email } = req.body;
  if (!name || !password) return res.status(400).json({ error: '名前とパスワードは必須です' });
  const dup = await pool.query('SELECT id FROM users WHERE name=$1', [name]);
  if (dup.rows[0]) return res.status(400).json({ error: 'この名前はすでに使われています' });
  const id = uuidv4();
  await pool.query('INSERT INTO users (id,name,role,password,email) VALUES ($1,$2,$3,$4,$5)',
    [id, name, 'sales', password, email || '']);
  res.status(201).json({ id, name, role: 'sales', email: email || '' });
});

app.put('/api/users/:id', async (req, res) => {
  const { name, password, email } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (rows[0].role === 'admin') return res.status(403).json({ error: '管理者アカウントは変更できません' });
  if (name) {
    const dup = await pool.query('SELECT id FROM users WHERE name=$1 AND id!=$2', [name, req.params.id]);
    if (dup.rows[0]) return res.status(400).json({ error: 'この名前はすでに使われています' });
  }
  await pool.query(
    'UPDATE users SET name=COALESCE($1,name), password=COALESCE($2,password), email=COALESCE($3,email) WHERE id=$4',
    [name || null, password || null, email !== undefined ? email : null, req.params.id]
  );
  const { rows: u } = await pool.query('SELECT id,name,role,email FROM users WHERE id=$1', [req.params.id]);
  res.json(u[0]);
});

app.delete('/api/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (rows[0].role === 'admin') return res.status(403).json({ error: '管理者アカウントは削除できません' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Blocked Dates ─────────────────────────────────────────────
app.get('/api/blocked-dates', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM blocked_dates ORDER BY date, time_from');
  res.json(rows);
});

app.post('/api/blocked-dates', async (req, res) => {
  const { date, time_from, time_to, reason } = req.body;
  if (!date) return res.status(400).json({ error: '日付は必須です' });
  const id = uuidv4();
  await pool.query('INSERT INTO blocked_dates (id,date,time_from,time_to,reason) VALUES ($1,$2,$3,$4,$5)',
    [id, date, time_from || '', time_to || '', reason || '']);
  const { rows } = await pool.query('SELECT * FROM blocked_dates WHERE id=$1', [id]);
  res.status(201).json(rows[0]);
});

app.delete('/api/blocked-dates/:id', async (req, res) => {
  await pool.query('DELETE FROM blocked_dates WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Conflict check ────────────────────────────────────────────
app.get('/api/schedule/conflicts', async (req, res) => {
  const { date, time, exclude_project_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  const { rows: blocked } = await pool.query('SELECT * FROM blocked_dates WHERE date=$1', [date]);
  const isBlocked = blocked.some(b => {
    if (!b.time_from && !b.time_to) return true;
    if (!time) return true;
    if (b.time_from && time < b.time_from) return false;
    if (b.time_to && time > b.time_to) return false;
    return true;
  });

  const params = [date];
  let extra = '';
  if (time) { params.push(time); extra += ` AND (sc.candidate_time=$${params.length} OR sc.candidate_time='')`; }
  if (exclude_project_id) { params.push(exclude_project_id); extra += ` AND p.id!=$${params.length}`; }
  const { rows } = await pool.query(`
    SELECT DISTINCT p.sales_rep FROM schedule_candidates sc
    JOIN projects p ON sc.project_id=p.id
    WHERE sc.candidate_date=$1 AND p.status NOT IN ('delivered','cancelled') ${extra}
  `, params);

  res.json({ blocked: isBlocked, blockedInfo: isBlocked ? blocked[0] : null, sales_reps: rows.map(r => r.sales_rep) });
});

// ── Email Settings ────────────────────────────────────────────
app.get('/api/settings/email', async (_req, res) => {
  const settings = await getEmailSettings();
  // アプリパスワードはマスクして返す
  const safe = { ...settings };
  if (safe.gmail_app_password) safe.gmail_app_password = '********';
  res.json(safe);
});

app.put('/api/settings/email', async (req, res) => {
  const { provider, from, notify_emails, gmail_user, gmail_app_password } = req.body;
  // 既存設定を取得してマージ（パスワードが '********' なら変更しない）
  const existing = await getEmailSettings();
  const value = JSON.stringify({
    provider: provider || 'gmail',
    from: from || '',
    notify_emails: notify_emails || [],
    gmail_user: gmail_user || '',
    gmail_app_password: (gmail_app_password && gmail_app_password !== '********')
      ? gmail_app_password
      : (existing.gmail_app_password || ''),
  });
  await pool.query(
    "INSERT INTO settings (key,value) VALUES ('email_settings',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
    [value]
  );
  res.json({ success: true });
});

// ── Email test endpoint ───────────────────────────────────────
app.post('/api/settings/email/test', async (req, res) => {
  const settings = await getEmailSettings();
  if (!settings.notify_emails?.length) return res.status(400).json({ error: '通知先メールアドレスが登録されていません' });
  const result = await sendEmail({
    to: settings.notify_emails,
    subject: '【テスト】納品スケジューラー メール設定確認',
    html: makeEmailHtml('メール設定テスト ✅', [
      ['プロバイダー', settings.provider === 'resend' ? 'Resend' : 'Gmail SMTP'],
      ['送信先', settings.notify_emails.join(', ')],
    ], 'このメールは設定確認のためのテスト送信です。正常に届いていれば設定完了です。'),
  });
  if (result?.error) return res.status(500).json({ error: result.error });
  if (result?.skipped) return res.status(400).json({ error: 'メール設定が未完了です。GmailアカウントとAppパスワードを確認してください。' });
  res.json({ success: true });
});

// ── Projects ──────────────────────────────────────────────────
app.get('/api/projects', async (_req, res) => {
  const { rows: projects } = await pool.query('SELECT * FROM projects ORDER BY updated_at DESC');
  const { rows: candidates } = await pool.query('SELECT * FROM schedule_candidates ORDER BY candidate_date');
  const candMap = {};
  candidates.forEach(c => { if (!candMap[c.project_id]) candMap[c.project_id] = []; candMap[c.project_id].push(c); });
  res.json(projects.map(p => ({ ...p, candidates: candMap[p.id] || [] })));
});

app.get('/api/projects/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const { rows: candidates } = await pool.query(
    'SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json({ ...rows[0], candidates });
});

app.post('/api/projects', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, delivery_method, candidates } = req.body;
  if (!client_name || !project_name || !sales_rep)
    return res.status(400).json({ error: '必須項目が不足しています' });
  if (candidates && candidates.length > 3)
    return res.status(400).json({ error: '候補日は最大3件までです' });

  const id = uuidv4();
  await pool.query(
    `INSERT INTO projects (id,client_name,project_name,sales_rep,memo,delivery_method,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
    [id, client_name, project_name, sales_rep, memo || '', delivery_method || 'remote']
  );

  if (candidates?.length) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query(
        'INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), id, c.date, c.time || '', `第${i+1}候補`]
      );
    }
  }

  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [id]);
  const project = { ...rows[0], candidates: cands };

  // ── 管理者へメール通知 ──
  const settings = await getEmailSettings();
  if (settings.notify_emails?.length) {
    const deliveryLabel = delivery_method === 'onsite' ? '🚗 現地訪問' : '🖥 リモート';
    const dateLines = cands.map(c =>
      `${c.label}：${c.candidate_date}${c.candidate_time ? ' ' + c.candidate_time : ''}`
    ).join('<br>') || 'なし';
    await sendEmail({
      to: settings.notify_emails,
      subject: `【新規案件登録】${project_type}（${client_name}）`,
      html: makeEmailHtml('新しい案件が登録されました', [
        ['案件内容', `<b>${project_type}</b>`],
        ['顧客名', client_name],
        ['担当営業', sales_rep],
        ['納品方法', deliveryLabel],
        ['候補日', dateLines],
        ['備考', memo || 'なし'],
      ], '確認後、候補日の中から納品日を確定してください。'),
    });
  }

  res.status(201).json(project);
});

app.put('/api/projects/:id', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, delivery_method, candidates, status, confirmed_date } = req.body;
  const { rows: ex } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = ex[0];

  await pool.query(
    `UPDATE projects SET client_name=$1,project_name=$2,sales_rep=$3,memo=$4,status=$5,confirmed_date=$6,delivery_method=$7,updated_at=NOW() WHERE id=$8`,
    [client_name??p.client_name, project_name??p.project_name, sales_rep??p.sales_rep,
     memo??p.memo, status??p.status, confirmed_date??p.confirmed_date,
     delivery_method??p.delivery_method, req.params.id]
  );

  if (candidates !== undefined) {
    if (candidates.length > 3) return res.status(400).json({ error: '候補日は最大3件までです' });
    await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query(
        'INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), req.params.id, c.date, c.time || '', `第${i+1}候補`]
      );
    }
  }

  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  res.json({ ...rows[0], candidates: cands });
});

// 候補日の追加（単独エンドポイント）
app.post('/api/projects/:id/candidates', async (req, res) => {
  const { date, time } = req.body;
  if (!date) return res.status(400).json({ error: '日付は必須です' });

  const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: '案件が見つかりません' });

  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  if (cands.length >= 3) return res.status(400).json({ error: '候補日は最大3件までです' });

  const idx = cands.length;
  await pool.query(
    'INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
    [uuidv4(), req.params.id, date, time || '', `第${idx+1}候補`]
  );
  await pool.query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [req.params.id]);

  const { rows: updated } = await pool.query(
    'SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.status(201).json(updated);
});

// 候補日の削除（単独エンドポイント）
app.delete('/api/projects/:id/candidates/:candidateId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM schedule_candidates WHERE id=$1 AND project_id=$2',
    [req.params.candidateId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '候補日が見つかりません' });

  await pool.query('DELETE FROM schedule_candidates WHERE id=$1', [req.params.candidateId]);

  // ラベルを振り直す
  const { rows: remaining } = await pool.query(
    'SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  for (let i = 0; i < remaining.length; i++) {
    await pool.query('UPDATE schedule_candidates SET label=$1 WHERE id=$2', [`第${i+1}候補`, remaining[i].id]);
  }
  await pool.query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [req.params.id]);

  const { rows: updated } = await pool.query(
    'SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json(updated);
});

app.post('/api/projects/:id/confirm', async (req, res) => {
  const { confirmed_date, confirmed_time } = req.body;
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = rows[0];

  const fullDate = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;
  await pool.query(`UPDATE projects SET confirmed_date=$1,status='confirmed',updated_at=NOW() WHERE id=$2`,
    [fullDate, req.params.id]);
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);

  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const project = { ...updated[0], candidates: [] };

  // ── 担当営業 + 管理者全員へメール通知 ──
  const settings = await getEmailSettings();
  const deliveryLabel = p.delivery_method === 'onsite' ? '🚗 現地訪問' : '🖥 リモート';

  // 担当営業のメールアドレスを取得
  const { rows: salesUser } = await pool.query("SELECT email FROM users WHERE name=$1 AND role='sales'", [p.sales_rep]);
  const salesEmail = salesUser[0]?.email;

  // 送信先：管理者通知アドレス + 担当営業アドレス（重複除去）
  const allTo = [...new Set([
    ...(settings.notify_emails || []),
    ...(salesEmail ? [salesEmail] : []),
  ])].filter(Boolean);

  if (allTo.length) {
    await sendEmail({
      to: allTo,
      subject: `【納品日確定】${p.project_type}（${p.client_name}）`,
      html: makeEmailHtml('納品日程が確定しました', [
        ['案件内容', `<b>${p.project_type}</b>`],
        ['顧客名', p.client_name],
        ['担当営業', p.sales_rep],
        ['納品方法', deliveryLabel],
        ['✅ 確定日時', fullDate, true],
      ], '日程が確定しました。準備をお願いします。'),
    });
  }

  res.json(project);
});

app.delete('/api/projects/:id', async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/stats', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE TRUE) AS total,
           COUNT(*) FILTER (WHERE status='pending') AS pending,
           COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE status='delivered') AS delivered
    FROM projects
  `);
  const r = rows[0];
  res.json({ total: +r.total, pending: +r.pending, confirmed: +r.confirmed, delivered: +r.delivered });
});

app.get('*', (_req, res) => {
  if (fs.existsSync(CLIENT_BUILD)) res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  else res.json({ message: 'API running' });
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
