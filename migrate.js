// Migração one-shot: SQLite (data.db) -> Supabase via Management API SQL endpoint.
// Uso: SBP=<management token> node migrate.js
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SBP = process.env.SBP || process.env.SUPABASE_MGMT_TOKEN
const REF = process.env.SUPABASE_PROJECT_REF || 'qrskhtdxtqgdonnqlkme'
if (!SBP) { console.error('Defina SBP = Management API token'); process.exit(1) }

const db = new DatabaseSync(path.join(__dirname, 'data.db'))

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'broker',
  whatsapp TEXT, instagram TEXT, tiktok TEXT, linkedin TEXT, facebook TEXT,
  about TEXT, photo TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS developments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subtitle TEXT, description TEXT, price TEXT, location TEXT,
  status TEXT NOT NULL DEFAULT 'disponivel',
  type TEXT NOT NULL DEFAULT 'apartamento',
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  featured BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  broker_id BIGINT NOT NULL REFERENCES users(id),
  development_id BIGINT REFERENCES developments(id),
  name TEXT NOT NULL, phone TEXT, whatsapp TEXT, email TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  development_id BIGINT REFERENCES developments(id),
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

const q = (s) => `'${s.replace(/'/g, "''")}'`
const v = (x) => x === null || x === undefined ? 'NULL' : typeof x === 'number' ? String(x) : q(String(x))
const bool = (x) => (x ? 'true' : 'false')

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  if (!res.ok) { const body = await res.text(); throw new Error(`${res.status} ${body.slice(0, 300)}`) }
  return res.json()
}

const rows = (sql) => db.prepare(sql).all()

async function migrate() {
  console.log('[1/5] criando schema...')
  await runSql(SCHEMA)

  console.log('[2/5] usuários...')
  for (const u of rows('SELECT * FROM users')) {
    await runSql(`INSERT INTO users (id,name,email,password_hash,role,whatsapp,instagram,tiktok,linkedin,facebook,about,photo,active,created_at)
      VALUES (${u.id},${q(u.name)},${q(u.email)},${q(u.password_hash)},${q(u.role)},${v(u.whatsapp)},${v(u.instagram)},${v(u.tiktok)},${v(u.linkedin)},${v(u.facebook)},${v(u.about)},${v(u.photo)},${bool(u.active)},${q(u.created_at)}) ON CONFLICT (email) DO NOTHING`)
  }

  console.log('[3/5] empreendimentos...')
  for (const d of rows('SELECT * FROM developments')) {
    await runSql(`INSERT INTO developments (id,user_id,title,subtitle,description,price,location,status,type,media,featured,published,created_at)
      VALUES (${d.id},${d.user_id},${q(d.title)},${v(d.subtitle)},${v(d.description)},${v(d.price)},${v(d.location)},${q(d.status)},${q(d.type)},'${d.media.replace(/'/g,"''")}'::jsonb,${bool(d.featured)},${bool(d.published)},${q(d.created_at)}) ON CONFLICT (id) DO NOTHING`)
  }

  console.log('[4/5] leads...')
  for (const l of rows('SELECT * FROM leads')) {
    await runSql(`INSERT INTO leads (id,broker_id,development_id,name,phone,whatsapp,email,message,status,created_at)
      VALUES (${l.id},${l.broker_id},${v(l.development_id)},${q(l.name)},${v(l.phone)},${v(l.whatsapp)},${v(l.email)},${v(l.message)},${q(l.status)},${q(l.created_at)}) ON CONFLICT (id) DO NOTHING`)
  }

  console.log('[5/5] posts...')
  for (const p of rows('SELECT * FROM posts')) {
    await runSql(`INSERT INTO posts (id,user_id,development_id,platform,content,media,scheduled_at,status,published_at,created_at)
      VALUES (${p.id},${p.user_id},${v(p.development_id)},${q(p.platform)},${q(p.content)},'${p.media.replace(/'/g,"''")}'::jsonb,${q(p.scheduled_at)},${q(p.status)},${v(p.published_at)},${q(p.created_at)}) ON CONFLICT (id) DO NOTHING`)
  }

  const counts = await runSql(`SELECT (SELECT count(*) FROM users) u,(SELECT count(*) FROM developments) d,(SELECT count(*) FROM leads) l,(SELECT count(*) FROM posts) p`)
  console.log('[ok] Supabase:', JSON.stringify(counts[0]))
}

migrate().catch(e => { console.error('FALHOU:', e.message); process.exit(1) })