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
    if (!resend) { console.log('[Resend skipped - no key]'); return { skipped: true }; }
    const from = settings.from || '納品スケジューラー <onboarding@resend.dev>';
    try { const r = await resend.emails.send({ from, to: toList, subject, html }); return r; }
    catch (e) { console.error('[Resend error]', e.message); return { error: e.message }; }
  }
  return { skipped: true };
}

function makeEmailHtml(title, rows, note) {
  const rowsHtml = rows.map(([label, value, hi]) =>
    `<tr><td style="padding:8px 14px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0">${label}</td>
     <td style="padding:8px 14px;font-size:13px;border-bottom:1px solid #f0f0f0${hi ? ';color:#10b981;font-weight:700;font-size:15px' : ''}">${value}</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2332;padding:24px 28px">
      <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:0.1em;margin-bottom:6px">納品スケジューラー</div>
      <div style="color:#fff;font-size:20px;font-weight:700">${title}</div>
    </div>
    <div style="padding:8px 0"><table style="width:100%;border-collapse:collapse">${rowsHtml}</table></div>
    ${note ? `<div style="padding:16px 28px;background:#f8fafc;font-size:11px;color:#999">${note}</div>` : ''}
  </div></body></html>`;
}

// 営業担当のメールアドレスを取得
async function getSalesEmail(salesRepName) {
  const { rows } = await pool.query("SELECT email FROM users WHERE name=$1 AND role='sales'", [salesRepName]);
  return rows[0]?.email || null;
}

// 管理者通知先 + 営業担当の全送信先を構築
async function buildRecipients(salesRepName) {
  const settings = await getEmailSettings();
  const salesEmail = await getSalesEmail(salesRepName);
  return [...new Set([...(settings.notify_emails || []), ...(salesEmail ? [salesEmail] : [])])].filter(Boolean);
}

// 営業日（土日祝を除く）を加算する簡易計算（祝日は考慮しない）
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
        cancel_reason   TEXT DEFAULT '',
        scheduled_at    TIMESTAMPTZ,
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

    // Migrations for existing DBs
    await client.query(`ALTER TABLE projects ALTER COLUMN project_name DROP NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'remote'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT '新規納品'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS candidate_days INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
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
  await pool.query('INSERT INTO users (id,name,role,password,email) VALUES ($1,$2,$3,$4,$5)', [id, name, 'sales', password, email || '']);
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
  await pool.query('UPDATE users SET name=COALESCE($1,name), password=COALESCE($2,password), email=COALESCE($3,email) WHERE id=$4',
    [name || null, password || null, email !== undefined ? email : null, req.params.id]);
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
  const s = await getEmailSettings();
  const safe = { ...s };
  if (safe.gmail_app_password) safe.gmail_app_password = '********';
  res.json(safe);
});
app.put('/api/settings/email', async (req, res) => {
  const { provider, from, notify_emails, gmail_user, gmail_app_password } = req.body;
  const existing = await getEmailSettings();
  const value = JSON.stringify({
    provider: provider || 'gmail', from: from || '',
    notify_emails: notify_emails || [], gmail_user: gmail_user || '',
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
    html: makeEmailHtml('メール設定テスト ✅', [['プロバイダー', settings.provider === 'resend' ? 'Resend' : 'Gmail SMTP'], ['送信先', settings.notify_emails.join(', ')]], 'このメールはテスト送信です。'),
  });
  if (result?.error) return res.status(500).json({ error: result.error });
  if (result?.skipped) return res.status(400).json({ error: 'メール設定が未完了です' });
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
  const { rows: candidates } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json({ ...rows[0], candidates });
});

// 新規登録
app.post('/api/projects', async (req, res) => {
  const { client_name, project_type, sales_rep, memo, delivery_method, candidate_days } = req.body;
  if (!client_name || !project_type || !sales_rep) return res.status(400).json({ error: '必須項目が不足しています' });
  if (memo && memo.length > 30) return res.status(400).json({ error: '備考は30文字以内で入力してください' });
  const id = uuidv4();
  await pool.query(
    `INSERT INTO projects (id,client_name,project_type,sales_rep,memo,delivery_method,candidate_days,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [id, client_name, project_type, sales_rep, memo || '', delivery_method || 'remote', candidate_days || 1]
  );
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
  const project = { ...rows[0], candidates: [] };

  // 管理者へ通知
  const settings = await getEmailSettings();
  if (settings.notify_emails?.length) {
    await sendEmail({
      to: settings.notify_emails,
      subject: `【新規依頼】${project_type}（${client_name}）`,
      html: makeEmailHtml('新しい案件依頼が届きました', [
        ['案件内容', `<b>${project_type}</b>`],
        ['顧客名', client_name],
        ['担当営業', sales_rep],
        ['納品方法', delivery_method === 'onsite' ? '🚗 現地訪問' : '🖥 リモート'],
        ['希望候補日数', `${candidate_days || 1}日`],
        ['備考', memo || 'なし'],
      ], '候補日をカレンダーで確認して設定してください。'),
    });
  }
  res.status(201).json(project);
});

// 更新
app.put('/api/projects/:id', async (req, res) => {
  const { client_name, project_type, sales_rep, memo, delivery_method, candidate_days, candidates, status, confirmed_date } = req.body;
  if (memo && memo.length > 30) return res.status(400).json({ error: '備考は30文字以内で入力してください' });
  const { rows: ex } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = ex[0];
  await pool.query(
    `UPDATE projects SET client_name=$1,project_type=$2,sales_rep=$3,memo=$4,status=$5,confirmed_date=$6,delivery_method=$7,candidate_days=$8,updated_at=NOW() WHERE id=$9`,
    [client_name??p.client_name, project_type??p.project_type, sales_rep??p.sales_rep, memo??p.memo,
     status??p.status, confirmed_date??p.confirmed_date, delivery_method??p.delivery_method, candidate_days??p.candidate_days, req.params.id]
  );
  if (candidates !== undefined) {
    if (candidates.length > 3) return res.status(400).json({ error: '候補日は最大3件までです' });
    await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query('INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), req.params.id, c.date, c.time || '', `第${i+1}候補`]);
    }
  }
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json({ ...rows[0], candidates: cands });
});

// 候補日 追加
app.post('/api/projects/:id/candidates', async (req, res) => {
  const { date, time } = req.body;
  if (!date) return res.status(400).json({ error: '日付は必須です' });
  const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  if (cands.length >= 3) return res.status(400).json({ error: '候補日は最大3件までです' });
  await pool.query('INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
    [uuidv4(), req.params.id, date, time || '', `第${cands.length+1}候補`]);
  await pool.query('UPDATE projects SET updated_at=NOW(), status=CASE WHEN status=\'pending\' THEN \'scheduled\' ELSE status END WHERE id=$1', [req.params.id]);
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
  // 候補日が0件になったらpendingに戻す
  const newStatus = remaining.length === 0 ? 'pending' : 'scheduled';
  await pool.query('UPDATE projects SET updated_at=NOW(), status=$1 WHERE id=$2', [newStatus, req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1 ORDER BY candidate_date', [req.params.id]);
  res.json(updated);
});

// ── 営業が仮スケジュールを確定 ───────────────────────────────
app.post('/api/projects/:id/confirm-schedule', async (req, res) => {
  const { confirmed_date, confirmed_time } = req.body;
  if (!confirmed_date) return res.status(400).json({ error: '確定日を選択してください' });
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = rows[0];
  const fullDate = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;

  await pool.query(
    `UPDATE projects SET confirmed_date=$1, status='confirmed', scheduled_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [fullDate, req.params.id]
  );
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const project = { ...updated[0], candidates: [] };

  // 営業担当 + 管理者へ通知
  const allTo = await buildRecipients(p.sales_rep);
  if (allTo.length) {
    await sendEmail({
      to: allTo,
      subject: `【日程確定】${p.project_type}（${p.client_name}）`,
      html: makeEmailHtml('スケジュールが確定しました', [
        ['案件内容', `<b>${p.project_type}</b>`],
        ['顧客名', p.client_name],
        ['担当営業', p.sales_rep],
        ['納品方法', p.delivery_method === 'onsite' ? '🚗 現地訪問' : '🖥 リモート'],
        ['✅ 確定日時', fullDate, true],
      ], '日程が確定しました。準備をお願いします。'),
    });
  }
  res.json(project);
});

// ── キャンセル ────────────────────────────────────────────────
app.post('/api/projects/:id/cancel', async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'キャンセル理由を入力してください' });
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = rows[0];

  await pool.query(
    `UPDATE projects SET status='cancelled', cancel_reason=$1, updated_at=NOW() WHERE id=$2`,
    [reason.trim(), req.params.id]
  );
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);

  // 営業担当 + 管理者へ通知
  const allTo = await buildRecipients(p.sales_rep);
  if (allTo.length) {
    await sendEmail({
      to: allTo,
      subject: `【キャンセル】${p.project_type}（${p.client_name}）`,
      html: makeEmailHtml('案件がキャンセルされました', [
        ['案件内容', `<b>${p.project_type}</b>`],
        ['顧客名', p.client_name],
        ['担当営業', p.sales_rep],
        ['確定日', p.confirmed_date || '未確定'],
        ['キャンセル理由', `<span style="color:#dc2626">${reason.trim()}</span>`],
      ], '再スケジュールが必要な場合は新規案件として再申請してください。'),
    });
  }
  res.json({ ...updated[0], candidates: [] });
});

// ── リマインドメール ──────────────────────────────────────────
app.post('/api/projects/:id/remind', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = rows[0];

  const settings = await getEmailSettings();
  const salesEmail = await getSalesEmail(p.sales_rep);
  // 管理者 + 本人両方に送る
  const allTo = [...new Set([...(settings.notify_emails || []), ...(salesEmail ? [salesEmail] : [])])].filter(Boolean);
  if (!allTo.length) return res.status(400).json({ error: '送信先メールアドレスが登録されていません' });

  const result = await sendEmail({
    to: allTo,
    subject: `【リマインド】仮スケジュール日程未設定：${p.project_type}（${p.client_name}）`,
    html: makeEmailHtml('仮スケジュール未設定のリマインドです', [
      ['案件内容', `<b>${p.project_type}</b>`],
      ['顧客名', p.client_name],
      ['担当営業', p.sales_rep],
      ['希望候補日数', `${p.candidate_days || 1}日`],
      ['依頼日', p.created_at ? new Date(p.created_at).toLocaleDateString('ja-JP') : '—'],
    ], '候補日が未設定のままです。早急にスケジュールを設定してください。'),
  });

  if (result?.error) return res.status(500).json({ error: result.error });
  if (result?.skipped) return res.status(400).json({ error: 'メール設定が未完了です' });
  res.json({ success: true });
});

// ── 強制キャンセルバッチ（毎時実行） ─────────────────────────
async function runAutoCancel() {
  try {
    const now = new Date();
    // scheduled_atから10営業日後を計算して強制キャンセル
    const { rows: projects } = await pool.query(
      `SELECT * FROM projects WHERE status='scheduled' AND scheduled_at IS NOT NULL`
    );

    for (const p of projects) {
      const deadline = addBusinessDays(p.scheduled_at, 10);
      const warningDay = addBusinessDays(p.scheduled_at, 9); // 前日警告

      const todayStr = now.toISOString().split('T')[0];
      const deadlineStr = deadline.toISOString().split('T')[0];
      const warningStr = warningDay.toISOString().split('T')[0];

      // 強制キャンセル
      if (todayStr >= deadlineStr) {
        await pool.query(
          `UPDATE projects SET status='cancelled', cancel_reason='未確定のため（自動キャンセル）', updated_at=NOW() WHERE id=$1`,
          [p.id]
        );
        await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [p.id]);
        console.log(`[AutoCancel] ${p.id} ${p.project_type}`);

        const allTo = await buildRecipients(p.sales_rep);
        if (allTo.length) {
          await sendEmail({
            to: allTo,
            subject: `【自動キャンセル】${p.project_type}（${p.client_name}）`,
            html: makeEmailHtml('案件が自動キャンセルされました', [
              ['案件内容', `<b>${p.project_type}</b>`],
              ['顧客名', p.client_name],
              ['担当営業', p.sales_rep],
              ['キャンセル理由', '仮スケジュール設定から10営業日経過のため自動キャンセル'],
            ], '再スケジュールが必要な場合は新規案件として再申請してください。'),
          });
        }
      }
      // 前日警告（todayStr === warningStr のとき1回だけ）
      else if (todayStr === warningStr) {
        const allTo = await buildRecipients(p.sales_rep);
        if (allTo.length) {
          await sendEmail({
            to: allTo,
            subject: `【警告】明日自動キャンセル予定：${p.project_type}（${p.client_name}）`,
            html: makeEmailHtml('⚠️ 明日自動キャンセルされます', [
              ['案件内容', `<b>${p.project_type}</b>`],
              ['顧客名', p.client_name],
              ['担当営業', p.sales_rep],
              ['自動キャンセル日', deadlineStr],
              ['理由', '仮スケジュール設定から10営業日経過'],
            ], '本日中にスケジュールを確定するか、担当者に連絡してください。'),
          });
        }
        console.log(`[AutoCancel Warning] ${p.id} ${p.project_type} - cancels tomorrow`);
      }
    }
  } catch (e) {
    console.error('[AutoCancel error]', e.message);
  }
}

// ── 削除 ─────────────────────────────────────────────────────
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
  // 1時間ごとに強制キャンセルチェック
  setInterval(runAutoCancel, 60 * 60 * 1000);
  // 起動時も1回実行
  runAutoCancel();
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
