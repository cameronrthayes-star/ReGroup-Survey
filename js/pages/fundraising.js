import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
export let _fundDetailId = null;
let _fundEmailList = [];   // fundraising contact ids selected for an email blast
const FUND_FOLLOWUP_DAYS = 90;  // remind to reach out after ~3 months
const FUND_RELATIONSHIPS = ['Donor','Major Donor','Prospect','Board Member','Volunteer','Partner Org','Grantor','Community Member','Vendor','Other'];

function fEsc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtMoney(n){ const v=Number(n)||0; return '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function injectExamplePanels(){
  const panels = {
    'view-progress-note': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: completed progress note</h3>
        <p>Use the real client, mentor, service date, and default grant. A strong DAP note is specific, factual, and ends with the next step.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Mentor / client</strong>Cameron Hayes · Client #1241 · ReGroup Office</div>
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
          <div class="example-mini"><strong>Time</strong>9:30 AM - 10:15 AM · 0.75 hours</div>
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
          <div class="example-mini"><strong>Client</strong>Jordan R. · #1241 · Primary mentor: Steven Chambers</div>
          <div class="example-mini"><strong>Need areas</strong>Housing, Employment, ID documents, Transportation</div>
          <div class="example-mini"><strong>Goal</strong>Secure two job interviews by 07/15/2026 · In progress</div>
          <div class="example-mini"><strong>Next step</strong>Mentor helps client upload resume and apply to two warehouse roles.</div>
        </div>
      </div>`,
    'view-grants': `
      <div class="example-panel no-print" data-example-panel>
        <h3>How the grants agent works</h3>
        <p>Give the agent the project idea, population, geography, amount, timeline, and funding types. It searches broadly beyond reentry grants, then sends the matching opportunities and a funding strategy to your inbox and the admin inbox.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Input example</strong>Mobile reentry resource fair · $35,000 · Portland metro · 6-month launch.</div>
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
          <div class="example-mini"><strong>ID / name</strong>#1241 · Jordan Reed</div>
          <div class="example-mini"><strong>Relationship</strong>Client · Home meeting: Monday Night Group</div>
          <div class="example-mini"><strong>Contact</strong>jordan@example.org · 503-555-0141</div>
          <div class="example-mini"><strong>Notes</strong>Release 06/20/2026; prefers text; needs ID follow-up.</div>
        </div>
      </div>`,
    'view-fundraising': `
      <div class="example-panel no-print" data-example-panel>
        <h3>Example: fundraising CRM contact</h3>
        <p>Use fundraising contacts separately from the general directory. Log giving history, relationship category, shared contacts, notes, and the last meaningful call/email/meeting.</p>
        <div class="example-grid">
          <div class="example-mini"><strong>Contact</strong>Maria Lopez · Prospect · Credit union community fund</div>
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
          <div class="example-mini"><strong>Project</strong>Spring Reentry Job Fair · Active · Owner: Program Manager</div>
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
          <div class="example-mini"><strong>Staff</strong>Steven Chambers · CVI grant</div>
          <div class="example-mini"><strong>Expense line</strong>06/21/2026 · bus passes · $48.00 · client transportation</div>
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

function fundLastContact(c){
  // "Last contact" reflects only actual logged interactions — NOT the date the
  // record was created. A contact with no interactions has never been contacted.
  const dates = (c.interactions||[]).map(i=>i.date).filter(Boolean);
  return dates.length ? dates.sort().slice(-1)[0] : '';
}
function fundDaysSince(dateStr){
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function fundNeedsFollowup(c){ return fundDaysSince(fundLastContact(c)) > FUND_FOLLOWUP_DAYS; }
function fundGiftTotal(c){ return (c.gifts||[]).reduce((s,g)=>s+(Number(g.amount)||0),0); }
function fundRelative(dateStr){
  const days = fundDaysSince(dateStr);
  if (days === Infinity) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return days+' days ago';
  return Math.round(days/30)+' months ago';
}

function renderFundraising(){
  const q = (document.getElementById('fund-search')?.value || '').toLowerCase();
  const filter = document.getElementById('fund-filter')?.value || 'all';
  // populate + read the relationship filter
  const relSel = document.getElementById('fund-rel-filter');
  if (relSel) {
    const prev = relSel.value;
    relSel.innerHTML = '<option value="">All relationships</option>' + FUND_RELATIONSHIPS.map(r=>`<option ${r===prev?'selected':''}>${r}</option>`).join('');
    relSel.value = prev;
  }
  const relFilter = relSel ? relSel.value : '';
  const all = DB.fundContacts();
  let list = all.slice();
  if (q) {
    list = list.filter(c => {
      const name = ((c.firstName||'')+' '+(c.lastName||'')).toLowerCase();
      return name.includes(q) || (c.org||'').toLowerCase().includes(q) ||
             (c.email||'').toLowerCase().includes(q) || (c.phone||'').includes(q) ||
             (c.tags||'').toLowerCase().includes(q) || (c.notes||'').toLowerCase().includes(q);
    });
  }
  if (filter === 'followup') list = list.filter(fundNeedsFollowup);
  else if (filter === 'donors') list = list.filter(c => fundGiftTotal(c) > 0);
  if (relFilter) list = list.filter(c => (c.relationship||'') === relFilter);
  // Sort: needs-followup first, then by most-overdue
  list.sort((a,b)=> fundDaysSince(fundLastContact(b)) - fundDaysSince(fundLastContact(a)));

  const banner = document.getElementById('fund-followup-banner');
  const due = all.filter(fundNeedsFollowup).length;
  if (banner) {
    if (due) { banner.style.display='block'; banner.innerHTML = `⏰ <strong>${due}</strong> contact${due>1?'s have':' has'} had no contact in 3+ months — time to call, email, or meet. <a href="#" onclick="document.getElementById('fund-filter').value='followup';renderFundraising();return false;" style="color:#9a3412;text-decoration:underline;">Show them</a>`; }
    else banner.style.display='none';
  }
  const countEl = document.getElementById('fund-count');
  if (countEl) countEl.textContent = `${list.length} of ${all.length} contacts`;

  const wrap = document.getElementById('fund-table-wrap');
  if (!wrap) return;
  if (!all.length) { wrap.innerHTML = '<p style="color:#bbb;font-size:0.875em;">No contacts yet. Click “+ Add Contact” to start your fundraising list.</p>'; return; }
  if (!list.length) { wrap.innerHTML = '<p style="color:#bbb;font-size:0.875em;">No contacts match your search/filter.</p>'; return; }

  wrap.innerHTML = `<table>
    <thead><tr>
      <th style="width:30px"></th>
      <th>Name</th><th>Organization</th><th style="width:90px">Type</th><th style="width:120px">Relationship</th>
      <th style="width:110px">Last contact</th><th style="width:90px">Giving</th><th style="width:130px">Status</th>
    </tr></thead>
    <tbody>${list.map(c=>{
      const name = [c.firstName,c.lastName].filter(Boolean).join(' ') || '<span style="color:#bbb">—</span>';
      const total = fundGiftTotal(c);
      const follow = fundNeedsFollowup(c);
      const status = follow ? '<span class="badge badge-warn">⚠ Follow up</span>' : '<span class="badge badge-success">✓ Recent</span>';
      const checked = _fundEmailList.includes(c._id) ? 'checked' : '';
      return `<tr style="cursor:pointer;" onclick="openContactDetail('${c._id}')">
        <td onclick="event.stopPropagation()" style="text-align:center;"><input type="checkbox" class="fund-cb" value="${c._id}" ${checked} onchange="updateFundCheckedCount()"></td>
        <td style="font-weight:600;color:var(--primary);">${fEsc(name)}</td>
        <td style="font-size:0.85em;color:#555;">${fEsc(c.org)||'—'}</td>
        <td>${c.type?`<span class="badge badge-info">${fEsc(c.type)}</span>`:'—'}</td>
        <td style="font-size:0.82em;">${c.relationship?fEsc(c.relationship):'—'}</td>
        <td style="font-size:0.82em;color:${follow?'#c2410c':'#555'};">${fundRelative(fundLastContact(c))}</td>
        <td style="font-size:0.85em;font-weight:600;color:${total>0?'#43a047':'#bbb'};">${total>0?fmtMoney(total):'—'}</td>
        <td>${status}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
  updateFundCheckedCount();
}

// Selection helpers for the fundraising checkboxes
function updateFundCheckedCount(){
  const n = document.querySelectorAll('.fund-cb:checked').length;
  const el = document.getElementById('fund-checked-count');
  if (el) el.textContent = n ? '('+n+')' : '';
}
function checkAllFund(){
  document.querySelectorAll('.fund-cb').forEach(cb=>cb.checked=true);
  updateFundCheckedCount();
}
function clearFundChecks(){
  _fundEmailList = [];
  document.querySelectorAll('.fund-cb').forEach(cb=>cb.checked=false);
  updateFundCheckedCount();
}
function emailCheckedFund(){
  const ids = [...document.querySelectorAll('.fund-cb:checked')].map(cb=>cb.value);
  const withEmail = ids.filter(id => { const c=DB.fundContacts().find(x=>x._id===id); return c && c.email && c.email.trim(); });
  if (!ids.length){ alert('Check at least one contact first (or use “Check all”).'); return; }
  if (!withEmail.length){ alert('None of the checked contacts have an email address on file.'); return; }
  _fundEmailList = withEmail;
  navigate('email-blast');
  const sel = document.getElementById('eb-filter');
  if (sel){ updateEBPreview(); sel.value='fund-selected'; updateEBPreview(); }
}

function openContactModal(id){
  const modal = document.getElementById('fund-modal');
  // populate relationship options
  const relSel = document.getElementById('fm-relationship');
  if (relSel) relSel.innerHTML = '<option value="">—</option>' + FUND_RELATIONSHIPS.map(r=>`<option>${r}</option>`).join('');
  if (id) {
    const c = DB.fundContacts().find(x=>x._id===id);
    if (!c) return;
    document.getElementById('fund-modal-title').textContent = 'Edit Contact';
    document.getElementById('fm-id').value = id;
    document.getElementById('fm-firstName').value = c.firstName||'';
    document.getElementById('fm-lastName').value = c.lastName||'';
    document.getElementById('fm-org').value = c.org||'';
    document.getElementById('fm-type').value = c.type||'';
    document.getElementById('fm-relationship').value = c.relationship||'';
    document.getElementById('fm-email').value = c.email||'';
    document.getElementById('fm-phone').value = c.phone||'';
    document.getElementById('fm-address').value = c.address||'';
    document.getElementById('fm-tags').value = c.tags||'';
    document.getElementById('fm-commonContacts').value = c.commonContacts||'';
    document.getElementById('fm-notes').value = c.notes||'';
  } else {
    document.getElementById('fund-modal-title').textContent = 'Add Contact';
    document.getElementById('fm-id').value = '';
    ['fm-firstName','fm-lastName','fm-org','fm-email','fm-phone','fm-address','fm-tags','fm-commonContacts','fm-notes'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('fm-type').value = '';
    document.getElementById('fm-relationship').value = '';
  }
  modal.style.display = 'flex';
}
function closeContactModal(){ document.getElementById('fund-modal').style.display = 'none'; }

async function saveFundContact(){
  const id = document.getElementById('fm-id').value;
  const data = {
    firstName: document.getElementById('fm-firstName').value.trim(),
    lastName: document.getElementById('fm-lastName').value.trim(),
    org: document.getElementById('fm-org').value.trim(),
    type: document.getElementById('fm-type').value,
    relationship: document.getElementById('fm-relationship').value,
    email: document.getElementById('fm-email').value.trim(),
    phone: document.getElementById('fm-phone').value.trim(),
    address: document.getElementById('fm-address').value.trim(),
    tags: document.getElementById('fm-tags').value.trim(),
    commonContacts: document.getElementById('fm-commonContacts').value.trim(),
    notes: document.getElementById('fm-notes').value.trim(),
  };
  if (!data.firstName && !data.lastName && !data.org) { alert('Enter at least a name or organization.'); return; }
  if (id) {
    await DB.updateFundContact(id, data);   // merge — preserves interactions/gifts
  } else {
    await DB.addFundContact({...data, interactions:[], gifts:[], createdDate:new Date().toISOString().slice(0,10)});
  }
  closeContactModal();
  if (id && _fundDetailId === id) renderContactDetail(id);
}

function openContactDetail(id){
  const c = DB.fundContacts().find(x=>x._id===id);
  if (!c) return;
  _fundDetailId = id;
  document.getElementById('fund-detail').style.display = 'flex';
  const today = new Date().toISOString().slice(0,10);
  const di = document.getElementById('fd-int-date'); if (di) di.value = today;
  const dg = document.getElementById('fd-gift-date'); if (dg) dg.value = today;
  renderContactDetail(id);
}
function closeContactDetail(){ document.getElementById('fund-detail').style.display='none'; _fundDetailId = null; }

function renderContactDetail(id){
  const c = DB.fundContacts().find(x=>x._id===id);
  if (!c) { closeContactDetail(); return; }
  const name = [c.firstName,c.lastName].filter(Boolean).join(' ') || c.org || 'Contact';
  const follow = fundNeedsFollowup(c);
  const last = fundLastContact(c);
  document.getElementById('fd-header').innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="font-size:1.3em;font-weight:700;color:var(--primary);">${fEsc(name)}</div>
        ${c.org && (c.firstName||c.lastName) ? `<div style="color:#666;font-size:0.9em;">${fEsc(c.org)}</div>`:''}
        <div style="margin-top:4px;">${c.type?`<span class="badge badge-info">${fEsc(c.type)}</span> `:''}${follow?'<span class="badge badge-warn">⚠ Follow up — 3+ mo</span>':'<span class="badge badge-success">✓ Recently contacted</span>'}</div>
      </div>
      <div style="text-align:right;font-size:0.8em;color:#888;">
        <div>Last contact: <strong style="color:${follow?'#c2410c':'#555'};">${fundRelative(last)}</strong></div>
        <div>Total giving: <strong style="color:#43a047;">${fmtMoney(fundGiftTotal(c))}</strong></div>
      </div>
    </div>`;

  const infoRow = (label,val)=> val ? `<div style="margin-bottom:6px;"><span style="color:#999;font-size:0.78em;">${label}: </span><span style="font-size:0.9em;">${fEsc(val)}</span></div>` : '';
  document.getElementById('fd-body').innerHTML =
    `<div style="background:#f8f9fa;border-radius:10px;padding:14px;margin-top:10px;">
      ${infoRow('Email', c.email)}${infoRow('Phone', c.phone)}${infoRow('Address', c.address)}
      ${c.tags?`<div style="margin:6px 0;">${c.tags.split(',').map(t=>t.trim()).filter(Boolean).map(t=>`<span class="badge badge-info" style="margin-right:4px;">${fEsc(t)}</span>`).join('')}</div>`:''}
      ${c.commonContacts?`<div style="margin-top:8px;"><span style="color:#999;font-size:0.78em;">Common contacts: </span><div style="font-size:0.88em;white-space:pre-wrap;">${fEsc(c.commonContacts)}</div></div>`:''}
      ${c.notes?`<div style="margin-top:8px;"><span style="color:#999;font-size:0.78em;">Notes: </span><div style="font-size:0.88em;white-space:pre-wrap;">${fEsc(c.notes)}</div></div>`:''}
      ${!c.email&&!c.phone&&!c.address&&!c.tags&&!c.commonContacts&&!c.notes?'<span style="color:#bbb;font-size:0.85em;">No details yet — use “Edit Details” to add them.</span>':''}
    </div>`;

  const ints = (c.interactions||[]).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('fd-interactions').innerHTML = ints.length ? ints.map(i=>
    `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:0.86em;">
      <div><span class="badge badge-info" style="margin-right:6px;">${fEsc(i.method||'Note')}</span><strong>${i.date?fmtDate(i.date):''}</strong> — ${fEsc(i.summary)} ${i.by?`<span style="color:#bbb;">(${fEsc(i.by)})</span>`:''}</div>
      <button title="Delete (admin)" onclick="deleteInteraction('${i.id}')" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:1.1em;line-height:1;">×</button>
    </div>`).join('') : '<p style="color:#bbb;font-size:0.83em;">No interactions logged yet.</p>';

  const gifts = (c.gifts||[]).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('fd-gift-total').textContent = gifts.length ? '· '+fmtMoney(fundGiftTotal(c))+' total' : '';
  document.getElementById('fd-gifts').innerHTML = gifts.length ? gifts.map(g=>
    `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:0.86em;">
      <div><strong style="color:#43a047;">${fmtMoney(g.amount)}</strong> ${g.date?`<span style="color:#888;">${fmtDate(g.date)}</span>`:''} ${g.fund?`<span class="badge badge-info">${fEsc(g.fund)}</span>`:''} ${g.note?`— ${fEsc(g.note)}`:''}</div>
      <button title="Delete (admin)" onclick="deleteGift('${g.id}')" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:1.1em;line-height:1;">×</button>
    </div>`).join('') : '<p style="color:#bbb;font-size:0.83em;">No gifts recorded yet.</p>';
}

async function addInteraction(){
  if (!_fundDetailId) return;
  const c = DB.fundContacts().find(x=>x._id===_fundDetailId); if (!c) return;
  const date = document.getElementById('fd-int-date').value;
  const method = document.getElementById('fd-int-method').value;
  const summary = document.getElementById('fd-int-summary').value.trim();
  if (!summary && !date) { alert('Add a date or a summary for the interaction.'); return; }
  const entry = {id:uuid(), date, method, summary};
  const interactions = [...(c.interactions||[]), entry];
  await DB.updateFundContact(_fundDetailId, {interactions});
  document.getElementById('fd-int-summary').value = '';
  renderContactDetail(_fundDetailId);
}
function deleteInteraction(entryId){
  if (!_fundDetailId) return;
  requireAdmin(async ()=>{
    if (!confirm('Delete this interaction? This cannot be undone.')) return;
    const c = DB.fundContacts().find(x=>x._id===_fundDetailId); if (!c) return;
    const interactions = (c.interactions||[]).filter(i=>i.id!==entryId);
    await DB.updateFundContact(_fundDetailId, {interactions});
    renderContactDetail(_fundDetailId);
  });
}

async function addGift(){
  if (!_fundDetailId) return;
  const c = DB.fundContacts().find(x=>x._id===_fundDetailId); if (!c) return;
  const date = document.getElementById('fd-gift-date').value;
  const amount = parseFloat(document.getElementById('fd-gift-amount').value);
  const fund = document.getElementById('fd-gift-fund').value.trim();
  const note = document.getElementById('fd-gift-note').value.trim();
  if (!(amount > 0)) { alert('Enter a gift amount greater than 0.'); return; }
  const entry = {id:uuid(), date, amount, fund, note};
  const gifts = [...(c.gifts||[]), entry];
  await DB.updateFundContact(_fundDetailId, {gifts});
  document.getElementById('fd-gift-amount').value = '';
  document.getElementById('fd-gift-fund').value = '';
  document.getElementById('fd-gift-note').value = '';
  renderContactDetail(_fundDetailId);
}
function deleteGift(entryId){
  if (!_fundDetailId) return;
  requireAdmin(async ()=>{
    if (!confirm('Delete this gift record? This cannot be undone.')) return;
    const c = DB.fundContacts().find(x=>x._id===_fundDetailId); if (!c) return;
    const gifts = (c.gifts||[]).filter(g=>g.id!==entryId);
    await DB.updateFundContact(_fundDetailId, {gifts});
    renderContactDetail(_fundDetailId);
  });
}

function editContactDetails(){ if (!_fundDetailId) return; requireAdmin(()=>openContactModal(_fundDetailId)); }
function deleteFundContact(){
  if (!_fundDetailId) return;
  requireAdmin(async ()=>{
    if (!confirm('Delete this contact and all their logged interactions and gifts? This cannot be undone.')) return;
    await DB.removeFundContact(_fundDetailId);
    closeContactDetail();
  });
}

export { renderFundraising, openContactModal, closeContactModal, saveFundContact,
  openContactDetail, closeContactDetail, renderContactDetail, addInteraction, deleteInteraction,
  addGift, deleteGift, editContactDetails, deleteFundContact,
  updateFundCheckedCount, checkAllFund, clearFundChecks, emailCheckedFund,
  injectExamplePanels };
