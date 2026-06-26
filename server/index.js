const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// ── PostgreSQL (Supabase) connection ────────────────────────
// Set DATABASE_URL in Render.com environment variables
// Format: postgres://user:password@host:port/dbname
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Please configure it in Render.com environment variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Initialize schema ────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        role        TEXT NOT NULL DEFAULT 'sales',
        password    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id            TEXT PRIMARY KEY,
        client_name   TEXT NOT NULL,
        project_name  TEXT NOT NULL,
        sales_rep     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        memo          TEXT DEFAULT '',
        confirmed_date TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS schedule_candidates (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        candidate_date  TEXT NOT NULL,
        candidate_time  TEXT DEFAULT '',
        label           TEXT
      );
    `);

    // Seed default users if empty
    const { rows } = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(rows[0].c) === 0) {
      await client.query(`
        INSERT INTO users (id, name, role, password) VALUES
          ($1, '管理者',   'admin', 'admin123'),
          ($2, '営業 山田', 'sales', 'sales123'),
          ($3, '営業 田中', 'sales', 'sales456')
      `, [uuidv4(), uuidv4(), uuidv4()]);
      console.log('✅ Default users seeded');
    }
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

app.use(cors());
app.use(express.json());

// ── Serve React build ────────────────────────────────────────
const CLIENT_BUILD = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_BUILD)) {
  app.use(express.static(CLIENT_BUILD));
}

// ── Auth ─────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { name, password } = req.body;
  const { rows } = await pool.query(
    'SELECT id, name, role FROM users WHERE name = $1 AND password = $2',
    [name, password]
  );
  if (!rows[0]) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  res.json(rows[0]);
});

app.get('/api/users', async (_req, res) => {
  const { rows } = await pool.query("SELECT id, name, role FROM users WHERE role = 'sales' ORDER BY name");
  res.json(rows);
});

// ── Projects ──────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  const { role, sales_rep } = req.query;
  let query = 'SELECT * FROM projects';
  const params = [];
  if (role === 'sales' && sales_rep) {
    query += ' WHERE sales_rep = $1';
    params.push(sales_rep);
  }
  query += ' ORDER BY updated_at DESC';

  const { rows: projects } = await pool.query(query, params);
  const { rows: candidates } = await pool.query('SELECT * FROM schedule_candidates ORDER BY candidate_date');

  const candMap = {};
  candidates.forEach(c => {
    if (!candMap[c.project_id]) candMap[c.project_id] = [];
    candMap[c.project_id].push(c);
  });

  res.json(projects.map(p => ({ ...p, candidates: candMap[p.id] || [] })));
});

app.get('/api/projects/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const { rows: candidates } = await pool.query(
    'SELECT * FROM schedule_candidates WHERE project_id = $1 ORDER BY candidate_date',
    [req.params.id]
  );
  res.json({ ...rows[0], candidates });
});

app.post('/api/projects', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, candidates } = req.body;
  if (!client_name || !project_name || !sales_rep)
    return res.status(400).json({ error: '必須項目が不足しています' });
  if (candidates && candidates.length > 3)
    return res.status(400).json({ error: '候補日は最大3件までです' });

  const id = uuidv4();
  await pool.query(
    `INSERT INTO projects (id, client_name, project_name, sales_rep, memo, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [id, client_name, project_name, sales_rep, memo || '']
  );

  if (candidates?.length) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query(
        'INSERT INTO schedule_candidates (id, project_id, candidate_date, candidate_time, label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), id, c.date, c.time || '', `第${i + 1}候補`]
      );
    }
  }

  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id = $1', [id]);
  res.status(201).json({ ...rows[0], candidates: cands });
});

app.put('/api/projects/:id', async (req, res) => {
  const { client_name, project_name, sales_rep, memo, candidates, status, confirmed_date } = req.body;
  const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: '案件が見つかりません' });
  const p = existing[0];

  await pool.query(
    `UPDATE projects SET
      client_name = $1, project_name = $2, sales_rep = $3,
      memo = $4, status = $5, confirmed_date = $6,
      updated_at = NOW()
     WHERE id = $7`,
    [
      client_name ?? p.client_name,
      project_name ?? p.project_name,
      sales_rep ?? p.sales_rep,
      memo ?? p.memo,
      status ?? p.status,
      confirmed_date ?? p.confirmed_date,
      req.params.id
    ]
  );

  if (candidates !== undefined) {
    if (candidates.length > 3) return res.status(400).json({ error: '候補日は最大3件までです' });
    await pool.query('DELETE FROM schedule_candidates WHERE project_id = $1', [req.params.id]);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await pool.query(
        'INSERT INTO schedule_candidates (id, project_id, candidate_date, candidate_time, label) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), req.params.id, c.date, c.time || '', `第${i + 1}候補`]
      );
    }
  }

  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  const { rows: cands } = await pool.query('SELECT * FROM schedule_candidates WHERE project_id = $1', [req.params.id]);
  res.json({ ...rows[0], candidates: cands });
});

app.post('/api/projects/:id/confirm', async (req, res) => {
  const { confirmed_date, confirmed_time } = req.body;
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: '案件が見つかりません' });

  const fullDate = confirmed_time ? `${confirmed_date} ${confirmed_time}` : confirmed_date;

  await pool.query(
    `UPDATE projects SET confirmed_date = $1, status = 'confirmed', updated_at = NOW() WHERE id = $2`,
    [fullDate, req.params.id]
  );
  await pool.query('DELETE FROM schedule_candidates WHERE project_id = $1', [req.params.id]);

  const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  res.json({ ...updated[0], candidates: [] });
});

app.delete('/api/projects/:id', async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/stats', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE TRUE)                    AS total,
      COUNT(*) FILTER (WHERE status = 'pending')      AS pending,
      COUNT(*) FILTER (WHERE status = 'confirmed')    AS confirmed,
      COUNT(*) FILTER (WHERE status = 'delivered')    AS delivered
    FROM projects
  `);
  const r = rows[0];
  res.json({
    total:     parseInt(r.total),
    pending:   parseInt(r.pending),
    confirmed: parseInt(r.confirmed),
    delivered: parseInt(r.delivered),
  });
});

// SPA fallback
app.get('*', (_req, res) => {
  if (fs.existsSync(CLIENT_BUILD)) {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  } else {
    res.json({ message: 'API server running. Build the client for the full app.' });
  }
});

// ── Start ────────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
