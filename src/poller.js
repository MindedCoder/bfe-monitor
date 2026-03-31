export function createPoller(config, instances, state) {
  const baseUrl = config.baseUrl || 'https://claw.bfelab.com';
  const interval = config.pollIntervalMs || 5000;
  const timeout = config.timeoutMs || 10000;
  let timer = null;

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

    const [ping, health, codex] = await Promise.all([
      fetchJson(`${apiBase}/ping`),
      fetchJson(`${apiBase}/health`),
      fetchJson(`${apiBase}/codex-usage`),
    ]);

    state.set(name, {
      ping,
      health,
      codex,
      lastPoll: Date.now(),
      error: null,
    });
  }

  async function pollAll() {
    const tasks = [...instances.keys()].map(name =>
      pollInstance(name).catch(err => {
        state.set(name, {
          ping: null, health: null, codex: null,
          lastPoll: Date.now(),
          error: err.message,
        });
      })
    );
    await Promise.all(tasks);
  }

  function start() {
    // init state
    for (const name of instances.keys()) {
      if (!state.has(name)) {
        state.set(name, { ping: null, health: null, codex: null, lastPoll: null, error: null });
      }
    }
    pollAll();
    timer = setInterval(pollAll, interval);
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { start, stop, pollAll };
}
