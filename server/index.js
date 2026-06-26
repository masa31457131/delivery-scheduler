const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.'); process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Resend client (only if API key is set)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Email helpers ─────────────────────────────────────────────
async function getEmailSettings() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='email_settings'");
  if (!rows[0]) return { from: '', notify_emails: [] };
  return JSON.parse(rows[0].value);
}

async function sendEmail({ to, subject, html }) {
  if (!resend) { console.log('[Email skipped - no RESEND_API_KEY]', subject); return; }
  const settings = await getEmailSettings();
  const from = settings.from || 'noreply@example.com';
  try {
    await resend.emails.send({ from, to: Array.isArray(to) ? to : [to], subject, html });
    console.log('[Email sent]', subject, '->', to);
  } catch (e) {
    console.error('[Email error]', e.message);
  }
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
        password TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id              TEXT PRIMARY KEY,
        client_name     TEXT NOT NULL,
        project_name    TEXT NOT NULL,
        sales_rep       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        memo            TEXT DEFAULT '',
        delivery_method TEXT DEFAULT 'remote',
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
        id          TEXT PRIMARY KEY,
        date        TEXT NOT NULL,
        time_from   TEXT DEFAULT '',
        time_to     TEXT DEFAULT '',
        reason      TEXT DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrations for existing DBs
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'remote'`);

    const { rows } = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(rows[0].c) === 0) {
      await client.query(
        `INSERT INTO users (id,name,role,password) VALUES ($1,'管理者','admin','admin123'),($2,'営業 山田','sales','sales123'),($3,'営業 田中','sales','sales456')`,
        [uuidv4(), uuidv4(), uuidv4()]
      );
    }

    // Default email settings
    const { rows: sets } = await client.query("SELECT key FROM settings WHERE key='email_settings'");
    if (!sets[0]) {
      await client.query("INSERT INTO settings (key,value) VALUES ('email_settings',$1)",
        [JSON.stringify({ from: '', notify_emails: [] })]);
    }

    console.log('DB initialized');
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
  const { rows } = await pool.query("SELECT id,name,role FROM users WHERE role='sales' ORDER BY name");
  res.json(rows);
});

app.post('/api/users', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: '名前とパスワードは必須です' });
  const dup = await pool.query('SELECT id FROM users WHERE name=$1', [name]);
  if (dup.rows[0]) return res.status(400).json({ error: 'この名前はすでに使われています' });
  const id = uuidv4();
  await pool.query('INSERT INTO users (id,name,role,password) VALUES ($1,$2,$3,$4)', [id, name, 'sales', password]);
  res.status(201).json({ id, name, role: 'sales' });
});

app.put('/api/users/:id', async (req, res) => {
  const { name, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (rows[0].role === 'admin') return res.status(403).json({ error: '管理者アカウントは変更できません' });
  if (name) {
    const dup = await pool.query('SELECT id FROM users WHERE name=$1 AND id!=$2', [name, req.params.id]);
    if (dup.rows[0]) return res.status(400).json({ error: 'この名前はすでに使われています' });
  }
  await pool.query('UPDATE users SET name=COALESCE($1,name), password=COALESCE($2,password) WHERE id=$3',
    [name || null, password || null, req.params.id]);
  const { rows: u } = await pool.query('SELECT id,name,role FROM users WHERE id=$1', [req.params.id]);
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

// ── Conflict & Block check ────────────────────────────────────
app.get('/api/schedule/conflicts', async (req, res) => {
  const { date, time, exclude_project_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  // Check blocked dates
  const { rows: blocked } = await pool.query('SELECT * FROM blocked_dates WHERE date=$1', [date]);
  const isBlocked = blocked.some(b => {
    if (!b.time_from && !b.time_to) return true; // all-day block
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
  res.json(settings);
});

app.put('/api/settings/email', async (req, res) => {
  const { from, notify_emails } = req.body;
  const value = JSON.stringify({ from: from || '', notify_emails: notify_emails || [] });
  await pool.query("INSERT INTO settings (key,value) VALUES ('email_settings',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [value]);
  res.json({ from, notify_emails });
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

app.post('/api/projects', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, delivery_method, candidates } = req.body;
  if (!client_name || !project_name || !sales_rep) return res.status(400).json({ error: '必須項目が不足しています' });
  if (candidates && candidates.length > 3) return res.status(400).json({ error: '候補日は最大3件までです' });

  const id = uuidv4();
  await pool.query(`INSERT INTO projects (id,client_name,project_name,sales_rep,memo,delivery_method,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
    [id, client_name, project_name, sales_rep, memo || '', delivery_method || 'remote']);

  if (candidates?.length) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query('INSERT INTO schedule_candidates (id,project_id,candidate_date,candidate_time,label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), id, c.date, c.time || '', `第${i+1}候補`]);
    }
  }

  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [id]);
  const project = { ...rows[0], candidates: cands };

  // メール通知：管理者へ
  const settings = await getEmailSettings();
  if (settings.notify_emails?.length) {
    const deliveryLabel = delivery_method === 'onsite' ? '現地訪問' : 'リモート';
    const dateLines = cands.map(c => `・${c.label}：${c.candidate_date}${c.candidate_time ? ' ' + c.candidate_time : ''}`).join('<br>');
    await sendEmail({
      to: settings.notify_emails,
      subject: `【新規案件登録】${project_name}（${client_name}）`,
      html: `
        <h2>新しい案件が登録されました</h2>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 12px;color:#666">案件名</td><td style="padding:6px 12px"><b>${project_name}</b></td></tr>
          <tr><td style="padding:6px 12px;color:#666">顧客名</td><td style="padding:6px 12px">${client_name}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">担当営業</td><td style="padding:6px 12px">${sales_rep}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">納品方法</td><td style="padding:6px 12px">${deliveryLabel}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">候補日</td><td style="padding:6px 12px">${dateLines || 'なし'}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">備考</td><td style="padding:6px 12px">${memo || 'なし'}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:20px">納品スケジューラーより自動送信</p>
      `,
    });
  }

  res.status(201).json(project);
});

app.put('/api/projects/:id', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, delivery_method, candidates, status, confirmed_date } = req.body;
  const { rows: ex } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = ex[0];
  await pool.query(`UPDATE projects SET client_name=$1,project_name=$2,sales_rep=$3,memo=$4,status=$5,confirmed_date=$6,delivery_method=$7,updated_at=NOW() WHERE id=$8`,
    [client_name??p.client_name, project_name??p.project_name, sales_rep??p.sales_rep, memo??p.memo, status??p.status, confirmed_date??p.confirmed_date, delivery_method??p.delivery_method, req.params.id]);
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
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  res.json({ ...rows[0], candidates: cands });
});

app.post('/api/projects/:id/confirm', async (req, res) => {
  const { confirmed_date, confirmed_time } = req.body;
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = rows[0];
  const fullDate = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;
  await pool.query(`UPDATE projects SET confirmed_date=$1,status='confirmed',updated_at=NOW() WHERE id=$2`, [fullDate, req.params.id]);
  await pool.query('DELETE FROM schedule_candidates WHERE project_id=$1', [req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  const project = { ...updated[0], candidates: [] };

  // メール通知：担当営業へ
  const settings = await getEmailSettings();
  if (settings.notify_emails?.length) {
    const deliveryLabel = p.delivery_method === 'onsite' ? '現地訪問' : 'リモート';
    const dateStr = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;
    await sendEmail({
      to: settings.notify_emails,
      subject: `【日程確定】${p.project_name}（${p.client_name}）`,
      html: `
        <h2>納品日程が確定しました</h2>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 12px;color:#666">案件名</td><td style="padding:6px 12px"><b>${p.project_name}</b></td></tr>
          <tr><td style="padding:6px 12px;color:#666">顧客名</td><td style="padding:6px 12px">${p.client_name}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">担当営業</td><td style="padding:6px 12px">${p.sales_rep}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">納品方法</td><td style="padding:6px 12px">${deliveryLabel}</td></tr>
          <tr><td style="padding:6px 12px;color:#666">✅ 確定日時</td><td style="padding:6px 12px"><b style="color:#10b981;font-size:16px">${dateStr}</b></td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:20px">納品スケジューラーより自動送信</p>
      `,
    });
  }

  res.json(project);
});

app.delete('/api/projects/:id', async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/stats', async (_req, res) => {
  const { rows } = await pool.query(`SELECT COUNT(*) FILTER (WHERE TRUE) AS total, COUNT(*) FILTER (WHERE status='pending') AS pending, COUNT(*) FILTER (WHERE status='confirmed') AS confirmed, COUNT(*) FILTER (WHERE status='delivered') AS delivered FROM projects`);
  const r = rows[0];
  res.json({ total: +r.total, pending: +r.pending, confirmed: +r.confirmed, delivered: +r.delivered });
});

app.get('*', (_req, res) => {
  if (fs.existsSync(CLIENT_BUILD)) res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  else res.json({ message: 'API running' });
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
