import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
let _spId=null;
const SP_GOAL_STATUS=['Not started','In progress','On track','Behind','Completed','Paused'];
function spClientLabel(p){ return p.clientName||p.clientId||'Unnamed client'; }
function spGoalRow(g){
  g=g||{};
  return `<div class="card" style="padding:12px;margin-bottom:10px;" data-goal>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div class="form-group" style="flex:1;min-width:150px;margin:0;"><label>Goal area</label><input class="sp-g-cat" value="${fEsc(g.category||'')}" placeholder="Housing, Employment…"></div>
      <div class="form-group" style="margin:0;"><label>Status</label><select class="sp-g-status">${SP_GOAL_STATUS.map(s=>`<option ${g.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="form-group" style="margin:0;"><label>Target</label><input type="date" class="sp-g-target" value="${fEsc(g.targetDate||'')}"></div>
      <button class="btn btn-outline" style="font-size:0.8em;" onclick="this.closest('[data-goal]').remove()">×</button>
    </div>
    <div class="form-group" style="margin:8px 0 0;"><label>Goal statement</label><textarea class="sp-g-statement" rows="2">${fEsc(g.statement||'')}</textarea></div>
    <div class="form-group" style="margin:8px 0 0;"><label>Next step</label><input class="sp-g-next" value="${fEsc(g.nextStep||'')}"></div>
  </div>`;
}
function spAddGoal(g){ document.getElementById('sp-goals').insertAdjacentHTML('beforeend', spGoalRow(g)); }
function spFillClientId(){ const v=document.getElementById('sp-clientName').value.trim().toLowerCase(); const c=DB.clients().find(x=>clientFullName(x).toLowerCase()===v); if(c) document.getElementById('sp-clientId').value=c.clientId||''; }
function renderServicePlans(){
  const el=document.getElementById('sp-list'); if(!el) return;
  const all=DB.servicePlans();
  const q=(document.getElementById('sp-search')?.value||'').toLowerCase();
  let list=all.slice().reverse();
  if(q) list=list.filter(p=>JSON.stringify(p).toLowerCase().includes(q));
  if(!all.length){ el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:40px;">No service plans yet. Click "＋ New Service Plan" to build one (linked to clients, mentors, and progress notes).</div>'; return; }
  if(!list.length){ el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:30px;">No plans match your search.</div>'; return; }
  el.innerHTML=list.map(p=>{
    const goals=p.goals||[]; const open=goals.filter(g=>g.status!=='Completed').length;
    return `<div class="card" style="margin-bottom:12px;cursor:pointer;" onclick="openServicePlan('${p._id}')">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div><span style="font-weight:700;color:var(--primary);">${fEsc(spClientLabel(p))}</span> <span style="color:#999;font-size:0.85em;">${p.clientId?'#'+fEsc(p.clientId):''}</span></div>
        <span class="badge ${p.stage==='Closed'?'badge-success':'badge-info'}">${fEsc(p.stage||'Active')}</span>
      </div>
      <div style="font-size:0.82em;color:#777;margin-top:4px;">${p.mentor?'👤 '+fEsc(p.mentor)+' · ':''}${goals.length} goal${goals.length!==1?'s':''} (${open} open)${(p.domains&&p.domains.length)?' · '+fEsc((Array.isArray(p.domains)?p.domains:[p.domains]).join(', ')):''}</div>
    </div>`;
  }).join('');
}
function openServicePlan(id){
  const set=(i,val)=>{const e=document.getElementById(i); if(e) e.value=val==null?'':val;};
  document.getElementById('sp-goals').innerHTML='';
  if(id){
    const p=DB.servicePlans().find(x=>x._id===id); if(!p) return;
    if(!isOwnerOrAdmin(p.mentor)){ alert('Only the plan\'s mentor or an admin can edit this plan.'); return; }
    _spId=id;
    document.getElementById('sp-modal-title').textContent='Edit Service Plan';
    set('sp-id',id); set('sp-clientName',p.clientName); set('sp-clientId',p.clientId); set('sp-mentor',p.mentor);
    set('sp-stage',p.stage||'Intake'); set('sp-start',p.startDate); set('sp-review',p.reviewDate);
    set('sp-domains',Array.isArray(p.domains)?p.domains.join(', '):(p.domains||''));
    set('sp-needs',p.needsSummary); set('sp-strengths',p.strengths); set('sp-barriers',p.barriers);
    (p.goals&&p.goals.length?p.goals:[{}]).forEach(spAddGoal);
    document.getElementById('sp-stage').value=p.stage||'Intake';
    document.getElementById('sp-delete-btn').style.display=isAdmin()?'inline-flex':'none';
  } else {
    _spId=null;
    document.getElementById('sp-modal-title').textContent='New Service Plan';
    ['sp-id','sp-clientName','sp-clientId','sp-domains','sp-needs','sp-strengths','sp-barriers','sp-start','sp-review'].forEach(i=>set(i,''));
    set('sp-mentor', currentUserName()); document.getElementById('sp-stage').value='Intake';
    spAddGoal({});
    document.getElementById('sp-delete-btn').style.display='none';
  }
  document.getElementById('sp-modal').style.display='flex';
}
function closeServicePlan(){ document.getElementById('sp-modal').style.display='none'; _spId=null; }
async function saveServicePlan(){
  const v=i=>document.getElementById(i).value.trim();
  const goals=[...document.querySelectorAll('#sp-goals [data-goal]')].map(c=>({
    category:c.querySelector('.sp-g-cat').value.trim(),
    status:c.querySelector('.sp-g-status').value,
    targetDate:c.querySelector('.sp-g-target').value,
    statement:c.querySelector('.sp-g-statement').value.trim(),
    nextStep:c.querySelector('.sp-g-next').value.trim()
  })).filter(g=>g.category||g.statement);
  const data={
    clientName:v('sp-clientName'), clientId:v('sp-clientId'), mentor:v('sp-mentor'),
    stage:document.getElementById('sp-stage').value, startDate:v('sp-start'), reviewDate:v('sp-review'),
    domains:v('sp-domains').split(',').map(s=>s.trim()).filter(Boolean),
    needsSummary:v('sp-needs'), strengths:v('sp-strengths'), barriers:v('sp-barriers'), goals
  };
  if(!data.clientName && !data.clientId){ alert('Enter a client name or ID first.'); return; }
  if(_spId) await DB.updateServicePlan(_spId, data); else await DB.addServicePlan(data);
  closeServicePlan();
}
function deleteServicePlan(){ if(!_spId) return; requireAdmin(async()=>{ if(!confirm('Delete this service plan? This cannot be undone.')) return; await DB.removeServicePlan(_spId); closeServicePlan(); }); }

export { renderServicePlans, openServicePlan, closeServicePlan, saveServicePlan, deleteServicePlan,
  spAddGoal, spFillClientId };
