// Shared Firebase state — exported as live bindings.
// Only this module reassigns them; all importers always see the current value.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth, signInWithCustomToken, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBKu0fINl9bCadihzeeS1Nd2CzdkqxB0bI",
  authDomain: "regroup-elite-squad.firebaseapp.com",
  projectId: "regroup-elite-squad",
  storageBucket: "regroup-elite-squad.firebasestorage.app",
  messagingSenderId: "474118095009",
  appId: "1:474118095009:web:8e72e7a42f92ff36b470e0"
};

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// Re-export Firestore helpers so page modules only need to import from here
export { collection, addDoc, getDocs, doc, setDoc, deleteDoc,
         query, orderBy, onSnapshot, serverTimestamp };
// Re-export Firebase Auth helpers
export { signInWithCustomToken, onAuthStateChanged, signOut };

// ─── Shared state (live bindings) ────────────────────────────────────────────
export let _sessions         = [];
export let _activities       = [];
export let _staff            = [];
export let _needsAssessments = [];
export let _expenseReports   = [];
export let _clients          = [];
export let _tasks            = [];
export let _projects         = [];
export let _events           = [];
export let _meetings         = [];
export let _fundContacts     = [];
export let _dashboardConfig  = null;
export let _securityConfig   = {};
export let _messages         = [];
export let _calendar         = [];
export let _rjCases          = [];
export let _servicePlans     = [];

// ─── Setters — called by onSnapshot handlers in app.js ───────────────────────
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

// ─── Auth state ───────────────────────────────────────────────────────────────
export let _currentUser   = null;
export let _adminUnlocked = false;
export function setCurrentUser(v)   { _currentUser = v; }
export function setAdminUnlocked(v) { _adminUnlocked = v; }

// ─── DB — Firestore CRUD helpers used by page modules ────────────────────────
export const DB = {
  sessions:         () => _sessions,
  activities:       () => _activities,
  staff:            () => _staff,
  needsAssessments: () => _needsAssessments,
  expenseReports:   () => _expenseReports,
  clients:          () => _clients,
  tasks:            () => _tasks,
  projects:         () => _projects,
  events:           () => _events,
  meetings:         () => _meetings,
  fundContacts:     () => _fundContacts,
  dashboardConfig:  () => _dashboardConfig,
  securityConfig:   () => _securityConfig,
  servicePlans:     () => _servicePlans,
  rjCases:          () => _rjCases,
  calendar:         () => _calendar,
  messages:         () => _messages,

  async addClient(c)           { await addDoc(collection(db,'clients'), {...c, _createdAt: serverTimestamp()}); },
  async updateClient(id, c)    { await setDoc(doc(db,'clients',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeClient(id)       { await deleteDoc(doc(db,'clients',id)); },

  async addTask(t)             { await addDoc(collection(db,'tasks'), {...t, _createdAt: serverTimestamp()}); },
  async updateTask(id, t)      { await setDoc(doc(db,'tasks',id), {...t, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeTask(id)         { await deleteDoc(doc(db,'tasks',id)); },

  async addProject(p)          { await addDoc(collection(db,'projects'), {...p, _createdAt: serverTimestamp()}); },
  async addProjectAndGetRef(p) { const r = await addDoc(collection(db,'projects'), {...p, _createdAt: serverTimestamp()}); return r.id; },
  async updateProject(id, p)   { await setDoc(doc(db,'projects',id), {...p, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeProject(id)      { await deleteDoc(doc(db,'projects',id)); },

  async addEvent(e)            { await addDoc(collection(db,'events'), {...e, _createdAt: serverTimestamp()}); },
  async addMeeting(m)          { await addDoc(collection(db,'meetings'), {...m, _createdAt: serverTimestamp()}); },

  async addFundContact(c)      { await addDoc(collection(db,'fundContacts'), {...c, _createdAt: serverTimestamp()}); },
  async updateFundContact(id,c){ await setDoc(doc(db,'fundContacts',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeFundContact(id)  { await deleteDoc(doc(db,'fundContacts',id)); },

  async setDashboardConfig(metrics){ await setDoc(doc(db,'config','dashboard'), {metrics, _updatedAt: serverTimestamp()}); },
  async setAdminPIN(adminPIN)      { await setDoc(doc(db,'config','admin'), {adminPIN, _updatedAt: serverTimestamp()}, {merge:true}); },

  async addServicePlan(p)      { const r = await addDoc(collection(db,'servicePlans'), {...p, _createdAt: serverTimestamp()}); return r.id; },
  async updateServicePlan(id,p){ await setDoc(doc(db,'servicePlans',id), {...p, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeServicePlan(id)  { await deleteDoc(doc(db,'servicePlans',id)); },

  async addRJCase(c)           { const r = await addDoc(collection(db,'rjCases'), {...c, _createdAt: serverTimestamp()}); return r.id; },
  async updateRJCase(id,c)     { await setDoc(doc(db,'rjCases',id), {...c, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeRJCase(id)       { await deleteDoc(doc(db,'rjCases',id)); },

  async addCalEvent(e)         { const r = await addDoc(collection(db,'calendar'), {...e, _createdAt: serverTimestamp()}); return r.id; },
  async updateCalEvent(id,e)   { await setDoc(doc(db,'calendar',id), {...e, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeCalEvent(id)     { await deleteDoc(doc(db,'calendar',id)); },

  async addMessage(m)          { await addDoc(collection(db,'messages'), {...m, _createdAt: serverTimestamp()}); },
  async markMessageRead(id)    { await setDoc(doc(db,'messages',id), {read:true, _readAt: serverTimestamp()}, {merge:true}); },
  async removeMessage(id)      { await deleteDoc(doc(db,'messages',id)); },

  async addRecord(coll, data)        { const r = await addDoc(collection(db,coll), {...data, _createdAt: serverTimestamp()}); return r.id; },
  async updateRecord(coll, id, data) { await setDoc(doc(db,coll,id), {...data, _updatedAt: serverTimestamp()}, {merge:true}); },
  async removeRecord(coll, id)       { await deleteDoc(doc(db,coll,id)); },

  async addSession(s)          { await addDoc(collection(db,'sessions'), {...s, _createdAt: serverTimestamp()}); },
  async addActivity(a)         { await addDoc(collection(db,'activities'), {...a, _createdAt: serverTimestamp()}); },
  async addNeedsAssessment(n)  { await addDoc(collection(db,'needsAssessments'), {...n, _createdAt: serverTimestamp()}); },
  async addExpenseReport(r)    { await addDoc(collection(db,'expenseReports'), {...r, _createdAt: serverTimestamp()}); },
  async saveStaffMember(s)     { const ref = s._id ? doc(db,'staff',s._id) : doc(collection(db,'staff')); await setDoc(ref, s); },
  async removeStaffMember(id)  { await deleteDoc(doc(db,'staff',id)); },
  async saveSessions(arr)      { for (const s of arr) await addDoc(collection(db,'sessions'), {...s, _createdAt: serverTimestamp()}); },
  async saveActivities(arr)    { for (const a of arr) await addDoc(collection(db,'activities'), {...a, _createdAt: serverTimestamp()}); },

  allEntries() {
    return [..._sessions, ..._activities]
      .sort((a,b) => ((a.dateOfService||a.dateOfActivity||'')).localeCompare((b.dateOfService||b.dateOfActivity||'')));
  }
};
