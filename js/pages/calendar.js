import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans, _currentUser,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
import { myStaffRecord } from './profile.js';
let _calMonth = (()=>{ const d=new Date(); d.setDate(1); return d; })();
export let _calDetailId = null;
function calShiftMonth(n){ _calMonth.setMonth(_calMonth.getMonth()+n); renderCalendar(); }
function calToday(){ _calMonth=new Date(); _calMonth.setDate(1); renderCalendar(); }
function populateStaffNameList(){ const dl=document.getElementById('staff-name-list'); if(dl) dl.innerHTML=DB.staff().map(s=>`<option>${fEsc(s.name)}</option>`).join(''); }

// ===== Google Calendar sync (client-side OAuth — each staff profile email connects its own calendar) =====
let _gcalEvents = {};       // profileEmail -> [events]
let _icsEvents = {};        // profile email/display identity -> [events] (iCal-link sync, no Google Cloud project needed)
let _syncedIndex = {}, _calSidN = 0, _syncedCurrent = null;  // for clicking synced (Google) events
function calendarSyncOwnerKey(){
  return (currentProfileEmail() || currentUserName() || 'admin').toLowerCase();
}
function splitEmails(value){
  return String(value||'').split(/[;,\s]+/).map(s=>s.trim()).filter(s=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}
function cleanUrl(url){
  return String(url||'').trim().replace(/[),.;\]]+$/,'');
}
function urlsFromText(value){
  const matches = String(value||'').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches.map(cleanUrl).filter(Boolean);
}
function isVideoMeetingUrl(url){
  return /meet\.google\.com|zoom\.us|zoomgov\.com|teams\.microsoft\.com|webex\.com|gotomeeting\.com|bluejeans\.com|whereby\.com/i.test(String(url||''));
}
function extractMeetingUrl(){
  const urls = Array.from(arguments).flatMap(urlsFromText);
  return (urls.find(isVideoMeetingUrl) || urls[0] || '').trim();
}
function syncedSourceKey(e){
  return e.sourceKey || e.htmlLink || [e.title,e.date,e.time,e.video].join('|').toLowerCase();
}
function matchedStaffNamesForEmails(emails){
  const staff=DB.staff();
  const names=[];
  splitEmails((emails||[]).join(',')).forEach(email=>{
    const match=staff.find(s=>splitEmails(s.email).some(em=>em.toLowerCase()===email.toLowerCase()));
    if(match && !names.some(n=>n.toLowerCase()===(match.name||'').toLowerCase())) names.push(match.name);
  });
  return names;
}
function staffNamesForEmails(emails){
  const names=matchedStaffNamesForEmails(emails);
  const me=currentUserName();
  if(me && !names.some(n=>n.toLowerCase()===me.toLowerCase())) names.push(me);
  return names;
}
function syncedEventAttendees(e){
  const raw=Array.isArray(e.attendees) ? e.attendees.join(',') : (e.attendees||'');
  const emails=new Set(splitEmails(raw));
  const profileEmail=currentProfileEmail();
  if(profileEmail) emails.add(profileEmail);
  return Array.from(emails);
}
function mapGoogleCalendarEvent(it){
  const start=(it.start&&(it.start.dateTime||it.start.date))||'';
  const end=(it.end&&(it.end.dateTime||it.end.date))||'';
  const entryPoints=(it.conferenceData&&Array.isArray(it.conferenceData.entryPoints))?it.conferenceData.entryPoints:[];
  const videoEp=entryPoints.find(ep=>ep && ep.entryPointType==='video' && ep.uri);
  const phoneEp=entryPoints.find(ep=>ep && ep.entryPointType==='phone' && (ep.uri||ep.label));
  const video=(videoEp&&videoEp.uri) || it.hangoutLink || extractMeetingUrl(it.location,it.description,it.summary);
  const attendeeEmails=(it.attendees||[]).map(a=>a.email).filter(Boolean);
  const organizerEmail=it.organizer&&it.organizer.email;
  const creatorEmail=it.creator&&it.creator.email;
  [organizerEmail, creatorEmail].filter(Boolean).forEach(em=>attendeeEmails.push(em));
  const time=start && it.start.dateTime ? start.slice(11,16)+(end&&it.end&&it.end.dateTime?'-'+end.slice(11,16):'') : '';
  return {
    title:it.summary||'(no title)',
    date:start.slice(0,10),
    time,
    location:it.location||'',
    description:it.description||'',
    attendees:Array.from(new Set(attendeeEmails.map(em=>em.toLowerCase()))),
    video,
    phone:(phoneEp&&(phoneEp.label||phoneEp.uri))||'',
    htmlLink:it.htmlLink||'',
    sourceKey:'gcal:'+(it.id||it.iCalUID||it.htmlLink||[it.summary,start].join('|')),
    _gcal:true
  };
}
// A calendar chip — synced (Google) events open an action panel; app events open their detail
function calChip(e){
  if(e._gcal){
    const sid='s'+(_calSidN++); _syncedIndex[sid]=e;
    return `<div onclick="event.stopPropagation();openSyncedDetail('${sid}')" title="${fEsc(e.title)} (Google Calendar — click to send bot)" style="background:#e8f0fe;border-left:3px solid #4285F4;border-radius:4px;padding:1px 4px;margin-bottom:2px;font-size:0.68em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;"><span style="font-weight:700;color:#4285F4;">G</span> ${e.video?'🎥 ':''}${fEsc(e.title)}</div>`;
  }
  return `<div onclick="event.stopPropagation();openCalDetail('${e._id}')" title="${fEsc(e.title)}" style="background:#eef3fb;border-left:3px solid var(--primary);border-radius:4px;padding:1px 4px;margin-bottom:2px;font-size:0.68em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;">${e.video?'🎥 ':''}${fEsc(e.title)}</div>`;
}
function openSyncedDetail(sid){
  const e=_syncedIndex[sid]; if(!e) return; _syncedCurrent=e;
  document.getElementById('synced-title').textContent=e.title||'Event';
  const att=(e.attendees||[]);
  document.getElementById('synced-body').innerHTML=
    `<div style="font-size:0.85em;color:#555;margin-bottom:8px;">${fmtDate(e.date)}${e.time?' · '+e.time:''}${e.location?' · 📍 '+fEsc(e.location):''}</div>`+
    (e.video?`<div style="margin-bottom:8px;font-size:0.85em;">🎥 <a href="${e.video}" target="_blank" rel="noopener" style="color:#2f9bb5;word-break:break-all;">${fEsc(e.video)}</a></div>`:'<div style="font-size:0.82em;color:#9a3412;margin-bottom:8px;">No meeting/video link on this event — the bot needs one to join.</div>')+
    (att.length?`<div style="font-size:0.82em;color:#666;margin-bottom:8px;"><b>Attendees:</b> ${att.map(fEsc).join(', ')}</div>`:'')+
    (e.description?`<div style="font-size:0.8em;color:#777;white-space:pre-wrap;max-height:120px;overflow:auto;border-top:1px solid #eef;padding-top:6px;">${fEsc(e.description)}</div>`:'');
  document.getElementById('synced-sendbot').style.display=e.video?'inline-flex':'none';
  document.getElementById('synced-status').textContent='';
  document.getElementById('synced-modal').style.display='flex';
}
function closeSyncedDetail(){ document.getElementById('synced-modal').style.display='none'; _syncedCurrent=null; }
async function sendBotForSyncedLegacy(){
  const e=_syncedCurrent; if(!e||!e.video) return;
  const status=document.getElementById('synced-status');
  const base=(localStorage.getItem('rg_meetingbot_url')||DEFAULT_MEETING_BACKEND).replace(/\/+$/,'');
  const attendees=(e.attendees||[]).map(em=>({email:em}));
  status.style.color='#666'; status.textContent='Dispatching bot (backend may take ~15s to wake)…';
  try{
    const r=await fetch(base+'/api/meeting-agent/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      title:e.title||'Meeting', meeting_url:e.video, platform:'auto', attendees,
      notice_text:'ReGroup Summary Agent may join to record/transcribe and summarize this meeting for authorized attendees.',
      consent_confirmed:true, send_to_attendees:true, review_required:false, create_bot_now:true, source:'regroup_app_synced_calendar'
    })});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((d.error&&(d.error.message||JSON.stringify(d.error)))||('HTTP '+r.status));
    const ev=d.event||d; const botId=ev.provider_bot_id||ev.bot_id||'';
    status.style.color='#15803d'; status.textContent='✓ Bot dispatched'+(botId?(' (id '+botId+')'):'')+'. Admit “ReGroup Summary Agent” in the meeting; the summary goes to attendee inboxes when it ends.';
  }catch(err){ status.style.color='#e53935'; status.textContent='Bot error — '+err.message; }
}
async function ensureSyncedCalEvent(e){
  const sourceKey=syncedSourceKey(e);
  const existing=DB.calendar().find(x=>x.syncedSourceKey===sourceKey || (!x.syncedSourceKey && x.date===e.date && x.title===e.title && x.video===e.video));
  if(existing) return existing;
  const attendees=syncedEventAttendees(e);
  const staffNames=staffNamesForEmails(attendees);
  const external=attendees.filter(email=>!matchedStaffNamesForEmails([email]).length);
  const notes=[
    e.description||'',
    e.htmlLink ? 'Source calendar event: '+e.htmlLink : '',
    e.phone ? 'Phone join: '+e.phone : ''
  ].filter(Boolean).join('\n\n');
  const data={
    title:e.title||'Meeting',
    date:e.date||new Date().toISOString().slice(0,10),
    time:e.time||'',
    video:e.video||'',
    address:e.location||'',
    invited:staffNames.join(', '),
    external:external.join(', '),
    notes,
    createdBy:currentUserName(),
    syncedSource:'google_or_ical',
    syncedSourceKey:sourceKey
  };
  const id=await DB.addCalEvent(data);
  return {...data,_id:id};
}
async function sendBotForSynced(){
  const e=_syncedCurrent; if(!e||!e.video) return;
  const status=document.getElementById('synced-status');
  status.style.color='#666'; status.textContent='Importing synced event and dispatching bot (backend may take ~15s to wake)...';
  try{
    const appEvent=await ensureSyncedCalEvent(e);
    const res=await dispatchMeetingBot(appEvent);
    if(!res.ok) throw new Error(res.error||'bot dispatch failed');
    _syncedCurrent._appCalendarId=appEvent._id;
    status.style.color='#15803d'; status.textContent='Bot requested and linked to this app calendar event. Admit "ReGroup Summary Agent" if it waits in the lobby; the summary will be tracked here and delivered to attendee inboxes.';
    renderCalendar();
  }catch(err){ status.style.color='#e53935'; status.textContent='Bot error - '+err.message; }
}
let _gcalToken = null, _gcalTokenClient = null, _gcalTokenEmail = '';
// iCal-link sync: paste a calendar's secret ICS URL; fetched via the backend proxy (avoids browser CORS)
// Works for any account — staff store the URL on their staff doc (syncs across devices); admin/no-staff use localStorage.
function getMyIcsUrl(){
  const s=(typeof myStaffRecord==='function')?myStaffRecord():null;
  if(s && s.icsUrl) return s.icsUrl;
  try{ return localStorage.getItem('rg_ics_'+calendarSyncOwnerKey())||''; }catch(_){ return ''; }
}
async function setMyIcsUrl(v){
  const s=(typeof myStaffRecord==='function')?myStaffRecord():null;
  if(s){ try{ await DB.updateRecord('staff', s._id, {icsUrl:v}); }catch(_){} }
  try{ localStorage.setItem('rg_ics_'+calendarSyncOwnerKey(), v); }catch(_){}
}
async function saveProfileIcs(){
  const v=(document.getElementById('pf-ics').value||'').trim();
  const st=document.getElementById('pf-ics-status');
  await setMyIcsUrl(v);
  if(!v){ try{ delete _icsEvents[calendarSyncOwnerKey()]; }catch(_){} if(st){st.style.color='#888';st.textContent='Cleared.';} return; }
  if(st){ st.style.color='#666'; st.textContent='Saved ✓ — syncing… (first sync can take ~60s if the backend is asleep)'; }
  try{ await syncIcsCalendar(); if(st){st.style.color='#43a047';st.textContent='Saved ✓ — synced. Open the Calendar tab to see your events.';} }
  catch(e){ if(st){st.style.color='#e53935';st.textContent='Saved, but sync failed — '+e.message;} }
}
function openIcsSetup(){
  const url=prompt('Paste your calendar\'s SECRET iCal URL:\n\nGoogle Calendar → Settings → click your calendar (left side) → scroll to "Secret address in iCal format" → copy that link.\n(Outlook & iCloud also provide an ICS/iCal link.)', getMyIcsUrl());
  if(url===null) return;
  const v=url.trim();
  setMyIcsUrl(v).then(()=>{ if(v){ syncIcsCalendar(); } else { delete _icsEvents[calendarSyncOwnerKey()]; renderCalendar(); } });
}
async function syncIcsCalendar(){
  const status=document.getElementById('gcal-status');
  const icsUrl=getMyIcsUrl();
  if(!icsUrl){ if(status){status.style.color='#9a3412';status.textContent='No iCal link saved yet — click “📎 Sync via iCal link” and paste your calendar’s secret iCal URL.';} return; }
  // The /api/ics proxy lives on the known-good backend; don't rely on a possibly-misconfigured Meeting Bot URL.
  const base=DEFAULT_MEETING_BACKEND.replace(/\/+$/,'');
  const reqUrl=base+'/api/ics?url='+encodeURIComponent(icsUrl);
  if(status){ status.style.color='#666'; status.textContent='Syncing your calendar (backend may take up to ~60s to wake)…'; }
  // Cold-start retry: the free backend can be asleep, so retry a couple of times.
  let lastErr=null;
  for(let attempt=0; attempt<3; attempt++){
    try{
      const r=await fetch(reqUrl, {cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
      _icsEvents[calendarSyncOwnerKey()]=(d.events||[]).map(e=>({title:e.title,date:e.date,time:e.time,location:e.location,video:e.video||extractMeetingUrl(e.location,e.description,e.title),attendees:splitEmails((e.attendees||[]).join(',')),description:e.description||'',sourceKey:'ics:'+(e.uid||[e.title,e.date,e.time,e.location].join('|')),_gcal:true}));
      if(status){ status.style.color='#15803d'; status.textContent='✓ Synced '+(d.events||[]).length+' calendar events from your iCal link.'; }
      renderCalendar();
      return;
    }catch(e){ lastErr=e; if(status){ status.style.color='#666'; status.textContent='Waking the sync backend… (attempt '+(attempt+1)+' of 3)'; } await new Promise(r=>setTimeout(r,5000)); }
  }
  if(status){ status.style.color='#e53935'; status.textContent='Calendar sync error — '+(lastErr&&lastErr.message||'could not reach the backend')+'. Try again in a moment, or re-check your iCal link.'; }
}
function icsAutoSync(){ if(getMyIcsUrl() && !_icsEvents[calendarSyncOwnerKey()]) syncIcsCalendar(); }
function getGcalClientId(){ return (localStorage.getItem('rg_gcal_client_id')||'').trim(); }
function saveGcalClientId(){
  const v=(document.getElementById('gcal-clientid-input').value||'').trim();
  localStorage.setItem('rg_gcal_client_id', v);
  const m=document.getElementById('gcal-clientid-msg'); if(m){ m.style.color='#43a047'; m.textContent=v?'✓ Saved. Staff can now connect from the Calendar tab.':'Cleared.'; }
}
function gcalConnectedKey(email){ return 'rg_gcal_connected_'+String(email||currentProfileEmail()||'anon').toLowerCase(); }
function updateGcalProfileUi(){
  const email = currentProfileEmail();
  const status = document.getElementById('gcal-status');
  const btn = document.getElementById('gcal-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = email
      ? (localStorage.getItem(gcalConnectedKey(email))==='1' ? '🔄 Refresh '+email+' Calendar' : '🔗 Connect '+email+' Calendar')
      : 'Add profile email to sync calendar';
  }
  if (!email && status) {
    status.style.color = '#9a3412';
    status.innerHTML = 'Add your work email under <b>My Profile → Email Address(es)</b>. Calendar sync will use that profile email automatically.';
  }
}
function connectGcal(){
  const status=document.getElementById('gcal-status');
  const email=currentProfileEmail();
  const cid=getGcalClientId();
  if(!email){ updateGcalProfileUi(); return; }
  if(!cid){ if(status){status.style.color='#e53935'; status.innerHTML='No Google Client ID set yet — an admin adds it in <b>Settings → Google Calendar Sync</b>.';} return; }
  if(!(window.google && google.accounts && google.accounts.oauth2)){ if(status){status.style.color='#e53935'; status.textContent='Google sign-in is still loading — try again in a few seconds.';} return; }
  if(status){ status.style.color='#666'; status.textContent='Opening Google sign-in for '+email+'…'; }
  try{
    _gcalTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
      hint: email,
      callback: (resp)=>{ if(resp&&resp.access_token){ _gcalToken=resp.access_token; _gcalTokenEmail=email; localStorage.setItem(gcalConnectedKey(email),'1'); fetchGcal(email); }
        else if(status){ status.style.color='#e53935'; status.textContent='Google sign-in was cancelled.'; } }
    });
    _gcalTokenClient.requestAccessToken({prompt: localStorage.getItem(gcalConnectedKey(email))==='1' ? '' : 'consent'});
  }catch(e){ if(status){ status.style.color='#e53935'; status.textContent='Google connect error: '+e.message; } }
}
async function fetchGcal(profileEmail){
  const status=document.getElementById('gcal-status');
  const email=(profileEmail||currentProfileEmail()||'').toLowerCase();
  if(!email){ updateGcalProfileUi(); return; }
  if(!_gcalToken) return;
  if(status){ status.style.color='#666'; status.textContent='Loading Google Calendar for '+email+'…'; }
  try{
    try {
      const u=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{'Authorization':'Bearer '+_gcalToken}});
      if(u.ok){
        const info=await u.json();
        const signedIn=String(info.email||'').toLowerCase();
        if(signedIn && signedIn!==email){
          _gcalToken=null; _gcalTokenEmail=''; localStorage.removeItem(gcalConnectedKey(email));
          if(status){ status.style.color='#e53935'; status.textContent='Signed in as '+signedIn+', but this profile is set to '+email+'. Reconnect with the profile email account.'; }
          updateGcalProfileUi();
          return;
        }
      }
    } catch(_) {}
    const tMin=new Date(); tMin.setMonth(tMin.getMonth()-1);
    const tMax=new Date(); tMax.setMonth(tMax.getMonth()+3);
    const url='https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250'
      +'&timeMin='+encodeURIComponent(tMin.toISOString())+'&timeMax='+encodeURIComponent(tMax.toISOString());
    const r=await fetch(url,{headers:{'Authorization':'Bearer '+_gcalToken}});
    if(!r.ok){ throw new Error('Calendar API '+r.status+(r.status===403?' (enable Calendar API / check origin)':'')); }
    const d=await r.json();
    const evs=(d.items||[]).map(mapGoogleCalendarEvent).filter(e=>e.date);
    _gcalEvents[email]=evs;
    if(status){ status.style.color='#15803d'; status.textContent='✓ Synced '+evs.length+' Google Calendar events for '+email+'.'; }
    updateGcalProfileUi();
    renderCalendar();
  }catch(e){ if(status){ status.style.color='#e53935'; status.textContent='Could not load Google Calendar — '+e.message; } }
}
function gcalAutoSync(){
  const email=currentProfileEmail();
  if(email && getGcalClientId() && localStorage.getItem(gcalConnectedKey(email))==='1' && (!_gcalToken || _gcalTokenEmail!==email) && window.google && google.accounts) connectGcal();
}
function renderCalendar(){
  populateStaffNameList();
  updateGcalProfileUi();
  gcalAutoSync();
  icsAutoSync();
  checkMeetingSummaries();
  autoDispatchBots();
  const label=document.getElementById('cal-month-label');
  if(label) label.textContent=_calMonth.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const grid=document.getElementById('cal-grid'); if(!grid) return;
  const year=_calMonth.getFullYear(), month=_calMonth.getMonth();
  const startDow=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayStr=new Date().toISOString().slice(0,10);
  const byDate={};
  DB.calendar().forEach(e=>{ if(e.date){(byDate[e.date]=byDate[e.date]||[]).push(e);} });
  (_gcalEvents[currentProfileEmail()]||[]).forEach(e=>{ if(e.date){(byDate[e.date]=byDate[e.date]||[]).push(e);} });
  (_icsEvents[calendarSyncOwnerKey()]||[]).forEach(e=>{ if(e.date){(byDate[e.date]=byDate[e.date]||[]).push(e);} });
  _syncedIndex={}; _calSidN=0;

  if(window.innerWidth < 600){
    grid.innerHTML = _buildAgendaHtml(byDate, year, month, daysInMonth, todayStr);
    return;
  }

  const dows=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<div style="background:#fafbfd;border-radius:8px;min-height:82px;"></div>';
  for(let d=1; d<=daysInMonth; d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs=(byDate[ds]||[]).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const isToday=ds===todayStr;
    cells+=`<div onclick="openCalEvent(null,'${ds}')" style="background:#fff;border:1px solid ${isToday?'var(--accent)':'#eef'};border-radius:8px;min-height:82px;padding:5px 6px;cursor:pointer;">
      <div style="font-size:0.74em;font-weight:700;color:${isToday?'var(--accent)':'#94a3b8'};margin-bottom:3px;">${d}</div>
      ${evs.slice(0,3).map(calChip).join('')}
      ${evs.length>3?`<div style="font-size:0.64em;color:#94a3b8;">+${evs.length-3} more</div>`:''}</div>`;
  }
  grid.innerHTML=`<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;">
    ${dows.map(d=>`<div style="text-align:center;font-size:0.7em;font-weight:700;color:#94a3b8;text-transform:uppercase;padding-bottom:4px;">${d}</div>`).join('')}
    ${cells}</div>`;
}

function _buildAgendaHtml(byDate, year, month, daysInMonth, todayStr){
  const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let html='<div style="display:flex;flex-direction:column;">';
  let hasEvents=false;
  for(let d=1; d<=daysInMonth; d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs=(byDate[ds]||[]).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    if(!evs.length) continue;
    hasEvents=true;
    const isToday=ds===todayStr;
    const dateObj=new Date(year,month,d);
    const dayLabel=`${DOW[dateObj.getDay()].slice(0,3)}, ${dateObj.toLocaleDateString('en-US',{month:'short',day:'numeric'})}${isToday?' — Today':''}`;
    html+=`<div style="margin-bottom:14px;">
      <div style="font-size:0.72em;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${isToday?'var(--accent)':'#94a3b8'};margin-bottom:5px;padding-bottom:4px;border-bottom:1px solid #eef;">${dayLabel}</div>
      ${evs.map(e=>{
        const isGcal=!!e._gcal;
        let onclick;
        if(isGcal){ const sid='s'+(_calSidN++); _syncedIndex[sid]=e; onclick=`openSyncedDetail('${sid}')`; }
        else { onclick=`openCalDetail('${e._id}')`; }
        const accentColor=isGcal?'#4285F4':'var(--primary)';
        return `<div onclick="${onclick}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#fff;border-radius:8px;border:1px solid ${isToday?'var(--accent)':'#eef'};margin-bottom:6px;cursor:pointer;active:background:#f5f8ff;">
          <div style="width:3px;align-self:stretch;min-height:18px;border-radius:2px;background:${accentColor};flex-shrink:0;margin-top:2px;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.9em;color:${accentColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${isGcal?'<span style="opacity:0.6;font-size:0.82em;">G </span>':''}${fEsc(e.title||'Untitled')}</div>
            ${e.time?`<div style="font-size:0.77em;color:#777;margin-top:2px;">🕐 ${fEsc(e.time)}</div>`:''}
            ${e.video?'<div style="font-size:0.77em;color:#2f9bb5;margin-top:2px;">🎥 Video call</div>':''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
  if(!hasEvents) html+='<div style="text-align:center;padding:40px 20px;color:#bbb;"><div style="font-size:2.5em;margin-bottom:8px;">📅</div><div style="font-weight:600;">No events this month</div><div style="font-size:0.84em;margin-top:8px;">Tap + Add Event to create one</div></div>';
  return html+'</div>';
}
function openCalEvent(id, presetDate){
  populateStaffNameList();
  const del=document.getElementById('ce-delete-btn');
  if(id){
    const e=DB.calendar().find(x=>x._id===id); if(!e) return;
    if(!isOwnerOrAdmin(e.createdBy)){ alert('Only the event creator or an admin can edit this event.'); return; }
    document.getElementById('cal-modal-title').textContent='Edit Event';
    document.getElementById('ce-id').value=id;
    document.getElementById('ce-title').value=e.title||'';
    document.getElementById('ce-date').value=e.date||'';
    document.getElementById('ce-time').value=e.time||'';
    document.getElementById('ce-video').value=e.video||'';
    document.getElementById('ce-address').value=e.address||'';
    document.getElementById('ce-invited').value=e.invited||'';
    document.getElementById('ce-external').value=e.external||'';
    document.getElementById('ce-notes').value=e.notes||'';
    del.style.display=isAdmin()?'inline-flex':'none';
  } else {
    document.getElementById('cal-modal-title').textContent='Add Event';
    ['ce-id','ce-title','ce-time','ce-video','ce-address','ce-invited','ce-external','ce-notes'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('ce-date').value=presetDate||new Date().toISOString().slice(0,10);
    del.style.display='none';
  }
  document.getElementById('cal-modal').style.display='flex';
}
function closeCalEvent(){ document.getElementById('cal-modal').style.display='none'; }
async function saveCalEvent(){
  const id=document.getElementById('ce-id').value;
  const title=document.getElementById('ce-title').value.trim();
  const date=document.getElementById('ce-date').value;
  if(!title){ alert('Enter a title.'); return; }
  if(!date){ alert('Pick a date.'); return; }
  const data={ title, date, time:document.getElementById('ce-time').value.trim(),
    video:document.getElementById('ce-video').value.trim(), address:document.getElementById('ce-address').value.trim(),
    invited:document.getElementById('ce-invited').value.trim(), external:document.getElementById('ce-external').value.trim(),
    notes:document.getElementById('ce-notes').value.trim() };
  if(id) await DB.updateCalEvent(id, data);
  else { data.createdBy=currentUserName(); await DB.addCalEvent(data); }
  closeCalEvent(); renderCalendar();
}
function _extPeople(e){ return (e.external||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); }
function recordingBotUiState(e){
  const status=String((e&&e.botStatus)||'').trim().toLowerCase();
  if(!status) return {label:'Not sent', detail:'No recording bot has been sent for this meeting yet.', color:'#666', canRetry:false};
  if(status==='pending' || status==='joining') return {label:'Sending', detail:'The recording bot request was created and will request admission shortly.', color:'#2f6fed', canRetry:false};
  if(status==='waiting_for_admission') return {label:'Waiting for admission', detail:'The recording bot is waiting in the lobby. Admit it in the meeting to begin recording.', color:'#b7791f', canRetry:false};
  if(status==='recording') return {label:'Recording', detail:'The recording bot is in the meeting and the transcript is being captured.', color:'#c0392b', canRetry:false};
  if(status==='processing') return {label:'Processing summary', detail:'The meeting ended. The transcript is being summarized and delivered to attendee inboxes.', color:'#6b46c1', canRetry:false};
  if(status==='completed') return {label:'Summary sent', detail:e&&e.summary?'The summary has been written to this meeting and sent to attendee inboxes.':'The recording finished. The summary should appear shortly.', color:'#2e7d32', canRetry:false};
  if(status==='failed') return {label:'Failed', detail:(e&&e.botError)?('The recording bot failed: '+e.botError):'The recording bot request failed. You can retry it.', color:'#e53935', canRetry:true};
  return {label:status.replace(/_/g,' '), detail:'Current bot status: '+status.replace(/_/g,' ')+'.', color:'#666', canRetry:false};
}
function openCalDetail(id){
  const e=DB.calendar().find(x=>x._id===id); if(!e) return;
  _calDetailId=id;
  const link=e.video?`<a href="${fEsc(e.video)}" target="_blank" rel="noopener" style="color:#2f9bb5;word-break:break-all;">${fEsc(e.video)}</a>`:'<span style="color:#bbb;">—</span>';
  const mine=_extPeople(e);
  const history=mine.length?DB.calendar().filter(o=>o._id!==id && _extPeople(o).some(p=>mine.includes(p))).sort((a,b)=>(b.date||'').localeCompare(a.date||'')):[];
  const botUi=recordingBotUiState(e);
  const botRequestedBy=e.botRequestedBy?`<div style="font-size:0.76em;color:#777;margin-top:6px;">Requested by ${fEsc(e.botRequestedBy)}</div>`:'';
  const recordingLink=e.recordingUrl?`<div style="font-size:0.76em;color:#555;margin-top:6px;">Recording: <a href="${fEsc(e.recordingUrl)}" target="_blank" rel="noopener" style="color:#2f9bb5;word-break:break-all;">Open recording</a></div>`:'';
  document.getElementById('cal-detail-body').innerHTML=`
    <div style="font-size:1.3em;font-weight:700;color:var(--primary);">${fEsc(e.title)}</div>
    <div style="color:#777;font-size:0.88em;margin:4px 0 14px;">📅 ${fmtDate(e.date)}${e.time?' · '+fEsc(e.time):''}</div>
    <div style="background:#f8f9fa;border-radius:10px;padding:14px;font-size:0.9em;line-height:1.7;">
      <div><b>🎥 Video:</b> ${link}</div>
      <div><b>📍 Address:</b> ${fEsc(e.address)||'<span style="color:#bbb;">—</span>'}</div>
      <div><b>👥 Invited:</b> ${fEsc(e.invited)||'<span style="color:#bbb;">—</span>'}</div>
      <div><b>🌐 External:</b> ${fEsc(e.external)||'<span style="color:#bbb;">—</span>'}</div>
      ${e.notes?`<div style="margin-top:8px;"><b>📝 About:</b><div style="white-space:pre-wrap;margin-top:3px;">${fEsc(e.notes)}</div></div>`:''}
      <div style="margin-top:8px;font-size:0.78em;color:#aaa;">Created by ${fEsc(e.createdBy)||'—'}</div>
    </div>
    <h4 style="color:var(--primary);margin:18px 0 8px;border-bottom:1.5px solid #eef;padding-bottom:6px;">📚 History with the same external people</h4>
    ${history.length?history.map(o=>`<div style="padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:0.86em;cursor:pointer;" onclick="openCalDetail('${o._id}')"><b>${fmtDate(o.date)}</b> — ${fEsc(o.title)} <span style="color:#aaa;">(${fEsc(o.external)})</span></div>`).join(''):'<p style="color:#bbb;font-size:0.85em;">No other meetings with these external people yet.</p>'}
     <h4 style="color:var(--primary);margin:18px 0 8px;border-bottom:1.5px solid #eef;padding-bottom:6px;">🎙 Meeting Summary</h4>
     ${e.summary?`<div style="background:#f0f9f4;border:1px solid #cdeed6;border-radius:10px;padding:12px;font-size:0.88em;white-space:pre-wrap;line-height:1.6;margin-bottom:10px;">${fEsc(e.summary)}</div><div style="font-size:0.75em;color:#aaa;margin-bottom:8px;">Summarized by ${fEsc(e.summarizedBy)||'—'}</div>`:''}
     ${e.video?`<div style="background:#eef3fb;border:1px solid #dbe6f7;border-radius:10px;padding:12px;margin-bottom:12px;">
      <div style="font-size:0.85em;font-weight:600;color:var(--primary);margin-bottom:6px;">🤖 Recording bot</div>
      <p style="font-size:0.78em;color:#777;margin-bottom:8px;">Send a visible recording bot to this meeting. It requests admission, records only after it joins, then writes a summary to the inboxes of app users who attended.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-accent" style="font-size:0.82em;" onclick="sendMeetingBot('${id}')" ${e.botStatus && e.botStatus!=='failed' ? 'disabled' : ''}>Send Recording Bot</button>
        ${botUi.canRetry?`<button class="btn btn-outline" style="font-size:0.82em;" onclick="retryMeetingBot('${id}')">Retry</button>`:''}
        <span style="font-size:0.76em;color:${botUi.color};font-weight:700;">${fEsc(botUi.label)}</span>
      </div>
      <div id="mtg-bot-status" style="font-size:0.82em;color:${botUi.color};margin-top:8px;">${fEsc(botUi.detail)}</div>
      ${botRequestedBy}
      ${recordingLink}
     </div>`:''}
    <div style="background:#f8f9fa;border:1px solid #e5e9f0;border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="font-size:0.85em;font-weight:600;color:var(--primary);margin-bottom:4px;">🔴 Record &amp; transcribe (in this browser — no server needed)</div>
      <p style="font-size:0.78em;color:#777;margin-bottom:8px;">On the device in the meeting (or with the call on speaker), start recording — speech is transcribed live below. Stop, then summarize to message every attendee. Works in Chrome/Edge.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-danger" id="mtg-rec-btn" onclick="toggleMeetingRecording('${id}')">🔴 Start recording</button>
        <span id="mtg-rec-status" style="font-size:0.82em;color:#666;"></span>
      </div>
    </div>
    <p style="font-size:0.8em;color:#888;margin-bottom:6px;">Live transcript (editable) — or paste a transcript/auto-caption here. Then summarize to message every invited TJC staff member's inbox + Admin.</p>
    <textarea id="mtg-transcript" rows="3" placeholder="Transcript appears here as you record, or paste it…" style="width:100%;padding:9px 11px;border:1.5px solid #ddd;border-radius:8px;font-size:0.88em;min-height:60px;"></textarea>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;">
      <button class="btn btn-accent" style="font-size:0.82em;" onclick="summarizeMeeting('${id}')">✨ Summarize &amp; message attendees</button>
      <span id="mtg-sum-status" style="font-size:0.82em;color:#666;"></span>
    </div>`;
  document.getElementById('cal-detail-edit').style.display=isOwnerOrAdmin(e.createdBy)?'inline-flex':'none';
  document.getElementById('cal-detail').style.display='flex';
}
function closeCalDetail(){ document.getElementById('cal-detail').style.display='none'; _calDetailId=null; }
function editCalFromDetail(){ const id=_calDetailId; closeCalDetail(); openCalEvent(id); }
function deleteCalEvent(){
  const id=document.getElementById('ce-id').value; if(!id) return;
  requireAdmin(async ()=>{ if(!confirm('Delete this event?')) return; await DB.removeCalEvent(id); closeCalEvent(); renderCalendar(); });
}

function saveMeetingBotUrl(){
  const v=(document.getElementById('meetingbot-url-input').value||'').trim().replace(/\/+$/,'');
  localStorage.setItem('rg_meetingbot_url', v);
  const m=document.getElementById('meetingbot-msg'); if(m){ m.style.color='#43a047'; m.textContent=v?'✓ Saved.':'Cleared.'; }
}
function saveMeetingBotAuto(){
  const on=document.getElementById('meetingbot-auto').checked;
  localStorage.setItem('rg_meetingbot_auto', on?'1':'0');
  const m=document.getElementById('meetingbot-msg'); if(m){ m.style.color='#43a047'; m.textContent=on?'✓ Auto-bot ON — bots dispatch automatically as meetings start.':'Auto-bot off.'; }
  if(on) autoDispatchBots();
}
async function testMeetingBot(){
  const m=document.getElementById('meetingbot-msg');
  const url=(document.getElementById('meetingbot-url-input').value||'').trim().replace(/\/+$/,'');
  if(!url){ m.style.color='#e53935'; m.textContent='Enter the backend URL first.'; return; }
  m.style.color='#666'; m.textContent='Testing…';
  try{
    const r=await fetch(url+'/health'); const d=await r.json();
    const ai = d.ai_provider ? ('AI:'+d.ai_provider+':' + (d.ai_configured?'on':'off')) : ('Anthropic:'+(d.anthropic_configured?'on':'off'));
    m.style.color=d.ok?'#43a047':'#e53935';
    m.textContent=d.ok?`✓ Connected. Recall:${d.recall_configured?'on':'off'} · ${ai}`:'Unexpected response.';
  }catch(err){ m.style.color='#e53935'; m.textContent='Could not reach backend — '+err.message; }
}

// In-browser meeting recorder: live speech-to-text via the Web Speech API.
// No server, no paid bot — transcribes on the device that's in the meeting.
let _mtgRec = null, _mtgRecOn = false, _mtgRecBase = '';
function toggleMeetingRecording(id){
  const status=document.getElementById('mtg-rec-status');
  const btn=document.getElementById('mtg-rec-btn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ if(status){status.style.color='#e53935'; status.textContent='Live transcription needs Chrome or Edge. Use “paste transcript” instead.';} return; }
  if(_mtgRecOn){ // stop
    _mtgRecOn=false; try{ _mtgRec && _mtgRec.stop(); }catch(e){}
    btn.textContent='🔴 Start recording'; btn.classList.remove('btn-outline'); btn.classList.add('btn-danger');
    if(status){ status.style.color='#43a047'; status.textContent='Stopped. Review the transcript, then “Summarize & message attendees”.'; }
    return;
  }
  // start
  const ta=document.getElementById('mtg-transcript');
  _mtgRecBase = ta.value ? ta.value.replace(/\s+$/,'')+'\n' : '';
  _mtgRec = new SR(); _mtgRec.continuous=true; _mtgRec.interimResults=true; _mtgRec.lang='en-US';
  let finalText='';
  _mtgRec.onresult=(ev)=>{
    let interim='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const t=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) finalText+=t+' '; else interim+=t;
    }
    ta.value=_mtgRecBase+finalText+interim;
    ta.scrollTop=ta.scrollHeight;
  };
  _mtgRec.onerror=(e)=>{ if(status){ status.style.color='#e53935'; status.textContent='Mic/recognition error: '+(e.error||'unknown')+'. Allow microphone access.'; } };
  _mtgRec.onend=()=>{ if(_mtgRecOn){ try{ _mtgRec.start(); }catch(e){} } };  // auto-restart while recording
  try{ _mtgRec.start(); _mtgRecOn=true; btn.textContent='⏹ Stop recording'; btn.classList.remove('btn-danger'); btn.classList.add('btn-outline'); if(status){ status.style.color='#c0392b'; status.textContent='● Recording… speak; transcript fills in below.'; } }
  catch(e){ if(status){ status.style.color='#e53935'; status.textContent='Could not start: '+e.message; } }
}

const DEFAULT_MEETING_BACKEND='https://regroup-meeting-agent-backend.onrender.com';
const MEETING_BOT_SESSION_STORAGE_KEY='rg_meetingbot_session';
const _meetingBotDispatching = new Set();

function meetingBotBaseUrl(){
  return (localStorage.getItem('rg_meetingbot_url')||'').trim().replace(/\/+$/,'') || DEFAULT_MEETING_BACKEND;
}
function loadMeetingBotSession(){
  try{ return JSON.parse(localStorage.getItem(MEETING_BOT_SESSION_STORAGE_KEY)||'null'); }catch(_){ return null; }
}
function clearMeetingBotSession(){
  try{ localStorage.removeItem(MEETING_BOT_SESSION_STORAGE_KEY); }catch(_){}
}
function saveMeetingBotSession(session){
  try{ localStorage.setItem(MEETING_BOT_SESSION_STORAGE_KEY, JSON.stringify(session)); }catch(_){}
}
function hasValidMeetingBotSession(session){
  if(!session || !session.token || !session.userName || session.userName!==currentUserName()) return false;
  if(!session.expiresAt) return true;
  return new Date(session.expiresAt).getTime() > (Date.now()+15000);
}
async function ensureMeetingBotSession(opts={}){
  if(!_currentUser) throw new Error('Sign in to the app before sending a recording bot.');
  const existing=loadMeetingBotSession();
  if(hasValidMeetingBotSession(existing)) return existing.token;
  if(opts.silent) return '';
  const password=prompt(`Enter your app password to authorize the recording bot for ${currentUserName()}.`);
  if(password===null) throw new Error('Recording bot request cancelled.');
  const r=await fetch(meetingBotBaseUrl()+'/api/session/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({ password, expected_user_name: currentUserName() })
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error((d.error&&(d.error.message||d.error))||('HTTP '+r.status));
  if(!(d.session&&d.session.token)) throw new Error('The meeting bot backend did not return a session token.');
  saveMeetingBotSession({
    token:d.session.token,
    expiresAt:d.session.expires_at||'',
    userName:(d.user&&d.user.name)||currentUserName(),
    isAdmin:!!(d.user&&d.user.isAdmin)
  });
  return d.session.token;
}
async function dispatchMeetingBot(e, opts={}){
  if(!e || !e._id) return {ok:false, error:'meeting not found'};
  if(!e.video) return {ok:false, error:'this meeting does not have a video link'};
  let token='';
  try{
    token=opts.sessionToken || await ensureMeetingBotSession({silent:!!opts.silent});
  }catch(err){
    return {ok:false, error:err.message, authRequired:true};
  }
  if(!token) return {ok:false, error:'meeting bot session is required', authRequired:true};
  const path=opts.retry?`/api/meetings/${encodeURIComponent(e._id)}/recording-bot/retry`:`/api/meetings/${encodeURIComponent(e._id)}/recording-bot`;
  try{
    const r=await fetch(meetingBotBaseUrl()+path,{
      method:'POST',
      headers:{'content-type':'application/json','authorization':'Bearer '+token},
      body:'{}'
    });
    if(r.status===401 && !opts._retriedAuth){
      clearMeetingBotSession();
      return dispatchMeetingBot(e, {...opts, _retriedAuth:true});
    }
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((d.error&&(d.error.message||d.error))||('HTTP '+r.status));
    const ev=d.event||{};
    const patch={};
    if(ev.id) patch.botEventId=ev.id;
    if(ev.status||ev.bot_status) patch.botStatus=ev.status||ev.bot_status;
    if(ev.provider) patch.botProvider=ev.provider;
    if(ev.error_message!==undefined) patch.botError=ev.error_message||'';
    if(ev.requested_by_user_name) patch.botRequestedBy=ev.requested_by_user_name;
    if(ev.recording_url) patch.recordingUrl=ev.recording_url;
    if(ev.summary_text){ patch.summary=ev.summary_text; patch.summarizedBy='Meeting Bot'; }
    if(Object.keys(patch).length) await DB.updateCalEvent(e._id, patch);
    return {ok:true, event:ev, idempotent:!!d.idempotent, retriedFromEventId:d.retried_from_event_id||''};
  }catch(err){
    return {ok:false, error:err.message};
  }
}
async function sendMeetingBot(id, opts={}){
  const e=DB.calendar().find(x=>x._id===id); if(!e) return;
  const status=document.getElementById('mtg-bot-status');
  if(!e.video){
    if(status){ status.style.color='#e53935'; status.textContent='This meeting is missing a valid video link.'; }
    return;
  }
  if(_meetingBotDispatching.has(id)) return;
  _meetingBotDispatching.add(id);
  if(status){
    status.style.color='#666';
    status.textContent=opts.retry?'Retrying the recording bot request...':'Sending the recording bot. It may take a few seconds for the backend to wake up.';
  }
  try{
    const res=await dispatchMeetingBot(e, opts);
    if(status){
      if(res.ok){
        const latest=DB.calendar().find(x=>x._id===id) || {...e, botStatus:(res.event&&((res.event.status)||(res.event.bot_status)))||e.botStatus, botError:(res.event&&res.event.error_message)||e.botError, summary:(res.event&&res.event.summary_text)||e.summary};
        const ui=recordingBotUiState(latest);
        status.style.color=ui.color;
        status.textContent=res.idempotent?'A recording bot is already active for this meeting.':ui.detail;
      } else {
        status.style.color='#e53935';
        status.textContent='Recording bot error: '+res.error;
      }
    }
  } finally {
    _meetingBotDispatching.delete(id);
    if(_calDetailId===id) setTimeout(()=>openCalDetail(id), 0);
  }
}
function retryMeetingBot(id){
  return sendMeetingBot(id, {retry:true});
}
// Autonomous: when enabled by admin, send a bot to every calendar meeting that has a
// video link as its start time approaches (once per meeting).
let _autoBotBusy=false;
async function autoDispatchBots(){
  if(localStorage.getItem('rg_meetingbot_auto')!=='1' || _autoBotBusy) return;
  const now=new Date(), todayStr=now.toISOString().slice(0,10), nowMin=now.getHours()*60+now.getMinutes();
  const due=DB.calendar().filter(e=>e.video && !e.botEventId && e.date===todayStr && (()=>{
    if(!e.time) return true; const [h,m]=e.time.split(':').map(Number); const st=h*60+m; return nowMin>=st-3 && nowMin<=st+15;
  })());
  if(!due.length) return;
  _autoBotBusy=true;
  try{ for(const e of due){ await dispatchMeetingBot(e, {silent:true}); } } finally { _autoBotBusy=false; }
}

async function aiSummarizeTranscript(title, date, transcript, attendees){
  if(!transcript || transcript.trim().length<20) return '';
  const prompt='You are a meeting-notes assistant for ReGroup / TJC Oregon. Summarize the meeting "'+(title||'')+'" ('+(date||'')+'). Return Markdown with sections: **Summary** (2-4 concise sentences), **Attendees**, **Key Decisions**, **Action Items** (each "owner - task - due date" when available), and **Open Questions**. Be faithful; do not invent. Known attendees: '+(attendees||'Not provided')+'.\n\nTRANSCRIPT:\n'+transcript.slice(0,40000);
  try{
    const token=await ensureMeetingBotSession({silent:true});
    if(!token) return '';
    const r=await fetch(meetingBotBaseUrl()+'/api/ai/meeting-summary',{method:'POST',headers:{'content-type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({prompt,max_tokens:1600})});
    if(!r.ok) return '';
    const j=await r.json();
    return j.text||'';
  }catch(_){ return ''; }
}
// Poll the meeting backend so the UI can mirror bot status even if the calendar snapshot lags.
async function checkMeetingSummaries(){
  const pending=DB.calendar().filter(e=>e.botEventId && ((e.botStatus||'')!=='completed' || !e.summary));
  if(!pending.length) return;
  let events=[];
  try{ const r=await fetch(meetingBotBaseUrl()+'/api/meeting-agent/events'); const d=await r.json(); events=d.events||[]; }catch(e){ return; }
  for(const e of pending){
    const be=events.find(x=>x.id===e.botEventId); if(!be) continue;
    const patch={};
    const nextStatus=be.status||be.bot_status||'';
    const summary=be.summary_text||be.summary||'';
    const recordingUrl=be.recording_url||'';
    const errorMessage=be.error_message||'';
    if(nextStatus && nextStatus!==e.botStatus) patch.botStatus=nextStatus;
    if(errorMessage!==undefined && errorMessage!==e.botError) patch.botError=errorMessage;
    if(recordingUrl && recordingUrl!==e.recordingUrl) patch.recordingUrl=recordingUrl;
    if(summary && summary!==e.summary){ patch.summary=summary; patch.summarizedBy='Meeting Bot'; }
    if(Object.keys(patch).length) await DB.updateCalEvent(e._id, patch);
  }
}
// Write a meeting summary into the inbox of every invited TJC staff member (+ Admin)
async function deliverMeetingSummary(calId, summary){
  const e=DB.calendar().find(x=>x._id===calId); if(!e || e.summary) return;
  const staff=DB.staff().map(s=>s.name);
  const recips=new Set((e.invited||'').split(',').map(s=>s.trim()).filter(Boolean).filter(n=>staff.some(sn=>sn.toLowerCase()===n.toLowerCase())));
  const msg='🎙 Meeting summary — "'+(e.title||'')+'" ('+fmtDate(e.date)+'):\n\n'+summary;
  for(const n of recips){ try{ await DB.addMessage({mentorName:n, from:'Meeting Bot', text:msg, read:false}); }catch(_){} }
  try{ await DB.addMessage({mentorName:'Admin', from:'Meeting Bot', text:msg, read:false}); }catch(_){}
  await DB.updateCalEvent(calId, {summary, summarizedBy:'Meeting Bot'});
}

// Meeting Summary Agent: summarize a transcript and message it to all invited TJC staff
async function summarizeMeeting(id){
  const e=DB.calendar().find(x=>x._id===id); if(!e) return;
  const status=document.getElementById('mtg-sum-status');
  const transcript=(document.getElementById('mtg-transcript').value||'').trim();
  if(!transcript){ status.style.color='#e53935'; status.textContent='Paste the meeting transcript or notes first.'; return; }
  status.style.color='#666'; status.textContent='Authorizing…';
  let token='';
  try{ token=await ensureMeetingBotSession(); }
  catch(err){ status.style.color='#e53935'; status.textContent='Could not authorize: '+err.message; return; }
  status.style.color='#666'; status.textContent='Summarizing…';
  const knownAttendees=[e.invited,e.external].filter(Boolean).join(', ')||'Not provided';
  const prompt='You are a meeting-notes assistant for ReGroup / TJC Oregon. Summarize the meeting transcript/notes below in Markdown with sections: **Summary** (2-4 concise sentences), **Attendees**, **Key Decisions**, **Action Items** (each as "owner - task - due date" when available), and **Open Questions**. Be faithful; do not invent. Meeting: "'+(e.title||'')+'" on '+fmtDate(e.date)+'. Known attendees: '+knownAttendees+'.\n\nTRANSCRIPT/NOTES:\n'+transcript;
  let text='';
  try{
    const resp=await fetch(meetingBotBaseUrl()+'/api/ai/meeting-summary',{method:'POST',headers:{'content-type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({prompt,max_tokens:1500})});
    if(!resp.ok){ let d=''; try{const j=await resp.json(); d=(j.error&&(j.error.message||j.error))||'';}catch(_){} throw new Error('AI error '+(d||resp.status)); }
    const j=await resp.json();
    text=j.text||'';
  }catch(err){ status.style.color='#e53935'; status.textContent='AI error — '+err.message; return; }
  if(!text){ status.style.color='#e53935'; status.textContent='No summary returned — try again.'; return; }
  await DB.updateCalEvent(id, {summary:text, summarizedBy:currentUserName(), summarizedAt:new Date().toISOString()});
  // Message the summary to every invited internal/TJC staff member + Admin
  const staffNames=DB.staff().map(s=>s.name);
  const invited=(e.invited||'').split(',').map(s=>s.trim()).filter(Boolean);
  const recipients=new Set(invited.filter(n=>staffNames.some(sn=>sn.toLowerCase()===n.toLowerCase())));
  const msg='🎙 Meeting summary — "'+(e.title||'')+'" ('+fmtDate(e.date)+'):\n\n'+text;
  let sent=0;
  for(const n of recipients){ try{ await DB.addMessage({mentorName:n, from:'Meeting Notes', text:msg, read:false}); sent++; }catch(_){} }
  try{ await DB.addMessage({mentorName:'Admin', from:'Meeting Notes', text:msg, read:false}); }catch(_){}
  status.style.color='#43a047'; status.textContent='✓ Summarized and messaged to '+sent+' attendee'+(sent!==1?'s':'')+' + Admin.';
  openCalDetail(id);
}

export { renderCalendar, calShiftMonth, calToday, openCalEvent, closeCalEvent, saveCalEvent,
  openCalDetail, closeCalDetail, editCalFromDetail, deleteCalEvent,
  summarizeMeeting, sendMeetingBot, retryMeetingBot, dispatchMeetingBot, autoDispatchBots,
  saveMeetingBotUrl, saveMeetingBotAuto, testMeetingBot, toggleMeetingRecording,
  connectGcal, saveGcalClientId, fetchGcal, checkMeetingSummaries, deliverMeetingSummary,
  openIcsSetup, syncIcsCalendar, saveProfileIcs, openSyncedDetail, closeSyncedDetail, sendBotForSynced,
  meetingBotBaseUrl, ensureMeetingBotSession, loadMeetingBotSession, clearMeetingBotSession,
  DEFAULT_MEETING_BACKEND };
