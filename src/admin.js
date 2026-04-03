function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Login Page ──────────────────────────────────────────────

export function renderLoginPage(basePath) {
  const B = basePath;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BFE Monitor Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0e14;color:#c9d1d9;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-wrap{width:100%;max-width:380px;padding:24px}
.login-header{text-align:center;margin-bottom:32px}
.login-header h1{font-size:22px;color:#58a6ff;margin-bottom:6px}
.login-header p{font-size:13px;color:#8b949e}
.tabs{display:flex;margin-bottom:24px;border-bottom:1px solid #21262d}
.tab{flex:1;padding:10px 0;text-align:center;font-size:13px;color:#8b949e;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
.tab:hover{color:#c9d1d9}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.panel{display:none}
.panel.active{display:block}
label{font-size:12px;color:#8b949e;display:block;margin-bottom:6px;letter-spacing:.5px}
input[type="tel"],input[type="text"],input[type="password"]{width:100%;padding:10px 12px;margin-bottom:16px;background:#161b22;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:14px;outline:none;transition:border-color .2s}
input:focus{border-color:#58a6ff;box-shadow:0 0 0 3px rgba(56,139,253,.1)}
input::placeholder{color:#484f58}
.code-row{display:flex;gap:8px;margin-bottom:16px}
.code-row input{flex:1;margin-bottom:0}
.code-row button{flex-shrink:0;width:108px;padding:10px 0;background:transparent;border:1px solid #58a6ff;color:#58a6ff;border-radius:6px;cursor:pointer;font-size:13px;transition:all .2s}
.code-row button:hover:not(:disabled){background:rgba(56,139,253,.1)}
.code-row button:disabled{border-color:#30363d;color:#484f58;cursor:not-allowed}
.login-btn{width:100%;padding:11px;background:linear-gradient(135deg,#238636,#2ea043);border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;transition:all .2s}
.login-btn:hover{box-shadow:0 4px 14px rgba(35,134,54,.4);transform:translateY(-1px)}
.msg{font-size:13px;margin-top:14px;text-align:center;min-height:18px}
.msg.ok{color:#3fb950}
.msg.err{color:#f85149}
</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-header">
    <h1>BFE Monitor</h1>
    <p>管理后台登录</p>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="switchTab('sms')">短信验证码</div>
    <div class="tab" onclick="switchTab('pwd')">密码登录</div>
  </div>

  <div id="smsPanel" class="panel active">
    <label>手机号</label>
    <input type="tel" id="phone" placeholder="请输入手机号" maxlength="11" autofocus>
    <label>验证码</label>
    <div class="code-row">
      <input type="text" id="code" placeholder="6位验证码" maxlength="6">
      <button type="button" id="sendBtn" onclick="sendCode()">获取验证码</button>
    </div>
    <button class="login-btn" onclick="doSmsLogin()">登 录</button>
  </div>

  <div id="pwdPanel" class="panel">
    <label>手机号</label>
    <input type="tel" id="pwdPhone" placeholder="请输入手机号" maxlength="11">
    <label>密码</label>
    <input type="password" id="pwdPassword" placeholder="请输入密码">
    <button class="login-btn" onclick="doPwdLogin()">登 录</button>
  </div>

  <div class="msg" id="msg"></div>
</div>

<script>
const BASE='${B}';
function showMsg(t,ok){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+(ok?'ok':'err')}
function switchTab(t){
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',(t==='sms'&&i===0)||(t==='pwd'&&i===1)));
  document.getElementById('smsPanel').classList.toggle('active',t==='sms');
  document.getElementById('pwdPanel').classList.toggle('active',t==='pwd');
  showMsg('',true);
}
let countdown=0,timer=null;
function startCountdown(){
  countdown=60;const btn=document.getElementById('sendBtn');btn.disabled=true;
  timer=setInterval(()=>{countdown--;btn.textContent=countdown+'s';if(countdown<=0){clearInterval(timer);btn.disabled=false;btn.textContent='获取验证码'}},1000);
}
async function sendCode(){
  const phone=document.getElementById('phone').value.trim();
  if(!/^1\\d{10}$/.test(phone))return showMsg('请输入正确的手机号',false);
  const btn=document.getElementById('sendBtn');btn.disabled=true;
  try{
    const r=await fetch(BASE+'/admin/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
    const d=await r.json();
    if(r.ok){showMsg(d.message,true);startCountdown()}else{showMsg(d.message||'发送失败',false);btn.disabled=false}
  }catch{showMsg('网络错误',false);btn.disabled=false}
}
async function doSmsLogin(){
  const phone=document.getElementById('phone').value.trim();
  const code=document.getElementById('code').value.trim();
  if(!phone||!code)return showMsg('请填写完整',false);
  try{
    const r=await fetch(BASE+'/admin/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,code,loginType:'sms'})});
    const d=await r.json();
    if(r.ok){location.href=BASE+'/admin'}else{showMsg(d.message||'登录失败',false)}
  }catch{showMsg('网络错误',false)}
}
async function doPwdLogin(){
  const phone=document.getElementById('pwdPhone').value.trim();
  const password=document.getElementById('pwdPassword').value;
  if(!phone||!password)return showMsg('请填写完整',false);
  try{
    const r=await fetch(BASE+'/admin/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password,loginType:'password'})});
    const d=await r.json();
    if(r.ok){location.href=BASE+'/admin'}else{showMsg(d.message||'登录失败',false)}
  }catch{showMsg('网络错误',false)}
}
document.getElementById('phone').addEventListener('keydown',e=>{if(e.key==='Enter')sendCode()});
document.getElementById('code').addEventListener('keydown',e=>{if(e.key==='Enter')doSmsLogin()});
document.getElementById('pwdPassword').addEventListener('keydown',e=>{if(e.key==='Enter')doPwdLogin()});
</script>
</body>
</html>`;
}

// ─── Admin Dashboard Page ────────────────────────────────────

export function renderAdminPage(basePath, user) {
  const B = basePath;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BFE Monitor 管理后台</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#161b22;border-bottom:1px solid #30363d}
.topbar h1{font-size:18px;color:#58a6ff}
.topbar-right{display:flex;gap:12px;align-items:center;font-size:13px}
.topbar-right span{color:#8b949e}
.topbar-right a{color:#f85149;text-decoration:none;font-size:12px}
.topbar-right a:hover{text-decoration:underline}
.back-link{color:#58a6ff;text-decoration:none;font-size:13px;margin-right:12px}
.back-link:hover{text-decoration:underline}

.tabs{display:flex;gap:0;padding:0 20px;background:#161b22;border-bottom:1px solid #30363d}
.tab-btn{padding:12px 20px;font-size:13px;color:#8b949e;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;transition:all .2s}
.tab-btn:hover{color:#c9d1d9}
.tab-btn.active{color:#58a6ff;border-bottom-color:#58a6ff}

.content{padding:20px;max-width:1000px;margin:0 auto}
.section{display:none}
.section.active{display:block}

.toolbar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.search-input{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:13px;width:220px}
.search-input:focus{border-color:#58a6ff;outline:none}
.btn{border:1px solid #30363d;background:#21262d;color:#c9d1d9;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;transition:all .15s}
.btn:hover{background:#30363d}
.btn-primary{background:#238636;border-color:#238636;color:#fff}
.btn-primary:hover{background:#2ea043}
.btn-danger{color:#f85149;border-color:#f85149}
.btn-danger:hover{background:rgba(248,81,73,.1)}
.btn-sm{padding:4px 10px;font-size:12px}

table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{background:#0d1117;color:#8b949e;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
td{color:#c9d1d9}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;margin:1px 2px}
.tag-tenant{background:rgba(56,139,253,.15);color:#58a6ff}
.tag-admin{background:rgba(63,185,80,.15);color:#3fb950}
.tag-super{background:rgba(210,153,34,.15);color:#d29922}
.empty{text-align:center;padding:40px;color:#484f58}

/* modal */
.modal-mask{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center}
.modal-mask.open{display:flex}
.modal{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:24px;width:420px;max-width:90vw}
.modal h3{margin-bottom:16px;font-size:16px;color:#c9d1d9}
.modal label{font-size:12px;color:#8b949e;display:block;margin-bottom:4px;margin-top:12px}
.modal input,.modal select{width:100%;padding:8px 10px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:13px;outline:none}
.modal input:focus,.modal select:focus{border-color:#58a6ff}
.modal-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.tenants-input-hint{font-size:11px;color:#484f58;margin-top:2px}

.pagination{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px}
.page-info{font-size:12px;color:#8b949e}
</style>
</head>
<body>
<header class="topbar">
  <div style="display:flex;align-items:center">
    <a href="${B}/" class="back-link">&larr; 监控面板</a>
    <h1>管理后台</h1>
  </div>
  <div class="topbar-right">
    <span>${esc(user.name)}（${esc(user.phone)}）</span>
    <a href="#" onclick="logout()">退出</a>
  </div>
</header>

<div class="tabs">
  <button class="tab-btn active" onclick="switchSection('users')">用户管理</button>
  <button class="tab-btn" onclick="switchSection('admins')">管理员</button>
</div>

<div class="content">
  <!-- Users Section -->
  <div id="sec-users" class="section active">
    <div class="toolbar">
      <input class="search-input" id="userSearch" placeholder="搜索手机号或姓名..." oninput="loadUsers()">
      <button class="btn btn-primary" onclick="openUserModal()">+ 新增用户</button>
    </div>
    <table>
      <thead><tr><th>姓名</th><th>手机号</th><th>租户</th><th>管理员</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody id="userTableBody"><tr><td colspan="6" class="empty">加载中...</td></tr></tbody>
    </table>
    <div class="pagination" id="userPagination"></div>
  </div>

  <!-- Admins Section -->
  <div id="sec-admins" class="section">
    <div class="toolbar">
      <input class="search-input" id="adminSearch" placeholder="搜索手机号..." oninput="loadAdmins()">
    </div>
    <table>
      <thead><tr><th>姓名</th><th>手机号</th><th>角色</th><th>添加时间</th><th>操作</th></tr></thead>
      <tbody id="adminTableBody"><tr><td colspan="5" class="empty">加载中...</td></tr></tbody>
    </table>
  </div>
</div>

<!-- User Modal -->
<div class="modal-mask" id="userModal">
  <div class="modal">
    <h3 id="userModalTitle">新增用户</h3>
    <input type="hidden" id="editUserId">
    <label>姓名</label>
    <input type="text" id="uName" placeholder="用户姓名">
    <label>手机号</label>
    <input type="tel" id="uPhone" placeholder="手机号" maxlength="11">
    <label>密码（可选）</label>
    <input type="text" id="uPassword" placeholder="留空则只能短信登录">
    <label>租户（逗号分隔）</label>
    <input type="text" id="uTenants" placeholder="/huangcan, /bfetest">
    <div class="tenants-input-hint">多个租户用逗号分隔，如 /huangcan, /bfetest</div>
    <div class="modal-footer">
      <button class="btn" onclick="closeUserModal()">取消</button>
      <button class="btn btn-primary" onclick="saveUser()">保存</button>
    </div>
  </div>
</div>

<!-- Admin Assign Modal -->
<div class="modal-mask" id="adminModal">
  <div class="modal">
    <h3>设为管理员</h3>
    <label>选择用户（手机号）</label>
    <input type="tel" id="aPhone" placeholder="输入用户手机号" maxlength="11">
    <label>角色</label>
    <select id="aRole">
      <option value="admin">admin</option>
      <option value="super_admin">super_admin</option>
    </select>
    <div class="modal-footer">
      <button class="btn" onclick="closeAdminModal()">取消</button>
      <button class="btn btn-primary" onclick="saveAdmin()">确认</button>
    </div>
  </div>
</div>

<script>
const BASE='${B}';
let userPage=1;const userLimit=20;

function switchSection(name){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('sec-'+name).classList.add('active');
  if(name==='users')loadUsers();
  if(name==='admins')loadAdmins();
}

// ─── Users ────────────────────────────────────────────────
async function loadUsers(){
  const q=document.getElementById('userSearch').value.trim();
  const params=new URLSearchParams({page:userPage,limit:userLimit});
  if(q)params.set('q',q);
  try{
    const r=await fetch(BASE+'/admin/api/users?'+params);
    const d=await r.json();
    renderUserTable(d.users||[],d.total||0);
  }catch{document.getElementById('userTableBody').innerHTML='<tr><td colspan="6" class="empty">加载失败</td></tr>'}
}

function renderUserTable(users,total){
  const tb=document.getElementById('userTableBody');
  if(!users.length){tb.innerHTML='<tr><td colspan="6" class="empty">暂无用户</td></tr>';return}
  tb.innerHTML=users.map(u=>{
    const tenants=(u.tenants||[]).map(t=>'<span class="tag tag-tenant">'+esc(t)+'</span>').join(' ');
    const isAdmin=u._isAdmin;
    const adminBadge=isAdmin?'<span class="tag '+(u._adminRole==='super_admin'?'tag-super':'tag-admin')+'">'+esc(u._adminRole||'admin')+'</span>':'-';
    const dt=u.createdAt?new Date(u.createdAt).toLocaleDateString('zh-CN'):'';
    return '<tr><td>'+esc(u.name)+'</td><td>'+esc(u.phone)+'</td><td>'+tenants+'</td><td>'+adminBadge+'</td><td>'+dt+'</td>'
      +'<td><button class="btn btn-sm" onclick="editUser(\\''+u._id+'\\')">编辑</button> '
      +(isAdmin?'<button class="btn btn-sm btn-danger" onclick="removeAdmin(\\''+esc(u.phone)+'\\')">取消管理员</button> ':'<button class="btn btn-sm" onclick="promoteAdmin(\\''+esc(u.phone)+'\\')">设为管理员</button> ')
      +'<button class="btn btn-sm btn-danger" onclick="deleteUser(\\''+u._id+'\\')">删除</button></td></tr>';
  }).join('');
  const pages=Math.ceil(total/userLimit);
  const pg=document.getElementById('userPagination');
  pg.innerHTML=(userPage>1?'<button class="btn btn-sm" onclick="userPage--;loadUsers()">&laquo; 上一页</button>':'')
    +'<span class="page-info">第 '+userPage+' / '+pages+' 页，共 '+total+' 条</span>'
    +(userPage<pages?'<button class="btn btn-sm" onclick="userPage++;loadUsers()">下一页 &raquo;</button>':'');
}

function openUserModal(id){
  document.getElementById('editUserId').value='';
  document.getElementById('uName').value='';
  document.getElementById('uPhone').value='';
  document.getElementById('uPassword').value='';
  document.getElementById('uTenants').value='';
  document.getElementById('userModalTitle').textContent=id?'编辑用户':'新增用户';
  document.getElementById('userModal').classList.add('open');
  if(id)loadUserForEdit(id);
}
function closeUserModal(){document.getElementById('userModal').classList.remove('open')}

async function loadUserForEdit(id){
  const r=await fetch(BASE+'/admin/api/users/'+id);
  const u=await r.json();
  document.getElementById('editUserId').value=u._id;
  document.getElementById('uName').value=u.name||'';
  document.getElementById('uPhone').value=u.phone||'';
  document.getElementById('uPassword').value=u.password||'';
  document.getElementById('uTenants').value=(u.tenants||[]).join(', ');
}

async function saveUser(){
  const id=document.getElementById('editUserId').value;
  const data={
    name:document.getElementById('uName').value.trim(),
    phone:document.getElementById('uPhone').value.trim(),
    password:document.getElementById('uPassword').value,
    tenants:document.getElementById('uTenants').value.split(',').map(s=>s.trim()).filter(Boolean),
  };
  if(!data.name||!data.phone){alert('姓名和手机号必填');return}
  const url=id?BASE+'/admin/api/users/'+id:BASE+'/admin/api/users';
  const method=id?'PUT':'POST';
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(r.ok){closeUserModal();loadUsers()}else{const d=await r.json();alert(d.error||'操作失败')}
}

async function deleteUser(id){
  if(!confirm('确认删除该用户？'))return;
  await fetch(BASE+'/admin/api/users/'+id,{method:'DELETE'});
  loadUsers();
}

async function editUser(id){openUserModal(id)}

// ─── Admins ───────────────────────────────────────────────
async function loadAdmins(){
  const q=document.getElementById('adminSearch').value.trim();
  const params=new URLSearchParams();
  if(q)params.set('q',q);
  try{
    const r=await fetch(BASE+'/admin/api/admins?'+params);
    const d=await r.json();
    renderAdminTable(d.admins||[]);
  }catch{document.getElementById('adminTableBody').innerHTML='<tr><td colspan="5" class="empty">加载失败</td></tr>'}
}

function renderAdminTable(admins){
  const tb=document.getElementById('adminTableBody');
  if(!admins.length){tb.innerHTML='<tr><td colspan="5" class="empty">暂无管理员</td></tr>';return}
  tb.innerHTML=admins.map(a=>{
    const dt=a.createdAt?new Date(a.createdAt).toLocaleDateString('zh-CN'):'';
    const roleCls=a.role==='super_admin'?'tag-super':'tag-admin';
    return '<tr><td>'+esc(a.userName||'-')+'</td><td>'+esc(a.phone)+'</td><td><span class="tag '+roleCls+'">'+esc(a.role)+'</span></td><td>'+dt+'</td>'
      +'<td><button class="btn btn-sm btn-danger" onclick="removeAdmin(\\''+esc(a.phone)+'\\')">移除</button></td></tr>';
  }).join('');
}

function promoteAdmin(phone){
  document.getElementById('aPhone').value=phone;
  document.getElementById('adminModal').classList.add('open');
}
function closeAdminModal(){document.getElementById('adminModal').classList.remove('open')}

async function saveAdmin(){
  const phone=document.getElementById('aPhone').value.trim();
  const role=document.getElementById('aRole').value;
  if(!phone){alert('请输入手机号');return}
  const r=await fetch(BASE+'/admin/api/admins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,role})});
  if(r.ok){closeAdminModal();loadAdmins();loadUsers()}else{const d=await r.json();alert(d.error||'操作失败')}
}

async function removeAdmin(phone){
  if(!confirm('确认取消该用户的管理员权限？'))return;
  await fetch(BASE+'/admin/api/admins/'+encodeURIComponent(phone),{method:'DELETE'});
  loadAdmins();loadUsers();
}

async function logout(){
  await fetch(BASE+'/admin/logout',{method:'POST'});
  location.href=BASE+'/admin/login';
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// init
loadUsers();
</script>
</body>
</html>`;
}
