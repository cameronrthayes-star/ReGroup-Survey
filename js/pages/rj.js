import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
const RJ_STEPS = [
  { key:'assessment', title:'Assessment', focus:'Initial case review, suitability analysis, and harm-risk screening. Identify participants and assign a tentative mentor + two facilitators.', fields:[
    {id:'referralSource', label:'Referral source', type:'select', options:['Self-referral','Community referral','System referral']},
    {id:'suitability', label:'Suitability — can this be addressed restoratively? (capacity, safety, ethics)', type:'textarea'},
    {id:'harmRisk', label:'Harm-risk screening & power-imbalance notes', type:'textarea'},
    {id:'participants', label:'Participants (use numbers/roles — no incriminating detail)', type:'textarea'},
    {id:'tentMentor', label:'Tentative mentor', type:'text'},
    {id:'tentFac1', label:'Facilitator 1 (dual-facilitator model)', type:'text'},
    {id:'tentFac2', label:'Facilitator 2', type:'text'},
    {id:'directorAccepted', label:'Regroup Director accepted the case (with RJ Team input)', type:'check'},
  ]},
  { key:'intake', title:'Intake', focus:'Voluntariness, informed participation, rights, and confidentiality. Assign one mentor and two facilitators.', fields:[
    {id:'voluntary', label:'Participation confirmed voluntary — not coerced (F06)', type:'check'},
    {id:'rights', label:'Participant rights reviewed — may withdraw anytime (F07)', type:'check'},
    {id:'confidentiality', label:'Confidentiality & info-sharing reviewed — ORS 147.610 (F08)', type:'check'},
    {id:'mandatoryReporter', label:'Mandatory-reporter disclosure, if any RJ Team member is one (F11)', type:'text'},
    {id:'mentor', label:'Assigned mentor', type:'text'},
    {id:'facilitator1', label:'Facilitator 1', type:'text'},
    {id:'facilitator2', label:'Facilitator 2', type:'text'},
    {id:'hopes', label:"Participant's understanding of the harm, needs, and hopes", type:'textarea'},
    {id:'demographics', label:'Demographics / contact, de-identified (F01)', type:'textarea'},
  ]},
  { key:'restorative', title:'Restorative Work', focus:'Education, positive modeling, and circles (minimum 3 before any conference). Build a participant plan and readiness.', fields:[
    {id:'education', label:'Some aspect of education provided', type:'check'},
    {id:'modeling', label:'Positive modeling of interpersonal relationships', type:'check'},
    {id:'circlesCount', label:'Circles completed (minimum 3)', type:'number'},
    {id:'participantPlan', label:'Participant plan — wants, supports/barriers, next steps (F03)', type:'textarea'},
    {id:'activities', label:'Activities (psychoeducation, mentor contact, prep for dialogue/surrogate/healing circle/conference)', type:'textarea'},
    {id:'processType', label:'Selected restorative process', type:'select', options:['Undecided','Continue separate work','Parallel separate work','Healing circle','Surrogate process','Victim-offender dialogue / conference']},
    {id:'goals', label:'Participant goals — participant-owned (F04)', type:'textarea'},
  ]},
  { key:'debrief', title:'Debrief', focus:'Stabilize participants after major process points; reflect and note support needs. Do not record incriminating information.', fields:[
    {id:'emotionalState', label:'Emotional state & immediate support needs', type:'textarea'},
    {id:'whatOccurred', label:'What each participant believes occurred', type:'textarea'},
    {id:'followUp', label:'Goals / follow-up tasks / clarifications', type:'textarea'},
  ]},
  { key:'closure', title:'Closure', focus:'Formal RJ Team closing decision. A case counts as complete only after formal closure.', fields:[
    {id:'twoFacilitators', label:'Two facilitators present for final case work', type:'check'},
    {id:'summary', label:'Facilitators’ summary of process & immediate outcomes', type:'textarea'},
    {id:'nextSteps', label:'Next-step goals / support contacts', type:'textarea'},
    {id:'rjTeamApproved', label:'RJ Team agrees no further active casework is needed (marks case Closed)', type:'check'},
  ]},
  { key:'checkins', title:'Check-Ins', focus:'Follow-through, not punishment monitoring. Revisit goals, encourage revision, and document progress. Add a check-in each time you follow up.', fields:[] },
];
let _rjId = null, _rjStep = 0;
function rjCaseById(id){ return DB.rjCases().find(c=>c._id===id); }
function rjStatusBadge(c){ const s=c.status||'Open'; const cls=s==='Closed'?'badge-success':s==='Withdrawn'?'badge-warn':'badge-info'; return `<span class="badge ${cls}">${s}</span>`; }

function renderRJ(){
  const el=document.getElementById('rj-list'); if(!el) return;
  const cases=DB.rjCases().slice().sort((a,b)=>(b.caseNumber||0)-(a.caseNumber||0));
  if(!cases.length){ el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:40px;">No cases yet. Click “＋ New Case” to begin a guided restorative-justice case.</div>'; return; }
  el.innerHTML=cases.map(c=>{
    const done=c.currentStep||0;
    return `<div class="card" style="margin-bottom:12px;cursor:pointer;" onclick="openRJCase('${c._id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div><span style="font-weight:700;color:var(--primary);">Case #${c.caseNumber||'?'}</span>
          <span style="color:#777;font-size:0.85em;margin-left:8px;">${fEsc(c.referralSource||'')}</span></div>
        ${rjStatusBadge(c)}
      </div>
      <div style="display:flex;gap:3px;margin-top:10px;">${RJ_STEPS.map((s,i)=>`<div title="${s.title}" style="flex:1;height:6px;border-radius:3px;background:${i<done?'var(--success)':i===done?'var(--accent)':'#e0e0e0'};"></div>`).join('')}</div>
      <div style="font-size:0.78em;color:#888;margin-top:6px;">Stage ${Math.min(done+1,6)}/6 — ${RJ_STEPS[Math.min(done,5)].title}</div>
    </div>`;
  }).join('');
}
async function openRJCase(id){
  if(!id){
    const nums=DB.rjCases().map(c=>c.caseNumber||0);
    const caseNumber=(nums.length?Math.max(...nums):1000)+1;
    id=await DB.addRJCase({caseNumber, status:'Open', currentStep:0, referralSource:'Self-referral', createdBy:currentUserName()});
    await new Promise(r=>setTimeout(r,350));
  }
  _rjId=id;
  const c=rjCaseById(id);
  _rjStep=c?Math.min(c.currentStep||0,RJ_STEPS.length-1):0;
  document.getElementById('rj-delete-btn').style.display=isAdmin()?'inline-flex':'none';
  rjRenderStep();
  document.getElementById('rj-modal').style.display='flex';
}
function closeRJCase(){ document.getElementById('rj-modal').style.display='none'; _rjId=null; if(document.getElementById('view-rj')?.classList.contains('active')) renderRJ(); }
function rjField(f,val){
  const v=val==null?'':val;
  if(f.type==='textarea') return `<textarea id="rjf-${f.id}" rows="2" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9em;min-height:54px;">${fEsc(v)}</textarea>`;
  if(f.type==='select') return `<select id="rjf-${f.id}" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9em;">${f.options.map(o=>`<option ${o===v?'selected':''}>${o}</option>`).join('')}</select>`;
  if(f.type==='check') return `<label style="display:flex;align-items:center;gap:8px;font-size:0.9em;cursor:pointer;"><input type="checkbox" id="rjf-${f.id}" ${v?'checked':''}> ${fEsc(f.label)}</label>`;
  if(f.type==='number') return `<input type="number" id="rjf-${f.id}" min="0" value="${fEsc(v)}" style="width:120px;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9em;">`;
  return `<input type="text" id="rjf-${f.id}" value="${fEsc(v)}" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9em;">`;
}
function rjRenderStep(){
  const c=rjCaseById(_rjId); if(!c){ closeRJCase(); return; }
  const step=RJ_STEPS[_rjStep], done=c.currentStep||0;
  document.getElementById('rj-modal-title').textContent='Case #'+(c.caseNumber||'?')+' — '+step.title;
  document.getElementById('rj-status-pill').innerHTML=rjStatusBadge(c);
  document.getElementById('rj-step-label').textContent='Stage '+(_rjStep+1)+' of 6 · '+step.title;
  document.getElementById('rj-stepbar').innerHTML=RJ_STEPS.map((s,i)=>`<div title="${s.title}" onclick="rjGoStep(${i})" style="flex:1;height:8px;border-radius:4px;cursor:pointer;background:${i<done?'var(--success)':i===_rjStep?'var(--accent)':'#e0e0e0'};"></div>`).join('');
  const data=c[step.key]||{};
  let body=`<p style="font-size:0.85em;color:#666;margin-bottom:14px;">${step.focus}</p>`;
  if(step.key==='checkins'){
    const cis=c.checkins||[];
    body+=(cis.length?cis.slice().reverse().map(ci=>`<div style="background:#f8f9fa;border-radius:8px;padding:10px;margin-bottom:8px;font-size:0.86em;"><b>${ci.date?fmtDate(ci.date):''}</b> — ${fEsc(ci.progress||'')}${ci.notes?`<div style="color:#666;margin-top:3px;">${fEsc(ci.notes)}</div>`:''}${ci.by?`<div style="color:#bbb;font-size:0.85em;margin-top:2px;">${fEsc(ci.by)}</div>`:''}</div>`).join(''):'<p style="color:#bbb;font-size:0.85em;">No check-ins logged yet.</p>')
      +`<div style="background:#eef3fb;border-radius:10px;padding:12px;margin-top:10px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
            <div style="display:flex;flex-direction:column;"><label style="font-size:0.72em;color:#777;">Date</label><input type="date" id="rjci-date" value="${new Date().toISOString().slice(0,10)}" style="padding:7px;border:1.5px solid #ddd;border-radius:7px;"></div>
            <div style="display:flex;flex-direction:column;flex:1;min-width:160px;"><label style="font-size:0.72em;color:#777;">Goal progress / revision</label><input type="text" id="rjci-progress" style="padding:7px;border:1.5px solid #ddd;border-radius:7px;"></div>
            <button class="btn btn-accent" style="font-size:0.8em;" onclick="rjAddCheckin()">+ Add Check-In</button>
          </div>
          <textarea id="rjci-notes" rows="2" placeholder="Notes (support offered, barriers)…" style="width:100%;margin-top:8px;padding:7px;border:1.5px solid #ddd;border-radius:7px;font-size:0.88em;"></textarea>
        </div>`;
  } else {
    body+=step.fields.map(f=> f.type==='check'
      ? `<div class="form-group">${rjField(f,data[f.id])}</div>`
      : `<div class="form-group"><label>${fEsc(f.label)}</label>${rjField(f,data[f.id])}</div>`).join('');
  }
  document.getElementById('rj-step-body').innerHTML=body;
  document.getElementById('rj-back-btn').style.display=_rjStep>0?'inline-flex':'none';
  document.getElementById('rj-next-btn').textContent=_rjStep>=RJ_STEPS.length-1?'Done':'Save & Continue ›';
}
function rjCollectStep(){
  const step=RJ_STEPS[_rjStep]; const out={};
  if(step.key==='checkins') return out;
  step.fields.forEach(f=>{ const el=document.getElementById('rjf-'+f.id); if(!el) return;
    out[f.id]=f.type==='check'?el.checked:(f.type==='number'?(parseFloat(el.value)||0):el.value.trim()); });
  return out;
}
async function rjSaveAndNext(){
  const c=rjCaseById(_rjId); if(!c) return;
  const step=RJ_STEPS[_rjStep];
  if(_rjStep>=RJ_STEPS.length-1){ closeRJCase(); return; }   // check-ins step: Done
  const patch={};
  patch[step.key]=rjCollectStep();
  patch.currentStep=Math.max(c.currentStep||0,_rjStep+1);
  if(step.key==='assessment') patch.referralSource=patch.assessment.referralSource;
  if(step.key==='closure' && patch.closure.rjTeamApproved) patch.status='Closed';
  await DB.updateRJCase(_rjId, patch);
  _rjStep++;
  await new Promise(r=>setTimeout(r,150));
  rjRenderStep();
}
function rjBack(){ if(_rjStep>0){ _rjStep--; rjRenderStep(); } }
function rjGoStep(i){ _rjStep=Math.max(0,Math.min(i,RJ_STEPS.length-1)); rjRenderStep(); }
async function rjAddCheckin(){
  const c=rjCaseById(_rjId); if(!c) return;
  const date=document.getElementById('rjci-date').value;
  const progress=document.getElementById('rjci-progress').value.trim();
  const notes=document.getElementById('rjci-notes').value.trim();
  if(!progress && !notes){ alert('Add some check-in detail first.'); return; }
  const checkins=[...(c.checkins||[]), {date, progress, notes, by:currentUserName()}];
  await DB.updateRJCase(_rjId, {checkins, currentStep:Math.max(c.currentStep||0,5)});
  await new Promise(r=>setTimeout(r,200));
  rjRenderStep();
}
function deleteRJCase(){ if(!_rjId) return; requireAdmin(async()=>{ if(!confirm('Delete this RJ case permanently? This cannot be undone.')) return; await DB.removeRJCase(_rjId); closeRJCase(); }); }

export { renderRJ, openRJCase, closeRJCase, rjSaveAndNext, rjBack, rjGoStep,
  rjAddCheckin, deleteRJCase };
