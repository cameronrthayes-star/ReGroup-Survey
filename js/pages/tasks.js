import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
function computeClientAlerts() {
  const alerts = [];
  const now = new Date();
  const msDay = 86400000;
  const sessions = DB.sessions();
  const clients  = DB.clients();

  function sortByDate(arr) {
    return arr.slice().sort((a,b)=>(getDate(a)||'').localeCompare(getDate(b)||''));
  }

  // Group sessions by clientId field
  const byClientId = {};
  sessions.forEach(s => {
    const key = (s.clientId||'').trim();
    if (!key) return;
    if (!byClientId[key]) byClientId[key] = [];
    byClientId[key].push(s);
  });

  // ALERT TYPE 2: No contact in 3+ months — for any client with sessions
  Object.entries(byClientId).forEach(([clientId, sess]) => {
    const sorted = sortByDate(sess);
    const lastDate = new Date(getDate(sorted[sorted.length-1]) + 'T12:00:00');
    const daysSince = (now - lastDate) / msDay;
    if (daysSince >= 90) {
      const cRec = clients.find(c=>c.clientId===clientId);
      const name = cRec ? [cRec.firstName,cRec.lastName].filter(Boolean).join(' ') : clientId;
      alerts.push({
        type:'no-contact-90', severity:'danger', clientName:name, clientId,
        lastContact: getDate(sorted[sorted.length-1]),
        daysSince: Math.floor(daysSince), sessionCount: sess.length,
        reason: 'No contact in ' + Math.floor(daysSince) + ' days (last: ' + fmtDate(getDate(sorted[sorted.length-1])) + ')'
      });
    }
  });

  // ALERT TYPES 1 & 3: Overdue regular contact / missed meeting
  Object.entries(byClientId).forEach(([clientId, sess]) => {
    if (sess.length < 2) return;
    const sorted = sortByDate(sess);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(getDate(sorted[i-1]) + 'T12:00:00');
      const curr = new Date(getDate(sorted[i]) + 'T12:00:00');
      if (!isNaN(prev) && !isNaN(curr)) gaps.push((curr - prev) / msDay);
    }
    if (!gaps.length) return;
    const avgGap = gaps.reduce((s,v)=>s+v,0) / gaps.length;
    const lastDate = new Date(getDate(sorted[sorted.length-1]) + 'T12:00:00');
    const daysSinceLast = (now - lastDate) / msDay;
    const cRec = clients.find(c=>c.clientId===clientId);
    const name = cRec ? [cRec.firstName,cRec.lastName].filter(Boolean).join(' ') : clientId;
    const alreadyFlagged = alerts.find(a=>a.clientId===clientId && a.type==='no-contact-90');

    // Type 1: regular contact pattern but 2+ weeks overdue
    if (!alreadyFlagged && avgGap < 60 && daysSinceLast > avgGap + 14) {
      alerts.push({
        type:'overdue-regular', severity:'warn', clientName:name, clientId,
        lastContact: getDate(sorted[sorted.length-1]),
        daysSince: Math.floor(daysSinceLast), avgGapDays: Math.round(avgGap),
        sessionCount: sess.length,
        reason: 'Usually contacted every ~' + Math.round(avgGap) + ' days, but it\'s been ' + Math.floor(daysSinceLast) + ' days (' + Math.floor(daysSinceLast - avgGap) + ' days overdue)'
      });
    }

    // Type 3: had 2+ consecutive contacts then a large gap
    if (!alreadyFlagged && sorted.length >= 3 && avgGap < 45 && gaps.length >= 2) {
      const lastGap = gaps[gaps.length-1];
      const prevAvg = gaps.slice(0,-1).reduce((s,v)=>s+v,0) / (gaps.length-1);
      if (lastGap > prevAvg * 2.2 && lastGap > 14 && !alerts.find(a=>a.clientId===clientId)) {
        alerts.push({
          type:'missed-meeting', severity:'warn', clientName:name, clientId,
          lastContact: getDate(sorted[sorted.length-1]),
          daysSince: Math.floor(daysSinceLast), sessionCount: sess.length,
          reason: 'Had regular contact (avg every ' + Math.round(prevAvg) + ' days) then a ' + Math.round(lastGap) + '-day gap — may have missed a meeting'
        });
      }
    }
  });

  return alerts.sort((a,b) => b.daysSince - a.daysSince);
}

// ADMIN INBOX
let _cachedAlerts = [];

function refreshAlerts() {
  _cachedAlerts = computeClientAlerts();
  renderAdminInbox();
}

function renderAdminInbox() {
  if (!_cachedAlerts.length) _cachedAlerts = computeClientAlerts();
  const el = document.getElementById('alert-list');
  if (!el) return;
  if (!_cachedAlerts.length) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:#bbb;">✅ No client alerts at this time. All contacts appear up to date.</div>';
    return;
  }
  el.innerHTML = _cachedAlerts.map((a,i) => {
    const col = a.severity==='danger' ? 'var(--danger)' : 'var(--warn)';
    const icon = a.severity==='danger' ? '🔴' : '🟡';
    return '<div class="card" style="border-left:4px solid ' + col + ';margin-bottom:14px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;">' +
          '<div style="font-weight:700;color:var(--primary);margin-bottom:4px;">' + icon + ' ' + (a.clientName||'Unknown') + ' <span style="font-size:0.75em;color:#999;font-weight:400;">#' + (a.clientId||'—') + '</span></div>' +
          '<div style="font-size:0.875em;color:#555;margin-bottom:6px;">' + a.reason + '</div>' +
          '<div style="font-size:0.78em;color:#aaa;">Last contact: ' + (fmtDate(a.lastContact)||'Unknown') + ' · ' + a.sessionCount + ' session' + (a.sessionCount!==1?'s':'') + ' on record</div>' +
        '</div>' +
        '<button class="btn btn-accent" style="white-space:nowrap;" onclick="openAssignModal(' + i + ')">Assign Task</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderAdminTasks() {
  const el = document.getElementById('admin-tasks-list');
  if (!el) return;
  const tasks = DB.tasks().slice().reverse();
  if (!tasks.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No tasks assigned yet.</p>'; return; }
  el.innerHTML = '<div class="table-wrap"><table>' +
    '<thead><tr><th>Assigned To</th><th>Client</th><th>Description</th><th>Due</th><th>Status</th><th></th></tr></thead>' +
    '<tbody>' + tasks.map(t =>
      '<tr>' +
        '<td><b>' + (t.mentorName||'—') + '</b></td>' +
        '<td>' + (t.clientName||'—') + '</td>' +
        '<td style="font-size:0.85em;">' + (t.description||'—') + '</td>' +
        '<td style="font-size:0.82em;">' + (fmtDate(t.dueDate)||'—') + '</td>' +
        '<td><span class="badge ' + (t.status==='Done'?'badge-success':t.status==='In Progress'?'badge-info':'badge-warn') + '">' + (t.status||'Open') + '</span></td>' +
        '<td><button class="btn btn-danger" style="padding:4px 8px;font-size:0.75em;" onclick="adminRemoveTask(\'' + t._id + '\')">Remove</button></td>' +
      '</tr>'
    ).join('') + '</tbody></table></div>';
}

function openAssignModal(alertIndex) {
  const a = _cachedAlerts[alertIndex];
  if (!a) return;
  document.getElementById('am-alert-data').value = JSON.stringify(a);
  document.getElementById('am-description').value = 'Follow up with ' + a.clientName + ': ' + a.reason;
  document.getElementById('am-due').value = '';
  const sel = document.getElementById('am-mentor');
  sel.innerHTML = '<option value="">— Select mentor —</option>' +
    DB.staff().map(s=>'<option value="' + s.name + '">' + s.name + '</option>').join('');
  document.getElementById('assign-modal').style.display = 'flex';
}

function closeAssignModal() { document.getElementById('assign-modal').style.display='none'; }

async function saveAssignedTask() {
  const mentorName = document.getElementById('am-mentor').value;
  const description = document.getElementById('am-description').value.trim();
  if (!mentorName) { alert('Please select a mentor.'); return; }
  if (!description) { alert('Please enter a task description.'); return; }
  const alertData = JSON.parse(document.getElementById('am-alert-data').value||'{}');
  await DB.addTask({
    mentorName, description,
    clientName: alertData.clientName||'',
    clientId:   alertData.clientId||'',
    dueDate:    document.getElementById('am-due').value,
    status:     'Open',
    alertType:  alertData.type||'',
    reason:     alertData.reason||''
  });
  closeAssignModal();
}

function adminRemoveTask(id) {
  requireAdmin(async ()=>{
    if (!confirm('Remove this task?')) return;
    await DB.removeTask(id);
    renderAdminTasks();
  });
}

// MY TASKS (MENTOR INBOX)
function renderMyTasks() {
  const sel = document.getElementById('my-tasks-mentor');
  if (!sel) return;
  // Non-admins are locked to their own inbox; admins can switch between people
  let current = sel.value;
  if (!isAdmin() && currentUserName()) { current = currentUserName(); sel.disabled = true; }
  else { sel.disabled = false; }
  sel.innerHTML = '<option value="">— Select your name —</option>' +
    DB.staff().map(s=>'<option value="' + s.name + '"' + (s.name===current?' selected':'') + '>' + s.name + '</option>').join('');
  sel.value = current;
  const el = document.getElementById('my-tasks-list');
  const msgsEl = document.getElementById('my-inbox-msgs');
  const compose = document.getElementById('my-compose');
  if (!el) return;
  if (!current) {
    if (compose) compose.style.display='none';
    if (msgsEl) msgsEl.innerHTML='';
    el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:32px;">Select your name above to see your messages and tasks.</div>';
    return;
  }
  // Compose: recipients = Admin + every other mentor
  if (compose) {
    compose.style.display='block';
    const toSel = document.getElementById('mim-to');
    const prev = toSel.value;
    const opts = ['Admin', ...mentorNames().filter(n=>n!==current)];
    toSel.innerHTML = opts.map(o=>`<option value="${fEsc(o)}"${o===prev?' selected':''}>${o==='Admin'?'Admin':o}</option>`).join('');
  }
  // Inbox: full conversations involving me (sent + received), grouped into threads
  const involving = DB.messages().filter(m=>m.mentorName===current || m.from===current);
  involving.filter(m=>m.mentorName===current && !m.read).forEach(m=>DB.markMessageRead(m._id));
  if (msgsEl) msgsEl.innerHTML = renderMyThreads(current, involving);
  const tasks = DB.tasks().filter(t=>t.mentorName===current);
  const countEl = document.getElementById('my-tasks-count');
  if (countEl) countEl.textContent = tasks.filter(t=>t.status!=='Done').length + ' open';
  if (!tasks.length) { el.innerHTML = '<div class="card" style="color:#bbb;text-align:center;padding:32px;">🎉 No tasks assigned to you right now.</div>'; return; }
  el.innerHTML = tasks.slice().reverse().map(t => {
    const col = t.status==='Done'?'var(--success)':t.status==='In Progress'?'var(--accent)':'var(--warn)';
    return '<div class="card" style="border-left:4px solid ' + col + ';margin-bottom:14px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;">' +
          '<div style="font-weight:700;color:var(--primary);margin-bottom:4px;">' + (t.clientName||'General Task') + '</div>' +
          '<div style="font-size:0.875em;color:#555;margin-bottom:8px;">' + (t.description||'') + '</div>' +
          (t.dueDate ? '<div style="font-size:0.78em;color:#888;">Due: ' + fmtDate(t.dueDate) + '</div>' : '') +
          (t.reason  ? '<div style="font-size:0.78em;color:#999;margin-top:4px;font-style:italic;">Alert: ' + t.reason + '</div>' : '') +
        '</div>' +
        '<select onchange="updateMyTaskStatus(\'' + t._id + '\',this.value)" style="padding:6px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.82em;min-width:120px;">' +
          '<option' + (t.status==='Open'?' selected':'') + '>Open</option>' +
          '<option' + (t.status==='In Progress'?' selected':'') + '>In Progress</option>' +
          '<option' + (t.status==='Done'?' selected':'') + '>Done</option>' +
        '</select>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function updateMyTaskStatus(id, status) {
  await DB.updateTask(id, {status});
}

// Mentor composes a message to Admin or another mentor
async function sendMyMessage(){
  const from = document.getElementById('my-tasks-mentor').value;
  const status = document.getElementById('mim-status');
  if (!from) { if(status){status.style.color='#e53935';status.textContent='Select your name first.';} return; }
  const to = document.getElementById('mim-to').value;
  const text = document.getElementById('mim-text').value.trim();
  if (!to) { if(status){status.style.color='#e53935';status.textContent='Choose a recipient.';} return; }
  if (!text) { if(status){status.style.color='#e53935';status.textContent='Type a message.';} return; }
  await DB.addMessage({mentorName:to, from, text, read:false});
  document.getElementById('mim-text').value='';
  if (status){ status.style.color='#43a047'; status.textContent='Sent to '+to+' ✓'; setTimeout(()=>{status.textContent='';},4000); }
}

// MENTOR PANEL & DIRECT MESSAGING (admin portal)
export let _msgMentor = null;
let _mtaskMentor = null;

function mentorNames(){
  return [...new Set(DB.staff().map(s=>s.name).filter(Boolean))].sort();
}
function fmtMsgTime(m){
  const ts = m._createdAt || m._readAt;
  const d = (ts && typeof ts.toDate === 'function') ? ts.toDate() : null;
  if (!d) return 'just now';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}

function renderMentorPanel(){
  const el = document.getElementById('mentor-panel');
  if (!el) return;
  const names = mentorNames();
  if (!names.length){ el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:32px;">No staff yet. Add mentors in Staff &amp; Settings.</div>'; return; }
  const tasks = DB.tasks(); const msgs = DB.messages();
  const stat = (label,count,color,onclick)=>
    `<button class="btn" onclick="${onclick}" style="flex:1;min-width:104px;background:#f4f6fb;border:1.5px solid #e2e8f0;color:#333;display:flex;flex-direction:column;gap:2px;align-items:center;padding:11px 8px;">
      <span style="font-size:1.5em;font-weight:800;color:${color};line-height:1;">${count}</span>
      <span style="font-size:0.68em;color:#666;text-transform:uppercase;letter-spacing:.3px;text-align:center;">${label}</span>
    </button>`;
  el.innerHTML = names.map(name=>{
    const unread = msgs.filter(m=>m.mentorName===name && !m.read).length;
    const uncompleted = tasks.filter(t=>t.mentorName===name && t.status!=='Done').length;
    const inprog = tasks.filter(t=>t.mentorName===name && t.status==='In Progress').length;
    const nm = name.replace(/'/g,"\\'");
    const sid = (DB.staff().find(x=>x.name===name)||{})._id || '';
    return `<div class="card" style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <div style="font-weight:700;color:var(--primary);font-size:1.05em;">👤 ${fEsc(name)}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline" style="font-size:0.82em;" onclick="openStaffModal('${sid}')">✏ Edit</button>
          <button class="btn btn-accent" style="font-size:0.82em;" onclick="openMentorMessages('${nm}')">✉ Message</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${stat('Unread Messages',unread,unread?'#e53935':'#9aa6b2',`openMentorMessages('${nm}')`)}
        ${stat('Uncompleted Tasks',uncompleted,uncompleted?'#fb8c00':'#9aa6b2',`openMentorTasks('${nm}','uncompleted')`)}
        ${stat('In Progress',inprog,inprog?'#2f9bb5':'#9aa6b2',`openMentorTasks('${nm}','inprogress')`)}
      </div>
    </div>`;
  }).join('');
}

function openMentorMessages(name){
  _msgMentor = name;
  document.getElementById('msg-modal-title').textContent = 'Messages — ' + name;
  document.getElementById('msg-text').value = '';
  document.getElementById('msg-modal').style.display = 'flex';
  // Mark this mentor's messages to Admin as read (admin is reading them now)
  DB.messages().filter(m=>m.mentorName==='Admin' && m.from===name && !m.read).forEach(m=>DB.markMessageRead(m._id));
  renderMessageThread();
}
function closeMentorMessages(){ document.getElementById('msg-modal').style.display='none'; _msgMentor=null; }
function deleteMessage(id){
  requireAdmin(async ()=>{
    if (!confirm('Delete this message? This cannot be undone.')) return;
    await DB.removeMessage(id);
    renderMessageThread();
  });
}
function renderMessageThread(){
  const wrap = document.getElementById('msg-thread');
  if (!wrap || !_msgMentor) return;
  // Two-way conversation between Admin and this mentor
  const msgs = DB.messages().filter(m=>
    (m.mentorName===_msgMentor && (m.from==='Admin' || !m.from)) ||
    (m.mentorName==='Admin' && m.from===_msgMentor)
  ).slice().sort((a,b)=>((a._createdAt&&a._createdAt.seconds)||0)-((b._createdAt&&b._createdAt.seconds)||0));
  wrap.innerHTML = msgs.length ? msgs.map(m=>{
    const fromMentor = m.from===_msgMentor;   // message sent BY the mentor to Admin
    return `<div style="margin-bottom:10px;display:flex;flex-direction:column;align-items:${fromMentor?'flex-start':'flex-end'};">
      <div style="display:flex;align-items:flex-start;gap:8px;max-width:85%;">
        <div style="background:${fromMentor?'#eef3fb':'#e8f6fa'};border:1px solid ${fromMentor?'#dbe6f7':'#cdebf3'};border-radius:10px;padding:9px 12px;font-size:0.88em;white-space:pre-wrap;">${fEsc(m.text)}</div>
        <button title="Delete (admin)" onclick="deleteMessage('${m._id}')" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:1.1em;line-height:1;">×</button>
      </div>
      <div style="font-size:0.7em;color:#aaa;margin-top:3px;">${fEsc(m.from||'Admin')} → ${fEsc(m.mentorName)} · ${fmtMsgTime(m)}${fromMentor?'':(' · '+(m.read?'✓ read':'• unread'))}</div>
    </div>`;
  }).join('') : '<p style="color:#bbb;font-size:0.85em;text-align:center;padding:16px;">No messages yet. Send the first one below.</p>';
  wrap.scrollTop = wrap.scrollHeight;
}
async function sendMentorMessage(){
  if (!_msgMentor) return;
  const t = document.getElementById('msg-text').value.trim();
  if (!t) { alert('Type a message first.'); return; }
  await DB.addMessage({mentorName:_msgMentor, text:t, from:'Admin', read:false});
  document.getElementById('msg-text').value = '';
  renderMessageThread();
}

// Admin's inbox: messages mentors sent to Admin
function renderAdminMessages(){
  const el = document.getElementById('admin-msgs-list');
  if (!el) return;
  const msgs = DB.messages().filter(m=>m.mentorName==='Admin').slice().reverse();
  msgs.filter(m=>!m.read).forEach(m=>DB.markMessageRead(m._id));   // admin is viewing
  if (!msgs.length){ el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:32px;">No messages from mentors yet.</div>'; return; }
  el.innerHTML = msgs.map(m=>{
    const nm=(m.from||'').replace(/'/g,"\\'");
    return `<div class="card" style="margin-bottom:12px;${m.read?'':'border-left:4px solid var(--accent);'}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:var(--primary);">👤 ${fEsc(m.from||'Unknown')} ${m.read?'':'<span class="badge badge-info">new</span>'}</div>
          <div style="font-size:0.9em;color:#444;margin:5px 0;white-space:pre-wrap;">${fEsc(m.text)}</div>
          <div style="font-size:0.72em;color:#aaa;">${fmtMsgTime(m)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button class="btn btn-accent" style="font-size:0.8em;" onclick="openMentorMessages('${nm}')">Reply</button>
          <button class="btn btn-danger" style="font-size:0.78em;" onclick="deleteMessage('${m._id}')">×</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openMentorTasks(name, mode){
  _mtaskMentor = name;
  const all = DB.tasks().filter(t=>t.mentorName===name);
  const open = all.filter(t=>t.status==='Open' || !t.status).length;
  const prog = all.filter(t=>t.status==='In Progress').length;
  const done = all.filter(t=>t.status==='Done').length;
  let list, titleWord;
  if (mode==='inprogress'){ list = all.filter(t=>t.status==='In Progress'); titleWord='In-Progress Tasks'; }
  else if (mode==='uncompleted'){ list = all.filter(t=>t.status!=='Done'); titleWord='Uncompleted Tasks'; }
  else { list = all; titleWord='Tasks'; }   // 'breakdown' / 'all'
  document.getElementById('mtask-modal-title').textContent = titleWord + ' — ' + name;
  const chip=(label,n,color)=>`<div style="flex:1;min-width:74px;text-align:center;background:#f4f6fb;border:1px solid #e2e8f0;border-radius:10px;padding:9px 6px;">
    <div style="font-size:1.45em;font-weight:800;color:${color};line-height:1;">${n}</div>
    <div style="font-size:0.64em;color:#666;text-transform:uppercase;letter-spacing:.3px;margin-top:3px;">${label}</div></div>`;
  const breakdown = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
    ${chip('Open',open,'#fb8c00')}${chip('In Progress',prog,'#2f9bb5')}${chip('Done',done,'#43a047')}${chip('Total',all.length,'#1e3a8a')}</div>`;
  const listHtml = list.length ? list.slice().reverse().map(t=>{
    const col = t.status==='Done'?'var(--success)':t.status==='In Progress'?'var(--accent)':'var(--warn)';
    const badgeCls = t.status==='Done'?'badge-success':t.status==='In Progress'?'badge-info':'badge-warn';
    return `<div class="card" style="border-left:4px solid ${col};margin-bottom:10px;">
      <div style="font-weight:600;color:var(--primary);">${fEsc(t.clientName||'General Task')}</div>
      <div style="font-size:0.86em;color:#555;margin:4px 0;">${fEsc(t.description||'')}</div>
      <div style="font-size:0.76em;color:#999;">${t.dueDate?'Due '+fmtDate(t.dueDate)+' · ':''}<span class="badge ${badgeCls}">${fEsc(t.status||'Open')}</span></div>
    </div>`;
  }).join('') : '<p style="color:#bbb;font-size:0.875em;text-align:center;padding:20px;">No tasks in this group. 🎉</p>';
  document.getElementById('mtask-list').innerHTML = breakdown + listHtml;
  document.getElementById('mtask-modal').style.display = 'flex';
}
function closeMentorTasks(){ document.getElementById('mtask-modal').style.display='none'; _mtaskMentor=null; }

function _msgTs(m){ return (m._createdAt && m._createdAt.seconds) || (m._createdAt && typeof m._createdAt.toMillis==='function' ? m._createdAt.toMillis()/1000 : 0) || 0; }
// Group all messages involving `me` into per-person threads, with an inline reply box on each.
function renderMyThreads(me, msgs){
  if (!msgs.length) return '<div class="card" style="color:#bbb;text-align:center;padding:20px;margin-bottom:18px;">No messages yet. Use "✉ Send a Message" below to start one — replies appear here as a thread.</div>';
  const threads={};
  msgs.forEach(m=>{ const partner=(m.from===me ? m.mentorName : m.from)||'Unknown'; (threads[partner]=threads[partner]||[]).push(m); });
  const partners=Object.keys(threads).sort((a,b)=>_msgTs(threads[b][threads[b].length-1])-_msgTs(threads[a][threads[a].length-1]));
  return '<div class="card" style="margin-bottom:18px;border-left:4px solid var(--accent);"><h3 style="margin-bottom:12px;">✉ My Messages</h3>'+
    partners.map(p=>{
      const list=threads[p].slice().sort((a,b)=>_msgTs(a)-_msgTs(b));
      const pe=fEsc(p), pjs=p.replace(/'/g,"\\'");
      const unread=list.some(m=>m.mentorName===me && !m.read);
      return `<details class="msg-thread" style="border:1px solid #eef;border-radius:10px;margin-bottom:10px;" ${unread?'open':''}>
        <summary style="cursor:pointer;font-weight:600;color:var(--primary);padding:8px 10px;list-style:none;">💬 ${pe} <span style="color:#aaa;font-weight:400;font-size:0.85em;">(${list.length})</span></summary>
        <div style="padding:4px 10px 10px;">
          ${list.map(m=>{ const mine=m.from===me; return `<div style="display:flex;justify-content:${mine?'flex-end':'flex-start'};margin-bottom:6px;"><div style="max-width:82%;background:${mine?'#e8f6fa':'#eef3fb'};border:1px solid ${mine?'#cdebf3':'#dbe6f7'};border-radius:10px;padding:7px 10px;font-size:0.88em;white-space:pre-wrap;">${fEsc(m.text)}<div style="font-size:0.66em;color:#aaa;margin-top:3px;">${mine?'You':fEsc(m.from)} · ${fmtMsgTime(m)}</div></div></div>`; }).join('')}
          <div style="display:flex;gap:6px;margin-top:6px;">
            <input type="text" class="thread-reply" placeholder="Reply to ${pe}…" style="flex:1;padding:7px 9px;border:1.5px solid #ddd;border-radius:7px;font-size:0.85em;" onkeydown="if(event.key==='Enter'){replyThread(this,'${pjs}');}">
            <button class="btn btn-accent" style="font-size:0.8em;" onclick="replyThread(this.previousElementSibling,'${pjs}')">Reply</button>
          </div>
        </div>
      </details>`;
    }).join('')+'</div>';
}
async function replyThread(inputEl, partner){
  const me=(document.getElementById('my-tasks-mentor')||{}).value || currentUserName();
  const text=(inputEl && inputEl.value||'').trim();
  if(!me){ alert('Select your name first.'); return; }
  if(!text) return;
  inputEl.value='';
  await DB.addMessage({mentorName:partner, from:me, text, read:false});
}

export { computeClientAlerts, refreshAlerts, renderAdminInbox, renderAdminTasks,
  openAssignModal, closeAssignModal, saveAssignedTask, adminRemoveTask,
  renderMyTasks, updateMyTaskStatus,
  renderMentorPanel, openMentorMessages, closeMentorMessages, sendMentorMessage, deleteMessage,
  openMentorTasks, closeMentorTasks, sendMyMessage, renderAdminMessages, replyThread,
  renderMessageThread };
