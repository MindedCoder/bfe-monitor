const ALERT_COOLDOWN = 60000; // same alert at least 60s apart
const REPEAT_INTERVAL = 5 * 60 * 1000; // repeat ongoing alerts every 5 minutes
const lastAlerts = new Map(); // key → timestamp
const ongoingAlerts = new Map(); // name → { since, lastRepeat }

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

function buildCard(title, color, lines, baseUrl, basePath) {
  const dashboardUrl = `${baseUrl}${basePath}/`;
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
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '查看面板' },
          url: dashboardUrl,
          type: 'primary',
        }],
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
  const baseUrl = config.baseUrl || 'https://claw.bfelab.com';
  const basePath = config.basePath || '/bfe-monitor';
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
          ], baseUrl, basePath);
          sendWebhook(webhookUrl, card);
        }
      }

      // check ping (supports array format from /api/ping/trigger)
      if (data.ping && !data.ping.error) {
        const pingItems = Array.isArray(data.ping)
          ? data.ping.map(item => [item.name || '?', { ok: item.ok, error: item.error, status: item.status }])
          : Object.entries(data.ping).filter(([k]) => k !== 'error').map(([k, v]) => [k, v?.last]);
        for (const [target, info] of pingItems) {
          if (info && !info.ok && prev[`ping:${target}`] !== false) {
            alerts.push({ type: 'warn', msg: `${target} Ping 失败: ${info.error || 'HTTP ' + info.status}` });
          }
          if (info) prev[`ping:${target}`] = info.ok;
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

      // send alerts for state changes
      if (alerts.length > 0) {
        const key = `${name}:${alerts.map(a => a.msg).join(',')}`;
        if (shouldAlert(key)) {
          const color = alerts.some(a => a.type === 'error') ? 'red' : 'orange';
          const lines = [`**${label}** (${name})`, ...alerts.map(a => `${a.type === 'error' ? '🔴' : '🟡'} ${a.msg}`)];
          const card = buildCard(`${label} 告警`, color, lines, baseUrl, basePath);
          sendWebhook(webhookUrl, card);
        }
      }

      // repeat alerts for ongoing issues every 5 minutes
      const hasOngoingIssue = healthStatus === 'down' || !!data.error;
      if (hasOngoingIssue) {
        const ongoing = ongoingAlerts.get(name);
        const now = Date.now();
        if (!ongoing) {
          ongoingAlerts.set(name, { since: now, lastRepeat: now });
        } else if (now - ongoing.lastRepeat >= REPEAT_INTERVAL) {
          ongoing.lastRepeat = now;
          const durationMin = Math.round((now - ongoing.since) / 60000);
          const lines = [`**${label}** (${name})`];
          if (healthStatus === 'down') {
            lines.push(`🔴 OpenClaw 持续宕机中 (已持续 ${durationMin} 分钟, 连续失败 ${data.health?.consecutiveFails || '?'} 次)`);
          }
          if (data.error) {
            lines.push(`🔴 持续连接失败: ${data.error} (已持续 ${durationMin} 分钟)`);
          }
          const card = buildCard(`${label} 持续告警`, 'red', lines, baseUrl, basePath);
          sendWebhook(webhookUrl, card);
        }
      } else {
        ongoingAlerts.delete(name);
      }

      prev.health = healthStatus;
      prevStatus.set(name, prev);
    }
  }

  return { check };
}
