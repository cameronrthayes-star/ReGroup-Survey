import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
function switchTab(tabId, btn) {
  // Scope to the current view so only this view's tabs swap (previously this
  // was hardcoded to #view-data-view, so tabs in other views stacked instead
  // of replacing each other).
  const scope = (btn && btn.closest('.view')) || document;
  scope.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  ((btn && btn.closest('.tabs')) || scope).querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');
}

function renderDataView() {
  renderTimesheetTable();
  renderSummaryTable();
  renderSafetyTable();
  renderAllData();
  populateMentorFilter();
}

// Data View entries are scoped to the current user (admins see everyone)
function dvEntries(){
  return isAdmin() ? DB.allEntries()
    : DB.allEntries().filter(e => ((e._owner||e.mentorName)||'') === currentUserName());
}

function renderTimesheetTable() {
  const entries = dvEntries();
  const tbody = document.querySelector('#timesheet-table tbody');
  tbody.innerHTML = entries.length ? entries.map(e=>`
    <tr>
      <td>${e.mentorName||''}</td>
      <td>${fmtDate(getDate(e))}</td>
      <td>${fmtTime(e.startTime)}</td>
      <td>${fmtTime(e.endTime)}</td>
      <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getActivityLabel(e)}</td>
      <td>${Math.max(0,calcHours(e.startTime,e.endTime)).toFixed(2)}</td>
      <td>${e.grant||''}</td>
      <td><span class="badge ${e._type==='client'?'badge-info':'badge-success'}">${e._type==='client'?'Client':'Activity'}</span></td>
    </tr>
  `).join('') : '<tr><td colspan="8" style="text-align:center;color:#bbb;padding:30px;">No entries yet.</td></tr>';
}

function renderSummaryTable() {
  const mentorData = {};
  dvEntries().forEach(e=>{
    const n = e.mentorName||'Unknown';
    if (!mentorData[n]) mentorData[n]={sessions:0,hours:0};
    mentorData[n].sessions++;
    mentorData[n].hours += Math.max(0,calcHours(e.startTime,e.endTime));
  });
  const tbody = document.querySelector('#summary-table tbody');
  const rows = Object.entries(mentorData).sort((a,b)=>a[0].localeCompare(b[0]));
  tbody.innerHTML = rows.length ? rows.map(([n,d])=>`
    <tr><td>${n}</td><td style="text-align:center">${d.sessions}</td><td style="text-align:center">${d.hours.toFixed(2)}</td></tr>
  `).join('') : '<tr><td colspan="3" style="text-align:center;color:#bbb;padding:30px;">No data yet.</td></tr>';
}

function renderSafetyTable() {
  const entries = dvEntries().filter(e=>e.safetyConcerns && e.safetyConcerns!=='No concerns' && e.safetyConcerns!=='no');
  const tbody = document.querySelector('#safety-table tbody');
  tbody.innerHTML = entries.length ? entries.map(e=>`
    <tr>
      <td>${e.mentorName||''}</td>
      <td>${fmtDate(getDate(e))}</td>
      <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getActivityLabel(e)}</td>
      <td>${safeConcernBadge(e.safetyConcerns)}</td>
      <td>${e.concernDescription||e.safetyDescription||''}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:30px;">No safety concerns logged.</td></tr>';
}

function renderAllData() {
  const search = (document.getElementById('search-input').value||'').toLowerCase();
  const typeF  = document.getElementById('filter-type').value;
  const mentorF= document.getElementById('filter-mentor').value;
  let entries = dvEntries();
  if (typeF) entries = entries.filter(e=>e._type===typeF);
  if (mentorF) entries = entries.filter(e=>e.mentorName===mentorF);
  if (search) entries = entries.filter(e=>JSON.stringify(e).toLowerCase().includes(search));
  const tbody = document.querySelector('#all-data-table tbody');
  tbody.innerHTML = entries.length ? entries.map(e=>`
    <tr>
      <td><span class="badge ${e._type==='client'?'badge-info':'badge-success'}">${e._type==='client'?'Client':'Activity'}</span></td>
      <td>${e.mentorName||''}</td>
      <td>${fmtDate(getDate(e))}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getActivityLabel(e)}</td>
      <td style="font-size:0.82em;">${e.serviceOutcome||e.immediateOutcome||''}</td>
      <td>${Math.max(0,calcHours(e.startTime,e.endTime)).toFixed(2)}</td>
      <td>${e.grant||''}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:30px;">No entries found.</td></tr>';
}

function populateMentorFilter() {
  const mentors = [...new Set(dvEntries().map(e=>e.mentorName).filter(Boolean))].sort();
  const sel = document.getElementById('filter-mentor');
  sel.innerHTML = '<option value="">All mentors</option>' + mentors.map(m=>`<option value="${m}">${m}</option>`).join('');
}

function filterPayPeriod() {
  const start = document.getElementById('pp-start').value;
  const end   = document.getElementById('pp-end').value;
  let entries = dvEntries();
  if (start) entries = entries.filter(e=>getDate(e)>=start);
  if (end)   entries = entries.filter(e=>getDate(e)<=end);
  const tbody = document.querySelector('#pp-table tbody');
  tbody.innerHTML = entries.length ? entries.map(e=>`
    <tr>
      <td>${e.mentorName||''}</td>
      <td>${fmtDate(getDate(e))}</td>
      <td>${fmtTime(e.startTime)}</td>
      <td>${fmtTime(e.endTime)}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getActivityLabel(e)}</td>
      <td>${Math.max(0,calcHours(e.startTime,e.endTime)).toFixed(2)}</td>
      <td>${e.grant||''}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">No entries in this period.</td></tr>';
}

function exportTableCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  const rows = [...table.querySelectorAll('tr')];
  const csv = rows.map(r=>[...r.querySelectorAll('th,td')].map(c=>
    `"${c.innerText.replace(/"/g,'""')}"`
  ).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// TIMESHEET GENERATOR

function exportData() {
  const blob = new Blob([JSON.stringify({
    sessions: DB.sessions().map(({_type,...s})=>s),
    activities: DB.activities().map(({_type,...a})=>a),
    staff: DB.staff(),
    exportedAt: new Date().toISOString()
  },null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`regroup-data-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function importDataJSON(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if(d.sessions)   await DB.saveSessions(d.sessions);
      if(d.activities) await DB.saveActivities(d.activities);
      showImportMsg('success',`✅ Imported: ${(d.sessions||[]).length} sessions, ${(d.activities||[]).length} activities.`);
    } catch(err) { showImportMsg('danger','❌ Error: '+err.message); }
  };
  reader.readAsText(file);
}

function parseCSVLine(line) {
  const result=[]; let cur='',inQ=false;
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){inQ=!inQ;}
    else if(line[i]===',' && !inQ){result.push(cur.trim());cur='';}
    else{cur+=line[i];}
  }
  result.push(cur.trim()); return result;
}

function csvHeaderToKey(h) {
  return h.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+(.)/g,(_,c)=>c.toUpperCase());
}

function importCSV(e, type) {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const lines=ev.target.result.split(/\r?\n/).filter(l=>l.trim());
      const headers=parseCSVLine(lines[0]).map(csvHeaderToKey);
      const records=lines.slice(1).filter(l=>l.trim()).map(line=>{
        const vals=parseCSVLine(line);
        const obj={id:uuid(),type,submittedAt:new Date().toISOString()};
        headers.forEach((h,i)=>{ if(h) obj[h]=vals[i]||''; });
        if(obj.mentorName===undefined) obj.mentorName = obj.name||obj.mentor||'';
        if(obj.dateOfService===undefined && type==='client') obj.dateOfService = obj.date||obj.dateOfActivity||'';
        if(obj.dateOfActivity===undefined && type==='activity') obj.dateOfActivity = obj.date||'';
        return obj;
      });
      if(type==='client') await DB.saveSessions(records);
      else await DB.saveActivities(records);
      showImportMsg('success',`✅ Imported ${records.length} ${type} records.`);
    } catch(err){ showImportMsg('danger','❌ Error: '+err.message); }
  };
  reader.readAsText(file);
}

function showImportMsg(type, msg) {
  const el=document.getElementById('import-msg');
  el.className=`alert alert-${type}`; el.textContent=msg; el.style.display='block';
  setTimeout(()=>el.style.display='none',6000);
}

function clearAllData() {
  if(!confirm('This will permanently delete all session and activity data from Firestore. This cannot be undone. Continue?')) return;
  showImportMsg('warn','⚠️ To clear all data, delete the sessions and activities collections directly in the Firebase console.');
}

// SHARED CALENDAR
export { renderDataView, switchTab, renderTimesheetTable, renderSummaryTable,
  renderSafetyTable, renderAllData, exportTableCSV, exportData, importDataJSON, importCSV, clearAllData };
