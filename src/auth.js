import { randomBytes, randomInt, createHmac } from 'node:crypto';
import { getDb } from './db.js';

// ─── Session Store ───────────────────────────────────────────

export class SessionStore {
  #ttl;

  constructor(ttlMs = 7 * 24 * 3600 * 1000) {
    this.#ttl = ttlMs;
  }

  get #col() {
    return getDb().collection('sessions');
  }

  async create(userData) {
    const id = randomBytes(24).toString('hex');
    const now = new Date();
    await this.#col.insertOne({
      _id: id,
      phone: userData.phone || null,
      tenant: '__admin__',
      user: userData,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.#ttl),
    });
    return id;
  }

  async get(id) {
    const doc = await this.#col.findOne({ _id: id, tenant: '__admin__' });
    if (!doc) return null;
    if (new Date() > doc.expiresAt) {
      await this.#col.deleteOne({ _id: id });
      return null;
    }
    return doc.user;
  }

  async destroy(id) {
    await this.#col.deleteOne({ _id: id });
  }
}

// ─── Cookie helpers ──────────────────────────────────────────

const COOKIE_NAME = 'bfe_admin_session';

export function parseCookies(req) {
  const map = {};
  for (const pair of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) map[k] = decodeURIComponent(v.join('='));
  }
  return map;
}

export function getSessionId(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

export function setSessionCookie(res, sid, ttlMs) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

// ─── Admin check ─────────────────────────────────────────────

export async function isAdmin(phone) {
  const doc = await getDb().collection('admins').findOne({ phone });
  return !!doc;
}

// ─── SMS: send verification code via Aliyun ──────────────────

function encodeRFC3986(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

async function sendSms(phone, code, smsConfig) {
  const { accessKeyId, accessKeySecret, signName, templateCode } = smsConfig;
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: Math.random().toString(36).slice(2),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const sorted = Object.keys(params).sort();
  const canonicalized = sorted
    .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(params[k])}`)
    .join('&');
  const stringToSign = `GET&${encodeRFC3986('/')}&${encodeRFC3986(canonicalized)}`;
  const signature = createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64');
  params.Signature = signature;

  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = await fetch(`https://dysmsapi.aliyuncs.com/?${qs}`);
  const data = await res.json();
  if (data.Code !== 'OK') {
    console.error('[sms] send failed:', data);
    throw new Error(data.Message || 'SMS send failed');
  }
  return data;
}

// ─── Send code ───────────────────────────────────────────────

export async function sendCode(phone, smsConfig) {
  const db = getDb();

  // user must exist
  const user = await db.collection('users').findOne({ phone });
  if (!user) return { ok: false, status: 403, message: '用户不存在' };

  // must be admin
  const admin = await db.collection('admins').findOne({ phone });
  if (!admin) return { ok: false, status: 403, message: '您没有管理员权限' };

  // rate limit: 60s
  const recent = await db.collection('codes').findOne({
    phone,
    tenant: '__admin__',
    createdAt: { $gt: new Date(Date.now() - 60_000) },
  });
  if (recent) return { ok: false, status: 429, message: '请60秒后再试' };

  const code = String(randomInt(100000, 999999));
  const now = new Date();

  await db.collection('codes').deleteMany({ phone, tenant: '__admin__' });
  await db.collection('codes').insertOne({
    _id: randomBytes(12).toString('hex'),
    phone,
    tenant: '__admin__',
    code,
    attempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
  });

  await sendSms(phone, code, smsConfig);
  return { ok: true, message: '验证码已发送' };
}

// ─── Verify login ────────────────────────────────────────────

export async function verifyLogin({ phone, code, password, loginType }) {
  if (!phone) return null;
  const db = getDb();

  // password login
  if (loginType === 'password' || (!code && password)) {
    if (!password) return { error: '请输入密码' };
    const user = await db.collection('users').findOne({ phone });
    if (!user) return { error: '用户不存在' };
    if (!user.password) return { error: '该用户未设置密码' };
    if (user.password !== password) return { error: '密码错误' };
    const admin = await db.collection('admins').findOne({ phone });
    if (!admin) return { error: '您没有管理员权限' };
    return { name: user.name, phone: user.phone, role: admin.role || 'admin' };
  }

  // sms code login
  if (!code) return { error: '请输入验证码' };

  const doc = await db.collection('codes').findOne({ phone, tenant: '__admin__' });
  if (!doc) return { error: '验证码不存在或已过期' };
  if (doc.attempts >= 5) return { error: '错误次数过多，请重新获取验证码' };

  if (doc.code !== code) {
    await db.collection('codes').updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    return { error: '验证码错误' };
  }

  if (new Date() > doc.expiresAt) return { error: '验证码已过期' };

  await db.collection('codes').deleteOne({ _id: doc._id });

  const user = await db.collection('users').findOne({ phone });
  if (!user) return { error: '用户不存在' };
  const admin = await db.collection('admins').findOne({ phone });
  if (!admin) return { error: '您没有管理员权限' };

  return { name: user.name, phone: user.phone, role: admin.role || 'admin' };
}
