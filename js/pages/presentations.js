import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
const PRESENTATION_HISTORY_KEY='regroup_presentation_history';
const PRESENTATION_HISTORY_LIMIT=10;
let _presentationFile = null;
let _presentationRequest = null;

function loadPresentationHistory(){
  try{
    const raw=localStorage.getItem(PRESENTATION_HISTORY_KEY);
    const parsed=raw?JSON.parse(raw):[];
    return Array.isArray(parsed)?parsed:[];
  }catch(_){ return []; }
}
function savePresentationHistory(entries){
  try{ localStorage.setItem(PRESENTATION_HISTORY_KEY, JSON.stringify(entries.slice(0,PRESENTATION_HISTORY_LIMIT))); }catch(_){}
}
function addPresentationHistoryEntry(request, result){
  const entry={
    id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    savedAt: new Date().toISOString(),
    request,
    result
  };
  const next=[entry, ...loadPresentationHistory()].slice(0, PRESENTATION_HISTORY_LIMIT);
  savePresentationHistory(next);
  return entry;
}
function removePresentationHistoryEntry(id){
  const next=loadPresentationHistory().filter(item=>item.id!==id);
  savePresentationHistory(next);
  renderPresentationHistory();
}
function clearPresentationHistory(){
  try{ localStorage.removeItem(PRESENTATION_HISTORY_KEY); }catch(_){}
  renderPresentationHistory();
}
function renderPresentationHistory(){
  const el=document.getElementById('presentation-history-list');
  if(!el) return;
  const entries=loadPresentationHistory();
  if(!entries.length){
    el.innerHTML='<div class="card" style="color:#999;text-align:center;padding:22px;">No presentations generated yet.</div>';
    return;
  }
  el.innerHTML=entries.map(entry=>{
    const slideCount=Array.isArray(entry.result?.slides)?entry.result.slides.length:0;
    return `<div class="card" style="margin-bottom:10px;padding:14px;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
        <div style="min-width:220px;">
          <div style="font-weight:700;color:var(--primary);">${fEsc(entry.result?.title||entry.request?.audience||'Presentation')}</div>
          <div style="font-size:0.82em;color:#777;margin-top:3px;">${fEsc(entry.request?.audience||'')} · ${fEsc(entry.request?.purpose||'')} · ${slideCount} slide${slideCount===1?'':'s'}</div>
          <div style="font-size:0.76em;color:#999;margin-top:3px;">Saved ${fmtDate(entry.savedAt)} ${fmtTime(entry.savedAt)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="loadPresentationFromHistory('${fEsc(entry.id)}')">Open</button>
          <button class="btn btn-danger" onclick="removePresentationHistoryEntry('${fEsc(entry.id)}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function loadPresentationFromHistory(id){
  const entry=loadPresentationHistory().find(item=>item.id===id);
  if(!entry) return;
  _presentationRequest=entry.request || null;
  renderPresentationOutput(entry.result || null);
  populatePresentationForm(entry.request || {});
}
function renderPresentations(){
  renderPresentationHistory();
  if(!_presentationRequest) renderPresentationOutput(null);
}
function presentationBackendBase(){
  return meetingBotBaseUrl();
}
function presentationFileToBase64(file){
  return new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
    reader.onerror=()=>reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
function handlePresentationFile(input){
  const file=input && input.files && input.files[0];
  const info=document.getElementById('pres-file-info');
  const ctx=document.getElementById('pres-context');
  if(!file){
    if(info) info.textContent='Optional: upload a brief or notes file.';
    return;
  }
  const name=file.name || 'uploaded file';
  const lower=name.toLowerCase();
  if(/\.(txt|md|markdown|csv|json)$/.test(lower) || (file.type && file.type.startsWith('text/'))){
    const reader=new FileReader();
    reader.onload=()=>{
      if(ctx) ctx.value = String(reader.result || '');
      if(info) info.textContent = `Loaded ${name} into contextual material.`;
    };
    reader.onerror=()=>{ if(info) info.textContent = `Could not read ${name}.`; };
    reader.readAsText(file);
    return;
  }
  if(info) info.textContent = `${name} selected. Paste the extracted text below if you want the deck to use the contents directly.`;
}
function openPresentationStudio(){
  populatePresentationForm({});
  _presentationFile=null;
  _presentationRequest=null;
  const fileInput=document.getElementById('pres-file');
  if(fileInput) fileInput.value='';
  const fileInfo=document.getElementById('pres-file-info');
  if(fileInfo) fileInfo.textContent='Optional: upload a brief or notes file.';
  document.getElementById('presentation-output').innerHTML='';
  renderPresentationHistory();
  navigate('presentations');
}
function populatePresentationForm(data){
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.value=val||''; };
  set('pres-audience', data.audience || '');
  set('pres-purpose', data.purpose || '');
  set('pres-duration', data.durationMinutes || 20);
  set('pres-slide-count', data.slideCount || 'auto');
  set('pres-tone', data.tone || 'clear and practical');
  set('pres-lif', data.livedExperienceFraming || '');
  set('pres-data', data.dataInclusion || '');
  set('pres-cta', data.callToAction || '');
  set('pres-key', data.keyMessage || '');
  set('pres-points', data.requiredPoints || '');
  set('pres-context', data.contextualMaterial || '');
}
function renderPresentationOutput(result){
  const el=document.getElementById('presentation-output');
  if(!el) return;
  if(!result){
    el.innerHTML='<div class="card" style="color:#999;text-align:center;padding:30px;">No presentation generated yet.</div>';
    return;
  }
  el.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;margin-bottom:14px;">
      <div>
        <h3 style="color:var(--primary);margin-bottom:4px;">${fEsc(result.title||'Presentation')}</h3>
        <div style="font-size:0.84em;color:#777;">Audience: ${fEsc(result.audience||'')} · Purpose: ${fEsc(result.purpose||'')} · ${fEsc(String(result.durationMinutes||''))} minutes</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-outline" onclick="copyPresentationFollowUp()">Copy Follow-up Email</button>
        <button class="btn btn-outline" onclick="downloadPresentationJson()">Download JSON</button>
      </div>
    </div>
    <div style="display:grid;gap:12px;">
      ${(Array.isArray(result.slides)?result.slides:[]).map(slide=>`
        <div class="card" style="padding:14px;background:#fbfdff;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start;">
            <strong style="color:var(--primary);">Slide ${slide.number || ''}: ${fEsc(slide.title || '')}</strong>
            ${slide.visualSuggestion ? `<span class="badge badge-info">${fEsc(slide.visualSuggestion)}</span>` : ''}
          </div>
          <ul style="margin:8px 0 0 18px;color:#444;font-size:0.9em;">
            ${(Array.isArray(slide.bullets)?slide.bullets:[]).map(b=>`<li>${fEsc(b)}</li>`).join('')}
          </ul>
          ${slide.speakerNotes ? `<div style="margin-top:8px;font-size:0.82em;color:#666;"><b>Speaker notes:</b> ${fEsc(slide.speakerNotes)}</div>` : ''}
          ${slide.sourceNotes ? `<div style="margin-top:6px;font-size:0.8em;color:#888;"><b>Source notes:</b> ${fEsc(slide.sourceNotes)}</div>` : ''}
        </div>`).join('')}
    </div>
    ${result.handoutSummary ? `<div style="margin-top:14px;"><b>Handout summary:</b><div style="white-space:pre-wrap;color:#444;font-size:0.9em;">${fEsc(result.handoutSummary)}</div></div>` : ''}
    ${result.callToAction ? `<div style="margin-top:12px;"><b>Call to action:</b> ${fEsc(result.callToAction)}</div>` : ''}
    ${Array.isArray(result.factualReviewNotes)&&result.factualReviewNotes.length ? `<div style="margin-top:12px;"><b>Review before use:</b><ul style="margin:6px 0 0 18px;">${result.factualReviewNotes.map(n=>`<li>${fEsc(n)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}
async function generatePresentation(){
  const payload = {
    audience: document.getElementById('pres-audience').value.trim(),
    purpose: document.getElementById('pres-purpose').value.trim(),
    durationMinutes: Number(document.getElementById('pres-duration').value || 20),
    slideCount: document.getElementById('pres-slide-count').value || null,
    tone: document.getElementById('pres-tone').value.trim(),
    livedExperienceFraming: document.getElementById('pres-lif').value.trim() || null,
    dataInclusion: document.getElementById('pres-data').value.trim() || null,
    callToAction: document.getElementById('pres-cta').value.trim() || null,
    keyMessage: document.getElementById('pres-key').value.trim() || null,
    requiredPoints: document.getElementById('pres-points').value.trim() || null,
    contextualMaterial: document.getElementById('pres-context').value.trim() || null
  };
  if(!payload.audience || !payload.purpose){
    alert('Please add an audience and a purpose first.');
    return;
  }
  const btn=document.getElementById('pres-generate-btn');
  const status=document.getElementById('pres-status');
  btn.disabled=true;
  status.style.color='#666';
  status.textContent='Generating presentationâ€¦';
  try{
    const resp = await fetch(presentationBackendBase() + '/api/presentation/generate', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error((data.error && (data.error.message || data.error)) || ('HTTP '+resp.status));
    _presentationRequest = payload;
    renderPresentationOutput(data);
    addPresentationHistoryEntry(payload, data);
    renderPresentationHistory();
    status.style.color='#15803d';
    status.textContent='Presentation generated and saved to history.';
  }catch(err){
    status.style.color='#e53935';
    status.textContent='Generation failed â€” ' + err.message;
  }finally{
    btn.disabled=false;
  }
}
async function generatePresentationNow(){
  const payload = {
    audience: document.getElementById('pres-audience').value.trim(),
    purpose: document.getElementById('pres-purpose').value.trim(),
    durationMinutes: Number(document.getElementById('pres-duration').value || 20),
    slideCount: document.getElementById('pres-slide-count').value || null,
    tone: document.getElementById('pres-tone').value.trim(),
    livedExperienceFraming: document.getElementById('pres-lif').value.trim() || null,
    dataInclusion: document.getElementById('pres-data').value.trim() || null,
    callToAction: document.getElementById('pres-cta').value.trim() || null,
    keyMessage: document.getElementById('pres-key').value.trim() || null,
    requiredPoints: document.getElementById('pres-points').value.trim() || null,
    contextualMaterial: document.getElementById('pres-context').value.trim() || null
  };
  if(!payload.audience || !payload.purpose){
    alert('Please add an audience and a purpose first.');
    return;
  }
  const btn=document.getElementById('pres-generate-btn');
  const status=document.getElementById('pres-status');
  btn.disabled=true;
  status.style.color='#666';
  status.textContent='Generating presentation...';
  try{
    const resp = await fetch(presentationBackendBase() + '/api/presentation/generate', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(()=>({}));
    if(!resp.ok){
      let message = (data.error && (data.error.message || data.error)) || ('HTTP '+resp.status);
      if(resp.status===404) message = 'Presentation backend route is not deployed yet. Update and redeploy the backend service.';
      if(resp.status===503 && /GEMINI_API_KEY/i.test(message)) message = 'Presentation backend is live, but GEMINI_API_KEY is not configured on the server.';
      throw new Error(message);
    }
    _presentationRequest = payload;
    renderPresentationOutput(data);
    addPresentationHistoryEntry(payload, data);
    renderPresentationHistory();
    status.style.color='#15803d';
    status.textContent = 'Presentation generated and saved to history.';
  }catch(err){
    status.style.color='#e53935';
    status.textContent='Generation failed - ' + err.message;
  }finally{
    btn.disabled=false;
  }
}
function downloadPresentationJson(){
  if(!_presentationRequest) return;
  const payload={ request:_presentationRequest, result: null, savedAt:new Date().toISOString() };
  const entries=loadPresentationHistory();
  const latest=entries[0] && JSON.stringify(entries[0].request)===JSON.stringify(_presentationRequest) ? entries[0] : entries.find(e=>JSON.stringify(e.request)===JSON.stringify(_presentationRequest));
  payload.result = latest ? latest.result : null;
  const blob=new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='regroup-presentation.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function copyPresentationFollowUp(){
  const entries=loadPresentationHistory();
  const latest=entries.find(e=>e.request && _presentationRequest && JSON.stringify(e.request)===JSON.stringify(_presentationRequest)) || entries[0];
  const text=latest?.result?.followUpEmail || '';
  if(!text){ alert('No follow-up email was generated for this presentation yet.'); return; }
  navigator.clipboard?.writeText(text).then(()=>alert('Follow-up email copied.')).catch(()=>alert(text));
}
function refreshPresentationHistory(){ renderPresentationHistory(); }

export { handlePresentationFile, generatePresentationNow, generatePresentation,
  refreshPresentationHistory, clearPresentationHistory, loadPresentationFromHistory,
  openPresentationStudio, renderPresentations };
