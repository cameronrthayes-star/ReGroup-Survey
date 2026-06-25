// Shared Firebase state — exported as live bindings.
// Only this module reassigns them; all importers always see the current value.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBKu0fINl9bCadihzeeS1Nd2CzdkqxB0bI",
  authDomain: "regroup-elite-squad.firebaseapp.com",
  projectId: "regroup-elite-squad",
  storageBucket: "regroup-elite-squad.firebasestorage.app",
  messagingSenderId: "474118095009",
  appId: "1:474118095009:web:8e72e7a42f92ff36b470e0"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);

// DATA LAYER — Firestore backed, real-time shared across all users

// In-memory cache updated by real-time listeners
let _sessions         = [];
let _activities       = [];
let _staff            = [];
let _needsAssessments = [];
let _expenseReports   = [];
let _listenersReady   = 0;

function _onReady() {
  _listenersReady++;
  if (_listenersReady === 16) {
    renderDashboard();
    refreshStaffDatalist();
    seedClientsIfEmpty();
  }
}

// Real-time listeners — fire whenever any mentor adds/changes data
onSnapshot(query(collection(db,'sessions'),   orderBy('dateOfService','asc')),   snap => {
  _sessions   = snap.docs.map(d => ({...d.data(), _id:d.id, _type:'client'}));
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active'))   renderDashboard();
  if (document.getElementById('view-data-view')?.classList.contains('active'))  renderDataView();
});
onSnapshot(query(collection(db,'activities'), orderBy('dateOfActivity','asc')),  snap => {
  _activities = snap.docs.map(d => ({...d.data(), _id:d.id, _type:'activity'}));
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active'))   renderDashboard();
  if (document.getElementById('view-data-view')?.classList.contains('active'))  renderDataView();
});
onSnapshot(collection(db,'staff'), snap => {
  _staff = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  refreshStaffDatalist();
  if (document.getElementById('view-settings')?.classList.contains('active')) renderSettings();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
  if (document.getElementById('view-profile')?.classList.contains('active')) renderProfile();
});
onSnapshot(query(collection(db,'needsAssessments'), orderBy('_createdAt','asc')), snap => {
  _needsAssessments = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-needs-assessment')?.classList.contains('active')) renderNAList();
  if (document.getElementById('view-form-reports')?.classList.contains('active')) renderFormReports();
});
onSnapshot(query(collection(db,'expenseReports'), orderBy('_createdAt','asc')), snap => {
  _expenseReports = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-expense-report')?.classList.contains('active')) renderERList();
  if (document.getElementById('view-form-reports')?.classList.contains('active')) renderFormReports();
});

let _clients  = [];
let _tasks    = [];
let _projects = [];
let _events   = [];
let _meetings = [];
let _fundContacts = [];
let _dashboardConfig = null;
let _securityConfig = {};
let _messages = [];
let _calendar = [];
let _rjCases = [];
let _servicePlans = [];

onSnapshot(collection(db,'calendar'), snap => {
  _calendar = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-calendar')?.classList.contains('active')) renderCalendar();
  if (_calDetailId && document.getElementById('cal-detail')?.style.display === 'flex') openCalDetail(_calDetailId);
});
onSnapshot(collection(db,'rjCases'), snap => {
  _rjCases = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-rj')?.classList.contains('active')) renderRJ();
});
onSnapshot(collection(db,'servicePlans'), snap => {
  _servicePlans = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-service-plans')?.classList.contains('active')) renderServicePlans();
});
onSnapshot(query(collection(db,'clients'), orderBy('clientId','asc')), snap => {
  _clients = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-clients')?.classList.contains('active')) renderClientDirectory();
  populateClientNameList();
});
onSnapshot(query(collection(db,'tasks'),    orderBy('_createdAt','asc')), snap => {
  _tasks = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-admin-inbox')?.classList.contains('active')) renderAdminTasks();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
});
onSnapshot(query(collection(db,'projects'), orderBy('_createdAt','asc')), snap => {
  _projects = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-projects')?.classList.contains('active')) renderProjects();
});
onSnapshot(query(collection(db,'events'),   orderBy('_createdAt','asc')), snap => {
  _events = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-events')?.classList.contains('active')) renderEvents();
});
onSnapshot(query(collection(db,'meetings'), orderBy('_createdAt','asc')), snap => {
  _meetings = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-meetings')?.classList.contains('active')) renderMeetingsList();
});
onSnapshot(query(collection(db,'fundContacts'), orderBy('_createdAt','asc')), snap => {
  _fundContacts = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('view-fundraising')?.classList.contains('active')) renderFundraising();
  if (_fundDetailId && document.getElementById('fund-detail')?.style.display === 'flex') renderContactDetail(_fundDetailId);
});
onSnapshot(collection(db,'config'), snap => {
  const d = snap.docs.find(x => x.id === 'dashboard');
  const security = snap.docs.find(x => x.id === 'admin');
  _dashboardConfig = d ? d.data() : null;
  _securityConfig = security ? security.data() : {};
  _onReady();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
});
onSnapshot(query(collection(db,'messages'), orderBy('_createdAt','asc')), snap => {
  _messages = snap.docs.map(d => ({...d.data(), _id:d.id}));
  _onReady();
  if (document.getElementById('ai-tab-mentors')?.classList.contains('active')) renderMentorPanel();
  if (document.getElementById('ai-tab-amsgs')?.classList.contains('active')) renderAdminMessages();
  if (document.getElementById('view-my-tasks')?.classList.contains('active')) renderMyTasks();
  if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
  updateMentorInboxNav();
  if (_msgMentor && document.getElementById('msg-modal')?.style.display === 'flex') renderMessageThread();
});

const DB = {
  sessions:         () => _sessions,
  activities:       () => _activities,
  staff:            () => _staff,
  needsAssessments: () => _needsAssessments,
  expenseReports:   () => _expenseReports,
  clients:  () => _clients,
  tasks:    () => _tasks,
  projects: () => _projects,
  events:   () => _events,

  async addClient(c) { await addDoc(collection(db,'clients'), {...c, _createdAt: serverTimestamp()}); },
  async updateClient(id, c) { await setDoc(doc(db,'clients',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeClient(id) { await deleteDoc(doc(db,'clients',id)); },

  async addTask(t)          { await addDoc(collection(db,'tasks'),    {...t, _createdAt: serverTimestamp()}); },
  async updateTask(id, t)   { await setDoc(doc(db,'tasks',id),    {...t, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeTask(id)      { await deleteDoc(doc(db,'tasks',id)); },

  async addProject(p)       { await addDoc(collection(db,'projects'), {...p, _createdAt: serverTimestamp()}); },
  async addProjectAndGetRef(p) { const r = await addDoc(collection(db,'projects'), {...p, _createdAt: serverTimestamp()}); return r.id; },
  async updateProject(id,p) { await setDoc(doc(db,'projects',id),  {...p, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeProject(id)   { await deleteDoc(doc(db,'projects',id)); },

  async addEvent(e)         { await addDoc(collection(db,'events'),   {...e, _createdAt: serverTimestamp()}); },
  async addMeeting(m)       { await addDoc(collection(db,'meetings'), {...m, _createdAt: serverTimestamp()}); },
  meetings: () => _meetings,

  fundContacts: () => _fundContacts,
  async addFundContact(c)      { await addDoc(collection(db,'fundContacts'), {...c, _createdAt: serverTimestamp()}); },
  async updateFundContact(id,c){ await setDoc(doc(db,'fundContacts',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeFundContact(id)  { await deleteDoc(doc(db,'fundContacts',id)); },

  dashboardConfig: () => _dashboardConfig,
  async setDashboardConfig(metrics){ await setDoc(doc(db,'config','dashboard'), {metrics, _updatedAt: serverTimestamp()}); },
  securityConfig: () => _securityConfig,
  async setAdminPIN(adminPIN){ await setDoc(doc(db,'config','admin'), {adminPIN, _updatedAt: serverTimestamp()}, {merge:true}); },

  servicePlans: () => _servicePlans,
  async addServicePlan(p)      { const r=await addDoc(collection(db,'servicePlans'), {...p, _createdAt: serverTimestamp()}); return r.id; },
  async updateServicePlan(id,p){ await setDoc(doc(db,'servicePlans',id), {...p, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeServicePlan(id)  { await deleteDoc(doc(db,'servicePlans',id)); },

  rjCases: () => _rjCases,
  async addRJCase(c)         { const r = await addDoc(collection(db,'rjCases'), {...c, _createdAt: serverTimestamp()}); return r.id; },
  async updateRJCase(id,c)   { await setDoc(doc(db,'rjCases',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeRJCase(id)     { await deleteDoc(doc(db,'rjCases',id)); },

  calendar: () => _calendar,
  async addCalEvent(e)       { const r=await addDoc(collection(db,'calendar'), {...e, _createdAt: serverTimestamp()}); return r.id; },
  async updateCalEvent(id,e) { await setDoc(doc(db,'calendar',id), {...e, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeCalEvent(id)   { await deleteDoc(doc(db,'calendar',id)); },

  messages: () => _messages,
  async addMessage(m)        { await addDoc(collection(db,'messages'), {...m, _createdAt: serverTimestamp()}); },
  async markMessageRead(id)  { await setDoc(doc(db,'messages',id), {read:true, _readAt: serverTimestamp()}, {merge:true}); },
  async removeMessage(id)    { await deleteDoc(doc(db,'messages',id)); },

  // Generic helpers (used by the form add/edit/delete framework)
  async addRecord(coll, data)        { const r = await addDoc(collection(db,coll), {...data, _createdAt: serverTimestamp()}); return r.id; },
  async updateRecord(coll, id, data) { await setDoc(doc(db,coll,id), {...data, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeRecord(coll, id)       { await deleteDoc(doc(db,coll,id)); },

  async addSession(s) {
    await addDoc(collection(db,'sessions'), {...s, _createdAt: serverTimestamp()});
  },
  async addActivity(a) {
    await addDoc(collection(db,'activities'), {...a, _createdAt: serverTimestamp()});
  },
  async addNeedsAssessment(n) {
    await addDoc(collection(db,'needsAssessments'), {...n, _createdAt: serverTimestamp()});
  },
  async addExpenseReport(r) {
    await addDoc(collection(db,'expenseReports'), {...r, _createdAt: serverTimestamp()});
  },
  async saveStaffMember(s) {
    const ref = s._id ? doc(db,'staff',s._id) : doc(collection(db,'staff'));
    await setDoc(ref, s);
  },
  async removeStaffMember(id) {
    await deleteDoc(doc(db,'staff',id));
  },
  async saveSessions(arr) {
    for (const s of arr) await addDoc(collection(db,'sessions'), {...s, _createdAt: serverTimestamp()});
  },
  async saveActivities(arr) {
    for (const a of arr) await addDoc(collection(db,'activities'), {...a, _createdAt: serverTimestamp()});
  },

  allEntries() {
    return [..._sessions, ..._activities]
      .sort((a,b) => (getDate(a)||'').localeCompare(getDate(b)||''));
  }
};

// Setters — called by onSnapshot handlers in app.js
export function setSessions(v)         { _sessions = v; }
export function setActivities(v)       { _activities = v; }
export function setStaff(v)            { _staff = v; }
export function setNeedsAssessments(v) { _needsAssessments = v; }
export function setExpenseReports(v)   { _expenseReports = v; }
export function setClients(v)          { _clients = v; }
export function setTasks(v)            { _tasks = v; }
export function setProjects(v)         { _projects = v; }
export function setEvents(v)           { _events = v; }
export function setMeetings(v)         { _meetings = v; }
export function setFundContacts(v)     { _fundContacts = v; }
export function setDashboardConfig(v)  { _dashboardConfig = v; }
export function setSecurityConfig(v)   { _securityConfig = v; }
export function setMessages(v)         { _messages = v; }
export function setCalendar(v)         { _calendar = v; }
export function setRjCases(v)          { _rjCases = v; }
export function setServicePlans(v)     { _servicePlans = v; }

// Auth state (also shared)
export let _currentUser   = null;
export let _adminUnlocked = false;
export function setCurrentUser(v)    { _currentUser = v; }
export function setAdminUnlocked(v)  { _adminUnlocked = v; }