import { _currentUser, _securityConfig } from './state.js';

// Pure utilities
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0; return(c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}

export function getDate(e) {
  return e.dateOfService || e.dateOfActivity || e.dateOfAttempt || '';
}

export function calcHours(start, end) {
  if (!start || !end) return 0;
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  return Math.round(((eh*60+em)-(sh*60+sm)) / 60 * 100) / 100;
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
}

export function fmtDateSlash(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt)) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  const ap = h>=12?'PM':'AM'; const hr=h%12||12;
  return `${hr}:${String(m).padStart(2,'0')} ${ap}`;
}

export function getActivityLabel(e) {
  if (e._type==='client' || e.type==='client') {
    const types = Array.isArray(e.supportTypes) ? e.supportTypes : (e.supportTypes ? [e.supportTypes] : []);
    return types.filter(Boolean).join(', ') || e.serviceOutcome || '';
  }
  return e.activityType || '';
}

export function safeConcernBadge(val) {
  if (!val || val==='No concerns' || val==='no') return '';
  const cls = (val.includes('Immediate')||val.includes('Elevated')) ? 'badge-danger' : 'badge-warn';
  return `<span class="badge ${cls}">${val}</span>`;
}


// fEsc + fmtMoney (were originally defined near fundraising section)
export function fEsc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function fmtMoney(n){ const v=Number(n)||0; return '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// Auth helpers
export function firstNameOf(name){ return (name||'').trim().split(/\s+/)[0] || ''; }
export function currentUserName(){ return _currentUser ? _currentUser.name : ''; }
export function isAdmin(){ return !!(_currentUser && _currentUser.isAdmin); }
export function isOwnerOrAdmin(ownerName){ return isAdmin() || (!!ownerName && ownerName === currentUserName()); }
export function requireAdmin(cb) {
  if (isAdmin()) cb();
  else alert('Only an administrator can do this. Log in as an admin to continue.');
}

// Profile helpers
export function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read file')); r.readAsDataURL(f); }); }
export function profileEmails(raw){
  return (raw||"").split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
}
export function primaryProfileEmail(staff){
  if (!staff) return "";
  const all = profileEmails(staff.email || "");
  return all.find(e=>/@tjcoregon\.org$/i.test(e)) || all[0] || "";
}

// Print helper
export function printDoc(html){
  const root = document.getElementById('print-root');
  if (!root) return;
  root.innerHTML = html;
  window.print();
  window.addEventListener('afterprint', function once(){
    root.innerHTML = '';
    window.removeEventListener('afterprint', once);
  });
}