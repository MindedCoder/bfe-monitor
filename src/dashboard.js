function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return `${Math.floor(diff / 3600000)}小时前`;
}

function renderPingCard(ping) {
  if (!ping || ping.error) return '<div class="metric error">Ping: 不可用</div>';

  // /api/ping/trigger returns array: [{name, ok, ms, ...}, ...]
  if (Array.isArray(ping)) {
    if (ping.length === 0) return '<div class="metric unknown">Ping: 未检测</div>';
    return ping.map(item => {
      const cls = item.ok ? 'ok' : 'fail';
      const val = item.ok ? `${item.ms}ms` : (item.error || `HTTP ${item.status}`);
      return `<div class="metric ${cls}">${esc(item.name || '?')}: ${val}</div>`;
    }).join('');
  }

  // /api/ping returns object: { Google: { last: {...}, historyCount }, ... }
  const targets = Object.entries(ping).filter(([k]) => k !== 'error');
  if (targets.length === 0) return '<div class="metric unknown">Ping: 未检测</div>';
  return targets.map(([name, data]) => {
    if (!data?.last) return `<div class="metric unknown">${esc(name)}: 未检测</div>`;
    const cls = data.last.ok ? 'ok' : 'fail';
    const val = data.last.ok ? `${data.last.ms}ms` : (data.last.error || `HTTP ${data.last.status}`);
    return `<div class="metric ${cls}">${esc(name)}: ${val}</div>`;
  }).join('');
}

function renderHealthCard(health) {
  if (!health || health.error) return '<div class="metric error">OpenClaw: 不可用</div>';
  const statusMap = { ok: '正常', down: '宕机', degraded: '异常', unknown: '未知' };
  const cls = health.status === 'ok' ? 'ok' : health.status === 'down' ? 'fail' : 'warn';
  return `<div class="metric ${cls}">OpenClaw: ${statusMap[health.status] || health.status}</div>`;
}

function renderCodexCard(codex) {
  if (!codex || codex.error) return `<div class="metric error">Codex: ${codex?.error ? esc(codex.error) : '不可用'}</div>`;
  if (!codex.primary && !codex.secondary) return '<div class="metric unknown">Codex: 未获取</div>';

  const rows = [];
  if (codex.primary) {
    const pct = Math.round(codex.primary.usedPercent);
    rows.push(`<div class="metric ${pct > 80 ? 'warn' : 'ok'}">5h: ${pct}%<div class="bar"><div class="fill ${pct > 80 ? 'warn' : ''}" style="width:${pct}%"></div></div></div>`);
  }
  if (codex.secondary) {
    const pct = Math.round(codex.secondary.usedPercent);
    rows.push(`<div class="metric ${pct > 80 ? 'warn' : 'ok'}">周: ${pct}%<div class="bar"><div class="fill ${pct > 80 ? 'warn' : ''}" style="width:${pct}%"></div></div></div>`);
  }
  if (codex.limitReached) rows.push('<div class="metric fail">已达配额上限</div>');
  if (codex.plan) rows.push(`<div class="metric-sub">${esc(codex.plan)}</div>`);
  return rows.join('');
}

function renderInstancePanel(name, label, data, baseUrl, paused) {
  const errorCls = data?.error && !paused ? ' panel-error' : '';
  const pausedCls = paused ? ' panel-paused' : '';
  const pollTime = paused ? '已暂停' : timeAgo(data?.lastPoll);
  const monitorUrl = `${baseUrl}/${name}/`;
  const btnText = paused ? '开启通知' : '暂停通知';
  const btnCls = paused ? 'btn-pause btn-resume' : 'btn-pause';

  return `
    <div class="panel${errorCls}${pausedCls}">
      <div class="panel-header">
        <a href="${monitorUrl}" target="_blank" class="panel-link">${esc(label)}${label !== name ? ` <span style="font-size:11px;color:#8b949e;font-weight:400">${esc(name)}</span>` : ''}</a>
        <span class="poll-time">${pollTime}</span>
      </div>
      ${paused
        ? `<div class="metric unknown">⏸ 已暂停监控与通知</div>`
        : data?.error
        ? `<div class="metric error">${esc(data.error)}</div>`
        : `<div class="metrics">
            ${renderPingCard(data?.ping)}
            ${renderHealthCard(data?.health)}
            ${renderCodexCard(data?.codex)}
          </div>`
      }
      <div class="panel-actions">
        <button class="${btnCls}" data-name="${esc(name)}" data-paused="${paused ? '1' : '0'}" onclick="togglePause(this)">${btnText}</button>
      </div>
    </div>`;
}

export function renderInner(instances, state, baseUrl, pausedInstances = new Set()) {
  return [...instances.entries()].map(([name, label]) =>
    renderInstancePanel(name, label, state.get(name), baseUrl, pausedInstances.has(name))
  ).join('');
}

export function renderPage(basePath, instances, state, baseUrl, pausedInstances = new Set()) {
  const inner = renderInner(instances, state, baseUrl, pausedInstances);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BFE Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px}
.topbar{padding:16px 20px;background:#161b22;border-bottom:1px solid #30363d}
.topbar-row{display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:18px;color:#58a6ff}
.topbar-right{display:flex;gap:8px;align-items:center}
.instance-count{font-size:12px;color:#8b949e}
.topbar-desc{font-size:12px;color:#8b949e;margin-top:6px;line-height:1.5}
.btn{border:1px solid #30363d;background:#21262d;color:#c9d1d9;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;text-decoration:none}
.btn:hover{background:#30363d}
.grid{padding:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:1200px;margin:0 auto}
.panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.panel-error{border-color:#f85149}
.panel-paused{opacity:0.65;border-style:dashed}
.panel-actions{margin-top:12px;display:flex;justify-content:flex-end}
.btn-pause{border:1px solid #30363d;background:#21262d;color:#c9d1d9;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px}
.btn-pause:hover{background:#30363d}
.btn-pause.btn-resume{border-color:#3fb950;color:#3fb950}
.btn-pause:disabled{opacity:0.5;cursor:wait}
.panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.panel-header h3{font-size:15px;color:#c9d1d9}
.panel-link{font-size:15px;color:#58a6ff;text-decoration:none;font-weight:600}
.panel-link:hover{text-decoration:underline}
.poll-time{font-size:11px;color:#484f58}
.metrics{display:flex;flex-direction:column;gap:6px}
.metric{font-size:13px;padding:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.metric.ok{color:#3fb950}
.metric.fail{color:#f85149}
.metric.warn{color:#d29922}
.metric.error{color:#f85149}
.metric.unknown{color:#8b949e}
.metric-sub{font-size:11px;color:#8b949e}
.bar{flex:1;min-width:60px;height:6px;background:#21262d;border-radius:3px;overflow:hidden}
.fill{height:100%;background:#3fb950;border-radius:3px}
.fill.warn{background:#d29922}
@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr);gap:8px;padding:8px}.panel{padding:10px}.panel-link{font-size:13px}.metric{font-size:11px}}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-row">
    <h1>BFE Monitor</h1>
    <div class="topbar-right">
      <span class="instance-count">${instances.size} 台机器</span>
      <a href="${basePath}/admin" class="btn">管理后台</a>
    </div>
  </div>
  <div class="topbar-desc">OpenClaw 全局监控 — 实时巡检每一只龙虾的网络连通、服务健康与 Codex 配额</div>
</header>
<div class="grid" id="grid">${inner}</div>
<script>
const BASE='${basePath}';
async function refreshGrid(){
  try{
    const r=await fetch(BASE+'/api/html');
    if(r.ok){document.getElementById('grid').innerHTML=await r.text()}
  }catch{}
}
async function togglePause(btn){
  const name=btn.dataset.name;
  const next=btn.dataset.paused==='1'?false:true;
  btn.disabled=true;
  try{
    const r=await fetch(BASE+'/api/instances/'+encodeURIComponent(name)+'/pause',{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({paused:next}),
    });
    if(!r.ok){alert('操作失败: HTTP '+r.status);btn.disabled=false;return}
    await refreshGrid();
  }catch(e){alert('操作失败: '+e.message);btn.disabled=false}
}
setInterval(refreshGrid,5000);
</script>
</body>
</html>`;
}
