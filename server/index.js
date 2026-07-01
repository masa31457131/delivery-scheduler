const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }

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

// ── Email templates ───────────────────────────────────────────
const DEFAULT_TEMPLATES = {
  schedule_proposed: {
    subject: '【新規依頼】{{project_type}}（{{client_name}}）',
    body: `新しい案件依頼が届きました。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
納品方法：{{delivery_method}}
希望候補日数：{{candidate_days}}日
備考：{{memo}}

候補日をカレンダーで確認して設定してください。`
  },
  candidates_set: {
    subject: '【仮スケジュール設定完了】{{project_type}}（{{client_name}}）',
    body: `候補日が設定されました。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
納品方法：{{delivery_method}}
CS担当者：{{cs_members}}

▼候補日一覧
{{candidate_list}}

担当営業は候補日の中から日程を確定してください。`
  },
  schedule_confirmed: {
    subject: '【日程確定】{{project_type}}（{{client_name}}）',
    body: `スケジュールが確定しました。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
CS担当者：{{cs_members}}
納品方法：{{delivery_method}}
確定日時：{{confirmed_date}}
{{shortage_reason_line}}

日程が確定しました。準備をお願いします。`
  },
  schedule_cancelled: {
    subject: '【キャンセル】{{project_type}}（{{client_name}}）',
    body: `案件がキャンセルされました。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
確定日：{{confirmed_date}}
キャンセル理由：{{cancel_reason}}

再スケジュールが必要な場合は新規案件として再申請してください。`
  },
  reminder: {
    subject: '【リマインド】仮スケジュール日程未設定：{{project_type}}（{{client_name}}）',
    body: `仮スケジュール未設定のリマインドです。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
希望候補日数：{{candidate_days}}日
依頼日：{{created_at}}

候補日が未設定のままです。早急にスケジュールを設定してください。`
  },
  auto_cancel_warning: {
    subject: '【警告】明日自動キャンセル予定：{{project_type}}（{{client_name}}）',
    body: `⚠️ 明日自動キャンセルされます。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
自動キャンセル日：{{deadline_date}}
理由：仮スケジュール設定から10営業日経過

本日中にスケジュールを確定するか、担当者に連絡してください。`
  },
  auto_cancelled: {
    subject: '【自動キャンセル】{{project_type}}（{{client_name}}）',
    body: `案件が自動キャンセルされました。

案件内容：{{project_type}}
顧客名：{{client_name}}
担当営業：{{sales_rep}}
キャンセル理由：仮スケジュール設定から10営業日経過のため自動キャンセル

再スケジュールが必要な場合は新規案件として再申請してください。`
  },
};

async function getEmailTemplates() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='email_templates'");
  if (!rows[0]) return DEFAULT_TEMPLATES;
  return { ...DEFAULT_TEMPLATES, ...JSON.parse(rows[0].value) };
}

function renderTemplate(str, vars) {
  return (str || '').replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function textToHtml(title, bodyText) {
  const bodyHtml = (bodyText || '').split('\n').map(l => l.trim() === '' ? '<br>' : `<div style="margin:2px 0">${l}</div>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2332;padding:24px 28px">
      <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:0.1em;margin-bottom:6px">納品スケジューラー</div>
      <div style="color:#fff;font-size:18px;font-weight:700">${title}</div>
    </div>
    <div style="padding:24px 28px;font-size:14px;color:#333;line-height:1.8">${bodyHtml}</div>
  </div></body></html>`;
}

async function sendTemplatedEmail(templateKey, to, vars) {
  const templates = await getEmailTemplates();
  const tpl = templates[templateKey] || DEFAULT_TEMPLATES[templateKey];
  if (!tpl) { console.log('[Email skipped - no template]', templateKey); return { skipped: true }; }
  const subject = renderTemplate(tpl.subject, vars);
  const bodyText = renderTemplate(tpl.body, vars);
  const html = textToHtml(subject, bodyText);
  return sendEmail({ to, subject, html });
}

function createGmailTransport(user, pass) {
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
}

async function sendEmail({ to, subject, html }) {
  const settings = await getEmailSettings();
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) { console.log('[Email skipped - no recipients]', subject); return { skipped: true }; }
  const provider = settings.provider || 'gmail';
  if (provider === 'gmail') {
    const { gmail_user, gmail_app_password } = settings;
    if (!gmail_user || !gmail_app_password) { console.log('[Email skipped - Gmail not configured]'); return { skipped: true }; }
    try {
      await createGmailTransport(gmail_user, gmail_app_password).sendMail({ from: `"納品スケジューラー" <${gmail_user}>`, to: toList, subject, html });
      console.log('[Gmail sent]', subject); return { success: true };
    } catch (e) { console.error('[Gmail error]', e.message); return { error: e.message }; }
  }
  if (provider === 'resend') {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) { console.log('[Resend skipped]'); return { skipped: true }; }
    const from = settings.from || '納品スケジューラー <onboarding@resend.dev>';
    try { return await resend.emails.send({ from, to: toList, subject, html }); }
    catch (e) { console.error('[Resend error]', e.message); return { error: e.message }; }
  }
  return { skipped: true };
}

// 担当営業のメールアドレスを display_name で取得
async function getSalesEmail(displayName) {
  const { rows } = await pool.query("SELECT email FROM users WHERE display_name=$1 AND role='sales'", [displayName]);
  return rows[0]?.email || null;
}

// CS部員のメールアドレスを取得（display_name の配列から）
async function getCsEmails(csMemberNames) {
  if (!csMemberNames || !csMemberNames.length) return [];
  const { rows } = await pool.query(
    "SELECT email FROM users WHERE display_name = ANY($1) AND email != ''",
    [csMemberNames]
  );
  return rows.map(r => r.email).filter(Boolean);
}

// 管理者通知アドレス + 担当営業 + CS部員 を合算
async function buildRecipients(salesDisplayName, csMemberNames) {
  const settings = await getEmailSettings();
  const salesEmail = await getSalesEmail(salesDisplayName);
  const csEmails = await getCsEmails(csMemberNames || []);
  return [...new Set([
    ...(settings.notify_emails || []),
    ...(salesEmail ? [salesEmail] : []),
    ...csEmails,
  ])].filter(Boolean);
}

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
const DELIVERY_LABEL = (m) => m === 'onsite' ? '🚗 現地訪問' : '🖥 リモート';

// ── DB Init ───────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE,
        role         TEXT NOT NULL DEFAULT 'sales',
        password     TEXT NOT NULL,
        email        TEXT DEFAULT '',
        display_name TEXT,
        login_id     TEXT,
        area         TEXT DEFAULT '東京'
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
        cancel_reason   TEXT DEFAULT '',
        scheduled_at    TIMESTAMPTZ,
        cs_members      TEXT DEFAULT '[]',
        shortage_reason TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS schedule_candidates (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        candidate_date    TEXT NOT NULL,
        candidate_date_to TEXT DEFAULT '',
        candidate_time    TEXT DEFAULT '',
        label             TEXT
      );
      CREATE TABLE IF NOT EXISTS blocked_dates (
        id         TEXT PRIMARY KEY,
        date       TEXT NOT NULL,
        time_from  TEXT DEFAULT '',
        time_to    TEXT DEFAULT '',
        reason     TEXT DEFAULT '',
        area       TEXT NOT NULL DEFAULT '東京',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrations
    await client.query(`ALTER TABLE projects ALTER COLUMN project_name DROP NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'remote'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT '新規納品'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS candidate_days INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS cs_members TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS shortage_reason TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT`);
    await client.query(`UPDATE users SET display_name = name WHERE display_name IS NULL`);
    await client.query(`UPDATE users SET login_id = name WHERE login_id IS NULL`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_login_id_unique UNIQUE (login_id)`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS area TEXT DEFAULT '東京'`);
    await client.query(`ALTER TABLE blocked_dates ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT '東京'`);
    await client.query(`ALTER TABLE schedule_candidates ADD COLUMN IF NOT EXISTS candidate_date_to TEXT DEFAULT ''`);

    const { rows } = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(rows[0].c) === 0) {
      await client.query(
        `INSERT INTO users (id,name,display_name,login_id,role,password,email,area) VALUES
         ($1,'管理者','管理者','admin','admin','admin123','','東京'),
         ($2,'営業 山田','山田 太郎','yamada','sales','sales123','','東京'),
         ($3,'営業 田中','田中 一郎','tanaka','sales','sales456','','大阪')`,
        [uuidv4(), uuidv4(), uuidv4()]
      );
    }
    const { rows: sets } = await client.query("SELECT key FROM settings WHERE key='email_settings'");
    if (!sets[0]) {
      await client.query("INSERT INTO settings (key,value) VALUES ('email_settings',$1)",
        [JSON.stringify({ provider: 'gmail', from: '', notify_emails: [], gmail_user: '', gmail_app_password: '' })]);
    }
    console.log('✅ DB initialized');
  } finally { client.release(); }
}

app.use(cors());
app.use(express.json());

const CLIENT_BUILD = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_BUILD)) app.use(express.static(CLIENT_BUILD));

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { name, password } = req.body;
  const { rows } = await pool.query(
    'SELECT id,name,display_name,login_id,role,area FROM users WHERE login_id=$1 AND password=$2', [name, password]
  );
  if (!rows[0]) return res.status(401).json({ error: 'ログインIDまたはパスワードが違います' });
  const u = rows[0];
  res.json({ id: u.id, name: u.display_name || u.name, login_id: u.login_id, role: u.role, area: u.area || '東京' });
});

// ── ユーザー共通ヘルパー ──────────────────────────────────────
async function upsertUser(id, { display_name, login_id, password, email, area, role }) {
  await pool.query(
    `UPDATE users SET
      display_name=COALESCE($1,display_name), name=COALESCE($1,name),
      login_id=COALESCE($2,login_id), password=COALESCE($3,password),
      email=COALESCE($4,email), area=COALESCE($5,area)
     WHERE id=$6`,
    [display_name || null, login_id || null, password || null, email !== undefined ? email : null, area || null, id]
  );
}

// ── 営業 CRUD ─────────────────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  const { rows } = await pool.query("SELECT id,display_name,login_id,email,area FROM users WHERE role='sales' ORDER BY display_name");
  res.json(rows);
});
app.post('/api/users', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  if (!display_name || !login_id || !password) return res.status(400).json({ error: '表示名・ログインID・パスワードは必須です' });
  const dup = await pool.query('SELECT id FROM users WHERE login_id=$1', [login_id]);
  if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  const id = uuidv4();
  await pool.query('INSERT INTO users (id,name,display_name,login_id,role,password,email,area) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)',
    [id, display_name, login_id, 'sales', password, email || '', area || '東京']);
  res.status(201).json({ id, display_name, login_id, role: 'sales', email: email || '', area: area || '東京' });
});
app.put('/api/users/:id', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (rows[0].role === 'admin') return res.status(403).json({ error: '管理者はこのAPIから変更できません' });
  if (login_id) {
    const dup = await pool.query('SELECT id FROM users WHERE login_id=$1 AND id!=$2', [login_id, req.params.id]);
    if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  }
  await upsertUser(req.params.id, { display_name, login_id, password, email, area });
  const { rows: u } = await pool.query('SELECT id,display_name,login_id,email,area FROM users WHERE id=$1', [req.params.id]);
  res.json(u[0]);
});
app.delete('/api/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (rows[0].role === 'admin') return res.status(403).json({ error: '管理者はこのAPIから削除できません' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── 管理者 CRUD ───────────────────────────────────────────────
app.get('/api/admins', async (_req, res) => {
  const { rows } = await pool.query("SELECT id,display_name,login_id,email,area FROM users WHERE role='admin' ORDER BY display_name");
  res.json(rows);
});
app.post('/api/admins', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  if (!display_name || !login_id || !password) return res.status(400).json({ error: '表示名・ログインID・パスワードは必須です' });
  const dup = await pool.query('SELECT id FROM users WHERE login_id=$1', [login_id]);
  if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  const id = uuidv4();
  await pool.query('INSERT INTO users (id,name,display_name,login_id,role,password,email,area) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)',
    [id, display_name, login_id, 'admin', password, email || '', area || '東京']);
  res.status(201).json({ id, display_name, login_id, role: 'admin', email: email || '', area: area || '東京' });
});
app.put('/api/admins/:id', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '管理者が見つかりません' });
  if (rows[0].role !== 'admin') return res.status(400).json({ error: '管理者アカウントではありません' });
  if (login_id) {
    const dup = await pool.query('SELECT id FROM users WHERE login_id=$1 AND id!=$2', [login_id, req.params.id]);
    if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  }
  await upsertUser(req.params.id, { display_name, login_id, password, email, area });
  const { rows: u } = await pool.query('SELECT id,display_name,login_id,email,area FROM users WHERE id=$1', [req.params.id]);
  res.json(u[0]);
});
app.delete('/api/admins/:id', async (req, res) => {
  const { rows: all } = await pool.query("SELECT id FROM users WHERE role='admin'");
  if (all.length <= 1) return res.status(400).json({ error: '最後の管理者アカウントは削除できません' });
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '管理者が見つかりません' });
  if (rows[0].role !== 'admin') return res.status(400).json({ error: '管理者アカウントではありません' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── CS部員 CRUD ───────────────────────────────────────────────
app.get('/api/cs-members', async (_req, res) => {
  const { rows } = await pool.query("SELECT id,display_name,login_id,email,area FROM users WHERE role='cs' ORDER BY area, display_name");
  res.json(rows);
});
app.post('/api/cs-members', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  if (!display_name || !login_id || !password) return res.status(400).json({ error: '表示名・ログインID・パスワードは必須です' });
  const dup = await pool.query('SELECT id FROM users WHERE login_id=$1', [login_id]);
  if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  const id = uuidv4();
  await pool.query('INSERT INTO users (id,name,display_name,login_id,role,password,email,area) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)',
    [id, display_name, login_id, 'cs', password, email || '', area || '東京']);
  res.status(201).json({ id, display_name, login_id, role: 'cs', email: email || '', area: area || '東京' });
});
app.put('/api/cs-members/:id', async (req, res) => {
  const { display_name, login_id, password, email, area } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'CS部員が見つかりません' });
  if (login_id) {
    const dup = await pool.query('SELECT id FROM users WHERE login_id=$1 AND id!=$2', [login_id, req.params.id]);
    if (dup.rows[0]) return res.status(400).json({ error: 'このログインIDはすでに使われています' });
  }
  await upsertUser(req.params.id, { display_name, login_id, password, email, area });
  const { rows: u } = await pool.query('SELECT id,display_name,login_id,email,area FROM users WHERE id=$1', [req.params.id]);
  res.json(u[0]);
});
app.delete('/api/cs-members/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'CS部員が見つかりません' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Blocked Dates ─────────────────────────────────────────────
app.get('/api/blocked-dates', async (req, res) => {
  const { area } = req.query;
  const { rows } = area
    ? await pool.query('SELECT * FROM blocked_dates WHERE area=$1 ORDER BY date, time_from', [area])
    : await pool.query('SELECT * FROM blocked_dates ORDER BY date, time_from');
  res.json(rows);
});
app.post('/api/blocked-dates', async (req, res) => {
  const { date, time_from, time_to, reason, area } = req.body;
  if (!date) return res.status(400).json({ error: '日付は必須です' });
  if (!area) return res.status(400).json({ error: 'エリアを選択してください' });
  const id = uuidv4();
  await pool.query('INSERT INTO blocked_dates (id,date,time_from,time_to,reason,area) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, date, time_from || '', time_to || '', reason || '', area]);
  const { rows } = await pool.query('SELECT * FROM blocked_dates WHERE id=$1', [id]);
  res.status(201).json(rows[0]);
});
app.delete('/api/blocked-dates/:id', async (req, res) => {
  await pool.query('DELETE FROM blocked_dates WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Conflict check ────────────────────────────────────────────
app.get('/api/schedule/conflicts', async (req, res) => {
  const { date, time, exclude_project_id, area } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const blockedQ = area ? 'SELECT * FROM blocked_dates WHERE date=$1 AND area=$2' : 'SELECT * FROM blocked_dates WHERE date=$1';
  const { rows: blocked } = await pool.query(blockedQ, area ? [date, area] : [date]);
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
  const s = await getEmailSettings();
  const safe = { ...s };
  if (safe.gmail_app_password) safe.gmail_app_password = '********';
  res.json(safe);
});
app.put('/api/settings/email', async (req, res) => {
  const { provider, from, notify_emails, gmail_user, gmail_app_password } = req.body;
  const existing = await getEmailSettings();
  const value = JSON.stringify({
    provider: provider || 'gmail', from: from || '', notify_emails: notify_emails || [], gmail_user: gmail_user || '',
    gmail_app_password: (gmail_app_password && gmail_app_password !== '********') ? gmail_app_password : (existing.gmail_app_password || ''),
  });
  await pool.query("INSERT INTO settings (key,value) VALUES ('email_settings',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [value]);
  res.json({ success: true });
});
app.post('/api/settings/email/test', async (req, res) => {
  const settings = await getEmailSettings();
  if (!settings.notify_emails?.length) return res.status(400).json({ error: '通知先メールアドレスが登録されていません' });
  const result = await sendEmail({
    to: settings.notify_emails,
    subject: '【テスト】納品スケジューラー メール設定確認',
    html: textToHtml('メール設定テスト ✅', `プロバイダー：${settings.provider === 'resend' ? 'Resend' : 'Gmail SMTP'}\n送信先：${settings.notify_emails.join(', ')}\n\nこのメールはテスト送信です。`),
  });
  if (result?.error) return res.status(500).json({ error: result.error });
  if (result?.skipped) return res.status(400).json({ error: 'メール設定が未完了です' });
  res.json({ success: true });
});
app.get('/api/settings/email-templates', async (_req, res) => { res.json(await getEmailTemplates()); });
app.put('/api/settings/email-templates', async (req, res) => {
  await pool.query("INSERT INTO settings (key,value) VALUES ('email_templates',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(req.body)]);
  res.json({ success: true });
});
app.post('/api/settings/email-templates/reset', async (_req, res) => {
  await pool.query("DELETE FROM settings WHERE key='email_templates'");
  res.json(DEFAULT_TEMPLATES);
});

// ── Projects helper ───────────────────────────────────────────
function parseProject(p) {
  return { ...p, cs_members: JSON.parse(p.cs_members || '[]') };
}

// ── Projects ──────────────────────────────────────────────────
app.get('/api/projects', async (_req, res) => {
  const { rows: projects } = await pool.query('SELECT * FROM projects ORDER BY updated_at DESC');
  const { rows: candidates } = await pool.query('SELECT * FROM schedule_candidates ORDER BY candidate_date');
  const candMap = {};
  candidates.forEach(c => { if (!candMap[c.project_id]) candMap[c.project_id] = []; candMap[c.project_id].push(c); });
  res.json(projects.map(p => ({ ...parseProject(p), candidates: candMap[p.id] || [] })));
});
app.get('/api/projects/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const { rows: candidates } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json({ ...parseProject(rows[0]), candidates });
});

// 新規登録
app.post('/api/projects', async (req, res) => {
  const { client_name, project_type, sales_rep, memo, delivery_method, candidate_days } = req.body;
  if (!client_name || !project_type || !sales_rep) return res.status(400).json({ error: '必須項目が不足しています' });
  if (memo && memo.length > 50) return res.status(400).json({ error: '備考は50文字以内で入力してください' });
  const id = uuidv4();
  await pool.query(
    `INSERT INTO projects (id,client_name,project_type,sales_rep,memo,delivery_method,candidate_days,status,cs_members) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','[]')`,
    [id, client_name, project_type, sales_rep, memo || '', delivery_method || 'remote', candidate_days || 1]
  );
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
  const project = { ...parseProject(rows[0]), candidates: [] };
  // 管理者通知アドレス ＋ 担当営業へ送信
  const allTo = await buildRecipients(sales_rep, []);
  if (allTo.length) {
    const result = await sendTemplatedEmail('schedule_proposed', allTo, {
      project_type, client_name, sales_rep,
      delivery_method: DELIVERY_LABEL(delivery_method),
      candidate_days: candidate_days || 1, memo: memo || 'なし',
    });
    if (result?.error) console.error('[新規依頼メール送信エラー]', result.error);
  }
  res.status(201).json(project);
});

// 更新
app.put('/api/projects/:id', async (req, res) => {
  const { client_name, project_type, sales_rep, memo, delivery_method, candidate_days, cs_members, candidates, status, confirmed_date } = req.body;
  if (memo && memo.length > 50) return res.status(400).json({ error: '備考は50文字以内で入力してください' });
  const { rows: ex } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = ex[0];
  const csMembersJson = cs_members !== undefined ? JSON.stringify(cs_members) : p.cs_members;
  await pool.query(
    `UPDATE projects SET client_name=$1,project_type=$2,sales_rep=$3,memo=$4,status=$5,confirmed_date=$6,delivery_method=$7,candidate_days=$8,cs_members=$9,updated_at=NOW() WHERE id=$10`,
    [client_name??p.client_name, project_type??p.project_type, sales_rep??p.sales_rep, memo??p.memo,
     status??p.status, confirmed_date??p.confirmed_date, delivery_method??p.delivery_method, candidate_days??p.candidate_days, csMembersJson, req.params.id]
  );
  if (candidates !== undefined) {
    await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query('INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_date_to,candidate_time,label) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuidv4(), req.params.id, c.date, c.date_to || '', c.time || '', `第${i+1}候補`]);
    }
  }
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json({ ...parseProject(rows[0]), candidates: cands });
});

// 候補日 追加（希望日数上限チェック・ステータスはfinalizeまでpending維持）
app.post('/api/projects/:id/candidates', async (req, res) => {
  const { date, date_to, time } = req.body;
  if (!date) return res.status(400).json({ error: '日付は必須です' });
  const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const maxDays = existing[0].candidate_days || 1;
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  if (cands.length >= maxDays) {
    return res.status(400).json({ error: `希望候補日数は${maxDays}日です。${maxDays}件を超えて登録できません。` });
  }
  await pool.query('INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_date_to,candidate_time,label) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), req.params.id, date, date_to || '', time || '', `第${cands.length+1}候補`]);
  // ステータスはfinalizeまでpendingのまま維持（scheduledには変更しない）
  await pool.query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.status(201).json(updated);
});

// 候補日 削除
app.delete('/api/projects/:id/candidates/:candidateId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM schedule_candidates WHERE id=$1 AND project_id=$2', [req.params.candidateId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '候補日が見つかりません' });
  await pool.query('DELETE FROM schedule_candidates WHERE id=$1', [req.params.candidateId]);
  const { rows: remaining } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  for (let i = 0; i < remaining.length; i++) {
    await pool.query('UPDATE schedule_candidates SET label=$1 WHERE id=$2', [`第${i+1}候補`, remaining[i].id]);
  }
  await pool.query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json(updated);
});

// 候補日の設定完了（通知メール送信・ステータスをscheduledに変更）
app.post('/api/projects/:id/candidates/finalize', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = parseProject(rows[0]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  if (cands.length === 0) return res.status(400).json({ error: '候補日が1件も登録されていません' });
  const maxDays = p.candidate_days || 1;
  if (cands.length > maxDays) return res.status(400).json({ error: `希望候補日数（${maxDays}日）を超えています。${cands.length - maxDays}件削除してください。` });
  if (cands.length < maxDays) return res.status(400).json({ error: `希望候補日数は${maxDays}日です。あと${maxDays - cands.length}件追加してください。` });

  await pool.query("UPDATE projects SET status='scheduled', updated_at=NOW() WHERE id=$1", [req.params.id]);
  const { rows: updatedProject } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);

  const allTo = await buildRecipients(p.sales_rep, p.cs_members);
  if (allTo.length) {
    const dateLines = cands.map(c => {
      let s = `${c.label}：${c.candidate_date}`;
      if (c.candidate_date_to) s += `〜${c.candidate_date_to}`;
      if (c.candidate_time) s += ` ${c.candidate_time}`;
      return s;
    }).join('\n');
    await sendTemplatedEmail('candidates_set', allTo, {
      project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep,
      delivery_method: DELIVERY_LABEL(p.delivery_method),
      cs_members: p.cs_members.length ? p.cs_members.join('、') : 'なし',
      candidate_list: dateLines,
    });
  }
  res.json({ ...parseProject(updatedProject[0]), candidates: cands });
});

// 仮スケジュールを確定（CS部員選択・不足理由）
app.post('/api/projects/:id/confirm-schedule', async (req, res) => {
  const { confirmed_date, confirmed_time, cs_members, shortage_reason } = req.body;
  if (!confirmed_date) return res.status(400).json({ error: '確定日を選択してください' });
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = parseProject(rows[0]);
  const fullDate = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;
  const csMembersArr = cs_members || p.cs_members || [];
  const csMembersJson = JSON.stringify(csMembersArr);

  // 不足理由チェック：候補日1件以上あるのに確定した場合、候補日数<希望日数なら理由必須
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const needsReason = cands.length < (p.candidate_days || 1);
  if (needsReason && !shortage_reason?.trim()) {
    return res.status(400).json({ error: '希望日数より少ない候補日での確定です。理由を入力してください。' });
  }

  await pool.query(
    `UPDATE projects SET confirmed_date=$1, status='confirmed', scheduled_at=NOW(), updated_at=NOW(), cs_members=$2, shortage_reason=$3 WHERE id=$4`,
    [fullDate, csMembersJson, shortage_reason || '', req.params.id]
  );
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const project = { ...parseProject(updated[0]), candidates: [] };

  const allTo = await buildRecipients(p.sales_rep, csMembersArr);
  if (allTo.length) {
    const shortageReasonLine = shortage_reason?.trim() ? `不足理由：${shortage_reason.trim()}` : '';
    await sendTemplatedEmail('schedule_confirmed', allTo, {
      project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep,
      delivery_method: DELIVERY_LABEL(p.delivery_method),
      cs_members: csMembersArr.length ? csMembersArr.join('、') : 'なし',
      confirmed_date: fullDate, shortage_reason_line: shortageReasonLine,
    });
  }
  res.json(project);
});

// キャンセル
app.post('/api/projects/:id/cancel', async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'キャンセル理由を入力してください' });
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = parseProject(rows[0]);
  await pool.query(`UPDATE projects SET status='cancelled', cancel_reason=$1, updated_at=NOW() WHERE id=$2`, [reason.trim(), req.params.id]);
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const allTo = await buildRecipients(p.sales_rep, p.cs_members);
  if (allTo.length) {
    await sendTemplatedEmail('schedule_cancelled', allTo, {
      project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep,
      confirmed_date: p.confirmed_date || '未確定', cancel_reason: reason.trim(),
    });
  }
  res.json({ ...parseProject(updated[0]), candidates: [] });
});

// リマインド
app.post('/api/projects/:id/remind', async (req, res) => {
  const { requester_login_id } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = parseProject(rows[0]);
  const settings = await getEmailSettings();
  const salesEmail = await getSalesEmail(p.sales_rep);
  let requesterEmail = null;
  if (requester_login_id) {
    const { rows: r } = await pool.query('SELECT email FROM users WHERE login_id=$1', [requester_login_id]);
    requesterEmail = r[0]?.email || null;
  }
  const allTo = [...new Set([
    ...(settings.notify_emails || []), ...(salesEmail ? [salesEmail] : []), ...(requesterEmail ? [requesterEmail] : []),
  ])].filter(Boolean);
  if (!allTo.length) return res.status(400).json({ error: '送信先メールアドレスが登録されていません。管理者設定でメールアドレスを登録してください。' });
  const result = await sendTemplatedEmail('reminder', allTo, {
    project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep,
    candidate_days: p.candidate_days || 1,
    created_at: p.created_at ? new Date(p.created_at).toLocaleDateString('ja-JP') : '—',
  });
  if (result?.error) return res.status(500).json({ error: result.error });
  if (result?.skipped) return res.status(400).json({ error: 'メール送信設定（Gmail/Resend）が未完了です' });
  res.json({ success: true });
});

// 自動キャンセルバッチ
async function runAutoCancel() {
  try {
    const { rows: projects } = await pool.query(`SELECT * FROM projects WHERE status='scheduled' AND scheduled_at IS NOT NULL`);
    for (const p_ of projects) {
      const p = parseProject(p_);
      const deadline = addBusinessDays(p.scheduled_at, 10);
      const warningDay = addBusinessDays(p.scheduled_at, 9);
      const todayStr = new Date().toISOString().split('T')[0];
      const deadlineStr = deadline.toISOString().split('T')[0];
      const warningStr = warningDay.toISOString().split('T')[0];
      if (todayStr >= deadlineStr) {
        await pool.query(`UPDATE projects SET status='cancelled', cancel_reason='未確定のため（自動キャンセル）', updated_at=NOW() WHERE id=$1`, [p.id]);
        await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [p.id]);
        const allTo = await buildRecipients(p.sales_rep, p.cs_members);
        if (allTo.length) await sendTemplatedEmail('auto_cancelled', allTo, { project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep });
      } else if (todayStr === warningStr) {
        const allTo = await buildRecipients(p.sales_rep, p.cs_members);
        if (allTo.length) await sendTemplatedEmail('auto_cancel_warning', allTo, { project_type: p.project_type, client_name: p.client_name, sales_rep: p.sales_rep, deadline_date: deadlineStr });
      }
    }
  } catch (e) { console.error('[AutoCancel error]', e.message); }
}

app.delete('/api/projects/:id', async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/stats', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE TRUE) AS total,
           COUNT(*) FILTER (WHERE status='pending') AS pending,
           COUNT(*) FILTER (WHERE status='scheduled') AS scheduled,
           COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE status='delivered') AS delivered
    FROM projects
  `);
  const r = rows[0];
  res.json({ total: +r.total, pending: +r.pending, scheduled: +r.scheduled, confirmed: +r.confirmed, delivered: +r.delivered });
});

app.get('*', (_req, res) => {
  if (fs.existsSync(CLIENT_BUILD)) res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  else res.json({ message: 'API running' });
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
  setInterval(runAutoCancel, 60 * 60 * 1000);
  runAutoCancel();
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
