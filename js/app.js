// ================================================================
// app.js â€" entry point: Firestore listeners, navigation, auth,
// form framework, and wiring all page modules to window.
// ================================================================
import { db, DB,
  setSessions, setActivities, setStaff, setNeedsAssessments, setExpenseReports,
  setClients, setTasks, setProjects, setEvents, setMeetings, setFundContacts,
  setDashboardConfig, setSecurityConfig, setMessages, setCalendar, setRjCases, setServicePlans,
  setCurrentUser as _storeCurrentUser, setAdminUnlocked as _storeAdminUnlocked,
  _currentUser, _adminUnlocked, _securityConfig,
  collection, onSnapshot, query, orderBy, serverTimestamp, doc, setDoc, addDoc, deleteDoc
} from './state.js';
import { uuid, calcHours, currentUserName, isAdmin, firstNameOf, fmtDate, fEsc,
         getDate, profileEmails, primaryProfileEmail
       } from './utils.js';
import { renderDashboard, renderDashboardStaff, dashWeekStats, getDashboardMetrics, renderMyMetrics,
  openDashboardConfig, closeDashboardConfig, saveDashboardConfig,
  openMyMetricsConfig, closeMyMetricsConfig, saveMyMetricsConfig } from './pages/dashboard.js';
import { renderClientDirectory, openClientModal, closeClientModal, saveClient, deleteClient,
  seedClientsIfEmpty, populateClientNameList, fillClientId, populateHomeMeetingList, clientFullName } from './pages/clients.js';
import { renderFundraising, openContactModal, closeContactModal, saveFundContact,
  openContactDetail, closeContactDetail, renderContactDetail, addInteraction, deleteInteraction,
  addGift, deleteGift, editContactDetails, deleteFundContact,
  updateFundCheckedCount, checkAllFund, clearFundChecks, emailCheckedFund,
  _fundDetailId } from './pages/fundraising.js';
import { getEBRecipients, renderEBCustomList, ebCustCheckAll, updateEBCount,
  updateEBPreview, copyEBAddresses, openEBGmail, openEBMailto } from './pages/email-blast.js';
import { renderFormReports, deleteReport, renderNAList, printNA,
  renderERList, printER, addERRow, updateERTotal, compressImage, readImagesCompressed, printTimesheet } from './pages/forms.js';
import { renderProfile, saveProfile, savePassword, resetPassword,
  uploadProfilePhoto, uploadProfileDoc, deleteProfileDoc } from './pages/profile.js';
import { renderDataView, switchTab, renderTimesheetTable, renderSummaryTable,
  renderSafetyTable, renderAllData, exportTableCSV, exportData, importDataJSON, importCSV, clearAllData,
  filterPayPeriod } from './pages/reports.js';
import { generateTimesheet, tsUpdateFromStaff, populateTsMentors, populateTsCycles } from './pages/timesheets.js';
import { computeClientAlerts, refreshAlerts, renderAdminInbox, renderAdminTasks,
  openAssignModal, closeAssignModal, saveAssignedTask, adminRemoveTask,
  renderMyTasks, updateMyTaskStatus,
  renderMentorPanel, openMentorMessages, closeMentorMessages, sendMentorMessage, deleteMessage,
  openMentorTasks, closeMentorTasks, sendMyMessage, renderAdminMessages, replyThread,
  renderMessageThread, _msgMentor } from './pages/tasks.js';
import { renderProjects, openProjectModal, closeProjectModal, saveProject, deleteProject,
  openProjectDetail, closeProjectDetail, postProjectUpdate,
  openTaskModal, closeTaskModal, saveTaskModal,
  toggleProjectsView, toggleGanttView, setProjectsView, renderKanban, renderGantt,
  kbDragStart, kbDrop,
  openPMIWizard, closePMIWizard, pmiCompletePhase, pmiNextPhase, pmiBack, pmiFinish, pmiAssignTask,
  openAIPlanner, closeAIPlanner, handlePlannerFile, generatePlanAI, createPlannerTasks,
  addPlannerStep, removePlannerStep } from './pages/projects.js';
import { generateSocialPost, generateAllPostsAI, renderEvents, switchEvTab, copyEvText, copyText } from './pages/events.js';
import { renderMeetingsList } from './pages/meetings.js';
import { renderSettings, showAddStaff, addStaff, removeStaff,
  openStaffModal, closeStaffModal, saveStaffModal, deleteStaffFromModal } from './pages/settings.js';
import { renderCalendar, calShiftMonth, calToday, openCalEvent, closeCalEvent, saveCalEvent,
  openCalDetail, closeCalDetail, editCalFromDetail, deleteCalEvent,
  summarizeMeeting, sendMeetingBot, retryMeetingBot, dispatchMeetingBot, autoDispatchBots,
  saveMeetingBotUrl, saveMeetingBotAuto, testMeetingBot, toggleMeetingRecording,
  connectGcal, saveGcalClientId, fetchGcal, checkMeetingSummaries, deliverMeetingSummary,
  openIcsSetup, syncIcsCalendar, saveProfileIcs, openSyncedDetail, closeSyncedDetail, sendBotForSynced,
  meetingBotBaseUrl, loadMeetingBotSession, clearMeetingBotSession,
  _calDetailId } from './pages/calendar.js';
import { renderServicePlans, openServicePlan, closeServicePlan, saveServicePlan, deleteServicePlan,
  spAddGoal, spFillClientId } from './pages/service-plans.js';
import { runGrantsAgent } from './pages/grants.js';
import { renderRJ, openRJCase, closeRJCase, rjSaveAndNext, rjBack, rjGoStep,
  rjAddCheckin, deleteRJCase } from './pages/rj.js';
import { setOrientationType, openOrientationModule, closeOrientationModule, markSectionComplete,
  isOrientationComplete, resetOrientationProgress, submitModuleQuiz, retryModuleQuiz,
  openHandbookReader, closeHandbookReader, hbPrev, hbNext,
  hbSubmitQuiz, hbRetryQuiz, hbContinueAfterQuiz, hbCloseQuizDone,
  hbCompleteOrientation } from './pages/orientation.js';
import { sendHandbookQuestion } from './pages/handbook-chat.js';

// â"€â"€â"€ Local app-level state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
let _navHistory = [];
let _postLoginView = null;
let _listenersReady = 0;
let _orientationLocked = false;

// â"€â"€â"€ _onReady â€" fires once per listener; renders dashboard when all 16 land â"€
function _onReady() {
  _listenersReady++;
  if (_listenersReady === 16) {
    renderDashboard();
    refreshStaffDatalist();
    seedClientsIfEmpty();
  }
}

function _applyNavLock(locked) {
  window._orientationLocked = locked;
  document.querySelectorAll('#sidebar nav a[data-view]').forEach(a => {
    a.style.display = (locked && a.getAttribute('data-view') !== 'profile') ? 'none' : '';
  });
  document.querySelectorAll('#sidebar .nav-section').forEach(el => {
    el.style.display = locked ? 'none' : '';
  });
}

function _checkOrientationLock() {
  if (!_currentUser || _currentUser.isAdmin) {
    if (_orientationLocked) { _orientationLocked = false; _applyNavLock(false); }
    return;
  }
  const s = DB.staff().find(st => st.name === _currentUser.name);
  if (!s) return;
  const complete = isOrientationComplete(s);
  const wasLocked = _orientationLocked;
  _orientationLocked = !complete;
  _applyNavLock(_orientationLocked);
  if (wasLocked !== _orientationLocked) {
    if (_orientationLocked) {
      _navHistory = [];
      navigate('profile');
    } else {
      const ov = document.getElementById('orientation-module-overlay');
      if (ov) ov.remove();
      const hbOv = document.getElementById('hb-reader-overlay');
      if (hbOv) hbOv.remove();
      navigate('dashboard');
    }
  }
}


// â"€â"€â"€ Firestore real-time listeners â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
onSnapshot(query(collection(db,'sessions'),   orderBy('dateOfService','asc')),   snap => {
  setSessions(snap.docs.map(d => ({...d.data(), _id:d.id, _type:'client'})));
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active'))   renderDashboard();
  if (document.getElementById('view-data-view')?.classList.contains('active'))  renderDataView();
});
onSnapshot(query(collection(db,'activities'), orderBy('dateOfActivity','asc')),  snap => {
  setActivities(snap.docs.map(d => ({...d.data(), _id:d.id, _type:'activity'})));
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active'))   renderDashboard();
  if (document.getElementById('view-data-view')?.classList.contains('active'))  renderDataView();
});
onSnapshot(collection(db,'staff'), snap => {
  setStaff(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  _checkOrientationLock();
  refreshStaffDatalist();
  if (document.getElementById('view-settings')?.classList.contains('active')) renderSettings();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
  if (document.getElementById('view-profile')?.classList.contains('active')) renderProfile();
});
onSnapshot(query(collection(db,'needsAssessments'), orderBy('_createdAt','asc')), snap => {
  setNeedsAssessments(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-needs-assessment')?.classList.contains('active')) renderNAList();
  if (document.getElementById('view-form-reports')?.classList.contains('active')) renderFormReports();
});
onSnapshot(query(collection(db,'expenseReports'), orderBy('_createdAt','asc')), snap => {
  setExpenseReports(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-expense-report')?.classList.contains('active')) renderERList();
  if (document.getElementById('view-form-reports')?.classList.contains('active')) renderFormReports();
});



onSnapshot(collection(db,'calendar'), snap => {
  setCalendar(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-calendar')?.classList.contains('active')) renderCalendar();
  if (_calDetailId && document.getElementById('cal-detail')?.style.display === 'flex') openCalDetail(_calDetailId);
});
onSnapshot(collection(db,'rjCases'), snap => {
  setRjCases(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-rj')?.classList.contains('active')) renderRJ();
});
onSnapshot(collection(db,'servicePlans'), snap => {
  setServicePlans(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-service-plans')?.classList.contains('active')) renderServicePlans();
});
onSnapshot(query(collection(db,'clients'), orderBy('clientId','asc')), snap => {
  setClients(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-clients')?.classList.contains('active')) renderClientDirectory();
  populateClientNameList();
});
onSnapshot(query(collection(db,'tasks'),    orderBy('_createdAt','asc')), snap => {
  setTasks(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-admin-inbox')?.classList.contains('active')) renderAdminTasks();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
});
onSnapshot(query(collection(db,'projects'), orderBy('_createdAt','asc')), snap => {
  setProjects(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-projects')?.classList.contains('active')) renderProjects();
});
onSnapshot(query(collection(db,'events'),   orderBy('_createdAt','asc')), snap => {
  setEvents(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-events')?.classList.contains('active')) renderEvents();
});
onSnapshot(query(collection(db,'meetings'), orderBy('_createdAt','asc')), snap => {
  setMeetings(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-meetings')?.classList.contains('active')) renderMeetingsList();
});
onSnapshot(query(collection(db,'fundContacts'), orderBy('_createdAt','asc')), snap => {
  setFundContacts(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('view-fundraising')?.classList.contains('active')) renderFundraising();
  if (_fundDetailId && document.getElementById('fund-detail')?.style.display === 'flex') renderContactDetail(_fundDetailId);
});
onSnapshot(collection(db,'config'), snap => {
  const d = snap.docs.find(x => x.id === 'dashboard');
  const security = snap.docs.find(x => x.id === 'admin');
  setDashboardConfig(d ? d.data() : null);
  setSecurityConfig(security ? security.data() : {});
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
});
onSnapshot(query(collection(db,'messages'), orderBy('_createdAt','asc')), snap => {
  setMessages(snap.docs.map(d => ({...d.data(), _id:d.id})));
  _onReady();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('ai-tab-amsgs')?.classList.contains('active')) renderAdminMessages();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
  updateMentorInboxNav();
  if (_msgMentor && document.getElementById('msg-modal')?.style.display === 'flex') renderMessageThread();
});

// â"€â"€â"€ VIEW_TITLES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const VIEW_TITLES = {
  'dashboard':'Home',
  'progress-note':'Progress Notes',
  'activity-log':'Activity Log',
  'data-view':'Data View',
  'timesheets':'Timesheets',
  'form-reports':'Reports',
  'profile':'Profile',
  'calendar':'Meeting Bot',
  'rj':'Restorative Justice',
  'grants':'Grants',
  'settings':'Settings',
  'needs-assessment':'Needs',
  'expense-report':'Expenses',
  'clients':'Directory',
  'service-plans':'Service Plans',
  'email-blast':'Email Blast',
  'my-tasks':'Messaging',
  'projects':'Projects',
  'events':'Socials',
  'meetings':'Meetings',
  'fundraising':'Funders',
};

// ===================================================================

// â"€â"€â"€ navigate â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function navigate(v, isBack) {
  if (_orientationLocked && !isAdmin() && v !== 'profile') { navigate('profile'); return; }
  if (v === 'settings' && !isAdmin()) {
    showAdminPasswordPage();
    return;
  }
  // Track history so the Back button can return to the previous page
  const curEl = document.querySelector('.view.active');
  const cur = curEl ? curEl.id.replace('view-','') : null;
  if (!isBack && cur && cur !== v) _navHistory.push(cur);
  updateBackBtn();
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('#sidebar nav a').forEach(el=>el.classList.remove('active'));
  const ve = document.getElementById('view-'+v);
  if (ve) ve.classList.add('active');
  const ae = document.querySelector(`[data-view="${v}"]`);
  if (ae) ae.classList.add('active');
  document.getElementById('topbar-title').textContent = VIEW_TITLES[v]||v;
  if (v==='dashboard') renderDashboard();
  if (v==='data-view') renderDataView();
  if (v==='timesheets') { populateTsMentors(); populateTsCycles(); }
  if (v==='settings') { renderSettings(); refreshAlerts(); }
  if (v==='clients') renderClientDirectory();
  if (v==='email-blast') updateEBPreview();
  if (v==='my-tasks') renderMyTasks();
  if (v==='projects') renderProjects();
  if (v==='events') renderEvents();
  if (v==='meetings') renderMeetingsList();
  if (v==='fundraising') renderFundraising();
  if (v==='form-reports') renderFormReports();
  if (v==='profile') renderProfile();
  if (v==='calendar') renderCalendar();
  if (v==='rj') renderRJ();
  if (v==='service-plans') renderServicePlans();
  if (v==='progress-note' || v==='activity-log') populateClientNameList();
  closeNav();
}

// Back button â€" return to the previously viewed page
function goBack(){
  const prev = _navHistory.pop();
  updateBackBtn();
  navigate(prev || 'dashboard', true);
}
function updateBackBtn(){
  const b = document.getElementById('back-btn');
  if (b) b.style.visibility = _navHistory.length ? 'visible' : 'hidden';
}

// Mobile off-canvas navigation drawer
function toggleNav(){ document.body.classList.toggle('nav-open'); }
function closeNav(){ document.body.classList.remove('nav-open'); }

// Run cb immediately if admin already unlocked this session, otherwise prompt
// for the admin PIN first. Used to gate editing/deleting existing information.
function requireAdmin(cb) {
  if (isAdmin()) cb();
  else alert('Only an administrator can do this. Log in as an admin to continue.');
}

// â"€â"€â"€ AUTH â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const DEFAULT_ADMIN_PIN = '12345678';

function getAdminPIN() {
  const sharedPin = String((_securityConfig && _securityConfig.adminPIN) || '').trim();
  return sharedPin || DEFAULT_ADMIN_PIN;
}

function promptAdminPIN(onSuccess) {
  const overlay = document.getElementById('pin-overlay');
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-error').textContent = '';
  overlay.style.display = 'flex';
  document.getElementById('pin-input').focus();
  window._pinCallback = onSuccess;
}

async function submitPIN() {
  const entered = document.getElementById('pin-input').value;
  const errEl = document.getElementById('pin-error');
  errEl.textContent = '';
  let valid = false;
  try {
    const r = await fetch(meetingBotBaseUrl() + '/api/session/verify-admin-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: entered })
    });
    if (r.status === 429) { errEl.textContent = '⚠️ Too many attempts. Please wait and try again.'; return; }
    const d = await r.json();
    valid = !!d.valid;
  } catch (_) {
    errEl.textContent = '⚠️ Could not reach server. Check your connection.';
    return;
  }
  if (valid) {
    _adminUnlocked = true;
    document.getElementById('pin-overlay').style.display = 'none';
    if (window._pinCallback) window._pinCallback();
    window._pinCallback = null;
  } else {
    errEl.textContent = '❌ Incorrect PIN. Try again.';
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
}
function cancelPIN() {
  document.getElementById('pin-overlay').style.display = 'none';
  window._pinCallback = null;
}

// ===================================================================
// APP LOGIN / CURRENT USER (per-staff profiles)

// â"€â"€â"€ APP LOGIN / CURRENT USER â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function isOwnerOrAdmin(ownerName){ return isAdmin() || (!!ownerName && ownerName === currentUserName()); }

function setCurrentUser(u){
  const priorSession = loadMeetingBotSession();
  _storeCurrentUser(u);
  _storeAdminUnlocked(!!u.isAdmin);
  if (priorSession && priorSession.userName && priorSession.userName !== u.name) clearMeetingBotSession();
  try { localStorage.setItem('rg_current_user', JSON.stringify(u)); } catch(e){}
  document.getElementById('app-login').style.display = 'none';
  updateUserChrome();
  const target = (u.isAdmin && _postLoginView) ? _postLoginView : 'dashboard';
  _postLoginView = null;
  if (!u.isAdmin) {
    _checkOrientationLock();
    if (!_orientationLocked) navigate(target);
  } else {
    navigate(target);
  }
}
function logout(){
  _orientationLocked = false; _applyNavLock(false);
  _storeCurrentUser(null); _storeAdminUnlocked(false);
  clearMeetingBotSession();
  try { localStorage.removeItem('rg_current_user'); } catch(e){}
  const inp = document.getElementById('app-password-input'); if (inp) inp.value='';
  const err = document.getElementById('app-login-error'); if (err && !_postLoginView) err.textContent='';
  document.getElementById('app-login').style.display = 'flex';
}
function updateUserChrome(){
  const el = document.getElementById('current-user-label');
  if (el) el.textContent = _currentUser ? ((_currentUser.isAdmin ? '🔑 ' : '👤 ')+_currentUser.name) : '';
  updateMentorInboxNav();
}
// Turn the Mentor Inbox nav green + show a dot when the current user has unread messages
function updateMentorInboxNav(){
  const link = document.getElementById('nav-mentor-inbox');
  const dot = document.getElementById('nav-inbox-dot');
  if (!link) return;
  const me = currentUserName();
  const unread = me ? DB.messages().filter(m=>m.mentorName===me && !m.read).length : 0;
  if (dot) dot.style.display = unread ? 'inline-block' : 'none';
  link.style.color = unread ? '#22c55e' : '';
  link.style.fontWeight = unread ? '700' : '';
}
function restoreSession(){
  try {
    const u = JSON.parse(localStorage.getItem('rg_current_user')||'null');
    if (u && u.name){ _storeCurrentUser(u); _storeAdminUnlocked(!!u.isAdmin); document.getElementById('app-login').style.display='none'; updateUserChrome(); }
  } catch(e){}
}

async function submitAppLogin() {
  const entered = (document.getElementById('app-password-input').value||'').trim();
  const err = document.getElementById('app-login-error');
  if (!entered) return;
  // Admin login: verify via backend
  try {
    const r = await fetch(meetingBotBaseUrl() + '/api/session/verify-admin-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: entered })
    });
    if (r.status === 429) {
      if (err) { err.style.color = '#ef5350'; err.textContent = '⚠️ Too many attempts. Please wait before trying again.'; }
      return;
    }
    if (r.ok) {
      const d = await r.json();
      if (d.valid) {
        setCurrentUser({name:'Administrator', firstName:'Admin', isAdmin:true});
        document.getElementById('app-password-input').value='';
        return;
      }
    }
  } catch (_) { /* backend unreachable — fall through to staff check */ }
  // Staff login: custom password if set, otherwise FirstName + 1234 (e.g. Cameron1234)
  const staff = DB.staff().find(s => s.password
    ? entered === s.password
    : (firstNameOf(s.name).toLowerCase()+'1234') === entered.toLowerCase());
  if (staff){
    setCurrentUser({name:staff.name, firstName:firstNameOf(staff.name), isAdmin:!!staff.isAdmin});
    document.getElementById('app-password-input').value=''; return;
  }
  if (err) err.style.color = '#ef5350';
  if (!DB.staff().length){ err.textContent='⏳ Still loading staff — wait a moment and try again.'; return; }
  err.textContent='❌ Incorrect. Your password is your first name + 1234 (e.g. Cameron1234).';
  document.getElementById('app-password-input').value='';
  document.getElementById('app-password-input').focus();
}
function changeAdminPIN() {
  alert('Admin PIN changes are managed via the Render environment variable (ADMIN_PIN). Contact the system administrator to update it.');
}
function showAdminPasswordPage() {
  _postLoginView = 'settings';
  logout();
  const err = document.getElementById('app-login-error');
  if (err) {
    err.style.color = '#1a237e';
    err.textContent = 'Enter the admin PIN/password to open Settings.';
  }
  const inp = document.getElementById('app-password-input');
  if (inp) inp.focus();
  closeNav();
}


// â"€â"€â"€ FORM INIT â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// ===================================================================
const SUPPORT_TYPES = ['Violence Prevention Mentoring','Conflict Mediation','Crisis Intervention',
  'Safety Planning','Hospital/Post-Injury Intervention','Retaliation Prevention',
  'Street Outreach Engagement','Relationship Building','Life Stabilization','Housing Navigation',
  'Employment Support','Education/Training Support','Behavioral Health Support',
  'Substance Use Recovery Support','Systems Navigation','Transportation Assistance',
  'Emotional Support','Skill Building','Leadership Development','Restorative Justice Services','Other'];

const REFERRALS = ['Housing','Employment','Treatment','Education','Legal','Peer Support','None','Other'];

const SERVICE_CATS = ['Stabilization','Housing Support','Employment Support','Behavioral Health',
  'Recovery Support','Community Connection','Violence Prevention','Restorative Justice',
  'Crisis Response','Leadership Development','Other'];

const ATTEMPT_METHODS = ['Phone','Text','Email','In-Person Attempt','Third-Party Outreach','Other'];

const WHO_INVOLVED = ['Community Member(s)','High-Risk Individual(s)','Program Participant(s)',
  'Victim/Survivor','Partner Organization','Law Enforcement','Hospital Staff','Court Personnel',
  'School Staff','Outreach Team','Internal ReGroup Staff','Other'];

const SERVICE_AREAS = ['Violence Prevention','Restorative Justice','Community Outreach',
  'Partnership Development','Behavioral Health Support','Housing / Stabilization',
  'Employment Pathways','Youth Engagement','Crisis Response','Organizational Capacity','Training','Other'];

const OUTCOMES = ['Service Successfully Delivered','Mentor Attempted Contact â€" Client Unreachable',
  'Client Cancelled','Client No-Show','Rescheduled','Other'];

const SAFETY_PN = ['No concerns','Yes â€" Immediate Risk','Yes â€" Emerging Concern'];

const GRANTS = ['BeBlac','Collins Foundation','CJC','CVI','General Fund','RISE','WHC','Vital Project Funds'];

function buildCheckboxes(id, items, name) {
  document.getElementById(id).innerHTML = items.map(it=>
    `<label><input type="checkbox" name="${name}" value="${it}"> ${it}</label>`
  ).join('');
}

function buildRadios(id, items, name) {
  document.getElementById(id).innerHTML = items.map(it=>
    `<label><input type="radio" name="${name}" value="${it}"> ${it}</label>`
  ).join('');
}

const ASSISTANCE_TYPES = [
  'Clothing','Rent/Deposit Assistance','Transportation','Training/Certification Fees',
  'Substance Use Support','Other','Shoes/Work Boots','Utility Bill Payment',
  'Automotive Assistance','Medical Care','Childcare','Food/Groceries',
  'Phone/Internet Access','Employment Clothing/Tools','Mental Health Support','Legal Fees/Expungement'
];


function initForms() {
  buildCheckboxes('support-types-check', SUPPORT_TYPES, 'supportTypes');
  buildCheckboxes('referrals-check', REFERRALS, 'referralsMade');
  buildCheckboxes('service-categories-check', SERVICE_CATS, 'serviceCategories');
  buildCheckboxes('attempt-methods-check', ATTEMPT_METHODS, 'attemptMethods');
  buildCheckboxes('who-involved-check', WHO_INVOLVED, 'whoInvolved');
  buildCheckboxes('service-areas-check', SERVICE_AREAS, 'serviceAreas');
  buildRadios('outcome-radio', OUTCOMES, 'serviceOutcome');
  buildRadios('safety-radio-pn', SAFETY_PN, 'safetyConcerns');
  buildRadios('na-assistance-check', ASSISTANCE_TYPES, 'assistanceType');

  // Show/hide fields based on service outcome
  document.getElementById('outcome-radio').addEventListener('change', e => {
    const v = e.target.value;
    const success = v === 'Service Successfully Delivered';
    document.getElementById('successful-fields').style.display = success ? 'block' : 'none';
    document.getElementById('unsuccessful-fields').style.display = (!success && v) ? 'block' : 'none';
  });

  // Live hours preview - Progress Note
  ['[name="startTime"]','[name="endTime"]'].forEach(sel => {
    document.querySelector('#progress-note-form ' + sel)?.addEventListener('change', () => {
      const s = document.querySelector('#progress-note-form [name="startTime"]').value;
      const e = document.querySelector('#progress-note-form [name="endTime"]').value;
      const h = calcHours(s, e);
      document.getElementById('pn-hours-preview').value = h > 0 ? h.toFixed(2) + ' hrs' : '';
    });
  });

  // Live hours preview - Activity Log
  document.querySelector('#activity-log-form [name="startTime"]')?.addEventListener('change', updateALHours);
  document.querySelector('#activity-log-form [name="endTime"]')?.addEventListener('change', updateALHours);

  // Expense Report â€" seed first row and wire total update
  addERRow();
  document.querySelector('#er-form [name="cashAdvance"]')?.addEventListener('input', updateERTotal);
}

function updateALHours() {
  const s = document.querySelector('#activity-log-form [name="startTime"]').value;
  const e = document.querySelector('#activity-log-form [name="endTime"]').value;
  const h = calcHours(s, e);
  document.getElementById('al-hours-preview').value = h > 0 ? h.toFixed(2) + ' hrs' : '';
}

function refreshStaffDatalist() {
  const names = DB.staff().map(s=>s.name);
  ['staff-datalist','staff-datalist-al'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = names.map(n=>`<option value="${n}">`).join('');
  });
  // Keep My Tasks dropdown in sync whenever staff list changes
  const mtSel = document.getElementById('my-tasks-mentor');
  if (mtSel) {
    const current = mtSel.value;
    mtSel.innerHTML = '<option value="">â€" Select your name â€"</option>' +
      names.map(n=>'<option value="' + n + '"' + (n===current?' selected':'') + '>' + n + '</option>').join('');
  }
}


// â"€â"€â"€ FORM SUBMIT (progress-note + activity-log) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// ===================================================================
document.getElementById('progress-note-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Savingâ€¦'; btn.disabled = true;
  const fd = new FormData(this);
  const data = {id:uuid(), type:'client', submittedAt:new Date().toISOString()};
  for (const [k,v] of fd.entries()) { data[k] = v; }
  data.supportTypes = fd.getAll('supportTypes');
  data.referralsMade = fd.getAll('referralsMade');
  data.serviceCategories = fd.getAll('serviceCategories');
  data.attemptMethods = fd.getAll('attemptMethods');
  const _sid = await saveForm('progress-note', data);
  btn.textContent = 'Submit Progress Note'; btn.disabled = false;
  this.reset();
  document.getElementById('successful-fields').style.display='block';
  document.getElementById('unsuccessful-fields').style.display='none';
  document.getElementById('pn-hours-preview').value='';
  window.scrollTo(0,0);
  showFormSuccess('progress-note', _sid, data);
});

document.getElementById('activity-log-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Savingâ€¦'; btn.disabled = true;
  const fd = new FormData(this);
  const data = {id:uuid(), type:'activity', submittedAt:new Date().toISOString()};
  for (const [k,v] of fd.entries()) { data[k]=v; }
  data.whoInvolved = fd.getAll('whoInvolved');
  data.serviceAreas = fd.getAll('serviceAreas');
  const _sid = await saveForm('activity-log', data);
  btn.textContent = 'Submit Activity Log'; btn.disabled = false;
  this.reset();
  document.getElementById('al-hours-preview').value='';
  window.scrollTo(0,0);
  showFormSuccess('activity-log', _sid, data);
});


// â"€â"€â"€ NEEDS ASSESSMENT form submit â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
document.getElementById('na-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Savingâ€¦'; btn.disabled = true;
  const fd = new FormData(this);
  const data = {id:uuid(), submittedAt:new Date().toISOString()};
  for (const [k,v] of fd.entries()) { data[k] = v; }
  data.assistanceType = fd.get('assistanceType') || data.assistanceType || '';
  const _sid = await saveForm('needs-assessment', data);
  btn.textContent = 'Submit Needs Assessment'; btn.disabled = false;
  this.reset();
  window.scrollTo(0,0);
  showFormSuccess('needs-assessment', _sid, data);
});

// â"€â"€â"€ EXPENSE REPORT form submit â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
document.getElementById('er-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Savingâ€¦'; btn.disabled = true;
  const fd = new FormData(this);
  const dates = fd.getAll('er_date[]');
  const descs = fd.getAll('er_desc[]');
  const cats  = fd.getAll('er_cat[]');
  const costs = fd.getAll('er_cost[]');
  const items = dates.map((_,i)=>({date:dates[i],description:descs[i],category:cats[i],cost:parseFloat(costs[i])||0}))
                     .filter(r=>r.description||r.cost);
  const subtotal = items.reduce((s,r)=>s+r.cost, 0);
  const cashAdvance = parseFloat(fd.get('cashAdvance'))||0;
  let receipts = [];
  const recInput = document.getElementById('er-receipts');
  if (recInput && recInput.files.length){
    try { receipts = await readImagesCompressed(recInput.files, {maxDim:1400, quality:0.62, maxCount:10, maxTotalKB:850}); }
    catch(err){ alert(err.message); btn.textContent='Submit Expense Report'; btn.disabled=false; return; }
  }
  const data = {
    id: uuid(),
    submittedAt: new Date().toISOString(),
    employeeName: fd.get('employeeName'),
    businessPurpose: fd.get('businessPurpose'),
    periodFrom: fd.get('periodFrom'),
    periodTo: fd.get('periodTo'),
    items,
    subtotal,
    cashAdvance,
    totalReimbursement: Math.max(0, subtotal - cashAdvance)
  };
  // Only overwrite receipts when new ones were uploaded; when editing with no
  // new uploads, keep the existing ones (merge preserves them).
  if (receipts.length) data.receipts = receipts;
  else if (!_formEditId['expense-report']) data.receipts = [];
  const _sid = await saveForm('expense-report', data);
  _erEditReceipts = null;
  btn.textContent = 'Submit Expense Report'; btn.disabled = false;
  this.reset();
  document.getElementById('er-items-body').innerHTML = '';
  addERRow();
  updateERTotal();
  window.scrollTo(0,0);
  showFormSuccess('expense-report', _sid, data);
});

// â"€â"€â"€ EVENT form submit â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
document.getElementById('event-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Generatingâ€¦'; btn.disabled = true;
  const fd = new FormData(this);
  const data = {id: uuid(), submittedAt: new Date().toISOString()};
  for (const [k,v] of fd.entries()) data[k] = v;
  delete data.photos;   // remove raw File objects from FormData
  const photoInput = document.getElementById('event-photos');
  if (photoInput && photoInput.files.length){
    try { data.photos = await readImagesCompressed(photoInput.files, {maxDim:1280, quality:0.7, maxCount:4, maxTotalKB:850}); }
    catch(err){ alert(err.message); btn.textContent='Generate Posts & Save'; btn.disabled=false; return; }
  } else if (_formEditId['events'] && _evEditPhotos && _evEditPhotos.length){
    data.photos = _evEditPhotos;   // editing with no new photos â€" keep existing
  }
  data.generatedPosts = generateSocialPost(data);
  let _aiPostsEnhanced = false;
  try {
    const ai = await generateAllPostsAI(data);
    if (ai) { Object.assign(data.generatedPosts, ai); _aiPostsEnhanced = true; }
  } catch (err) { console.warn('AI post generation failed, using templates:', err); }
  const _sid = await saveForm('events', data);
  _evEditPhotos = null;
  btn.textContent = 'Generate Posts & Save'; btn.disabled = false;
  this.reset();
  showFormSuccess('events', _sid, data);
  if (!_aiPostsEnhanced) {
    const msg = document.getElementById('fsp-msg');
    if (msg) msg.textContent += ' (Posts used built-in templates — sign into Meeting Bot to enable AI-enhanced copy.)';
  }
});

// â"€â"€â"€ MEETING form submit â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
document.addEventListener('DOMContentLoaded', () => {
  const mf = document.getElementById('meetings-form');
  if (mf) mf.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(mf);
    const btn = mf.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const data = {
        location:    fd.get('location')?.trim()||'',
        meetingDate: fd.get('meetingDate')||'',
        loggedBy:    fd.get('loggedBy')?.trim()||'',
        attendees:   fd.get('attendees')?.trim()||'',
        topic:       fd.get('topic')?.trim()||'',
        notes:       fd.get('notes')?.trim()||'',
      };
      const _sid = await saveForm('meetings', data);
      mf.reset();
      showFormSuccess('meetings', _sid, data);
    } catch(err) { alert('Error saving meeting: '+err.message); }
    btn.disabled = false; btn.textContent = 'Save Meeting';
  });
});

// â"€â"€â"€ FORM FRAMEWORK â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// ===================================================================
const FORM_DEF = {
  'progress-note':   {coll:'sessions',         formId:'progress-note-form', submitter:'mentorName',   view:'progress-note',    label:'Progress Note'},
  'activity-log':    {coll:'activities',       formId:'activity-log-form',  submitter:'mentorName',   view:'activity-log',     label:'Activity Log'},
  'needs-assessment':{coll:'needsAssessments', formId:'na-form',            submitter:'referredBy',   view:'needs-assessment', label:'Needs Assessment'},
  'expense-report':  {coll:'expenseReports',   formId:'er-form',            submitter:'employeeName', view:'expense-report',   label:'Expense Report'},
  'events':          {coll:'events',           formId:'event-form',         submitter:'postedBy',     view:'events',           label:'Event / Social Post'},
  'meetings':        {coll:'meetings',         formId:'meetings-form',      submitter:'loggedBy',     view:'meetings',         label:'Meeting'},
};
let _formEditId = {};            // form key -> id currently being edited
let _fspKey=null, _fspId=null, _fspRecord=null;
let _erEditReceipts=null, _evEditPhotos=null;   // preserve images across an edit

function collData(coll){
  return ({sessions:DB.sessions(),activities:DB.activities(),needsAssessments:DB.needsAssessments(),
           expenseReports:DB.expenseReports(),events:DB.events(),meetings:DB.meetings()})[coll]||[];
}
function recordById(coll,id){ return collData(coll).find(x=>x._id===id); }

// Add (returns new id) or, when editing, update the existing record
async function saveForm(key, data){
  const def=FORM_DEF[key];
  if(_formEditId[key]){ const id=_formEditId[key]; await DB.updateRecord(def.coll, id, data); _formEditId[key]=null; return id; }
  // Stamp the submitter so each person can find/edit only their own forms
  return await DB.addRecord(def.coll, {...data, _owner: currentUserName()});
}

function showFormSuccess(key, id, data){
  _fspKey=key; _fspId=id; _fspRecord = data ? {...data, _id:id} : recordById(FORM_DEF[key].coll, id);
  const editing = !!data && false;
  document.getElementById('fsp-msg').textContent = FORM_DEF[key].label + ' saved. What would you like to do next?';
  document.getElementById('form-success-panel').style.display='flex';
}
function fspClose(){ document.getElementById('form-success-panel').style.display='none'; }
function fspSubmitAnother(){ if(_fspKey) _formEditId[_fspKey]=null; fspClose(); }
function fspDashboard(){ fspClose(); navigate('dashboard'); }
function fspEdit(){ const k=_fspKey,id=_fspId,rec=_fspRecord; fspClose(); editForm(k,id,true,rec); }

// Edit a submitted form. Unless skipNameCheck (just submitted by this person),
// require the name on the form to match before allowing edits.
function editForm(key, id, skipNameCheck, rec){
  const def=FORM_DEF[key];
  rec = rec || recordById(def.coll,id);
  if(!rec){ alert('Record not found â€" it may still be saving. Try again in a moment.'); return; }
  if(!skipNameCheck){
    const owner=(rec._owner||rec[def.submitter]||'').trim();
    if(!(isAdmin() || owner===currentUserName())){ alert('You can only edit forms you submitted.'); return; }
  }
  navigate(def.view);
  _formEditId[key]=id;
  if(key==='expense-report') _erEditReceipts = rec.receipts||[];
  if(key==='events') _evEditPhotos = rec.photos||[];
  prefillForm(key, rec);
  const form=document.getElementById(def.formId);
  const btn=form.querySelector('[type="submit"]');
  if(btn) btn.textContent='Update '+def.label;
  form.scrollIntoView({behavior:'smooth',block:'start'});
}

function prefillForm(key, rec){
  const def=FORM_DEF[key];
  const form=document.getElementById(def.formId);
  if(!form) return;
  const skip=new Set(['id','generatedPosts','items','photos','receipts','submittedAt','type','subtotal','totalReimbursement']);
  form.querySelectorAll('input[name],select[name],textarea[name]').forEach(el=>{
    const name=el.name; if(!name||skip.has(name)||name.endsWith('[]')) return;
    if(!(name in rec)) return;
    const val=rec[name];
    if(el.type==='checkbox'){ el.checked = Array.isArray(val) ? val.includes(el.value) : !!val; }
    else if(el.type==='radio'){ el.checked = (String(val)===el.value); }
    else { el.value = (val==null)?'':val; }
  });
  if(key==='expense-report') prefillER(rec);
  // fire change events so dependent UI (hours preview, outcome toggle, totals) refreshes
  form.querySelectorAll('input,select,textarea').forEach(el=>el.dispatchEvent(new Event('change',{bubbles:true})));
}
function prefillER(rec){
  const body=document.getElementById('er-items-body'); if(!body) return;
  body.innerHTML='';
  const items=rec.items||[];
  (items.length?items:[{}]).forEach(()=>addERRow());
  const rows=[...body.querySelectorAll('tr')];
  items.forEach((it,i)=>{ const r=rows[i]; if(!r) return;
    const set=(sel,v)=>{ const e=r.querySelector(sel); if(e) e.value=(v==null?'':v); };
    set('[name="er_date[]"]', it.date); set('[name="er_desc[]"]', it.description);
    set('[name="er_cat[]"]', it.category); set('[name="er_cost[]"]', it.cost);
  });
  updateERTotal();
}

// ===================================================================

// â"€â"€â"€ injectExamplePanels â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function injectExamplePanels(){
  const panels = {
    'view-progress-note': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: completed progress note</h3>
        <p>Use the real client, mentor, service date, and default grant. A strong DAP note is specific, factual, and ends with the next step.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Mentor / client</strong>Cameron Hayes Â· Client #1241 Â· ReGroup Office</div>
          <div class="example-mini"><strong>Data</strong>Client arrived on time, brought two job leads, and reviewed ID replacement status.</div>
          <div class="example-mini"><strong>Assessment</strong>Client is making progress on employment goal; barrier is transportation to interviews.</div>
          <div class="example-mini"><strong>Plan</strong>Mentor will text bus-pass resource today and meet again on 06/25/2026.</div>
        </div>
      </div>`,
    'view-activity-log': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: completed activity log</h3>
        <p>Use this for non-client work: outreach, meetings, trainings, admin tasks, community events, and program prep.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Activity</strong>Community partner outreach call</div>
          <div class="example-mini"><strong>Purpose</strong>Discussed warm referral path for housing support.</div>
          <div class="example-mini"><strong>Time</strong>9:30 AM - 10:15 AM Â· 0.75 hours</div>
          <div class="example-mini"><strong>Outcome</strong>Partner agreed to send eligibility checklist by email.</div>
        </div>
      </div>`,
    'view-calendar': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: shared calendar event</h3>
        <p>A complete calendar item includes the video link, physical address when relevant, invited staff, outside attendees, and meeting notes.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Title</strong>Housing partner check-in</div>
          <div class="example-mini"><strong>Video</strong>Google Meet or Zoom link pasted in the video field</div>
          <div class="example-mini"><strong>Invited</strong>Cameron Hayes, Steven Chambers, partner contact</div>
          <div class="example-mini"><strong>Notes</strong>Review referral status, documents needed, and next available appointments.</div>
        </div>
      </div>`,
    'view-rj': `
      <div class="example-panel no-print" data-example-panel>
        <h3>How an RJ case moves through the app</h3>
        <p>Start a new case, then the wizard walks staff through each stage from suitability to closure. Record process facts, support needs, and goals; do not record incriminating details.</p>
        <div class="example-process">
          <div class="example-step"><b>1. Assessment</b>Review suitability, safety, participants, and referral source.</div>
          <div class="example-step"><b>2. Intake</b>Confirm voluntary participation, rights, and confidentiality.</div>
          <div class="example-step"><b>3. Restorative Work</b>Education, circles, participant plan, and readiness.</div>
          <div class="example-step"><b>4. Debrief</b>Stabilize, clarify needs, and record follow-up tasks.</div>
          <div class="example-step"><b>5. Closure</b>RJ Team agrees active casework is complete.</div>
          <div class="example-step"><b>6. Check-ins</b>Support follow-through and update goals over time.</div>
        </div>
      </div>`,
    'view-service-plans': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: service plan filled out</h3>
        <p>Build one plan per client, then add goals that mentors can connect to progress notes.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Client</strong>Jordan R. Â· #1241 Â· Primary mentor: Steven Chambers</div>
          <div class="example-mini"><strong>Need areas</strong>Housing, Employment, ID documents, Transportation</div>
          <div class="example-mini"><strong>Goal</strong>Secure two job interviews by 07/15/2026 Â· In progress</div>
          <div class="example-mini"><strong>Next step</strong>Mentor helps client upload resume and apply to two warehouse roles.</div>
        </div>
      </div>`,
    'view-grants': `
      <div class="example-panel no-print" data-example-panel>
        <h3>How the grants agent works</h3>
        <p>Give the agent the project idea, population, geography, amount, timeline, and funding types. It searches broadly beyond reentry grants, then sends the matching opportunities and a funding strategy to your inbox and the admin inbox.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Input example</strong>Mobile reentry resource fair Â· $35,000 Â· Portland metro Â· 6-month launch.</div>
          <div class="example-mini"><strong>Search scope</strong>Foundations, city/county grants, corporate giving, banks, credit unions, sponsorships.</div>
          <div class="example-mini"><strong>Inbox result</strong>Top funders, deadline notes, links, fit explanation, and recommended next action.</div>
          <div class="example-mini"><strong>Strategy</strong>60-day plan mixing grant asks, sponsor packets, individual donors, and in-kind support.</div>
        </div>
      </div>`,
    'view-clients': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: directory contact</h3>
        <p>The Edit Fields button opens every editable contact field: ID, name, email, phone, address, relationship, home meeting, confirmation status, and notes.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>ID / name</strong>#1241 Â· Jordan Reed</div>
          <div class="example-mini"><strong>Relationship</strong>Client Â· Home meeting: Monday Night Group</div>
          <div class="example-mini"><strong>Contact</strong>jordan@example.org Â· 503-555-0141</div>
          <div class="example-mini"><strong>Notes</strong>Release 06/20/2026; prefers text; needs ID follow-up.</div>
        </div>
      </div>`,
    'view-fundraising': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: fundraising CRM contact</h3>
        <p>Use fundraising contacts separately from the general directory. Log giving history, relationship category, shared contacts, notes, and the last meaningful call/email/meeting.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Contact</strong>Maria Lopez Â· Prospect Â· Credit union community fund</div>
          <div class="example-mini"><strong>Giving history</strong>$2,500 sponsorship pledged for summer event</div>
          <div class="example-mini"><strong>Common contacts</strong>TJC board member, workforce partner</div>
          <div class="example-mini"><strong>Reminder</strong>Follow up if no call/email/meeting has happened for 3+ months.</div>
        </div>
      </div>`,
    'view-email-blast': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: email blast setup</h3>
        <p>Pick a list or choose Customize, check the exact names to include, then send from a TJC email address.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Audience</strong>Directory filtered to Supporter + Monday Night Group</div>
          <div class="example-mini"><strong>Subject</strong>Volunteer opportunity: reentry resource fair</div>
          <div class="example-mini"><strong>Body</strong>Short invitation, date/time, call to action, contact person.</div>
          <div class="example-mini"><strong>Sender</strong>mentor@tjcoregon.org or admin@tjcoregon.org</div>
        </div>
      </div>`,
    'view-projects': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: whole project view</h3>
        <p>A complete project can be created through PMI steps or the AI Planner, then tracked as a list, Kanban board, and Gantt chart.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Project</strong>Spring Reentry Job Fair Â· Active Â· Owner: Program Manager</div>
          <div class="example-mini"><strong>PMI</strong>Initiation done, Planning done, Execution active, Monitoring scheduled, Closing pending.</div>
          <div class="example-mini"><strong>Tasks</strong>Confirm venue, recruit employers, build flyer, assign intake table, collect outcomes.</div>
          <div class="example-mini"><strong>Outcome</strong>Dashboard shows open tasks; inbox tells owners what is assigned.</div>
        </div>
        <div class="example-kanban">
          <div class="example-col"><h4>Open</h4><div class="example-task">Recruit 10 employers</div><div class="example-task">Draft sponsor email</div></div>
          <div class="example-col"><h4>In Progress</h4><div class="example-task">Confirm venue agreement</div></div>
          <div class="example-col"><h4>Done</h4><div class="example-task">Set project goal and sponsor</div></div>
        </div>
        <div class="example-gantt">
          <div class="example-gantt-row"><span>Initiation</span><div class="example-gantt-track"><span class="example-gantt-bar" style="left:0%;width:20%;"></span></div></div>
          <div class="example-gantt-row"><span>Planning</span><div class="example-gantt-track"><span class="example-gantt-bar" style="left:18%;width:28%;"></span></div></div>
          <div class="example-gantt-row"><span>Execution</span><div class="example-gantt-track"><span class="example-gantt-bar" style="left:42%;width:38%;"></span></div></div>
          <div class="example-gantt-row"><span>Closing</span><div class="example-gantt-track"><span class="example-gantt-bar" style="left:78%;width:18%;"></span></div></div>
        </div>
      </div>`,
    'view-events': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: event and social post</h3>
        <p>Fill out what happened, upload photos if you have them, and the app saves generated copy for LinkedIn, Instagram, Facebook, X/Twitter, and the newsletter.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Event title</strong>Community Resource Fair</div>
          <div class="example-mini"><strong>Summary</strong>Staff and partners helped 18 people connect with IDs, housing referrals, and job leads.</div>
          <div class="example-mini"><strong>Impact</strong>6 follow-up appointments scheduled; 3 resumes started onsite.</div>
          <div class="example-mini"><strong>Generated post</strong>"Today we saw community show up in practical ways..." + platform-specific hashtags.</div>
        </div>
      </div>`,
    'view-meetings': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: meeting log</h3>
        <p>Log who attended, where it happened, the main topic, decisions, and follow-up actions.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Location</strong>Zoom + TJC office</div>
          <div class="example-mini"><strong>Attendees</strong>Cameron Hayes, mentor team, housing partner</div>
          <div class="example-mini"><strong>Topic</strong>Referral process for urgent housing support</div>
          <div class="example-mini"><strong>Notes</strong>Partner will send eligibility checklist; mentor will follow up with three clients.</div>
        </div>
      </div>`,
    'view-needs-assessment': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: needs assessment</h3>
        <p>Submit one form for each need so the follow-up is clear and reportable.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Need</strong>Transportation assistance for job interviews</div>
          <div class="example-mini"><strong>Contact</strong>Client phone/email and preferred time to reach them</div>
          <div class="example-mini"><strong>Urgency</strong>Needed before interview on 06/27/2026</div>
          <div class="example-mini"><strong>Action</strong>Assign mentor to confirm bus pass or ride resource.</div>
        </div>
      </div>`,
    'view-expense-report': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: expense report</h3>
        <p>Attach receipt photos directly to the expense report and list each expense line separately.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Staff</strong>Steven Chambers Â· CVI grant</div>
          <div class="example-mini"><strong>Expense line</strong>06/21/2026 Â· bus passes Â· $48.00 Â· client transportation</div>
          <div class="example-mini"><strong>Receipt</strong>Upload clear photo or PDF of the receipt.</div>
          <div class="example-mini"><strong>Review</strong>Admin downloads the report from Reports and deletes only when appropriate.</div>
        </div>
      </div>`,
    'view-timesheets': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: timesheet cycle</h3>
        <p>Select the mentor and a 14-day pay cycle. The app builds the timesheet from submitted notes and activity logs.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Pay cycle</strong>06/12/2026 - 06/26/2026</div>
          <div class="example-mini"><strong>Entries</strong>Progress notes + activity logs in that date range</div>
          <div class="example-mini"><strong>Grant</strong>Uses the staff member's default grant unless changed by admin</div>
          <div class="example-mini"><strong>Output</strong>Download PDF after the timesheet is built.</div>
        </div>
      </div>`
  };
  Object.entries(panels).forEach(([viewId, html]) => {
    const view = document.getElementById(viewId);
    if (!view || view.querySelector('[data-example-panel]')) return;
    view.insertAdjacentHTML('afterbegin', html);
  });
}


// â"€â"€â"€ INIT â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
try {
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  injectExamplePanels();
  initForms();
  restoreSession();
  // Poll the meeting backend so finished summaries reach attendee inboxes even when off the Calendar tab
  setInterval(()=>{ if(_currentUser){ try{ checkMeetingSummaries(); autoDispatchBots(); }catch(e){} } }, 120000);
} catch(e) {
  const s = document.getElementById('app-login-status');
  if (s) { s.textContent = 'Initialization error — please refresh the page.'; s.style.color = '#ef5350'; }
}

// Expose all functions used by inline onclick/onchange handlers to global scope
// (required because <script type="module"> does not share scope with HTML attributes)
Object.assign(window, {
  navigate, goBack, switchTab, filterPayPeriod, exportTableCSV,
  generateTimesheet, tsUpdateFromStaff, populateTsMentors,
  showAddStaff, addStaff, removeStaff,
  openStaffModal, closeStaffModal, saveStaffModal, deleteStaffFromModal,
  exportData, importDataJSON, importCSV, clearAllData,
  renderAllData, renderDashboard, renderDataView, renderSettings,
  renderNAList, printNA,
  renderERList, printER, addERRow, updateERTotal,
  renderFormReports, printTimesheet,
  fspSubmitAnother, fspEdit, fspDashboard, editForm, deleteReport,
  renderProfile, saveProfile, savePassword, resetPassword, uploadProfilePhoto, uploadProfileDoc, deleteProfileDoc, saveProfileIcs,
  setOrientationType, openOrientationModule, closeOrientationModule, markSectionComplete,
  submitModuleQuiz, retryModuleQuiz, resetOrientationProgress,
  openHandbookReader, closeHandbookReader, hbPrev, hbNext,
  hbSubmitQuiz, hbRetryQuiz, hbContinueAfterQuiz, hbCloseQuizDone, hbCompleteOrientation,
  sendHandbookQuestion,
  renderCalendar, calShiftMonth, calToday, openCalEvent, closeCalEvent, saveCalEvent, openCalDetail, closeCalDetail, editCalFromDetail, deleteCalEvent, summarizeMeeting, sendMeetingBot, retryMeetingBot, dispatchMeetingBot, autoDispatchBots, saveMeetingBotUrl, saveMeetingBotAuto, testMeetingBot, toggleMeetingRecording,
  connectGcal, saveGcalClientId, fetchGcal, checkMeetingSummaries, deliverMeetingSummary,
  openIcsSetup, syncIcsCalendar, openSyncedDetail, closeSyncedDetail, sendBotForSynced,
  renderRJ, openRJCase, closeRJCase, rjSaveAndNext, rjBack, rjGoStep, rjAddCheckin, deleteRJCase,
  runGrantsAgent,
  renderServicePlans, openServicePlan, closeServicePlan, saveServicePlan, deleteServicePlan, spAddGoal, spFillClientId,
  submitPIN, cancelPIN, changeAdminPIN,
  submitAppLogin, logout,
  renderClientDirectory, openClientModal, closeClientModal, saveClient, deleteClient, fillClientId,
  updateEBPreview, copyEBAddresses, openEBMailto, openEBGmail, renderEBCustomList, ebCustCheckAll, updateEBCount,
  refreshAlerts, renderAdminInbox, renderAdminTasks, openAssignModal, closeAssignModal, saveAssignedTask, adminRemoveTask,
  renderMyTasks, updateMyTaskStatus,
  renderProjects, openProjectModal, closeProjectModal, saveProject, deleteProject, openProjectDetail, closeProjectDetail, postProjectUpdate,
  openTaskModal, closeTaskModal, saveTaskModal, toggleProjectsView, toggleGanttView, setProjectsView, renderKanban, renderGantt, kbDragStart, kbDrop,
  openPMIWizard, closePMIWizard, pmiCompletePhase, pmiNextPhase, pmiBack, pmiFinish, pmiAssignTask,
  openAIPlanner, closeAIPlanner, handlePlannerFile, generatePlanAI, createPlannerTasks, addPlannerStep, removePlannerStep,
  renderEvents, switchEvTab, copyEvText, copyText,
  renderMeetingsList,
  renderFundraising, openContactModal, closeContactModal, saveFundContact,
  checkAllFund, clearFundChecks, emailCheckedFund, updateFundCheckedCount,
  openContactDetail, closeContactDetail, editContactDetails, deleteFundContact,
  addInteraction, deleteInteraction, addGift, deleteGift,
  openDashboardConfig, closeDashboardConfig, saveDashboardConfig,
  openMyMetricsConfig, closeMyMetricsConfig, saveMyMetricsConfig,
  toggleNav, closeNav,
  renderMentorPanel, openMentorMessages, closeMentorMessages, sendMentorMessage, deleteMessage,
  openMentorTasks, closeMentorTasks, sendMyMessage, renderAdminMessages, replyThread,
});

// Dashboard and staff datalist are rendered once Firestore listeners fire (_onReady)

// â"€â"€â"€ window assignments (required for inline onclick= handlers) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
Object.assign(window, {
  navigate, goBack, switchTab, filterPayPeriod, exportTableCSV,
  generateTimesheet, tsUpdateFromStaff, populateTsMentors,
  showAddStaff, addStaff, removeStaff,
  openStaffModal, closeStaffModal, saveStaffModal, deleteStaffFromModal,
  exportData, importDataJSON, importCSV, clearAllData,
  renderAllData, renderDashboard, renderDataView, renderSettings,
  renderNAList, printNA,
  renderERList, printER, addERRow, updateERTotal,
  renderFormReports, printTimesheet,
  fspSubmitAnother, fspEdit, fspDashboard, editForm, deleteReport,
  renderProfile, saveProfile, savePassword, resetPassword, uploadProfilePhoto, uploadProfileDoc, deleteProfileDoc, saveProfileIcs,
  setOrientationType, openOrientationModule, closeOrientationModule, markSectionComplete,
  submitModuleQuiz, retryModuleQuiz, resetOrientationProgress,
  openHandbookReader, closeHandbookReader, hbPrev, hbNext,
  hbSubmitQuiz, hbRetryQuiz, hbContinueAfterQuiz, hbCloseQuizDone, hbCompleteOrientation,
  sendHandbookQuestion,
  renderCalendar, calShiftMonth, calToday, openCalEvent, closeCalEvent, saveCalEvent, openCalDetail, closeCalDetail, editCalFromDetail, deleteCalEvent, summarizeMeeting, sendMeetingBot, retryMeetingBot, dispatchMeetingBot, autoDispatchBots, saveMeetingBotUrl, saveMeetingBotAuto, testMeetingBot, toggleMeetingRecording,
  connectGcal, saveGcalClientId, fetchGcal, checkMeetingSummaries, deliverMeetingSummary,
  openIcsSetup, syncIcsCalendar, openSyncedDetail, closeSyncedDetail, sendBotForSynced,
  renderRJ, openRJCase, closeRJCase, rjSaveAndNext, rjBack, rjGoStep, rjAddCheckin, deleteRJCase,
  runGrantsAgent,
  renderServicePlans, openServicePlan, closeServicePlan, saveServicePlan, deleteServicePlan, spAddGoal, spFillClientId,
  submitPIN, cancelPIN, changeAdminPIN,
  submitAppLogin, logout,
  renderClientDirectory, openClientModal, closeClientModal, saveClient, deleteClient, fillClientId,
  updateEBPreview, copyEBAddresses, openEBGmail, openEBMailto, renderEBCustomList, ebCustCheckAll, updateEBCount,
  refreshAlerts, renderAdminInbox, renderAdminTasks, openAssignModal, closeAssignModal, saveAssignedTask, adminRemoveTask,
  renderMyTasks, updateMyTaskStatus,
  renderProjects, openProjectModal, closeProjectModal, saveProject, deleteProject, openProjectDetail, closeProjectDetail, postProjectUpdate,
  openTaskModal, closeTaskModal, saveTaskModal, toggleProjectsView, toggleGanttView, setProjectsView, renderKanban, renderGantt, kbDragStart, kbDrop,
  openPMIWizard, closePMIWizard, pmiCompletePhase, pmiNextPhase, pmiBack, pmiFinish, pmiAssignTask,
  openAIPlanner, closeAIPlanner, handlePlannerFile, generatePlanAI, createPlannerTasks, addPlannerStep, removePlannerStep,
  renderEvents, switchEvTab, copyEvText, copyText,
  renderMeetingsList,
  renderFundraising, openContactModal, closeContactModal, saveFundContact,
  checkAllFund, clearFundChecks, emailCheckedFund, updateFundCheckedCount,
  openContactDetail, closeContactDetail, editContactDetails, deleteFundContact,
  addInteraction, deleteInteraction, addGift, deleteGift,
  openDashboardConfig, closeDashboardConfig, saveDashboardConfig,
  openMyMetricsConfig, closeMyMetricsConfig, saveMyMetricsConfig,
  toggleNav, closeNav,
  renderMentorPanel, openMentorMessages, closeMentorMessages, sendMentorMessage, deleteMessage,
  openMentorTasks, closeMentorTasks, sendMyMessage, renderAdminMessages, replyThread,
  // Expose form infrastructure for page modules that need it
  saveForm, showFormSuccess, collData, FORM_DEF,
  refreshStaffDatalist, populateClientNameList,
});
// Also expose mutable state references for page modules
window._formEditId = _formEditId;
window.readImagesCompressed = readImagesCompressed;

// Enable the Sign In button once all global functions are wired
(function() {
  clearTimeout(window._loginReadyTimeout);
  const btn = document.getElementById('app-login-btn');
  const status = document.getElementById('app-login-status');
  if (btn) { btn.disabled = false; btn.textContent = 'Sign In →'; btn.style.cursor = 'pointer'; btn.style.opacity = '1'; }
  if (status) status.style.display = 'none';
})();
