import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
function getEBRecipients() {
  const filter = document.getElementById('eb-filter')?.value || 'all';
  // Fundraiser sources draw from the fundraising CRM instead of clients
  if (filter === 'fundraisers') {
    return DB.fundContacts().filter(c=>c.email && c.email.trim()).map(c=>c.email.trim());
  }
  if (filter === 'fund-selected') {
    return DB.fundContacts().filter(c=>_fundEmailList.includes(c._id) && c.email && c.email.trim()).map(c=>c.email.trim());
  }
  if (filter.startsWith('fund-rel:')) {
    const rel = filter.slice(9);
    return DB.fundContacts().filter(c=>(c.relationship||'')===rel && c.email && c.email.trim()).map(c=>c.email.trim());
  }
  if (filter === 'customize') {
    return [...document.querySelectorAll('#eb-cust-rows input:checked')].map(c=>c.value).filter(Boolean);
  }
  return DB.clients()
    .filter(c => c.email && c.email.trim())
    .filter(c => {
      if (filter === 'accurate') return c.confirmation === 'Accurate';
      if (filter.startsWith('meeting:')) return (c.homeMeeting||'').trim() === filter.slice(8);
      return true;
    })
    .map(c => c.email.trim());
}

// Render the directory checklist for the "Customize" recipient option
function renderEBCustomList(){
  const wrap=document.getElementById('eb-cust-rows'); if(!wrap) return;
  const q=(document.getElementById('eb-cust-search')?.value||'').toLowerCase();
  const checked=new Set([...wrap.querySelectorAll('input:checked')].map(c=>c.value));
  let list=DB.clients().filter(c=>c.email && c.email.trim());
  if(q) list=list.filter(c=>(clientFullName(c)+' '+(c.email||'')).toLowerCase().includes(q));
  list.sort((a,b)=>clientFullName(a).localeCompare(clientFullName(b)));
  wrap.innerHTML = list.length ? list.map(c=>{
    const em=c.email.trim();
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:0.86em;cursor:pointer;border-bottom:1px solid #f3f3f3;">
      <input type="checkbox" value="${fEsc(em)}" ${checked.has(em)?'checked':''} onchange="updateEBCount()">
      <span style="font-weight:600;">${fEsc(clientFullName(c)||'—')}</span>
      <span style="color:#999;margin-left:auto;font-size:0.92em;">${fEsc(em)}</span>
    </label>`;
  }).join('') : '<p style="color:#bbb;font-size:0.84em;">No contacts with email match.</p>';
}
function ebCustCheckAll(on){ document.querySelectorAll('#eb-cust-rows input[type=checkbox]').forEach(c=>c.checked=on); updateEBCount(); }
function updateEBCount(){
  const emails=getEBRecipients();
  const el=document.getElementById('eb-count');
  if(el) el.textContent=`${emails.length} recipient${emails.length!==1?'s':''}`;
}

// Build the recipient filter: clients (all / accurate / by home meeting) + fundraiser lists
function populateEBFilter() {
  const sel = document.getElementById('eb-filter');
  if (!sel) return;
  const prev = sel.value;
  const meetings = clientHomeMeetings();
  const relsInUse = [...new Set(DB.fundContacts().map(c=>(c.relationship||'').trim()).filter(Boolean))].sort();
  sel.innerHTML = '<optgroup label="Clients">'
      + '<option value="all">All clients with email addresses</option>'
      + '<option value="accurate">Accurate confirmation only</option>'
      + meetings.map(m=>`<option value="meeting:${m.replace(/"/g,'&quot;')}">Home meeting: ${m}</option>`).join('')
    + '</optgroup>'
    + '<optgroup label="Fundraiser List">'
      + `<option value="fund-selected">Selected fundraiser contacts (${_fundEmailList.length})</option>`
      + '<option value="fundraisers">All fundraiser contacts</option>'
      + relsInUse.map(r=>`<option value="fund-rel:${r.replace(/"/g,'&quot;')}">Relationship: ${r}</option>`).join('')
    + '</optgroup>'
    + '<optgroup label="Custom"><option value="customize">✓ Customize — pick names from the directory</option></optgroup>';
  if ([...sel.options].some(o=>o.value===prev)) sel.value = prev;
}

// The sender's @tjcoregon.org address (from their profile). Picks the first
// tjcoregon.org address if several are listed.
function ebSenderEmail() {
  const s = myStaffRecord();
  const raw = (s && s.email) ? s.email : (isAdmin() ? 'chayes@tjcoregon.org' : '');
  const list = raw.split(/[,;\s]+/).filter(Boolean);
  return list.find(e => /@tjcoregon\.org$/i.test(e)) || list[0] || '';
}
function ebCanSend() { return /@tjcoregon\.org$/i.test(ebSenderEmail()); }

function updateEBPreview() {
  populateEBFilter();
  const isCustom = (document.getElementById('eb-filter')?.value === 'customize');
  const cl = document.getElementById('eb-customlist');
  if (cl) { cl.style.display = isCustom ? 'block' : 'none'; if (isCustom) renderEBCustomList(); }
  const emails = getEBRecipients();
  const el = document.getElementById('eb-count');
  if (el) el.textContent = `${emails.length} recipient${emails.length !== 1 ? 's' : ''}`;
  // From field + tjcoregon.org gate
  const from = ebSenderEmail();
  const fromEl = document.getElementById('eb-from');
  if (fromEl) fromEl.value = from || '(no email on file)';
  const warn = document.getElementById('eb-from-warn');
  if (warn) {
    if (!ebCanSend()) { warn.style.display='block'; warn.innerHTML = 'Email blasts must be sent from a <b>@tjcoregon.org</b> address. Add yours in <b>My Profile → Email</b>, then reopen this page.'; }
    else warn.style.display='none';
  }
}

function copyEBAddresses() {
  const emails = getEBRecipients();
  if (!emails.length) { showEBMsg('warn', '⚠️ No email addresses found for the selected filter.'); return; }
  navigator.clipboard.writeText(emails.join(', ')).then(() => {
    showEBMsg('success', `✅ Copied ${emails.length} email addresses to clipboard. Paste into BCC in Gmail or Outlook.`);
  }).catch(() => {
    // Fallback: show in a textarea
    const ta = document.createElement('textarea');
    ta.value = emails.join(', ');
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showEBMsg('success', `✅ Copied ${emails.length} email addresses to clipboard.`);
  });
}

function openEBGmail() {
  if (!ebCanSend()) { showEBMsg('warn', '⚠️ You can only send a blast from a @tjcoregon.org address. Add yours in My Profile → Email.'); return; }
  const emails = getEBRecipients();
  if (!emails.length) { showEBMsg('warn', '⚠️ No email addresses found for the selected recipients.'); return; }
  const subject = document.getElementById('eb-subject').value.trim();
  const body    = document.getElementById('eb-body').value.trim();
  if (!subject) { showEBMsg('warn', '⚠️ Please enter a subject.'); return; }
  const from = ebSenderEmail();
  // Gmail web compose handles long BCC lists (unlike mailto:'s ~2000-char cap)
  const url = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1'
    + '&bcc=' + encodeURIComponent(emails.join(','))
    + '&su='  + encodeURIComponent(subject)
    + '&body='+ encodeURIComponent(body);
  window.open(url, '_blank');
  showEBMsg('success', `✅ Opening Gmail with all ${emails.length} recipients in BCC — review and click Send. Make sure the account shown is <b>${fEsc(from)}</b>.`);
}

function openEBMailto() {
  if (!ebCanSend()) { showEBMsg('warn', '⚠️ You can only send a blast from a @tjcoregon.org address. Add yours in My Profile → Email.'); return; }
  const emails = getEBRecipients();
  if (!emails.length) { showEBMsg('warn', '⚠️ No email addresses found.'); return; }
  const subject = document.getElementById('eb-subject').value.trim();
  const body    = document.getElementById('eb-body').value.trim();
  if (!subject) { showEBMsg('warn', '⚠️ Please enter a subject.'); return; }
  // mailto: has browser URL limits ~2000 chars — warn if large
  const bcc = emails.join(',');
  const url = `mailto:?from=${encodeURIComponent(ebSenderEmail())}&bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (url.length > 2000) {
    showEBMsg('warn', `⚠️ Too many recipients (${emails.length}) for the default mail app. Use <b>Open in Gmail</b> instead — it has no size limit.`);
    return;
  }
  window.open(url, '_blank');
  showEBMsg('success', '✅ Opening your email app…');
}

function showEBMsg(type, html) {
  const el = document.getElementById('eb-msg');
  el.className = `alert alert-${type}`;
  el.innerHTML = html;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 8000);
}

document.getElementById('client-modal').addEventListener('click', function(e) {
  if (e.target === this) closeClientModal();
});
document.getElementById('fund-modal').addEventListener('click', function(e) {
  if (e.target === this) closeContactModal();
});
document.getElementById('fund-detail').addEventListener('click', function(e) {
  if (e.target === this) closeContactDetail();
});
document.getElementById('dash-modal').addEventListener('click', function(e) {
  if (e.target === this) closeDashboardConfig();
});
document.getElementById('mymetrics-modal').addEventListener('click', function(e) {
  if (e.target === this) closeMyMetricsConfig();
});
document.getElementById('task-modal').addEventListener('click', function(e) {
  if (e.target === this) closeTaskModal();
});
document.getElementById('cal-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCalEvent();
});
document.getElementById('cal-detail').addEventListener('click', function(e) {
  if (e.target === this) closeCalDetail();
});
document.getElementById('rj-modal').addEventListener('click', function(e) {
  if (e.target === this) closeRJCase();
});
document.getElementById('sp-modal').addEventListener('click', function(e) {
  if (e.target === this) closeServicePlan();
});
document.getElementById('msg-modal').addEventListener('click', function(e) {
  if (e.target === this) closeMentorMessages();
});
document.getElementById('mtask-modal').addEventListener('click', function(e) {
  if (e.target === this) closeMentorTasks();
});
document.getElementById('staff-modal').addEventListener('click', function(e) {
  if (e.target === this) closeStaffModal();
});
document.getElementById('planner-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAIPlanner();
});

// NEEDS ASSESSMENT — form handlers and list/print renderers
export { getEBRecipients, renderEBCustomList, ebCustCheckAll, updateEBCount,
  updateEBPreview, copyEBAddresses, openEBGmail, openEBMailto };
