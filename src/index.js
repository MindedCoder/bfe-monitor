import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { renderPage, renderInner } from './dashboard.js';
import { createPoller } from './poller.js';
import { connectDb, getDb } from './db.js';
import { SessionStore, getSessionId, setSessionCookie, clearSessionCookie, sendCode, verifyLogin } from './auth.js';
import { renderLoginPage, renderAdminPage } from './admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// load config
const confPath = process.env.CONFIG_PATH || resolve(ROOT, 'config.json');
const config = JSON.parse(readFileSync(confPath, 'utf-8'));

// env overrides for secrets
if (process.env.MONGODB_URI) {
  config.mongodb = config.mongodb || {};
  config.mongodb.uri = process.env.MONGODB_URI;
}
if (process.env.SMS_ACCESS_KEY_ID) {
  config.sms = config.sms || {};
  config.sms.accessKeyId = process.env.SMS_ACCESS_KEY_ID;
}
if (process.env.SMS_ACCESS_KEY_SECRET) {
  config.sms = config.sms || {};
  config.sms.accessKeySecret = process.env.SMS_ACCESS_KEY_SECRET;
}

const port = config.port || 3000;
const basePath = config.basePath || '/bfe-monitor';
const sessionTtl = config.sessionTtlMs || 7 * 24 * 3600 * 1000;

// instance map: name → label (mutable)
const instances = new Map();
for (const item of config.instances || []) {
  if (typeof item === 'string') {
    instances.set(item, item);
  } else {
    instances.set(item.name, item.label || item.name);
  }
}

// polling state: { instanceName: { ping, health, codex, lastPoll, error } }
const state = new Map();

// init poller
const poller = createPoller(config, instances, state);
poller.start();

// connect MongoDB & init session store
let sessions;
let dbReady = false;
(async () => {
  try {
    await connectDb(config);
    sessions = new SessionStore(sessionTtl);
    dbReady = true;
    // load instances from DB; seed from config on first run
    const col = getDb().collection('instances');
    await col.createIndex({ path: 1 }, { unique: true });
    const docs = await col.find({}).toArray();
    if (docs.length === 0 && instances.size > 0) {
      await col.insertMany([...instances.entries()].map(([path, label]) => ({
        _id: randomBytes(12).toString('hex'),
        path,
        label,
      })));
      console.log(`[bfe-monitor] seeded ${instances.size} instances into DB`);
    } else {
      instances.clear();
      for (const d of docs) {
        instances.set(d.path, d.label || d.path);
        if (!state.has(d.path)) state.set(d.path, { ping: null, health: null, codex: null, lastPoll: null, error: null });
      }
      console.log(`[bfe-monitor] loaded ${docs.length} instances from DB`);
    }
    console.log('[bfe-monitor] admin module ready');
  } catch (err) {
    console.error('[bfe-monitor] MongoDB connection failed, admin module disabled:', err.message);
  }
})();

// ─── helpers ─────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function requireAuth(req, res) {
  if (!sessions) {
    sendJson(res, { error: '管理模块未就绪' }, 503);
    return null;
  }
  const sid = getSessionId(req);
  if (!sid) {
    sendJson(res, { error: '未登录' }, 401);
    return null;
  }
  const user = await sessions.get(sid);
  if (!user) {
    sendJson(res, { error: '会话已过期' }, 401);
    return null;
  }
  return user;
}

// ─── http server ─────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  let path = req.url.split('?')[0];
  const query = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;

  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ═══ Original monitoring routes ═══

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderPage(basePath, instances, state, config.baseUrl));
  }

  if (req.method === 'GET' && path === '/api/html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderInner(instances, state, config.baseUrl));
  }

  if (req.method === 'GET' && path === '/api/status') {
    const data = {};
    for (const [name, s] of state) data[name] = s;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ instances: [...instances.entries()].map(([n, l]) => ({ name: n, label: l })), data }));
  }

  if (req.method === 'GET' && path === '/api/instances') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([...instances.entries()].map(([n, l]) => ({ name: n, label: l }))));
  }

  if (req.method === 'POST' && path === '/api/instances') {
    const body = await readBody(req);
    if (!body?.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'name required' }));
    }
    const label = body.label || body.name;
    instances.set(body.name, label);
    state.set(body.name, { ping: null, health: null, codex: null, lastPoll: null, error: null });
    if (dbReady) {
      await getDb().collection('instances').updateOne(
        { path: body.name },
        { $set: { label }, $setOnInsert: { _id: randomBytes(12).toString('hex'), path: body.name } },
        { upsert: true },
      );
    }
    console.log(`[bfe-monitor] instance added: ${body.name} (${label})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'DELETE' && path.startsWith('/api/instances/')) {
    const name = decodeURIComponent(path.slice('/api/instances/'.length));
    instances.delete(name);
    state.delete(name);
    if (dbReady) {
      await getDb().collection('instances').deleteOne({ path: name });
    }
    console.log(`[bfe-monitor] instance removed: ${name}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200);
    return res.end('ok');
  }

  // ═══ Admin routes ═══

  // Login page
  if (req.method === 'GET' && path === '/admin/login') {
    return sendHtml(res, renderLoginPage(basePath));
  }

  // Admin dashboard (requires auth)
  if (req.method === 'GET' && path === '/admin') {
    if (!sessions) {
      res.writeHead(302, { Location: `${basePath}/admin/login` });
      return res.end();
    }
    const sid = getSessionId(req);
    const user = sid ? await sessions.get(sid) : null;
    if (!user) {
      res.writeHead(302, { Location: `${basePath}/admin/login` });
      return res.end();
    }
    return sendHtml(res, renderAdminPage(basePath, user));
  }

  // Send verification code
  if (req.method === 'POST' && path === '/admin/send-code') {
    const body = await readBody(req);
    if (!body?.phone) return sendJson(res, { message: '请输入手机号' }, 400);
    if (!config.sms) return sendJson(res, { message: '短信服务未配置' }, 500);
    try {
      const result = await sendCode(body.phone, config.sms);
      return sendJson(res, { message: result.message }, result.ok ? 200 : result.status);
    } catch (err) {
      console.error('[admin] send-code error:', err);
      return sendJson(res, { message: '发送失败' }, 500);
    }
  }

  // Login callback
  if (req.method === 'POST' && path === '/admin/callback') {
    const body = await readBody(req);
    if (!body) return sendJson(res, { message: '请求无效' }, 400);
    try {
      const result = await verifyLogin(body);
      if (result?.error) return sendJson(res, { message: result.error }, 403);
      if (!result?.phone) return sendJson(res, { message: '登录失败' }, 403);
      const sid = await sessions.create(result);
      setSessionCookie(res, sid, sessionTtl);
      return sendJson(res, { ok: true, user: { name: result.name, role: result.role } });
    } catch (err) {
      console.error('[admin] callback error:', err);
      return sendJson(res, { message: '登录失败' }, 500);
    }
  }

  // Logout
  if (req.method === 'POST' && path === '/admin/logout') {
    const sid = getSessionId(req);
    if (sid && sessions) await sessions.destroy(sid);
    clearSessionCookie(res);
    return sendJson(res, { ok: true });
  }

  // ─── User CRUD API ──────────────────────────────────────

  // List users
  if (req.method === 'GET' && path === '/admin/api/users') {
    const user = await requireAuth(req, res);
    if (!user) return;

    const db = getDb();
    const q = query.get('q') || '';
    const page = Math.max(1, parseInt(query.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.get('limit')) || 20));
    const skip = (page - 1) * limit;

    const filter = q
      ? { $or: [{ phone: { $regex: q, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }] }
      : {};

    const [users, total] = await Promise.all([
      db.collection('users').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('users').countDocuments(filter),
    ]);

    // enrich with admin info
    const adminPhones = await db.collection('admins').find({}).toArray();
    const adminMap = new Map(adminPhones.map(a => [a.phone, a.role || 'admin']));

    for (const u of users) {
      u._isAdmin = adminMap.has(u.phone);
      u._adminRole = adminMap.get(u.phone) || null;
    }

    return sendJson(res, { users, total, page, limit });
  }

  // Get single user
  if (req.method === 'GET' && path.startsWith('/admin/api/users/')) {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = path.slice('/admin/api/users/'.length);
    let doc;
    try {
      doc = await getDb().collection('users').findOne({ _id: id });
    } catch {
      return sendJson(res, { error: '无效ID' }, 400);
    }
    if (!doc) return sendJson(res, { error: '用户不存在' }, 404);
    return sendJson(res, doc);
  }

  // Create user
  if (req.method === 'POST' && path === '/admin/api/users') {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readBody(req);
    if (!body?.name || !body?.phone) return sendJson(res, { error: '姓名和手机号必填' }, 400);

    const db = getDb();
    const existing = await db.collection('users').findOne({ phone: body.phone });
    if (existing) return sendJson(res, { error: '该手机号已存在' }, 409);

    const now = new Date();
    const id = randomBytes(12).toString('hex');
    const doc = {
      _id: id,
      phone: body.phone,
      name: body.name,
      tenants: body.tenants || [],
      createdAt: now,
      updatedAt: now,
    };
    if (body.password) doc.password = await bcrypt.hash(body.password, 10);

    await db.collection('users').insertOne(doc);
    return sendJson(res, { ok: true, _id: id });
  }

  // Update user
  if (req.method === 'PUT' && path.startsWith('/admin/api/users/')) {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = path.slice('/admin/api/users/'.length);
    const body = await readBody(req);
    if (!body) return sendJson(res, { error: '请求无效' }, 400);

    const update = { updatedAt: new Date() };
    if (body.name !== undefined) update.name = body.name;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.tenants !== undefined) update.tenants = body.tenants;
    if (body.password !== undefined) {
      update.password = body.password ? await bcrypt.hash(body.password, 10) : null;
    }

    try {
      await getDb().collection('users').updateOne(
        { _id: id },
        { $set: update },
      );
    } catch {
      return sendJson(res, { error: '无效ID' }, 400);
    }
    return sendJson(res, { ok: true });
  }

  // Delete user
  if (req.method === 'DELETE' && path.startsWith('/admin/api/users/')) {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = path.slice('/admin/api/users/'.length);
    try {
      const doc = await getDb().collection('users').findOne({ _id: id });
      if (doc) {
        await getDb().collection('users').deleteOne({ _id: id });
        // also remove admin record if exists
        await getDb().collection('admins').deleteOne({ phone: doc.phone });
      }
    } catch {
      return sendJson(res, { error: '无效ID' }, 400);
    }
    return sendJson(res, { ok: true });
  }

  // ─── Admin management API ──────────────────────────────

  // List admins
  if (req.method === 'GET' && path === '/admin/api/admins') {
    const user = await requireAuth(req, res);
    if (!user) return;

    const db = getDb();
    const q = query.get('q') || '';
    const filter = q ? { phone: { $regex: q, $options: 'i' } } : {};
    const admins = await db.collection('admins').find(filter).sort({ createdAt: -1 }).toArray();

    // enrich with user name
    const phones = admins.map(a => a.phone);
    const users = await db.collection('users').find({ phone: { $in: phones } }).toArray();
    const nameMap = new Map(users.map(u => [u.phone, u.name]));
    for (const a of admins) {
      a.userName = nameMap.get(a.phone) || null;
    }

    return sendJson(res, { admins });
  }

  // Add admin
  if (req.method === 'POST' && path === '/admin/api/admins') {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = await readBody(req);
    if (!body?.phone) return sendJson(res, { error: '手机号必填' }, 400);

    const db = getDb();
    // user must exist
    const userDoc = await db.collection('users').findOne({ phone: body.phone });
    if (!userDoc) return sendJson(res, { error: '该用户不存在，请先创建用户' }, 404);

    const existing = await db.collection('admins').findOne({ phone: body.phone });
    if (existing) return sendJson(res, { error: '该用户已是管理员' }, 409);

    await db.collection('admins').insertOne({
      _id: randomBytes(12).toString('hex'),
      phone: body.phone,
      role: body.role || 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return sendJson(res, { ok: true });
  }

  // Remove admin
  if (req.method === 'DELETE' && path.startsWith('/admin/api/admins/')) {
    const user = await requireAuth(req, res);
    if (!user) return;

    const phone = decodeURIComponent(path.slice('/admin/api/admins/'.length));
    await getDb().collection('admins').deleteOne({ phone });
    return sendJson(res, { ok: true });
  }

  // ─── 404 ────────────────────────────────────────────────

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`[bfe-monitor] listening on :${port}, basePath=${basePath}`);
  console.log(`[bfe-monitor] monitoring ${instances.size} instances: ${[...instances.entries()].map(([n, l]) => `${n}(${l})`).join(', ')}`);
});
