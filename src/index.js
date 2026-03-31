import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, renderInner } from './dashboard.js';
import { createPoller } from './poller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// load config
const confPath = process.env.CONFIG_PATH || resolve(ROOT, 'config.json');
const config = JSON.parse(readFileSync(confPath, 'utf-8'));

const port = config.port || 3000;
const basePath = config.basePath || '/bfe-monitor';

// instance list (mutable, can be added via API)
const instances = new Set(config.instances || []);

// polling state: { instanceName: { ping, health, codex, lastPoll, error } }
const state = new Map();

// init poller
const poller = createPoller(config, instances, state);
poller.start();

// http server
const server = http.createServer(async (req, res) => {
  let path = req.url.split('?')[0];

  // strip basePath
  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // routes
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderPage(basePath, instances, state));
  }

  if (req.method === 'GET' && path === '/api/html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderInner(instances, state));
  }

  if (req.method === 'GET' && path === '/api/status') {
    const data = {};
    for (const [name, s] of state) data[name] = s;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ instances: [...instances], data }));
  }

  if (req.method === 'GET' && path === '/api/instances') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([...instances]));
  }

  if (req.method === 'POST' && path === '/api/instances') {
    const body = await readBody(req);
    if (!body?.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'name required' }));
    }
    instances.add(body.name);
    state.set(body.name, { ping: null, health: null, codex: null, lastPoll: null, error: null });
    console.log(`[bfe-monitor] instance added: ${body.name}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, instances: [...instances] }));
  }

  if (req.method === 'DELETE' && path.startsWith('/api/instances/')) {
    const name = decodeURIComponent(path.slice('/api/instances/'.length));
    instances.delete(name);
    state.delete(name);
    console.log(`[bfe-monitor] instance removed: ${name}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, instances: [...instances] }));
  }

  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200);
    return res.end('ok');
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`[bfe-monitor] listening on :${port}, basePath=${basePath}`);
  console.log(`[bfe-monitor] monitoring ${instances.size} instances: ${[...instances].join(', ')}`);
});

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
