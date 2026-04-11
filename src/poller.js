import { createNotifier } from './notifier.js';

export function createPoller(config, refreshInstances, instances, state, pausedInstances = new Set()) {
  const baseUrl = config.baseUrl || 'https://claw.bfelab.com';
  const interval = config.pollIntervalMs || 5000;
  const codexInterval = config.codexPollIntervalMs || 300000; // 5 min
  const timeout = config.timeoutMs || 10000;
  const notifier = createNotifier(config);
  let timer = null;
  let codexTimer = null;

  async function fetchJsonOnce(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return await res.json();
    } catch (err) {
      return { error: err.message };
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchJson(url) {
    const maxRetries = 2;
    let result = await fetchJsonOnce(url);
    for (let i = 0; i < maxRetries && result.error; i++) {
      console.log(`[poller] retry ${i + 1}/${maxRetries} for ${url} (${result.error})`);
      result = await fetchJsonOnce(url);
    }
    return result;
  }

  // fail-N-times-before-alert retry: each HTTP call counts as one attempt.
  // network errors and "HTTP 200 but content says failure" both count as failure.
  // only after RESULT_RETRY_MAX consecutive failures does the bad result get returned.
  const RESULT_RETRY_MAX = config.resultRetryMax || 3; // total attempts, including the first
  const RESULT_RETRY_DELAY_MS = config.resultRetryDelayMs || 2000;

  function pingHasFailure(ping) {
    if (!ping) return true;
    if (ping.error) return true;
    if (Array.isArray(ping)) return ping.some(item => !item.ok);
    for (const info of Object.values(ping)) {
      if (info?.last && !info.last.ok) return true;
    }
    return false;
  }

  function healthHasFailure(health) {
    if (!health) return true;
    if (health.error) return true;
    return health.status === 'down';
  }

  async function fetchWithResultRetry(url, isFailure, name, label) {
    // uses fetchJsonOnce directly (not fetchJson) so each HTTP call counts as
    // one attempt — network errors are not silently retried under the hood.
    let result = await fetchJsonOnce(url);
    for (let i = 1; i < RESULT_RETRY_MAX; i++) {
      if (!isFailure(result)) break;
      const reason = result?.error || (isFailure(result) ? 'content-failure' : 'unknown');
      console.log(`[poller] ${name} ${label} attempt ${i}/${RESULT_RETRY_MAX} failed (${reason}), retrying in ${RESULT_RETRY_DELAY_MS}ms`);
      await new Promise(r => setTimeout(r, RESULT_RETRY_DELAY_MS));
      result = await fetchJsonOnce(url);
    }
    return result;
  }

  async function pollInstance(name) {
    const apiBase = `${baseUrl}/${name}/api`;

    const [ping, health] = await Promise.all([
      fetchWithResultRetry(`${apiBase}/ping/trigger`, pingHasFailure, name, 'ping'),
      fetchWithResultRetry(`${apiBase}/health/check`, healthHasFailure, name, 'health'),
    ]);

    const prev = state.get(name) || {};
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    console.log(`[poller][${ts}] ${name} health: ${prev.health?.status ?? 'N/A'} → ${health?.status ?? health?.error ?? 'N/A'}`);
    console.log(`[poller][${ts}] ${name} ping: ${JSON.stringify(prev.ping?.error ?? summarizePing(prev.ping))} → ${JSON.stringify(ping?.error ?? summarizePing(ping))}`);
    if (prev.error || health?.error || ping?.error) {
      console.log(`[poller][${ts}] ${name} error: ${prev.error ?? 'none'} → ${health?.error || ping?.error || 'none'}`);
    }

    state.set(name, {
      ping,
      health,
      codex: prev.codex || null,
      lastPoll: Date.now(),
      error: null,
    });
  }

  function summarizePing(ping) {
    if (!ping || ping.error) return 'N/A';
    const result = {};
    // array format from /api/ping/trigger: [{name, ok, ms, error, status}, ...]
    if (Array.isArray(ping)) {
      for (const item of ping) {
        const name = item.name || '?';
        result[name] = item.ok ? `ok(${item.ms}ms)` : `fail(${item.error || 'HTTP ' + item.status})`;
      }
    } else {
      // object format from /api/ping: { target: { last: {...} }, ... }
      for (const [target, info] of Object.entries(ping)) {
        if (info?.last) result[target] = info.last.ok ? 'ok' : `fail(${info.last.error || 'HTTP ' + info.last.status})`;
      }
    }
    return Object.keys(result).length ? result : 'N/A';
  }

  async function pollCodexInstance(name) {
    const apiBase = `${baseUrl}/${name}/api`;
    const codex = await fetchJson(`${apiBase}/codex-usage/refresh`);

    const prev = state.get(name) || {};
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const prevPercent = prev.codex?.primary?.usedPercent;
    const curPercent = codex?.primary?.usedPercent;
    console.log(`[poller][${ts}] ${name} codex: ${prevPercent ?? 'N/A'}% → ${curPercent ?? codex?.error ?? 'N/A'}%`);

    state.set(name, { ...prev, codex, lastPoll: Date.now() });
  }

  function activeNames() {
    return [...instances.keys()].filter(name => !pausedInstances.has(name));
  }

  function activeInstancesMap() {
    // build a filtered Map (path → label) that excludes paused instances,
    // so notifier.check never alerts on machines the user has paused.
    const m = new Map();
    for (const [name, label] of instances) {
      if (!pausedInstances.has(name)) m.set(name, label);
    }
    return m;
  }

  async function pollAll() {
    try { await refreshInstances(); } catch (err) { console.error('[poller] refreshInstances failed:', err.message); }
    const tasks = activeNames().map(name =>
      pollInstance(name).catch(err => {
        const prev = state.get(name) || {};
        state.set(name, {
          ping: null, health: null, codex: prev.codex || null,
          lastPoll: Date.now(),
          error: err.message,
        });
      })
    );
    await Promise.all(tasks);
    notifier.check(activeInstancesMap(), state);
  }

  async function pollAllCodex() {
    try { await refreshInstances(); } catch (err) { console.error('[poller] refreshInstances failed:', err.message); }
    const tasks = activeNames().map(name =>
      pollCodexInstance(name).catch(() => {})
    );
    await Promise.all(tasks);
    notifier.check(activeInstancesMap(), state);
  }

  function start() {
    pollAll();
    pollAllCodex();
    timer = setInterval(pollAll, interval);
    codexTimer = setInterval(pollAllCodex, codexInterval);
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (codexTimer) clearInterval(codexTimer);
  }

  return { start, stop, pollAll };
}
