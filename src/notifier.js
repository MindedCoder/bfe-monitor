const ALERT_COOLDOWN = 60000; // same alert at least 60s apart
const lastAlerts = new Map(); // key → timestamp

function shouldAlert(key) {
  const last = lastAlerts.get(key) || 0;
  if (Date.now() - last < ALERT_COOLDOWN) return false;
  lastAlerts.set(key, Date.now());
  return true;
}

async function sendWebhook(webhookUrl, card) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
    });
    if (!res.ok) console.log(`[notifier] webhook failed: HTTP ${res.status}`);
  } catch (err) {
    console.log(`[notifier] webhook error: ${err.message}`);
  }
}

function buildCard(title, color, lines) {
  return {
    header: {
      title: { tag: 'plain_text', content: title },
      template: color,
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: lines.join('\n') },
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: `BFE Monitor · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` }],
      },
    ],
  };
}

export function createNotifier(config) {
  const webhookUrl = config.feishu?.webhookUrl;
  if (!webhookUrl) {
    return { check() {} };
  }

  // previous state for change detection
  const prevStatus = new Map();

  function check(instances, state) {
    for (const [name, label] of instances) {
      const data = state.get(name);
      if (!data || !data.lastPoll) continue;

      const prev = prevStatus.get(name) || {};
      const alerts = [];

      // check health
      const healthStatus = data.health?.status;
      if (healthStatus === 'down' && prev.health !== 'down') {
        alerts.push({ type: 'error', msg: `OpenClaw 宕机 (连续失败 ${data.health.consecutiveFails} 次)` });
      } else if (healthStatus === 'ok' && prev.health === 'down') {
        // recovery
        if (shouldAlert(`${name}:health:recover`)) {
          const card = buildCard(`${label} 已恢复`, 'green', [
            `**${label}** (${name})`,
            'OpenClaw 服务已恢复正常',
          ]);
          sendWebhook(webhookUrl, card);
        }
      }

      // check ping
      if (data.ping && !data.ping.error) {
        for (const [target, info] of Object.entries(data.ping)) {
          if (info?.last && !info.last.ok && prev[`ping:${target}`] !== false) {
            alerts.push({ type: 'warn', msg: `${target} Ping 失败: ${info.last.error || 'HTTP ' + info.last.status}` });
          }
          if (info?.last) prev[`ping:${target}`] = info.last.ok;
        }
      }

      // check codex
      if (data.codex && !data.codex.error) {
        if (data.codex.limitReached && !prev.codexLimit) {
          alerts.push({ type: 'error', msg: `Codex 已达配额上限 (${data.codex.plan || ''})` });
        }
        const primary = data.codex.primary?.usedPercent;
        if (primary !== undefined && primary > 80 && (prev.codexPrimary || 0) <= 80) {
          alerts.push({ type: 'warn', msg: `Codex 5h 窗口使用 ${Math.round(primary)}%` });
        }
        prev.codexLimit = data.codex.limitReached;
        prev.codexPrimary = primary;
      }

      // check connection error
      if (data.error && !prev.connError) {
        alerts.push({ type: 'error', msg: `连接失败: ${data.error}` });
      }
      prev.connError = !!data.error;

      // send alerts
      if (alerts.length > 0) {
        const key = `${name}:${alerts.map(a => a.msg).join(',')}`;
        if (shouldAlert(key)) {
          const color = alerts.some(a => a.type === 'error') ? 'red' : 'orange';
          const lines = [`**${label}** (${name})`, ...alerts.map(a => `${a.type === 'error' ? '🔴' : '🟡'} ${a.msg}`)];
          const card = buildCard(`${label} 告警`, color, lines);
          sendWebhook(webhookUrl, card);
        }
      }

      prev.health = healthStatus;
      prevStatus.set(name, prev);
    }
  }

  return { check };
}
