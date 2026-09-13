import express from 'express'
import './env.js'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { fileURLToPath } from 'node:url'
import { supabase } from './supabase.js'
import { generatePosts, PLATFORMS } from './templates.js'
import { publish } from './publisher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao'
const PORT = process.env.PORT || 3001

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

if (!supabase) {
  console.error('[startup] Supabase NÃO configurado — defina SUPABASE_URL e SUPABASE_KEY no ambiente/.env')
  process.exit(1)
}

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOAD_DIR))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`)
})
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } })

const auth = (roles) => async (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Não autenticado' })
  let payload
  try { payload = jwt.verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Sessão expirada' }) }
  const { data: user } = await supabase.from('users').select('*').eq('id', payload.id).maybeSingle()
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' })
  if (roles && !roles.includes(user.role)) return res.status(403).json({ error: 'Sem permissão' })
  req.user = user
  next()
}

const publicUser = (u) => u && ({ id: u.id, name: u.name, whatsapp: u.whatsapp, about: u.about, photo: u.photo, instagram: u.instagram })
const mediaArr = (m) => Array.isArray(m) ? m : []
const publicBroker = () =>
  supabase.from('users').select('*').eq('role', 'broker').eq('active', true).order('id', { ascending: true }).limit(1).maybeSingle()

const findOwned = async (table, id, user) => {
  let q = supabase.from(table).select('*').eq('id', id)
  if (user.role !== 'admin' && table !== 'leads') q = q.eq('user_id', user.id)
  if (table === 'leads' && user.role !== 'admin') q = q.eq('broker_id', user.id)
  const { data } = await q.maybeSingle()
  return data
}

// ---- Auth ----
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase()
  const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle()
  if (!user || !bcrypt.compareSync(String(req.body?.password || ''), user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha inválidos' })
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: publicUser(user) })
})

app.get('/api/auth/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }))

// ---- Público (landing) ----
app.get('/api/public', async (req, res) => {
  const { data: broker } = await publicBroker()
  if (!broker) return res.json({ broker: null, developments: [] })
  const { data: devs } = await supabase.from('developments')
    .select('*').eq('published', true).order('featured', { ascending: false }).order('id', { ascending: false })
  res.json({ broker: publicUser(broker), developments: (devs || []).map(d => ({ ...d, media: mediaArr(d.media) })) })
})

app.post('/api/leads', async (req, res) => {
  const { name, phone, whatsapp, email, message, development_id } = req.body || {}
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' })
  const { data: broker } = await publicBroker()
  if (!broker) return res.status(500).json({ error: 'Sem corretor configurado' })
  const { data, error } = await supabase.from('leads').insert({
    broker_id: broker.id,
    development_id: development_id || null,
    name: String(name).trim(),
    phone: String(phone).trim(),
    whatsapp: whatsapp || null,
    email: email || null,
    message: message || null
  }).select('id').single()
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true, id: data.id })
})

// ---- Público: detalhe ----
app.get('/api/developments/:id', async (req, res) => {
  const { data: d } = await supabase.from('developments').select('*').eq('id', req.params.id).eq('published', true).maybeSingle()
  if (!d) return res.status(404).json({ error: 'Não encontrado' })
  res.json({ ...d, media: mediaArr(d.media) })
})

// ---- Upload (auth) ----
app.post('/api/upload', auth(), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' })
  const ext = path.extname(req.file.filename).toLowerCase()
  res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`, type: ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'image' })
})

// ---- Admin/Corretor: developments ----
app.get('/api/admin/developments', auth(), async (req, res) => {
  let q = supabase.from('developments').select('*').order('id', { ascending: false })
  if (req.user.role !== 'admin') q = q.eq('user_id', req.user.id)
  const { data } = await q
  res.json({ developments: (data || []).map(d => ({ ...d, media: mediaArr(d.media) })) })
})

app.post('/api/admin/developments', auth(), async (req, res) => {
  const { title, subtitle, description, price, location, status, type, media, featured, published } = req.body || {}
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' })
  const { data, error } = await supabase.from('developments').insert({
    user_id: req.user.id,
    title: String(title),
    subtitle: subtitle || null,
    description: description || null,
    price: price || null,
    location: location || null,
    status: status || 'disponivel',
    type: type || 'apartamento',
    media: media || [],
    featured: !!featured,
    published: published === undefined ? true : !!published
  }).select('id').single()
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true, id: data.id })
})

app.put('/api/admin/developments/:id', auth(), async (req, res) => {
  const dev = await findOwned('developments', req.params.id, req.user)
  if (!dev) return res.status(403).json({ error: 'Sem permissão' })
  const { title, subtitle, description, price, location, status, type, media, featured, published } = req.body || {}
  const { error } = await supabase.from('developments').update({
    title: String(title || dev.title),
    subtitle: subtitle ?? dev.subtitle,
    description: description ?? dev.description,
    price: price ?? dev.price,
    location: location ?? dev.location,
    status: status || dev.status,
    type: type || dev.type,
    media: Array.isArray(media) ? media : dev.media,
    featured: featured !== undefined ? !!featured : dev.featured,
    published: published !== undefined ? !!published : dev.published
  }).eq('id', dev.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

app.delete('/api/admin/developments/:id', auth(), async (req, res) => {
  const dev = await findOwned('developments', req.params.id, req.user)
  if (!dev) return res.status(403).json({ error: 'Sem permissão' })
  await supabase.from('developments').delete().eq('id', dev.id)
  res.json({ ok: true })
})

// ---- Leads ----
app.get('/api/admin/leads', auth(), async (req, res) => {
  const base = '*, developments(title)'
  let q = supabase.from('leads').select(base).order('id', { ascending: false })
  if (req.user.role !== 'admin') q = q.eq('broker_id', req.user.id)
  const { data } = await q
  res.json({
    leads: (data || []).map(({ developments, ...l }) => ({
      ...l, development_title: developments?.title ?? null, development_id: l.development_id
    }))
  })
})

app.patch('/api/admin/leads/:id/status', auth(), async (req, res) => {
  const lead = await findOwned('leads', req.params.id, req.user)
  if (!lead) return res.status(403).json({ error: 'Lead não encontrado' })
  const statuses = ['novo', 'contatado', 'interessado', 'convertido', 'descartado']
  const status = statuses.includes(req.body?.status) ? req.body.status : lead.status
  await supabase.from('leads').update({ status }).eq('id', lead.id)
  res.json({ ok: true })
})

// ---- Perfil do usuário logado ----
app.patch('/api/profile', auth(), async (req, res) => {
  const { name, whatsapp, instagram, tiktok, linkedin, facebook, about, photo } = req.body || {}
  const patch = {}
  if (name) patch.name = String(name)
  if (whatsapp !== undefined) patch.whatsapp = whatsapp
  if (instagram !== undefined) patch.instagram = instagram
  if (tiktok !== undefined) patch.tiktok = tiktok
  if (linkedin !== undefined) patch.linkedin = linkedin
  if (facebook !== undefined) patch.facebook = facebook
  if (about !== undefined) patch.about = about
  if (photo !== undefined) patch.photo = photo
  await supabase.from('users').update(patch).eq('id', req.user.id)
  res.json({ ok: true })
})

// ---- Posts agendados (geração automática) ----
app.get('/api/posts', auth(), async (req, res) => {
  let q = supabase.from('posts').select('*, developments(title)').order('scheduled_at', { ascending: false })
  if (req.user.role !== 'admin') q = q.eq('user_id', req.user.id)
  const { data } = await q
  res.json({
    posts: (data || []).map(({ developments, ...p }) => ({
      ...p, media: mediaArr(p.media), development_title: developments?.title ?? null
    }))
  })
})

app.post('/api/posts', auth(), async (req, res) => {
  const { development_id, platform, scheduled_at } = req.body || {}
  if (!scheduled_at) return res.status(400).json({ error: 'Defina a data/hora do agendamento' })
  const due = new Date(scheduled_at)
  if (isNaN(due)) return res.status(400).json({ error: 'Data inválida' })

  let dev = null
  if (development_id) {
    dev = await findOwned('developments', development_id, req.user)
    if (!dev) return res.status(403).json({ error: 'Empreendimento não encontrado' })
  }
  const generated = generatePosts(dev ? { ...dev, media: mediaArr(dev.media) } : null, req.user)
  const targets = platform === 'all' ? PLATFORMS : [platform]
  if (!targets?.every(p => PLATFORMS.includes(p))) return res.status(400).json({ error: 'Plataforma inválida' })

  const iso = due.toISOString()
  const rows = targets.map(p => ({
    user_id: req.user.id,
    development_id: development_id || null,
    platform: p,
    content: generated[p].content,
    media: generated[p].media,
    scheduled_at: iso
  }))
  const { data, error } = await supabase.from('posts').insert(rows).select('id')
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true, ids: data.map(r => r.id), next_publish: iso })
})

app.delete('/api/posts/:id', auth(), async (req, res) => {
  const post = await findOwned('posts', req.params.id, req.user)
  if (!post) return res.status(403).json({ error: 'Post não encontrado' })
  await supabase.from('posts').delete().eq('id', post.id)
  res.json({ ok: true })
})

app.patch('/api/posts/:id', auth(), async (req, res) => {
  const post = await findOwned('posts', req.params.id, req.user)
  if (!post) return res.status(403).json({ error: 'Post não encontrado' })
  const { scheduled_at } = req.body || {}
  if (scheduled_at) {
    const due = new Date(scheduled_at)
    if (isNaN(due)) return res.status(400).json({ error: 'Data inválida' })
    await supabase.from('posts').update({ scheduled_at: due.toISOString() }).eq('id', post.id)
  }
  res.json({ ok: true })
})

// Processador: publica posts vencidos (a cada 60s)
const checkDuePosts = async () => {
  const now = new Date().toISOString()
  const { data: due } = await supabase.from('posts').select('*').eq('status', 'agendado').lte('scheduled_at', now)
  for (const post of due || []) {
    try {
      await publish(post)
      await supabase.from('posts').update({ status: 'publicado', published_at: new Date().toISOString() }).eq('id', post.id)
    } catch (e) { console.error('[publish error]', e.message) }
  }
}
setInterval(checkDuePosts, 60_000)

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Erro interno' })
})

app.listen(PORT, () => console.log(`API (Supabase) em http://localhost:${PORT}`))