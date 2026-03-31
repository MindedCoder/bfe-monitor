import { createNotifier } from './notifier.js';

export function createPoller(config, instances, state) {
  const baseUrl = config.baseUrl || 'https://claw.bfelab.com';
  const interval = config.pollIntervalMs || 5000;
  const codexInterval = config.codexPollIntervalMs || 300000; // 5 min
  const timeout = config.timeoutMs || 10000;
  const notifier = createNotifier(config);
  let timer = null;
  let codexTimer = null;

  async function fetchJson(url) {
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

  async function pollInstance(name) {
    const apiBase = `${baseUrl}/${name}/api`;

    const [ping, health] = await Promise.all([
      fetchJson(`${apiBase}/ping/trigger`),
      fetchJson(`${apiBase}/health/check`),
    ]);

    const prev = state.get(name) || {};
    state.set(name, {
      ping,
      health,
      codex: prev.codex || null,
      lastPoll: Date.now(),
      error: null,
    });
  }

  async function pollCodexInstance(name) {
    const apiBase = `${baseUrl}/${name}/api`;
    const codex = await fetchJson(`${apiBase}/codex-usage/refresh`);

    const prev = state.get(name) || {};
    state.set(name, { ...prev, codex, lastPoll: Date.now() });
  }

  async function pollAll() {
    const tasks = [...instances.keys()].map(name =>
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
    notifier.check(instances, state);
  }

  async function pollAllCodex() {
    const tasks = [...instances.keys()].map(name =>
      pollCodexInstance(name).catch(() => {})
    );
    await Promise.all(tasks);
    notifier.check(instances, state);
  }

  function start() {
    for (const name of instances.keys()) {
      if (!state.has(name)) {
        state.set(name, { ping: null, health: null, codex: null, lastPoll: null, error: null });
      }
    }
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
