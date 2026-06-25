import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, printDoc
       } from '../utils.js';
function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read file')); r.readAsDataURL(f); }); }
function myStaffRecord(){ return DB.staff().find(s => s.name === currentUserName()); }
function profileEmails(raw){
  return String(raw||'').split(/[;,\s]+/).map(e=>e.trim()).filter(e=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}
function primaryProfileEmail(staff){
  const emails = profileEmails(staff && staff.email);
  return (emails.find(e=>/@tjcoregon\.org$/i.test(e)) || emails[0] || '').toLowerCase();
}
function currentProfileEmail(){ return primaryProfileEmail(myStaffRecord()); }

function renderProfile(){
  const host=document.getElementById('profile-body'); if(!host) return;
  const s=myStaffRecord();
  if(!s){
    host.innerHTML='<div class="card" style="text-align:center;color:#777;padding:40px;">'+
      (isAdmin()?'You are signed in as <b>Administrator</b>. Staff profiles are managed under <b>Staff &amp; Settings</b>.'
               :'No staff profile is linked to your account yet. Ask an admin to add you under Staff &amp; Settings.')+'</div>';
    return;
  }
  const photo = s.photo
    ? `<img src="${s.photo}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:2px solid #e2e8f0;">`
    : `<div style="width:96px;height:96px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.9em;font-weight:700;">${(firstNameOf(s.name)[0]||'?').toUpperCase()}</div>`;
  const docs = s.documents||[];
  host.innerHTML = `
    <div class="card" style="margin-bottom:18px;">
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
        <div style="text-align:center;">
          ${photo}
          <div style="margin-top:8px;"><label class="btn btn-outline" style="font-size:0.72em;cursor:pointer;">Change Photo<input type="file" accept="image/*" style="display:none;" onchange="uploadProfilePhoto(this)"></label></div>
        </div>
        <div>
          <div style="font-size:1.35em;font-weight:700;color:var(--primary);">${fEsc(s.name)}</div>
          <div style="color:#777;font-size:0.86em;">${fEsc(s.role||'Staff')}</div>
          <div style="color:#aaa;font-size:0.78em;margin-top:4px;">Login password: <b>${s.password ? '•••••• (custom)' : fEsc(firstNameOf(s.name))+'1234'}</b></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:18px;">
      <h3>Contact Information</h3>
      <div class="form-grid">
        <div class="form-group"><label>Phone Number</label><input type="text" id="pf-phone" value="${fEsc(s.phone||'')}"></div>
        <div class="form-group"><label>Preferred Contact Method</label><select id="pf-pref"><option value="">—</option>${['Phone','Email','Text','In Person'].map(o=>`<option ${s.preferredContact===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="form-group full"><label>Email Address(es)</label><input type="text" id="pf-email" value="${fEsc(s.email||'')}" placeholder="name@example.com, alt@example.com"></div>
        <div class="form-group full"><label>Address</label><input type="text" id="pf-address" value="${fEsc(s.address||'')}"></div>
      </div>
      <button class="btn btn-primary" onclick="saveProfile()">Save Profile</button>
      <span id="pf-status" style="font-size:0.82em;color:#43a047;margin-left:10px;"></span>
    </div>
    <div class="card" style="margin-bottom:18px;">
      <h3>Change Password</h3>
      <p style="font-size:0.8em;color:#888;margin-bottom:10px;">Set your own login password. Default is your first name + 1234 (e.g. ${fEsc(firstNameOf(s.name))}1234).</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin:0;"><label>New Password</label><input type="password" id="pf-newpw" placeholder="At least 4 characters"></div>
        <div class="form-group" style="margin:0;"><label>Confirm</label><input type="password" id="pf-newpw2" placeholder="Re-enter"></div>
        <button class="btn btn-primary" onclick="savePassword()">Update Password</button>
        ${s.password?'<button class="btn btn-outline" onclick="resetPassword()">Reset to default</button>':''}
      </div>
      <div id="pf-pw-status" style="font-size:0.82em;margin-top:8px;"></div>
    </div>
    <div class="card" style="margin-bottom:18px;">
      <h3>📅 My Calendar Sync</h3>
      <p style="font-size:0.8em;color:#888;margin-bottom:10px;">Paste your calendar's <b>secret iCal URL</b> to show your own events on the shared Calendar. Google Calendar → Settings → your calendar → "Secret address in iCal format". (Outlook/iCloud also provide one.)</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin:0;flex:1;min-width:240px;"><label>Your iCal URL</label><input type="text" id="pf-ics" value="${fEsc(s.icsUrl||'')}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></div>
        <button class="btn btn-primary" onclick="saveProfileIcs()">Save &amp; Sync</button>
      </div>
      <div id="pf-ics-status" style="font-size:0.82em;margin-top:8px;color:#888;"></div>
    </div>
    <div class="card">
      <h3>Documents</h3>
      <p style="font-size:0.8em;color:#888;margin-bottom:10px;">Store documents here (images or PDFs, up to ~700 KB each). You and admins can add; only admins can delete.</p>
      <div id="pf-docs">${docs.length?docs.map((d,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:0.86em;">
          <a href="${d.data}" download="${fEsc(d.name)}" style="color:#2f9bb5;text-decoration:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📎 ${fEsc(d.name)}</a>
          <span style="color:#bbb;font-size:0.8em;white-space:nowrap;">${d.addedBy?('by '+fEsc(d.addedBy)):''}</span>
          <button class="btn btn-danger" style="padding:3px 8px;font-size:0.72em;" onclick="deleteProfileDoc('${s._id}',${i})">🗑</button>
        </div>`).join(''):'<p style="color:#bbb;font-size:0.85em;">No documents yet.</p>'}</div>
      <label class="btn btn-accent" style="margin-top:12px;cursor:pointer;font-size:0.82em;">+ Add Document<input type="file" accept="image/*,.pdf" style="display:none;" onchange="uploadProfileDoc(this,'${s._id}')"></label>
      <span id="pf-doc-status" style="font-size:0.82em;color:#888;margin-left:10px;"></span>
    </div>`;
}
async function saveProfile(){
  const s=myStaffRecord(); if(!s) return;
  const oldEmail = primaryProfileEmail(s);
  const nextEmailRaw = document.getElementById('pf-email').value.trim();
  const nextEmail = primaryProfileEmail({email:nextEmailRaw});
  await DB.updateRecord('staff', s._id, {
    phone:document.getElementById('pf-phone').value.trim(),
    preferredContact:document.getElementById('pf-pref').value,
    email:nextEmailRaw,
    address:document.getElementById('pf-address').value.trim(),
  });
  if (oldEmail !== nextEmail) {
    if (oldEmail) localStorage.removeItem(gcalConnectedKey(oldEmail));
    _gcalToken = null;
    _gcalTokenEmail = '';
    if (oldEmail) delete _gcalEvents[oldEmail];
    if (document.getElementById('view-calendar')?.classList.contains('active')) renderCalendar();
  }
  const st=document.getElementById('pf-status'); if(st){
    st.textContent=nextEmail ? 'Saved ✓ Calendar sync will use '+nextEmail+'.' : 'Saved ✓ Add a profile email to enable Google Calendar sync.';
    setTimeout(()=>{if(st)st.textContent='';},4000);
  }
}
async function savePassword(){
  const s=myStaffRecord(); if(!s) return;
  const st=document.getElementById('pf-pw-status');
  const pw=document.getElementById('pf-newpw').value;
  const pw2=document.getElementById('pf-newpw2').value;
  const show=(msg,ok)=>{ if(st){ st.style.color=ok?'#43a047':'#e53935'; st.textContent=msg; } };
  if(!pw || pw.length<4){ show('Password must be at least 4 characters.',false); return; }
  if(pw!==pw2){ show('Passwords do not match.',false); return; }
  await DB.updateRecord('staff', s._id, {password:pw});
  show('Password updated ✓ Use it next time you log in.',true);
  document.getElementById('pf-newpw').value=''; document.getElementById('pf-newpw2').value='';
}
function resetPassword(){
  const s=myStaffRecord(); if(!s) return;
  if(!confirm('Reset your password back to the default ('+firstNameOf(s.name)+'1234)?')) return;
  DB.updateRecord('staff', s._id, {password:''}).then(()=>renderProfile());
}
async function uploadProfilePhoto(input){
  const s=myStaffRecord(); const f=input.files&&input.files[0]; if(!s||!f) return;
  try{ const url=await compressImage(f,400,0.7); await DB.updateRecord('staff', s._id, {photo:url}); renderProfile(); }
  catch(e){ alert(e.message); }
}
async function uploadProfileDoc(input, staffId){
  const f=input.files&&input.files[0]; if(!f) return;
  const st=document.getElementById('pf-doc-status'); if(st){ st.style.color='#888'; st.textContent='Uploading…'; }
  try{
    let data;
    if(f.type.startsWith('image/')) data=await compressImage(f,1400,0.65);
    else { if(f.size>720*1024) throw new Error('File too large (max ~700 KB). Please upload a smaller file.'); data=await fileToDataURL(f); }
    const s=DB.staff().find(x=>x._id===staffId); if(!s) return;
    const documents=[...(s.documents||[]), {name:f.name, data, addedBy:currentUserName(), addedAt:new Date().toISOString()}];
    await DB.updateRecord('staff', staffId, {documents});
    renderProfile();
  }catch(e){ if(st){st.style.color='#e53935';st.textContent=e.message;} else alert(e.message); }
}
function deleteProfileDoc(staffId, idx){
  requireAdmin(async ()=>{
    if(!confirm('Delete this document? This cannot be undone.')) return;
    const s=DB.staff().find(x=>x._id===staffId); if(!s) return;
    const documents=(s.documents||[]).filter((_,i)=>i!==idx);
    await DB.updateRecord('staff', staffId, {documents});
    renderProfile();
  });
}

export { renderProfile, saveProfile, savePassword, resetPassword,
  uploadProfilePhoto, uploadProfileDoc, deleteProfileDoc, saveProfileIcs };
