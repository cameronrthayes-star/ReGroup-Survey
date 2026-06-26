import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
import { meetingBotBaseUrl, ensureMeetingBotSession } from './calendar.js';
let _activeProjectId = null;

function renderProjects() {
  if (_projectsView==='kanban') renderKanban();
  if (_projectsView==='gantt') renderGantt();
  const el = document.getElementById('projects-list');
  if (!el) return;
  const projects = DB.projects();
  if (!projects.length) { el.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:40px;">No projects yet. Click "+ New Project" to get started.</div>'; return; }
  const statusColor = {Active:'var(--accent)',Completed:'var(--success)','On Hold':'var(--warn)',Cancelled:'#ccc'};
  el.innerHTML = projects.map(p => {
    const last = p.updates&&p.updates.length ? p.updates[p.updates.length-1] : null;
    const isPMI = p.type==='pmi';
    const pmiPhases = ['initiation','planning','execution','monitoring','closing'];
    const pmiDone = isPMI ? pmiPhases.filter(k=>p.pmi&&p.pmi[k]&&p.pmi[k].complete).length : 0;
    const pmiBar = isPMI ?
      '<div style="margin-top:10px;">' +
        '<div style="display:flex;gap:3px;margin-bottom:4px;">' +
          pmiPhases.map(k=>'<div style="flex:1;height:5px;border-radius:3px;background:' + (p.pmi&&p.pmi[k]&&p.pmi[k].complete?'var(--success)':'#e0e0e0') + ';"></div>').join('') +
        '</div>' +
        '<div style="font-size:0.72em;color:#888;">PMI Phase ' + pmiDone + '/5 complete' + (pmiDone<5?' — <span style="color:var(--accent);cursor:pointer;font-weight:600;" onclick="openPMIWizard(\''+p._id+'\')">Continue wizard →</span>':'') + '</div>' +
      '</div>' : '';
    return '<div class="card" style="border-left:4px solid ' + (isPMI?'var(--purple)':statusColor[p.status]||'var(--accent)') + ';margin-bottom:16px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;">' +
          '<div style="font-weight:700;font-size:1.05em;color:var(--primary);margin-bottom:4px;">' +
            (isPMI?'<span style="font-size:0.7em;background:var(--purple);color:#fff;border-radius:4px;padding:2px 6px;margin-right:6px;vertical-align:middle;">PMI</span>':'') +
            p.name + '</div>' +
          (p.description?'<div style="font-size:0.875em;color:#666;margin-bottom:8px;">' + p.description + '</div>':'') +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
            '<span class="badge ' + (p.status==='Completed'?'badge-success':p.status==='On Hold'?'badge-warn':'badge-info') + '">' + (p.status||'Active') + '</span>' +
            (p.assignedTo?'<span style="font-size:0.8em;color:#777;">👤 ' + p.assignedTo + '</span>':'') +
            (p.updates&&p.updates.length?'<span style="font-size:0.78em;color:#aaa;">' + p.updates.length + ' update' + (p.updates.length!==1?'s':'') + '</span>':'') +
          '</div>' +
          pmiBar +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          (isOwnerOrAdmin(p.assignedTo) && isPMI&&pmiDone<5?'<button class="btn btn-accent" style="padding:6px 12px;font-size:0.78em;" onclick="openPMIWizard(\'' + p._id + '\')">Continue PMI</button>':'') +
          (isOwnerOrAdmin(p.assignedTo)?'<button class="btn btn-outline" style="padding:6px 12px;font-size:0.78em;" onclick="openProjectModal(\'' + p._id + '\')">Edit</button>':'') +
          '<button class="btn btn-outline" style="padding:6px 12px;font-size:0.78em;" onclick="openProjectDetail(\'' + p._id + '\')">Updates →</button>' +
        '</div>' +
      '</div>' +
      (last?'<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;font-size:0.82em;color:#888;">Last update: <b>' + last.text.slice(0,80) + (last.text.length>80?'…':'') + '</b> <span style="color:#bbb;margin-left:6px;">' + new Date(last.at).toLocaleDateString() + '</span></div>':'') +
    '</div>';
  }).join('');
}

// ---- Create Task (standalone) ----
function openTaskModal(){
  const sel=document.getElementById('tm-mentor');
  const me=currentUserName();
  sel.innerHTML = '<option value="">— Select mentor —</option>' + DB.staff().map(s=>`<option ${s.name===me?'selected':''}>${fEsc(s.name)}</option>`).join('');
  document.getElementById('tm-desc').value='';
  document.getElementById('tm-related').value='';
  document.getElementById('tm-due').value='';
  document.getElementById('task-modal').style.display='flex';
}
function closeTaskModal(){ document.getElementById('task-modal').style.display='none'; }
async function saveTaskModal(){
  const mentorName=document.getElementById('tm-mentor').value;
  const description=document.getElementById('tm-desc').value.trim();
  if(!mentorName){ alert('Choose who the task is for.'); return; }
  if(!description){ alert('Enter a task description.'); return; }
  await DB.addTask({ mentorName, description, clientName:document.getElementById('tm-related').value.trim(),
    dueDate:document.getElementById('tm-due').value, status:'Open', createdBy:currentUserName(), source:'manual' });
  closeTaskModal();
}

// ---- Kanban board for projects ----
let _projectsView = 'list';
const KANBAN_COLS = ['Active','On Hold','Completed','Cancelled'];
function setProjectsView(mode){
  // clicking the active mode toggles back to list
  _projectsView = (_projectsView===mode) ? 'list' : mode;
  const listEl=document.getElementById('projects-list'), kb=document.getElementById('projects-kanban'), gt=document.getElementById('projects-gantt');
  listEl.style.display = _projectsView==='list' ? 'block':'none';
  kb.style.display = _projectsView==='kanban' ? 'block':'none';
  if(gt) gt.style.display = _projectsView==='gantt' ? 'block':'none';
  const kbBtn=document.getElementById('proj-view-toggle'); if(kbBtn) kbBtn.textContent = _projectsView==='kanban'?'📄 List View':'📋 Kanban Board';
  const gtBtn=document.getElementById('proj-gantt-toggle'); if(gtBtn) gtBtn.textContent = _projectsView==='gantt'?'📄 List View':'📊 Gantt';
  if(_projectsView==='kanban') renderKanban();
  if(_projectsView==='gantt') renderGantt();
}
function toggleProjectsView(){ setProjectsView('kanban'); }
function toggleGanttView(){ setProjectsView('gantt'); }

function renderGantt(){
  const gt=document.getElementById('projects-gantt'); if(!gt) return;
  const projects=DB.projects();
  const tasks=DB.tasks();
  const gd=t=>({ s:t.ganttStart||t.dueDate||'', e:t.ganttEnd||t.dueDate||t.ganttStart||'' });
  // collect scheduled tasks per project
  const blocks=projects.map(p=>{
    const pts=tasks.filter(t=>(t.project===p.name||t.clientName===p.name)).map(t=>({t, ...gd(t)})).filter(x=>x.s);
    return {p, pts};
  }).filter(b=>b.pts.length);
  if(!blocks.length){ gt.innerHTML='<div class="card" style="color:#bbb;text-align:center;padding:40px;">No scheduled tasks to chart yet. AI Planner projects auto-schedule their steps; or add due dates to tasks.</div>'; return; }
  // global timeline range
  let min=null,max=null;
  blocks.forEach(b=>b.pts.forEach(x=>{ if(!min||x.s<min)min=x.s; const en=x.e||x.s; if(!max||en>max)max=en; }));
  const minD=new Date(min+'T00:00:00'), maxD=new Date(max+'T00:00:00');
  const span=Math.max(1,(maxD-minD)/86400000);
  const pct=ds=>{ const d=new Date(ds+'T00:00:00'); return ((d-minD)/86400000)/span*100; };
  const isMobile = window.innerWidth < 600;
  const labelW = isMobile ? '90px' : '160px';
  gt.innerHTML = '<div class="card"><p style="font-size:0.8em;color:#999;margin-bottom:12px;">'+fmtDate(min)+' → '+fmtDate(max)+'</p>' +
    blocks.map(b=>`<div style="margin-bottom:18px;">
      <div style="font-weight:700;color:var(--primary);margin-bottom:8px;">${b.p.type==='pmi'?'🏗 ':''}${fEsc(b.p.name)}</div>
      ${b.pts.sort((a,c)=>(a.s).localeCompare(c.s)).map(x=>{
        const left=pct(x.s); const right=pct(x.e||x.s); const w=Math.max(2,right-left+ (100/span/ (span||1)) );
        const wpct=Math.max(3, right-left || 3);
        const done=x.t.status==='Done';
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
          <div style="width:${labelW};flex-shrink:0;font-size:0.78em;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${fEsc(x.t.description||'')}">${fEsc((x.t.description||'Task').slice(0,40))}</div>
          <div style="flex:1;position:relative;height:18px;background:#f1f5f9;border-radius:9px;">
            <div title="${fmtDate(x.s)} – ${fmtDate(x.e||x.s)}" style="position:absolute;left:${left}%;width:${wpct}%;height:18px;border-radius:9px;background:${done?'var(--success)':'var(--accent)'};min-width:10px;"></div>
          </div>
          ${isMobile?'':`<div style="width:80px;flex-shrink:0;font-size:0.7em;color:#999;text-align:right;">${fmtDate(x.s)}</div>`}
        </div>`;
      }).join('')}
    </div>`).join('') + '</div>';
}
function renderKanban(){
  const kb=document.getElementById('projects-kanban'); if(!kb) return;
  const projects=DB.projects();
  const isMobile=window.innerWidth < 600;
  const colW=isMobile?'100%':'210px';
  const col=(status)=>{
    const items=projects.filter(p=>(p.status||'Active')===status);
    const cards=items.map(p=>{
      const isPMI=p.type==='pmi';
      const canEdit=isOwnerOrAdmin(p.assignedTo);
      return `<div draggable="${canEdit && !isMobile}" ondragstart="kbDragStart(event,'${p._id}')"
        onclick="openProjectDetail('${p._id}')"
        style="background:#fff;border:1px solid #e5e9f0;border-left:4px solid ${isPMI?'var(--purple)':'var(--accent)'};border-radius:10px;padding:11px 12px;margin-bottom:10px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <div style="font-weight:700;font-size:0.9em;color:var(--primary);">${isPMI?'<span style="font-size:0.7em;background:var(--purple);color:#fff;border-radius:4px;padding:1px 5px;margin-right:5px;">PMI</span>':''}${fEsc(p.name||'Untitled')}</div>
        ${p.assignedTo?`<div style="font-size:0.74em;color:#777;margin-top:4px;">👤 ${fEsc(p.assignedTo)}</div>`:''}
      </div>`;
    }).join('') || `<div style="color:#cbd5e1;font-size:0.8em;text-align:center;padding:14px 0;">${isMobile?'None':'Drop here'}</div>`;
    return `<div ondragover="event.preventDefault()" ondrop="kbDrop(event,'${status}')"
      style="flex:1;min-width:${colW};background:#f4f6fb;border-radius:12px;padding:12px;">
      <div style="font-weight:700;font-size:0.82em;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin-bottom:10px;">${status} <span style="color:#cbd5e1;">(${items.length})</span></div>
      ${cards}</div>`;
  };
  const hint=isMobile
    ? '<p style="font-size:0.78em;color:#999;margin-bottom:10px;">Tap a project card to open details and change its status.</p>'
    : '<p style="font-size:0.78em;color:#999;margin-bottom:10px;">Drag a project card between columns to change its status (owner/admin only).</p>';
  kb.innerHTML = hint + `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">${KANBAN_COLS.map(col).join('')}</div>`;
}
function kbDragStart(e,id){ e.dataTransfer.setData('text/plain', id); }
async function kbDrop(e,status){
  e.preventDefault();
  const id=e.dataTransfer.getData('text/plain'); if(!id) return;
  const p=DB.projects().find(x=>x._id===id); if(!p) return;
  if(!isOwnerOrAdmin(p.assignedTo)){ alert('Only the project owner or an admin can move this project.'); return; }
  await DB.updateProject(id, {...p, status});
  renderKanban();
}

function openProjectModal(id) {
  const sel = document.getElementById('pm-assignee');
  sel.innerHTML = '<option value="">— Unassigned —</option>' + DB.staff().map(s=>'<option>' + s.name + '</option>').join('');
  const deleteBtn = document.getElementById('pm-delete-btn');
  if (id) {
    const p = DB.projects().find(x=>x._id===id);
    if (!p) return;
    if (!isOwnerOrAdmin(p.assignedTo)) { alert('Only the project owner or an admin can edit this project.'); return; }
    document.getElementById('pm-title').textContent = 'Edit Project';
    document.getElementById('pm-id').value = id;
    document.getElementById('pm-name').value = p.name||'';
    document.getElementById('pm-desc').value = p.description||'';
    document.getElementById('pm-status').value = p.status||'Active';
    document.getElementById('pm-assignee').value = p.assignedTo||'';
    deleteBtn.style.display = isAdmin() ? 'inline-flex' : 'none';   // only admin can delete
  } else {
    document.getElementById('pm-title').textContent = 'New Project';
    document.getElementById('pm-id').value = '';
    document.getElementById('pm-name').value = '';
    document.getElementById('pm-desc').value = '';
    document.getElementById('pm-status').value = 'Active';
    document.getElementById('pm-assignee').value = '';
    deleteBtn.style.display = 'none';
  }
  document.getElementById('project-modal').style.display = 'flex';
}

function closeProjectModal() { document.getElementById('project-modal').style.display='none'; }

async function saveProject() {
  const id   = document.getElementById('pm-id').value;
  const name = document.getElementById('pm-name').value.trim();
  if (!name) { alert('Project name is required.'); return; }
  const data = { name, description: document.getElementById('pm-desc').value.trim(), status: document.getElementById('pm-status').value, assignedTo: document.getElementById('pm-assignee').value };
  if (id) {
    const existing = DB.projects().find(p=>p._id===id);
    await DB.updateProject(id, {...data, updates: existing?.updates||[]});
  } else {
    await DB.addProject({...data, updates:[]});
  }
  closeProjectModal();
}

function deleteProject() {
  const id = document.getElementById('pm-id').value;
  if (!id) return;
  requireAdmin(async ()=>{
    if (!confirm('Delete this project and all its updates?')) return;
    await DB.removeProject(id);
    closeProjectModal();
  });
}

function openProjectDetail(id) {
  _activeProjectId = id;
  const p = DB.projects().find(x=>x._id===id);
  if (!p) return;
  document.getElementById('pd-name').textContent = p.name;
  document.getElementById('pd-desc').textContent = p.description||'';
  document.getElementById('pd-update-text').value = '';
  document.getElementById('pd-update-status').value = '';
  renderProjectUpdates(p);
  document.getElementById('project-detail-modal').style.display = 'flex';
}

function renderProjectUpdates(p) {
  const el = document.getElementById('pd-updates-list');
  if (!el) return;
  const updates = (p.updates||[]).slice().reverse();
  if (!updates.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No updates yet. Post the first one below.</p>'; return; }
  el.innerHTML = updates.map(u =>
    '<div style="border-left:3px solid var(--accent);padding:10px 14px;margin-bottom:12px;background:#f8fbff;border-radius:0 8px 8px 0;">' +
      '<div style="font-size:0.875em;color:#333;white-space:pre-wrap;">' + u.text + '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:6px;">' +
        '<span style="font-size:0.75em;color:#aaa;">' + new Date(u.at).toLocaleString() + ' · ' + (u.by||'Staff') + '</span>' +
        (u.status?'<span class="badge badge-info" style="font-size:0.7em;">' + u.status + '</span>':'') +
      '</div>' +
    '</div>'
  ).join('');
}

function closeProjectDetail() { document.getElementById('project-detail-modal').style.display='none'; _activeProjectId=null; }

async function postProjectUpdate() {
  const text = document.getElementById('pd-update-text').value.trim();
  if (!text) { alert('Please enter an update.'); return; }
  const status = document.getElementById('pd-update-status').value;
  const p = DB.projects().find(x=>x._id===_activeProjectId);
  if (!p) return;
  if (!isOwnerOrAdmin(p.assignedTo)) { alert('Only the project owner or an admin can post updates.'); return; }
  const updates = [...(p.updates||[]), {text, status, by:currentUserName()||'Staff', at: new Date().toISOString()}];
  const patch = {updates};
  if (status) patch.status = status;
  await DB.updateProject(_activeProjectId, {...p, ...patch});
  document.getElementById('pd-update-text').value = '';
  document.getElementById('pd-update-status').value = '';
  renderProjectUpdates({...p, ...patch});
}

// PMI 5-PHASE PROJECT WIZARD
const PMI_PHASES = [
  { key:'initiation',  label:'Phase 1 — Initiation',             short:'Initiation'   },
  { key:'planning',    label:'Phase 2 — Planning',               short:'Planning'     },
  { key:'execution',   label:'Phase 3 — Execution',              short:'Execution'    },
  { key:'monitoring',  label:'Phase 4 — Monitoring & Controlling', short:'Monitoring' },
  { key:'closing',     label:'Phase 5 — Closing',                short:'Closing'      },
];

let _pmiPhaseIndex = 0;     // 0-4 (PMI wizard phase)
let _pmiShowingSummary = false;

// AI PROJECT PLANNER — upload a doc, AI splits it into steps, assign tasks
let _plannerDoc = null;     // {kind:'pdf'|'image'|'text', media_type?, data?, text?}
let _plannerSteps = [];

function openAIPlanner(){
  _plannerDoc = null; _plannerSteps = [];
  ['plan-name','plan-text','plan-file'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('plan-file-info').textContent = '';
  document.getElementById('plan-status').textContent = '';
  document.getElementById('plan-steps').innerHTML = '';
  document.getElementById('plan-create-btn').style.display = 'none';
  document.getElementById('planner-modal').style.display = 'flex';
}
function closeAIPlanner(){ document.getElementById('planner-modal').style.display='none'; }

function handlePlannerFile(input){
  const f = input.files && input.files[0];
  const info = document.getElementById('plan-file-info');
  if (!f){ _plannerDoc=null; info.textContent=''; return; }
  const name = f.name.toLowerCase();
  const reader = new FileReader();
  if (f.type==='application/pdf' || name.endsWith('.pdf')){
    reader.onload = ()=>{ _plannerDoc={kind:'pdf', media_type:'application/pdf', data:reader.result.split(',')[1]}; info.textContent='📄 '+f.name+' ready'; };
    reader.readAsDataURL(f);
  } else if (f.type.startsWith('image/')){
    reader.onload = ()=>{ _plannerDoc={kind:'image', media_type:f.type, data:reader.result.split(',')[1]}; info.textContent='🖼 '+f.name+' ready'; };
    reader.readAsDataURL(f);
  } else if (f.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/.test(name)){
    reader.onload = ()=>{ _plannerDoc={kind:'text', text:reader.result}; info.textContent='📄 '+f.name+' ready'; };
    reader.readAsText(f);
  } else {
    _plannerDoc=null; input.value='';
    info.textContent='Unsupported file type — upload a PDF, text file, or image, or paste the text below.';
  }
}

async function generatePlanAI(){
  const status = document.getElementById('plan-status');
  const paste = document.getElementById('plan-text').value.trim();
  if (!_plannerDoc && !paste){ status.style.color='#e53935'; status.textContent='Upload a document or paste some text first.'; return; }
  status.style.color='#666'; status.textContent='Authorizing…';
  let token='';
  try{ token = await ensureMeetingBotSession(); }
  catch(err){ status.style.color='#e53935'; status.textContent='Could not authorize: '+err.message; return; }
  const btn = document.getElementById('plan-generate-btn');
  btn.disabled=true; status.style.color='#666'; status.textContent='Reading the document and drafting steps…';
  const instruction =
    'You are a project manager for ReGroup Elite Squad, a reentry and mentorship organization. ' +
    'Read the project document/details provided and break the project into a clear, ordered list of ' +
    'concrete, actionable tasks needed to complete it. Each task is a single ownable action. ' +
    'Return ONLY a JSON array of objects with keys "title" (short, under 8 words) and "description" ' +
    '(1-2 sentences). Aim for 6-20 tasks. No commentary, no code fences.';
  const content = [];
  if (_plannerDoc && _plannerDoc.kind==='pdf')   content.push({type:'document', source:{type:'base64', media_type:'application/pdf', data:_plannerDoc.data}});
  if (_plannerDoc && _plannerDoc.kind==='image') content.push({type:'image',    source:{type:'base64', media_type:_plannerDoc.media_type, data:_plannerDoc.data}});
  let textPart = instruction;
  if (_plannerDoc && _plannerDoc.kind==='text') textPart += '\n\nPROJECT DOCUMENT:\n' + _plannerDoc.text;
  if (paste) textPart += '\n\nADDITIONAL DETAILS:\n' + paste;
  content.push({type:'text', text:textPart});
  const beta = (_plannerDoc && _plannerDoc.kind==='pdf') ? 'pdfs-2024-09-25' : undefined;
  try{
    const resp = await fetch(meetingBotBaseUrl()+'/api/ai/project-plan', {
      method:'POST',
      headers:{'content-type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({ messages:[{role:'user',content}], beta })
    });
    if (!resp.ok){
      let detail=''; try{ const e=await resp.json(); detail=(e.error&&(e.error.message||e.error))||''; }catch(_){}
      throw new Error('AI error '+(detail||resp.status));
    }
    const j = await resp.json();
    let txt = (j.text||'').trim();
    const s = txt.indexOf('['), e = txt.lastIndexOf(']');
    if (s>=0 && e>s) txt = txt.slice(s, e+1);
    const arr = JSON.parse(txt);
    _plannerSteps = (Array.isArray(arr)?arr:[]).filter(s=>s && (s.title||s.description));
    if (!_plannerSteps.length){ status.style.color='#e53935'; status.textContent='No steps could be extracted. Try a clearer document.'; }
    else { status.style.color='#43a047'; status.textContent=_plannerSteps.length+' steps drafted — assign each below.'; }
    renderPlannerSteps();
  } catch(err){
    status.style.color='#e53935';
    status.textContent = 'AI error — '+err.message;
  } finally { btn.disabled=false; }
}

function renderPlannerSteps(){
  const el = document.getElementById('plan-steps');
  const createBtn = document.getElementById('plan-create-btn');
  if (!_plannerSteps.length){ el.innerHTML=''; createBtn.style.display='none'; return; }
  const opts = '<option value="">— Unassigned —</option>' + mentorNames().map(n=>`<option value="${fEsc(n)}">${fEsc(n)}</option>`).join('');
  el.innerHTML = '<div style="font-weight:600;color:var(--primary);margin-bottom:10px;">Steps &amp; assignments</div>' +
    _plannerSteps.map((s,i)=>`
      <div class="card" style="margin-bottom:10px;padding:14px;" data-step="${i}">
        <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <input class="plan-step-title" value="${fEsc(s.title||'')}" placeholder="Task title" style="width:100%;font-weight:600;padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:7px;margin-bottom:6px;">
            <textarea class="plan-step-desc" rows="2" placeholder="Description" style="width:100%;padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:0.86em;resize:vertical;">${fEsc(s.description||'')}</textarea>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:160px;">
            <label style="font-size:0.72em;color:#777;">Assign to</label>
            <select class="plan-step-mentor" style="padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:7px;">${opts.replace(`value="${fEsc(s.mentor||'')}"`, `value="${fEsc(s.mentor||'')}" selected`)}</select>
            <button class="btn btn-outline" style="font-size:0.74em;padding:4px 8px;" onclick="removePlannerStep(${i})">Remove</button>
          </div>
        </div>
      </div>`).join('') +
    '<button class="btn btn-outline" style="font-size:0.8em;" onclick="addPlannerStep()">+ Add step</button>';
  createBtn.style.display='inline-flex';
}

function syncPlannerStepsFromDOM(){
  const rows = [...document.querySelectorAll('#plan-steps [data-step]')];
  _plannerSteps = rows.map(r=>({
    title: r.querySelector('.plan-step-title').value.trim(),
    description: r.querySelector('.plan-step-desc').value.trim(),
    mentor: r.querySelector('.plan-step-mentor').value
  }));
}
function addPlannerStep(){ syncPlannerStepsFromDOM(); _plannerSteps.push({title:'',description:'',mentor:''}); renderPlannerSteps(); }
function removePlannerStep(i){ syncPlannerStepsFromDOM(); _plannerSteps.splice(i,1); renderPlannerSteps(); }

async function createPlannerTasks(){
  const name = document.getElementById('plan-name').value.trim();
  const status = document.getElementById('plan-status');
  if (!name){ status.style.color='#e53935'; status.textContent='Enter a project name first.'; return; }
  syncPlannerStepsFromDOM();
  const steps = _plannerSteps.filter(s=>s.title||s.description);
  if (!steps.length){ status.style.color='#e53935'; status.textContent='No steps to create.'; return; }
  const btn = document.getElementById('plan-create-btn');
  btn.disabled=true; status.style.color='#666'; status.textContent='Creating project and tasks…';
  await DB.addProject({name, description:'Created from an uploaded document via the AI Planner.', status:'Active', source:'AI Planner'});
  // Auto-schedule steps sequentially so a Gantt chart can be drawn (each step ~4 days)
  const DAYS=4; const base=new Date(); base.setHours(0,0,0,0);
  const addDays=(n)=>{ const d=new Date(base); d.setDate(base.getDate()+n); return d.toISOString().slice(0,10); };
  for (let i=0;i<steps.length;i++){
    const s=steps[i];
    await DB.addTask({
      mentorName: s.mentor||'',
      description: s.title ? (s.title + (s.description ? ' — '+s.description : '')) : s.description,
      clientName: name,
      project: name,
      status: 'Open',
      ganttStart: addDays(i*DAYS),
      ganttEnd: addDays(i*DAYS + DAYS-1),
      dueDate: addDays(i*DAYS + DAYS-1),
      seq: i+1,
      source: 'AI Planner'
    });
  }
  const assigned = steps.filter(s=>s.mentor).length;
  status.style.color='#43a047';
  status.textContent = `✓ Created ${steps.length} tasks (${assigned} assigned).`;
  btn.disabled=false;
  setTimeout(()=>{ closeAIPlanner(); renderProjects(); }, 1300);
}

function openPMIWizard(id) {
  _pmiPhaseIndex = 0;
  _pmiShowingSummary = false;
  document.getElementById('pmi-project-id').value = id || '';

  if (id) {
    const p = DB.projects().find(x=>x._id===id);
    if (p && p.pmi) {
      // Resume — find the first incomplete phase
      const idx = PMI_PHASES.findIndex(ph=>!p.pmi[ph.key]?.complete);
      _pmiPhaseIndex = idx >= 0 ? idx : 4;
      _prefillPMIPhase(p, _pmiPhaseIndex);
    }
  } else {
    // Clear all fields
    _clearPMIFields();
  }

  _renderPMIPhase();
  document.getElementById('pmi-wizard').style.display = 'flex';
}

function closePMIWizard() {
  document.getElementById('pmi-wizard').style.display = 'none';
}

function _clearPMIFields() {
  ['pmi-p0-name','pmi-p0-problem','pmi-p0-sponsor','pmi-p0-goal','pmi-p0-stakeholders',
   'pmi-p1-scope-in','pmi-p1-scope-out','pmi-p1-milestones','pmi-p1-budget','pmi-p1-risks','pmi-p1-comms',
   'pmi-p2-deliverables','pmi-p2-assignments','pmi-p2-dependencies',
   'pmi-p3-kpis','pmi-p3-changes','pmi-p3-issues',
   'pmi-p4-acceptance','pmi-p4-lessons','pmi-p4-report','pmi-p4-handoff'
  ].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
}

function _prefillPMIPhase(p, idx) {
  const ph = p.pmi;
  if (!ph) return;
  const f = (id,val) => { const el=document.getElementById(id); if(el&&val) el.value=val; };
  f('pmi-p0-name',       p.name);
  f('pmi-p0-problem',    ph.initiation?.problem);
  f('pmi-p0-sponsor',    ph.initiation?.sponsor);
  f('pmi-p0-goal',       ph.initiation?.goal);
  f('pmi-p0-stakeholders', ph.initiation?.stakeholders);
  f('pmi-p1-scope-in',   ph.planning?.scopeIn);
  f('pmi-p1-scope-out',  ph.planning?.scopeOut);
  f('pmi-p1-milestones', ph.planning?.milestones);
  f('pmi-p1-budget',     ph.planning?.budget);
  f('pmi-p1-risks',      ph.planning?.risks);
  f('pmi-p1-comms',      ph.planning?.comms);
  f('pmi-p2-deliverables',  ph.execution?.deliverables);
  f('pmi-p2-assignments',   ph.execution?.assignments);
  f('pmi-p2-dependencies',  ph.execution?.dependencies);
  f('pmi-p3-kpis',       ph.monitoring?.kpis);
  f('pmi-p3-changes',    ph.monitoring?.changes);
  f('pmi-p3-issues',     ph.monitoring?.issues);
  if (ph.monitoring?.cadence) document.getElementById('pmi-p3-cadence').value = ph.monitoring.cadence;
  f('pmi-p4-acceptance', ph.closing?.acceptance);
  f('pmi-p4-lessons',    ph.closing?.lessons);
  f('pmi-p4-report',     ph.closing?.report);
  f('pmi-p4-handoff',    ph.closing?.handoff);
}

function _renderPMIPhase() {
  const ph = PMI_PHASES[_pmiPhaseIndex];
  document.getElementById('pmi-phase-title').textContent = ph.label;

  // Step indicators
  PMI_PHASES.forEach((_,i) => {
    const el = document.getElementById('pmi-step-'+i);
    el.className = 'pmi-step' + (i < _pmiPhaseIndex ? ' done' : i===_pmiPhaseIndex ? ' active' : '');
  });

  // Show/hide phase forms and summary
  PMI_PHASES.forEach((_,i) => {
    const el = document.getElementById('pmi-phase-'+i);
    if (el) el.style.display = (!_pmiShowingSummary && i===_pmiPhaseIndex) ? 'block' : 'none';
  });
  document.getElementById('pmi-summary-panel').style.display = _pmiShowingSummary ? 'block' : 'none';

  // Buttons
  document.getElementById('pmi-back-btn').style.display     = _pmiPhaseIndex>0 && !_pmiShowingSummary ? 'inline-flex' : 'none';
  document.getElementById('pmi-complete-btn').style.display  = !_pmiShowingSummary ? 'inline-flex' : 'none';
  document.getElementById('pmi-next-btn').style.display      = _pmiShowingSummary && _pmiPhaseIndex<4 ? 'inline-flex' : 'none';
  document.getElementById('pmi-next-btn').textContent        = 'Ready for ' + (PMI_PHASES[_pmiPhaseIndex+1]?.short||'Next') + ' →';
  document.getElementById('pmi-finish-btn').style.display    = _pmiShowingSummary && _pmiPhaseIndex===4 ? 'inline-flex' : 'none';
}

function _gatherPhaseData(idx) {
  const g = id => (document.getElementById(id)?.value||'').trim();
  switch(idx) {
    case 0: return { problem:g('pmi-p0-problem'), sponsor:g('pmi-p0-sponsor'), goal:g('pmi-p0-goal'), stakeholders:g('pmi-p0-stakeholders'), complete:true };
    case 1: return { scopeIn:g('pmi-p1-scope-in'), scopeOut:g('pmi-p1-scope-out'), milestones:g('pmi-p1-milestones'), budget:g('pmi-p1-budget'), risks:g('pmi-p1-risks'), comms:g('pmi-p1-comms'), complete:true };
    case 2: return { deliverables:g('pmi-p2-deliverables'), assignments:g('pmi-p2-assignments'), dependencies:g('pmi-p2-dependencies'), complete:true };
    case 3: return { kpis:g('pmi-p3-kpis'), cadence:document.getElementById('pmi-p3-cadence').value, changes:g('pmi-p3-changes'), issues:g('pmi-p3-issues'), complete:true };
    case 4: return { acceptance:g('pmi-p4-acceptance'), lessons:g('pmi-p4-lessons'), report:g('pmi-p4-report'), handoff:g('pmi-p4-handoff'), complete:true };
  }
}

function _buildSummary(idx, data) {
  const bullets = [];
  switch(idx) {
    case 0:
      if(data.goal)          bullets.push('Goal: ' + data.goal);
      if(data.problem)       bullets.push('Problem/Opportunity: ' + data.problem);
      if(data.sponsor)       bullets.push('Sponsor: ' + data.sponsor);
      if(data.stakeholders)  bullets.push('Key Stakeholders: ' + data.stakeholders);
      break;
    case 1:
      const si = document.getElementById('pmi-p1-scope-in')?.value||'';
      if(si)               bullets.push('In Scope: ' + si);
      if(data.scopeOut)    bullets.push('Out of Scope: ' + data.scopeOut);
      if(data.milestones)  bullets.push('Milestones: ' + data.milestones);
      if(data.risks)       bullets.push('Key Risks: ' + data.risks);
      if(data.comms)       bullets.push('Communication: ' + data.comms);
      break;
    case 2:
      if(data.deliverables)   bullets.push('Active Deliverables: ' + data.deliverables);
      if(data.assignments)    bullets.push('Assignments: ' + data.assignments);
      if(data.dependencies)   bullets.push('Dependencies: ' + data.dependencies);
      break;
    case 3:
      if(data.kpis)    bullets.push('KPIs: ' + data.kpis);
      if(data.cadence) bullets.push('Check-in cadence: ' + data.cadence);
      if(data.issues)  bullets.push('Current Issues: ' + data.issues);
      if(data.changes) bullets.push('Change process: ' + data.changes);
      break;
    case 4:
      if(data.acceptance) bullets.push('Acceptance: ' + data.acceptance);
      if(data.lessons)    bullets.push('Lessons Learned: ' + data.lessons);
      if(data.report)     bullets.push('Final Report: ' + data.report);
      if(data.handoff)    bullets.push('Handoff: ' + data.handoff);
      break;
  }
  return bullets.map(b=>'• '+b).join('\n');
}

function _buildPhaseTasks(idx, phaseData, projectName) {
  const tasks = [];
  const name = (document.getElementById('pmi-p0-name')?.value||projectName||'Project').trim();
  switch(idx) {
    case 0:
      tasks.push({desc:'Hold project kickoff meeting — align team on goal and stakeholders', trigger:'Week 1'});
      if(phaseData.sponsor) tasks.push({desc:'Brief sponsor ' + phaseData.sponsor + ' on project scope and goals', trigger:'Before Phase 2'});
      tasks.push({desc:'Document and circulate project charter to all stakeholders', trigger:'End of Initiation'});
      break;
    case 1:
      tasks.push({desc:'Finalize project scope document and get sign-off', trigger:'Start of Execution'});
      if(phaseData.milestones) tasks.push({desc:'Set up milestone tracking for: ' + phaseData.milestones.slice(0,80), trigger:'Ongoing'});
      if(phaseData.risks) tasks.push({desc:'Create risk log and assign risk owners: ' + phaseData.risks.slice(0,60), trigger:'Week 1'});
      tasks.push({desc:'Schedule recurring team check-ins per communication plan', trigger:'Recurring'});
      break;
    case 2:
      tasks.push({desc:'Kick off active deliverables: ' + (phaseData.deliverables||'').slice(0,80), trigger:'Immediately'});
      if(phaseData.assignments) {
        phaseData.assignments.split('\n').filter(Boolean).forEach(line => {
          tasks.push({desc:line.trim(), trigger:'Per plan'});
        });
      }
      if(phaseData.dependencies) tasks.push({desc:'Resolve dependencies before proceeding: ' + phaseData.dependencies.slice(0,80), trigger:'Before next milestone'});
      break;
    case 3:
      tasks.push({desc:'Set up KPI tracking dashboard / log for: ' + (phaseData.kpis||'').slice(0,60), trigger:'Week 1'});
      tasks.push({desc:'Run ' + (phaseData.cadence||'weekly') + ' status check-in with team', trigger:phaseData.cadence||'Weekly'});
      if(phaseData.issues) tasks.push({desc:'Resolve open issues: ' + phaseData.issues.slice(0,80), trigger:'ASAP'});
      break;
    case 4:
      tasks.push({desc:'Obtain formal deliverable sign-off per acceptance criteria', trigger:'Before close'});
      tasks.push({desc:'Compile lessons learned document and share with team', trigger:'Final week'});
      if(phaseData.handoff) tasks.push({desc:'Execute handoff plan: ' + phaseData.handoff.slice(0,80), trigger:'Close date'});
      tasks.push({desc:'Archive all project files and send final report to stakeholders', trigger:'Project close'});
      break;
  }
  return tasks;
}

async function pmiCompletePhase() {
  const idx = _pmiPhaseIndex;
  const projectName = (document.getElementById('pmi-p0-name')?.value||'').trim();
  if (idx===0 && !projectName) { alert('Please enter a project name.'); return; }

  const phaseData = _gatherPhaseData(idx);
  const summary   = _buildSummary(idx, phaseData);
  const tasks     = _buildPhaseTasks(idx, phaseData, projectName);

  // Save to Firestore
  const projectId = document.getElementById('pmi-project-id').value;
  const pmiKey    = PMI_PHASES[idx].key;
  const pmiPatch  = {};
  pmiPatch[pmiKey] = phaseData;

  let savedId = projectId;
  if (!projectId) {
    // Create the project
    const ref = await DB.addProjectAndGetRef({
      name:        projectName,
      description: phaseData.goal || phaseData.deliverables || '',
      status:      'Active',
      type:        'pmi',
      pmi:         pmiPatch,
      updates:     []
    });
    savedId = ref;
    document.getElementById('pmi-project-id').value = savedId;
  } else {
    const existing = DB.projects().find(p=>p._id===projectId);
    const pmi = {...(existing?.pmi||{}), ...pmiPatch};
    await DB.updateProject(projectId, {...existing, pmi, name: projectName||existing?.name||''});
  }

  // Show summary
  document.getElementById('pmi-summary-text').textContent = summary;
  document.getElementById('pmi-tasks-phase-label').textContent = PMI_PHASES[idx].short;

  // Render task assignment rows
  const staffOptions = DB.staff().map(s=>'<option value="' + s.name + '">' + s.name + '</option>').join('');
  document.getElementById('pmi-tasks-list').innerHTML = tasks.map((t,i) =>
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:200px;font-size:0.875em;color:#333;">' + t.desc + '</div>' +
      '<select id="pmi-task-owner-' + i + '" style="padding:6px 10px;border:1.5px solid #ddd;border-radius:7px;font-size:0.82em;min-width:130px;">' +
        '<option value="">Assign to…</option>' + staffOptions +
      '</select>' +
      '<input type="text" id="pmi-task-due-' + i + '" value="' + t.trigger + '" style="width:110px;padding:6px 8px;border:1.5px solid #ddd;border-radius:7px;font-size:0.82em;" placeholder="Due/Trigger">' +
      '<button class="btn btn-accent" style="padding:5px 10px;font-size:0.75em;" onclick="pmiAssignTask(' + i + ',\'' + savedId + '\',\'' + pmiKey + '\')">Assign</button>' +
    '</div>'
  ).join('') + '<p style="font-size:0.78em;color:#aaa;margin-top:6px;">Select a mentor and click Assign to send tasks to their inbox.</p>';

  document.getElementById('pmi-next-prompt').textContent =
    idx < 4
      ? 'Ready for ' + PMI_PHASES[idx+1].label + '?'
      : '🏁 All 5 phases complete. Click "Finish Project" to close the wizard.';

  _pmiShowingSummary = true;
  _renderPMIPhase();
}

async function pmiAssignTask(taskIdx, projectId, phaseKey) {
  const owner = document.getElementById('pmi-task-owner-' + taskIdx)?.value;
  const due   = document.getElementById('pmi-task-due-' + taskIdx)?.value;
  const btn   = event.target;
  if (!owner) { alert('Select a mentor to assign this task to.'); return; }
  const desc  = btn.closest('div').querySelector('div').textContent.trim();
  await DB.addTask({
    mentorName:  owner,
    clientName:  '',
    clientId:    '',
    description: desc,
    dueDate:     due,
    status:      'Open',
    alertType:   'pmi',
    reason:      'PMI ' + phaseKey + ' task — Project: ' + (DB.projects().find(p=>p._id===projectId)?.name||projectId)
  });
  btn.textContent = '✅';
  btn.disabled = true;
  btn.style.background = 'var(--success)';
}

function pmiBack() {
  if (_pmiShowingSummary) { _pmiShowingSummary = false; _renderPMIPhase(); return; }
  if (_pmiPhaseIndex > 0) { _pmiPhaseIndex--; _renderPMIPhase(); }
}

function pmiNextPhase() {
  if (_pmiPhaseIndex < 4) {
    _pmiPhaseIndex++;
    _pmiShowingSummary = false;
    _renderPMIPhase();
  }
}

async function pmiFinish() {
  const id = document.getElementById('pmi-project-id').value;
  if (id) {
    const p = DB.projects().find(x=>x._id===id);
    if (p) await DB.updateProject(id, {...p, status:'Active'});
  }
  closePMIWizard();
}

export { renderProjects, openProjectModal, closeProjectModal, saveProject, deleteProject,
  openProjectDetail, closeProjectDetail, postProjectUpdate,
  openTaskModal, closeTaskModal, saveTaskModal,
  toggleProjectsView, toggleGanttView, setProjectsView, renderKanban, renderGantt,
  kbDragStart, kbDrop,
  openPMIWizard, closePMIWizard, pmiCompletePhase, pmiNextPhase, pmiBack, pmiFinish, pmiAssignTask,
  openAIPlanner, closeAIPlanner, handlePlannerFile, generatePlanAI, createPlannerTasks,
  addPlannerStep, removePlannerStep };
