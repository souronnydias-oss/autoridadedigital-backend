import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db')
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao'
const PORT = process.env.PORT || 3001

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'broker',
    whatsapp TEXT,
    instagram TEXT,
    about TEXT,
    photo TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS developments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    price TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'disponivel',
    type TEXT NOT NULL DEFAULT 'apartamento',
    media TEXT NOT NULL DEFAULT '[]',
    featured INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_id INTEGER NOT NULL REFERENCES users(id),
    development_id INTEGER REFERENCES developments(id),
    name TEXT NOT NULL,
    phone TEXT,
    whatsapp TEXT,
    email TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'novo',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

const seedUser = (name, email, role, extra = {}) => {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return existing.id
  const hash = bcrypt.hashSync('admin123', 10)
  const r = db.prepare(`INSERT INTO users (name, email, password_hash, role, whatsapp, instagram, about)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, email, hash, role, extra.whatsapp || null, extra.instagram || null, extra.about || null)
  return r.lastInsertRowid
}
seedUser('Administrador', 'admin@autoridadedigital.com', 'admin', {})
const brokerId = seedUser('Carlos Almeida', 'corretor@autoridadedigital.com', 'broker', {
  whatsapp: '5511999999999',
  instagram: '@carlosalmeida.imoveis',
  about: 'Corretor de imóveis com mais de 10 anos de experiência. Especialista em lançamentos e alto padrão na região.'
})

const seedDev = (dev) => {
  const existing = db.prepare('SELECT id FROM developments WHERE title = ?').get(dev.title)
  if (existing) return
  db.prepare(`INSERT INTO developments (user_id, title, subtitle, description, price, location, status, type, media, featured, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(dev.user_id, dev.title, dev.subtitle, dev.description, dev.price, dev.location, dev.status, dev.type, JSON.stringify(dev.media), dev.featured, dev.published)
}
seedDev({ user_id: brokerId, title: 'Residencial Vista Verde', subtitle: 'Lançamento 2 e 3 dormitórios', description: 'A 5 minutos do bairro das avenidas. Lazer completo: piscina, academia e espaço gourmet. Torre única com 20 andares e vista privilegiada.', price: 'R$ 489.900', location: 'Zona Sul - São Paulo/SP', status: 'lançamento', type: 'apartamento', media: [], featured: 1, published: 1 })
seedDev({ user_id: brokerId, title: 'Alto da Serra Residences', subtitle: 'Alto padrão com varanda gourmet', description: 'Empreendimento de alto padrão na Serra. Apartamentos de 3 e 4 suítes com 80 a 130m². Segurança 24h e área verde exclusiva.', price: 'R$ 1.250.000', location: 'Serra - Espirito Santo/ES', status: 'em construção', type: 'apartamento', media: [], featured: 1, published: 1 })

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOAD_DIR))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`)
  }
})
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } })

const auth = (roles) => (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Não autenticado' })
  let payload
  try { payload = jwt.verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Sessão expirada' }) }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' })
  if (roles && !roles.includes(user.role)) return res.status(403).json({ error: 'Sem permissão' })
  req.user = user
  next()
}

const publicUser = (u) => u && ({ id: u.id, name: u.name, whatsapp: u.whatsapp, about: u.about, photo: u.photo, instagram: u.instagram })
const parseMedia = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : [] } catch { return [] } }

const publicBroker = () => {
  const b = db.prepare("SELECT * FROM users WHERE role = 'broker' AND active = 1 ORDER BY id LIMIT 1").get()
  return b
}

// ---- Auth ----
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase())
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha inválidos' })
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: publicUser(user) })
})

app.get('/api/auth/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }))

// ---- Público (landing) ----
app.get('/api/public', (req, res) => {
  const broker = publicBroker()
  if (!broker) return res.json({ broker: null, developments: [] })
  const devs = db.prepare('SELECT * FROM developments WHERE published = 1 ORDER BY featured DESC, id DESC').all()
    .map(d => ({ ...d, media: parseMedia(d.media) }))
  res.json({ broker: publicUser(broker), developments: devs })
})

app.post('/api/leads', (req, res) => {
  const { name, phone, whatsapp, email, message, development_id } = req.body
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' })
  const broker = publicBroker()
  if (!broker) return res.status(500).json({ error: 'Sem corretor configurado' })
  const r = db.prepare(`INSERT INTO leads (broker_id, development_id, name, phone, whatsapp, email, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(broker.id, development_id || null, String(name).trim(), String(phone).trim(), whatsapp || null, email || null, message || null)
  db.prepare('UPDATE developments SET status = status WHERE id != ?').all(r.lastInsertRowid) // placeholder no-op
  res.json({ ok: true, id: r.lastInsertRowid })
})

// ---- Público: detalhe ----
app.get('/api/developments/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM developments WHERE id = ? AND published = 1').get(req.params.id)
  if (!d) return res.status(404).json({ error: 'Não encontrado' })
  res.json({ ...d, media: parseMedia(d.media) })
})

// ---- Upload (auth) ----
app.post('/api/upload', auth(), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' })
  const url = `/uploads/${req.file.filename}`
  const ext = path.extname(req.file.filename).toLowerCase()
  const type = ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'image'
  res.json({ url, type })
})

// ---- Admin/Corretor: developments ----
app.get('/api/admin/developments', auth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM developments ORDER BY id DESC')
    .all().map(d => ({ ...d, media: parseMedia(d.media) }))
    .filter(d => req.user.role === 'admin' || d.user_id === req.user.id)
  res.json({ developments: rows })
})

app.post('/api/admin/developments', auth(), (req, res) => {
  const { title, subtitle, description, price, location, status, type, media, featured, published } = req.body
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' })
  const r = db.prepare(`INSERT INTO developments (user_id, title, subtitle, description, price, location, status, type, media, featured, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, String(title), subtitle || null, description || null, price || null, location || null,
      status || 'disponivel', type || 'apartamento', JSON.stringify(media || []), featured ? 1 : 0, published === undefined ? 1 : (published ? 1 : 0))
  res.json({ ok: true, id: r.lastInsertRowid })
})

app.put('/api/admin/developments/:id', auth(), (req, res) => {
  const dev = db.prepare('SELECT * FROM developments WHERE id = ?').get(req.params.id)
  if (!dev) return res.status(404).json({ error: 'Não encontrado' })
  if (req.user.role !== 'admin' && dev.user_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
  const { title, subtitle, description, price, location, status, type, media, featured, published } = req.body
  db.prepare(`UPDATE developments SET title=?, subtitle=?, description=?, price=?, location=?, status=?, type=?, media=?, featured=?, published=? WHERE id=?`)
    .run(String(title || dev.title), subtitle ?? dev.subtitle, description ?? dev.description, price ?? dev.price,
      location ?? dev.location, status || dev.status, type || dev.type, JSON.stringify(media || parseMedia(dev.media)),
      featured ? 1 : 0, published === undefined ? dev.published : (published ? 1 : 0), dev.id)
  res.json({ ok: true })
})

app.delete('/api/admin/developments/:id', auth(), (req, res) => {
  const dev = db.prepare('SELECT * FROM developments WHERE id = ?').get(req.params.id)
  if (!dev) return res.status(404).json({ error: 'Não encontrado' })
  if (req.user.role !== 'admin' && dev.user_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
  db.prepare('DELETE FROM developments WHERE id = ?').run(dev.id)
  res.json({ ok: true })
})

// ---- Leads ----
app.get('/api/admin/leads', auth(), (req, res) => {
  const where = req.user.role === 'admin' ? '' : 'WHERE l.broker_id = ?'
  const rows = db.prepare(`SELECT l.*, d.title AS development_title FROM leads l LEFT JOIN developments d ON d.id = l.development_id ${where} ORDER BY l.id DESC`)
    .all(...(where ? [req.user.id] : []))
  res.json({ leads: rows })
})

app.patch('/api/admin/leads/:id/status', auth(), (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })
  if (req.user.role !== 'admin' && lead.broker_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
  const statuses = ['novo', 'contatado', 'interessado', 'convertido', 'descartado']
  const status = statuses.includes(req.body.status) ? req.body.status : lead.status
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, lead.id)
  res.json({ ok: true })
})

// ---- Perfil do usuário logado ----
app.patch('/api/profile', auth(), (req, res) => {
  const { name, whatsapp, instagram, about, photo } = req.body
  db.prepare('UPDATE users SET name=?, whatsapp=?, instagram=?, about=?, photo=? WHERE id=?')
    .run(String(name || req.user.name), whatsapp ?? req.user.whatsapp, instagram ?? req.user.instagram, about ?? req.user.about, photo ?? req.user.photo, req.user.id)
  res.json({ ok: true })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Erro interno' })
})

app.listen(PORT, () => console.log(`API em http://localhost:${PORT}`))