import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
import { myStaffRecord } from './profile.js';
// --- Dashboard metric catalog: every available metric in the app ---
function dashWeekStats(){
  const now=new Date(); const mon=new Date(now); mon.setDate(now.getDate()-((now.getDay()+6)%7));
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  const toYMD=d=>d.toISOString().slice(0,10); const ws=toYMD(mon), we=toYMD(sun);
  const ents=DB.allEntries().filter(e=>{const d=getDate(e);return d>=ws&&d<=we;});
  return {sessions:ents.length, hours:ents.reduce((a,e)=>a+Math.max(0,calcHours(e.startTime,e.endTime)),0)};
}
const _isDone = t => ['completed','done','complete','closed'].includes((t.status||'').toLowerCase());
const DASH_METRICS = [
  {id:'sessions',         group:'Client Work', label:'Client Services',     color:'#1e3a8a', calc:()=>DB.sessions().length},
  {id:'activities',       group:'Client Work', label:'Activities Logged',   color:'#7c4dff', calc:()=>DB.activities().length},
  {id:'totalHours',       group:'Client Work', label:'Total Hours',         color:'#43a047', calc:()=>DB.allEntries().reduce((s,e)=>s+Math.max(0,calcHours(e.startTime,e.endTime)),0).toFixed(1)},
  {id:'uniqueClients',    group:'Client Work', label:'Unique Clients Served',color:'#fb8c00', calc:()=>new Set(DB.sessions().map(s=>s.clientId).filter(Boolean)).size},
  {id:'avgSessionHours',  group:'Client Work', label:'Avg Hours / Session', color:'#00897b', calc:()=>{const s=DB.sessions();if(!s.length)return '0.0';return (s.reduce((a,e)=>a+Math.max(0,calcHours(e.startTime,e.endTime)),0)/s.length).toFixed(1);}},
  {id:'weekSessions',     group:'This Week',   label:'Sessions This Week',  color:'#2f9bb5', calc:()=>dashWeekStats().sessions},
  {id:'weekHours',        group:'This Week',   label:'Hours This Week',     color:'#2f9bb5', calc:()=>dashWeekStats().hours.toFixed(1)},
  {id:'safetyFlags',      group:'Client Work', label:'Safety Flags',        color:'#e53935', calc:()=>DB.allEntries().filter(e=>e.safetyConcerns&&e.safetyConcerns!=='No concerns'&&e.safetyConcerns!=='no').length},
  {id:'clientsTotal',     group:'Directory',   label:'Clients in Directory',color:'#1e3a8a', calc:()=>DB.clients().length},
  {id:'openTasks',        group:'Tasks',       label:'Open Tasks',          color:'#fb8c00', calc:()=>DB.tasks().filter(t=>!_isDone(t)).length},
  {id:'doneTasks',        group:'Tasks',       label:'Completed Tasks',     color:'#43a047', calc:()=>DB.tasks().filter(_isDone).length},
  {id:'projectsTotal',    group:'Work',        label:'Projects',            color:'#5b21b6', calc:()=>DB.projects().length},
  {id:'events',           group:'Work',        label:'Events / Social Posts',color:'#d81b60', calc:()=>DB.events().length},
  {id:'meetings',         group:'Work',        label:'Meetings Logged',     color:'#3949ab', calc:()=>DB.meetings().length},
  {id:'needsAssessments', group:'Forms',       label:'Needs Assessments',   color:'#00897b', calc:()=>DB.needsAssessments().length},
  {id:'expenseReports',   group:'Forms',       label:'Expense Reports',     color:'#6d4c41', calc:()=>DB.expenseReports().length},
  {id:'staff',            group:'Team',        label:'Staff / Mentors',     color:'#1e3a8a', calc:()=>DB.staff().length},
  {id:'fundContacts',     group:'Fundraising', label:'Fundraising Contacts',color:'#c2185b', calc:()=>DB.fundContacts().length},
  {id:'donors',           group:'Fundraising', label:'Donors',              color:'#43a047', calc:()=>DB.fundContacts().filter(c=>fundGiftTotal(c)>0).length},
  {id:'totalGiving',      group:'Fundraising', label:'Total Giving',        color:'#2e7d32', calc:()=>fmtMoney(DB.fundContacts().reduce((s,c)=>s+fundGiftTotal(c),0))},
  {id:'followupsDue',     group:'Fundraising', label:'Follow-ups Due (3+ mo)',color:'#9a3412', calc:()=>DB.fundContacts().filter(fundNeedsFollowup).length},
];
const DASH_DEFAULT = ['sessions','activities','totalHours','uniqueClients','fundContacts','totalGiving'];
function getDashboardMetrics(){
  const ids = (_dashboardConfig && Array.isArray(_dashboardConfig.metrics)) ? _dashboardConfig.metrics : null;
  const valid = (ids || DASH_DEFAULT).filter(id => DASH_METRICS.some(m=>m.id===id));
  return (valid.length ? valid : DASH_DEFAULT).slice(0,6);   // top 6, admin-set
}

// ---- Personal "My Metrics" (bottom 6, chosen by each mentor) ----
const MY_METRICS = [
  {id:'mySessions',   label:'My Client Services', color:'#1e3a8a', calc:n=>DB.sessions().filter(s=>s.mentorName===n).length},
  {id:'myActivities', label:'My Activities',      color:'#7c4dff', calc:n=>DB.activities().filter(a=>a.mentorName===n).length},
  {id:'myHours',      label:'My Total Hours',     color:'#43a047', calc:n=>DB.allEntries().filter(e=>e.mentorName===n).reduce((s,e)=>s+Math.max(0,calcHours(e.startTime,e.endTime)),0).toFixed(1)},
  {id:'myWeekHours',  label:'My Hours This Week', color:'#2f9bb5', calc:n=>{const w=dashWeekStats;const now=new Date();const mon=new Date(now);mon.setDate(now.getDate()-((now.getDay()+6)%7));const sun=new Date(mon);sun.setDate(mon.getDate()+6);const ws=mon.toISOString().slice(0,10),we=sun.toISOString().slice(0,10);return DB.allEntries().filter(e=>e.mentorName===n&&getDate(e)>=ws&&getDate(e)<=we).reduce((s,e)=>s+Math.max(0,calcHours(e.startTime,e.endTime)),0).toFixed(1);}},
  {id:'myOpenTasks',  label:'My Open Tasks',      color:'#fb8c00', calc:n=>DB.tasks().filter(t=>t.mentorName===n&&t.status!=='Done').length},
  {id:'myInProgress', label:'My Tasks In Progress',color:'#2f9bb5', calc:n=>DB.tasks().filter(t=>t.mentorName===n&&t.status==='In Progress').length},
  {id:'myDoneTasks',  label:'My Completed Tasks', color:'#43a047', calc:n=>DB.tasks().filter(t=>t.mentorName===n&&t.status==='Done').length},
  {id:'myUnread',     label:'My Unread Messages', color:'#e53935', calc:n=>DB.messages().filter(m=>m.mentorName===n&&!m.read).length},
  {id:'myClients',    label:'My Clients Served',  color:'#00897b', calc:n=>new Set(DB.sessions().filter(s=>s.mentorName===n).map(s=>s.clientId).filter(Boolean)).size},
  {id:'mySafety',     label:'My Safety Flags',    color:'#c62828', calc:n=>DB.allEntries().filter(e=>e.mentorName===n&&e.safetyConcerns&&e.safetyConcerns!=='No concerns'&&e.safetyConcerns!=='no').length},
  {id:'myEvents',     label:'My Events Posted',   color:'#d81b60', calc:n=>DB.events().filter(e=>e.postedBy===n).length},
  {id:'myMeetings',   label:'My Meetings Logged', color:'#3949ab', calc:n=>DB.meetings().filter(m=>m.loggedBy===n).length},
];
const MY_DEFAULT = ['mySessions','myHours','myWeekHours','myOpenTasks','myInProgress','myUnread'];
function getMyMetricIds(){
  const s = myStaffRecord();
  let ids = s && Array.isArray(s.myMetrics) ? s.myMetrics
          : (()=>{ try{ return JSON.parse(localStorage.getItem('rg_my_metrics')||'null'); }catch(e){ return null; } })();
  const valid = (ids || MY_DEFAULT).filter(id => MY_METRICS.some(m=>m.id===id));
  return (valid.length ? valid : MY_DEFAULT).slice(0,6);   // bottom 6, mentor-set
}
async function setMyMetricIds(ids){
  const s = myStaffRecord();
  if (s) await DB.updateRecord('staff', s._id, {myMetrics:ids});
  else { try{ localStorage.setItem('rg_my_metrics', JSON.stringify(ids)); }catch(e){} }
}
function renderMyMetrics(){
  const grid = document.getElementById('my-stats-grid');
  if (!grid) return;
  const name = currentUserName();
  const ids = getMyMetricIds();
  grid.innerHTML = ids.map(id=>{
    const m = MY_METRICS.find(x=>x.id===id); if(!m) return '';
    let val; try{ val = m.calc(name); }catch(e){ val='—'; }
    return `<div class="stat-card" style="border-top-color:${m.color}"><div class="num">${val}</div><div class="lbl">${m.label}</div></div>`;
  }).join('');
}

function renderDashboard() {
  const entries = DB.allEntries();
  const sessions = DB.sessions();
  const activities = DB.activities();

  const selected = getDashboardMetrics();
  const countEl = document.getElementById('dash-metric-count');
  if (countEl) countEl.textContent = `(${selected.length} shown)`;
  const adminUnread = DB.messages().filter(m=>m.mentorName==='Admin' && !m.read).length;
  const auEl = document.getElementById('dash-admin-unread');
  if (auEl) auEl.innerHTML = adminUnread ? `<span class="badge badge-danger" style="margin-left:4px;">${adminUnread}</span>` : '';
  renderDashboardStaff();
  document.getElementById('stats-grid').innerHTML = selected.map(id => {
    const m = DASH_METRICS.find(x=>x.id===id);
    if (!m) return '';
    let val; try { val = m.calc(); } catch(e){ val = '—'; }
    return `<div class="stat-card" style="border-top-color:${m.color}">
      <div class="num">${val}</div>
      <div class="lbl">${m.label}</div>
    </div>`;
  }).join('');
  renderMyMetrics();
  const acb = document.getElementById('dash-admin-cust-btn');
  if (acb) acb.style.display = isAdmin() ? 'inline-flex' : 'none';   // only admin sets the top 6

  // Hours by mentor bar chart
  const mhrs = {};
  entries.forEach(e => {
    const n = e.mentorName || 'Unknown';
    mhrs[n] = (mhrs[n]||0) + Math.max(0, calcHours(e.startTime, e.endTime));
  });
  const sorted = Object.entries(mhrs).sort((a,b)=>b[1]-a[1]);
  const maxH = Math.max(...sorted.map(x=>x[1]), 1);
  document.getElementById('mentor-hours-chart').innerHTML = sorted.length ?
    sorted.map(([n,h]) => `
      <div class="mentor-row">
        <div style="min-width:130px;font-size:0.85em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n}</div>
        <div class="mentor-bar-bg"><div class="mentor-bar" style="width:${(h/maxH*100).toFixed(1)}%"></div></div>
        <div style="min-width:48px;text-align:right;font-size:0.82em;color:#555;">${h.toFixed(1)}h</div>
      </div>
    `).join('') : '<p style="color:#bbb;font-size:0.875em;">No data yet. Start by logging a session.</p>';

  // Weekly summary
  const now = new Date();
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay()+6)%7));
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const toYMD = d => d.toISOString().slice(0,10);
  const wStart = toYMD(mon), wEnd = toYMD(sun);
  const wEntries = entries.filter(e => { const d=getDate(e); return d>=wStart && d<=wEnd; });
  const wMentors = {};
  wEntries.forEach(e => {
    const n = e.mentorName||'Unknown';
    if (!wMentors[n]) wMentors[n]={sessions:0,hours:0};
    wMentors[n].sessions++;
    wMentors[n].hours += Math.max(0,calcHours(e.startTime,e.endTime));
  });
  const wHrs = Object.values(wMentors).reduce((a,b)=>a+b.hours,0);
  document.getElementById('weekly-summary').innerHTML = `
    <p style="font-size:0.78em;color:#888;margin-bottom:14px;">${fmtDate(wStart)} — ${fmtDate(wEnd)}</p>
    <div style="display:flex;gap:24px;margin-bottom:18px;">
      <div><div style="font-size:2em;font-weight:800;color:var(--primary);">${wEntries.length}</div><div style="font-size:0.75em;color:#999;text-transform:uppercase;">Sessions</div></div>
      <div><div style="font-size:2em;font-weight:800;color:var(--primary);">${wHrs.toFixed(1)}</div><div style="font-size:0.75em;color:#999;text-transform:uppercase;">Hours</div></div>
    </div>
    ${Object.entries(wMentors).length ? `
      <table style="width:100%;font-size:0.84em;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid #f0f0f0;">
          <th style="text-align:left;padding:4px 0;color:#666;font-weight:600;">Mentor</th>
          <th style="text-align:center;color:#666;font-weight:600;">Sessions</th>
          <th style="text-align:center;color:#666;font-weight:600;">Hours</th>
        </tr></thead>
        <tbody>${Object.entries(wMentors).map(([n,d])=>`
          <tr style="border-bottom:1px solid #f5f5f5;">
            <td style="padding:6px 0;">${n}</td>
            <td style="text-align:center;">${d.sessions}</td>
            <td style="text-align:center;">${d.hours.toFixed(1)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p style="color:#bbb;font-size:0.875em;">No entries this week.</p>'}
  `;

  // Service breakdown
  const svcCount = {};
  entries.forEach(e => {
    const types = Array.isArray(e.supportTypes) ? e.supportTypes : [];
    const act = e.activityType ? [e.activityType] : [];
    [...types,...act].filter(Boolean).forEach(t => { svcCount[t]=(svcCount[t]||0)+1; });
  });
  const topSvc = Object.entries(svcCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const maxS = Math.max(...topSvc.map(x=>x[1]),1);
  document.getElementById('service-breakdown').innerHTML = topSvc.length ?
    topSvc.map(([n,c]) => `
      <div class="mentor-row">
        <div style="min-width:170px;font-size:0.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n}</div>
        <div class="mentor-bar-bg"><div class="mentor-bar" style="width:${(c/maxS*100).toFixed(1)}%;background:var(--purple)"></div></div>
        <div style="min-width:30px;text-align:right;font-size:0.82em;color:#555;">${c}</div>
      </div>
    `).join('') : '<p style="color:#bbb;font-size:0.875em;">No service data yet.</p>';

  // Safety flags
  const flags = entries.filter(e => e.safetyConcerns && e.safetyConcerns!=='No concerns' && e.safetyConcerns!=='no').slice(-5).reverse();
  document.getElementById('safety-flags-dash').innerHTML = flags.length ?
    flags.map(e=>`
      <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5;">
        ${safeConcernBadge(e.safetyConcerns)}
        <div>
          <div style="font-size:0.875em;font-weight:600;">${e.mentorName||''} — ${fmtDate(getDate(e))}</div>
          <div style="font-size:0.8em;color:#666;margin-top:2px;">${e.concernDescription||e.safetyDescription||'No description'}</div>
        </div>
      </div>
    `).join('') : '<p style="color:#bbb;font-size:0.875em;">No safety flags reported.</p>';
}

// Team activity strip: each staff member with active task + message counts
function renderDashboardStaff(){
  const el = document.getElementById('dash-staff-grid');
  if (!el) return;
  const staff = DB.staff().slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if (!staff.length){ el.innerHTML='<p style="color:#bbb;font-size:0.85em;">No staff yet. Add team members in Staff &amp; Settings.</p>'; return; }
  const tasks = DB.tasks(), msgs = DB.messages();
  const colors = ['#1e3a8a','#7c4dff','#2f9bb5','#43a047','#fb8c00','#d81b60','#00897b','#5b21b6','#3949ab','#c2185b'];
  el.innerHTML = staff.map(s=>{
    const name = s.name||'';
    const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) || '?';
    let h=0; for (let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
    const color = colors[h % colors.length];
    const activeTasks = tasks.filter(t=>t.mentorName===name && t.status!=='Done').length;
    const activeMsgs  = msgs.filter(m=>m.mentorName===name && !m.read).length;
    const nm = name.replace(/'/g,"\\'");
    const avatar = s.photo
      ? `<div style="width:48px;height:48px;border-radius:50%;background-image:url('${s.photo}');background-size:cover;background-position:center;border:1px solid #e5e9f0;"></div>`
      : `<div style="width:48px;height:48px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1em;">${initials}</div>`;
    return `<div onclick="openMentorTasks('${nm}','breakdown')" title="View ${fEsc(name)}'s tasks &amp; breakdown"
        style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:7px;width:112px;padding:13px 8px;border:1px solid #e5e9f0;border-radius:14px;background:#fff;">
      ${avatar}
      <div style="font-size:0.78em;font-weight:600;text-align:center;line-height:1.2;color:#333;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fEsc(name)}</div>
      <div style="display:flex;gap:6px;">
        <span title="Active tasks" style="font-size:0.7em;background:#fff4e5;color:#b25e00;border-radius:20px;padding:2px 7px;font-weight:700;">🗒 ${activeTasks}</span>
        <span title="Unread messages" style="font-size:0.7em;background:${activeMsgs?'#fdecea':'#eef3fb'};color:${activeMsgs?'#c62828':'#5a6b8c'};border-radius:20px;padding:2px 7px;font-weight:700;">✉ ${activeMsgs}</span>
      </div>
    </div>`;
  }).join('');
}

// Admin-only: customize which metric cards show on the dashboard
function openDashboardConfig(){
  requireAdmin(()=>{
    const selected = getDashboardMetrics();
    const groups = [...new Set(DASH_METRICS.map(m=>m.group))];
    document.getElementById('dash-modal-list').innerHTML = groups.map(g=>
      `<div style="grid-column:1/-1;font-size:0.72em;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--primary);margin:8px 0 2px;">${g}</div>` +
      DASH_METRICS.filter(m=>m.group===g).map(m=>
        `<label style="display:flex;align-items:center;gap:8px;font-size:0.88em;padding:3px 0;cursor:pointer;">
          <input type="checkbox" value="${m.id}" ${selected.includes(m.id)?'checked':''}> ${m.label}
        </label>`).join('')
    ).join('');
    document.getElementById('dash-modal-err').textContent = '';
    document.getElementById('dash-modal').style.display = 'flex';
  });
}
function closeDashboardConfig(){ document.getElementById('dash-modal').style.display = 'none'; }
async function saveDashboardConfig(){
  const checked = [...document.querySelectorAll('#dash-modal-list input:checked')].map(c=>c.value);
  if (!checked.length) { document.getElementById('dash-modal-err').textContent = 'Pick at least one metric.'; return; }
  if (checked.length > 6) { document.getElementById('dash-modal-err').textContent = 'Pick at most 6 metrics for the top row.'; return; }
  // Preserve catalog order for a tidy layout
  const ordered = DASH_METRICS.filter(m=>checked.includes(m.id)).map(m=>m.id);
  await DB.setDashboardConfig(ordered);
  closeDashboardConfig();
  renderDashboard();
}

// Per-mentor: customize their own bottom-row metrics
function openMyMetricsConfig(){
  const selected = getMyMetricIds();
  document.getElementById('mymetrics-list').innerHTML = MY_METRICS.map(m=>
    `<label style="display:flex;align-items:center;gap:8px;font-size:0.88em;padding:3px 0;cursor:pointer;">
      <input type="checkbox" value="${m.id}" ${selected.includes(m.id)?'checked':''}> ${m.label}
    </label>`).join('');
  document.getElementById('mymetrics-err').textContent = '';
  document.getElementById('mymetrics-modal').style.display = 'flex';
}
function closeMyMetricsConfig(){ document.getElementById('mymetrics-modal').style.display = 'none'; }
async function saveMyMetricsConfig(){
  const checked = [...document.querySelectorAll('#mymetrics-list input:checked')].map(c=>c.value);
  if (!checked.length) { document.getElementById('mymetrics-err').textContent = 'Pick at least one metric.'; return; }
  if (checked.length > 6) { document.getElementById('mymetrics-err').textContent = 'Pick at most 6 metrics.'; return; }
  const ordered = MY_METRICS.filter(m=>checked.includes(m.id)).map(m=>m.id);
  await setMyMetricIds(ordered);
  closeMyMetricsConfig();
  renderMyMetrics();
}

export { renderDashboard, renderDashboardStaff, dashWeekStats, getDashboardMetrics, renderMyMetrics,
  openDashboardConfig, closeDashboardConfig, saveDashboardConfig,
  openMyMetricsConfig, closeMyMetricsConfig, saveMyMetricsConfig };
