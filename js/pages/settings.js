import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
import { DEFAULT_MEETING_BACKEND } from './calendar.js';
import { orientationPct } from './orientation.js';

function renderSettings() {
  refreshStaffDatalist();
  const mbInput = document.getElementById('meetingbot-url-input');
  if (mbInput) mbInput.value = localStorage.getItem('rg_meetingbot_url') || DEFAULT_MEETING_BACKEND;
  const gcInput = document.getElementById('gcal-clientid-input');
  if (gcInput) gcInput.value = localStorage.getItem('rg_gcal_client_id') || '';
  const mbAuto = document.getElementById('meetingbot-auto');
  if (mbAuto) mbAuto.checked = localStorage.getItem('rg_meetingbot_auto')==='1';
  const staff = DB.staff();
  document.getElementById('staff-list').innerHTML = staff.length ? staff.map(s=>`
    <div class="staff-card">
      <div class="staff-avatar">${s.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}</div>
      <div class="staff-info">
        <div class="name">${s.name}</div>
        <div class="meta">${s.role} · $${s.rate}/hr · ${s.regularHrs}h/pay period · ${s.defaultGrant}</div>
        ${s.startDate?`<div class="meta">Start: ${fmtDate(s.startDate)}</div>`:''}
        <div class="meta" style="margin-top:2px;">Orientation: ${s.orientationType ? orientationPct(s)+'% ('+s.orientationType+' track)' : 'not started'}${(s.orientationType||(s.completedSections&&s.completedSections.length)) ? ' <button class="btn btn-outline" onclick="resetOrientationProgress(\''+s._id+'\')" style="padding:2px 7px;font-size:0.7em;margin-left:6px;">Reset</button>' : ''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-outline" onclick="openStaffModal('${s._id}')" style="padding:6px 12px;font-size:0.78em;">Edit</button>
        <button class="btn btn-danger" onclick="removeStaff('${s._id}')" style="padding:6px 12px;font-size:0.78em;">Remove</button>
      </div>
    </div>
  `).join('') : '<p style="color:#bbb;font-size:0.875em;margin-bottom:12px;">No staff members yet. Add your first team member below.</p>';
}

function showAddStaff() {
  document.getElementById('add-staff-form').style.display='block';
}

async function addStaff() {
  const name = document.getElementById('staff-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  await DB.saveStaffMember({
    name,
    role: document.getElementById('staff-role').value,
    startDate: document.getElementById('staff-start-date').value,
    rate: parseFloat(document.getElementById('staff-rate').value)||20,
    regularHrs: parseFloat(document.getElementById('staff-reg-hrs').value)||16,
    defaultGrant: document.getElementById('staff-grant').value
  });
  document.getElementById('add-staff-form').style.display='none';
  document.getElementById('staff-name').value='';
}

async function removeStaff(id) {
  if (!confirm('Remove this staff member?')) return;
  await DB.removeStaffMember(id);
}

// Edit a staff member / mentor profile (used from Settings and the admin Mentors panel)
function openStaffModal(id){
  requireAdmin(()=>{
    const s = DB.staff().find(x=>x._id===id);
    if (!s) { alert('Staff member not found.'); return; }
    document.getElementById('staff-modal-title').textContent = 'Edit ' + (s.name||'Staff Member');
    document.getElementById('sm-id').value = s._id;
    document.getElementById('sm-name').value = s.name||'';
    document.getElementById('sm-role').value = s.role||'REP';
    document.getElementById('sm-start-date').value = s.startDate||'';
    document.getElementById('sm-rate').value = (s.rate!=null?s.rate:20);
    document.getElementById('sm-reg-hrs').value = (s.regularHrs!=null?s.regularHrs:16);
    document.getElementById('sm-grant').value = s.defaultGrant||'CVI';
    document.getElementById('sm-delete-btn').style.display = 'inline-flex';
    document.getElementById('staff-modal').style.display = 'flex';
  });
}
function closeStaffModal(){ document.getElementById('staff-modal').style.display='none'; }
async function saveStaffModal(){
  const id = document.getElementById('sm-id').value;
  const name = document.getElementById('sm-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const data = {
    name,
    role: document.getElementById('sm-role').value,
    startDate: document.getElementById('sm-start-date').value,
    rate: parseFloat(document.getElementById('sm-rate').value)||0,
    regularHrs: parseFloat(document.getElementById('sm-reg-hrs').value)||0,
    defaultGrant: document.getElementById('sm-grant').value
  };
  if (id) data._id = id;
  await DB.saveStaffMember(data);
  closeStaffModal();
}
function deleteStaffFromModal(){
  const id = document.getElementById('sm-id').value;
  if (!id) return;
  requireAdmin(async ()=>{
    if (!confirm('Remove this staff member? This cannot be undone.')) return;
    await DB.removeStaffMember(id);
    closeStaffModal();
  });
}

export { renderSettings, showAddStaff, addStaff, removeStaff,
  openStaffModal, closeStaffModal, saveStaffModal, deleteStaffFromModal };
