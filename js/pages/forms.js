import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';

// Form infrastructure accessed via window (defined in app.js)
const collData = (...a) => window.collData(...a);
const saveForm = (...a) => window.saveForm(...a);
const showFormSuccess = (...a) => window.showFormSuccess(...a);
// _formEditId and _erEditReceipts are app.js module-level state exposed via window
const _formEditId = new Proxy({}, {
  get: (_,k) => window._formEditId?.[k],
  set: (_,k,v) => { if (window._formEditId) window._formEditId[k] = v; return true; }
});
let _erEditReceipts = null; // local mirror; ER submit just needs to null it out

// FR_SECTIONS + renderFormReports + deleteReport
// Reports: every submitted form, with Edit (name-locked), Download, admin Delete
const FR_SECTIONS = [
  {key:'progress-note',    icon:'📝', title:'Progress Notes',     summary:r=>[fmtDate(getDate(r)), fEsc(r.clientName||r.participantName||''), fEsc(r.mentorName||'')]},
  {key:'activity-log',     icon:'📋', title:'Activity Logs',      summary:r=>[fmtDate(getDate(r)), fEsc(r.activityType||''), fEsc(r.mentorName||'')]},
  {key:'meetings',         icon:'🤝', title:'Meetings',           summary:r=>[fmtDate(r.meetingDate), fEsc(r.topic||''), fEsc(r.loggedBy||'')]},
  {key:'events',           icon:'📣', title:'Events / Social',    summary:r=>[fmtDate(r.eventDate), fEsc(r.title||''), fEsc(r.postedBy||'')]},
  {key:'needs-assessment', icon:'📑', title:'Needs Assessments',  summary:r=>[fmtDate(r.date), fEsc(r.participantName||''), fEsc(r.referredBy||'')], download:'printNA'},
  {key:'expense-report',   icon:'🧾', title:'Expense Reports',    summary:r=>[fEsc(r.employeeName||''), fEsc(r.businessPurpose||''), '$'+(r.totalReimbursement||0).toFixed(2)], download:'printER'},
];
function renderFormReports() {
  const host = document.getElementById('fr-all');
  if (!host) return;
  host.innerHTML = FR_SECTIONS.map(sec=>{
    const def = window.FORM_DEF[sec.key];
    let rows = collData(def.coll).slice().reverse();
    if (!isAdmin()) rows = rows.filter(r => ((r._owner||r[def.submitter])||'') === currentUserName());  // staff see only their own
    const body = !rows.length ? '<p style="color:#bbb;font-size:0.85em;">None submitted yet.</p>' :
      `<div class="table-wrap"><table>
        <tbody>${rows.map(r=>{
          const cells = sec.summary(r).map(c=>`<td style="font-size:0.86em;">${c||'<span style=color:#bbb>—</span>'}</td>`).join('');
          const dl = sec.download ? `<button class="btn btn-outline" style="padding:4px 9px;font-size:0.74em;white-space:nowrap;" onclick="${sec.download}('${r._id}')">⬇️ PDF</button>` : '';
          return `<tr>${cells}
            <td style="white-space:nowrap;text-align:right;">
              ${dl}
              <button class="btn btn-outline" style="padding:4px 9px;font-size:0.74em;" onclick="editForm('${sec.key}','${r._id}')">✏️ Edit</button>
              <button class="btn btn-danger" style="padding:4px 9px;font-size:0.74em;" onclick="deleteReport('${def.coll}','${r._id}')">🗑</button>
            </td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
    return `<div class="card" style="margin-bottom:16px;"><h3>${sec.icon} ${sec.title} <span style="color:#bbb;font-weight:400;font-size:0.8em;">(${rows.length})</span></h3>${body}</div>`;
  }).join('');
}

// Admin-only: permanently delete a report
function deleteReport(coll, id){
  requireAdmin(async ()=>{
    if(!confirm('Delete this report permanently? This cannot be undone.')) return;
    await DB.removeRecord(coll, id);
    renderFormReports();
  });
}


// Needs Assessment list and print
function renderNAList() {
  const list = DB.needsAssessments();
  const el = document.getElementById('na-list');
  if (!list.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No assessments submitted yet.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Participant</th><th>Assistance Type</th><th>Amount</th><th>Submitted</th><th></th></tr></thead>
    <tbody>${list.slice().reverse().map(n=>`<tr>
      <td>${fmtDate(n.date)||'—'}</td>
      <td>${n.participantName||'—'}</td>
      <td>${n.assistanceType||'—'}</td>
      <td>${n.amountRequested?'$'+parseFloat(n.amountRequested).toFixed(2):'—'}</td>
      <td style="color:#999;font-size:0.82em;">${new Date(n.submittedAt).toLocaleDateString()}</td>
      <td><button class="btn btn-outline" style="padding:4px 10px;font-size:0.78em;" onclick="printNA('${n._id}')">🖨 Print</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function printNA(id) {
  const n = DB.needsAssessments().find(x=>x._id===id);
  if (!n) return;
  const html = `
    <div class="na-print-doc">
      <div class="na-print-header">
        <h1>Reentry Needs Assessment Form</h1>
        <p>ReGroup Elite Squad</p>
      </div>
      <table class="na-info-table">
        <tr><td><b>Date:</b></td><td>${fmtDate(n.date)||'_____________'}</td><td><b>Participant Name:</b></td><td>${n.participantName||'_____________'}</td></tr>
        <tr><td><b>Contact Info:</b></td><td colspan="3">${n.contactInfo||'_____________'}</td></tr>
      </table>
      <div class="na-section">
        <div class="na-section-title">Section 1 — Type of Assistance Requested</div>
        <div class="na-checkbox-grid">${ASSISTANCE_TYPES.map(t=>`
          <div class="na-cb-item"><span class="na-cb ${n.assistanceType===t?'na-cb-checked':''}"></span> ${t}</div>
        `).join('')}</div>
      </div>
      <div class="na-section">
        <div class="na-section-title">Section 2 — Description of Need</div>
        <div class="na-text-box">${n.descriptionOfNeed||''}</div>
      </div>
      <div class="na-section">
        <div class="na-section-title">Section 3 — Total Monetary Amount Requested</div>
        <p style="margin:8px 0;"><b>$</b> ${n.amountRequested?parseFloat(n.amountRequested).toFixed(2):'_____________'}</p>
      </div>
      <div class="na-section">
        <div class="na-section-title">Section 4 — Supporting Information</div>
        <div class="na-text-box">${n.supportingInfo||''}</div>
      </div>
      <div class="na-section">
        <div class="na-section-title">Section 5 — Referral &amp; Time Sensitivity</div>
        <table class="na-info-table">
          <tr><td><b>Referred By:</b></td><td>${n.referredBy||'_____________'}</td><td><b>Date of Referral:</b></td><td>${fmtDate(n.referralDate)||'_____________'}</td></tr>
          <tr><td><b>Response Needed By:</b></td><td colspan="3">${fmtDate(n.responseNeededBy)||'_____________'}</td></tr>
        </table>
      </div>
      <div class="na-sig-row">
        <div><div class="na-sig-line"></div><div class="na-sig-label">PARTICIPANT SIGNATURE</div></div>
        <div><div class="na-sig-line"></div><div class="na-sig-label">DATE</div></div>
        <div><div class="na-sig-line"></div><div class="na-sig-label">MENTOR / STAFF SIGNATURE</div></div>
        <div><div class="na-sig-line"></div><div class="na-sig-label">DATE</div></div>
      </div>
    </div>`;
  printDoc(html);
}

// EXPENSE REPORT — row management, handlers, list/print renderers

// Expense Report row management, list, print
function addERRow() {
  const cats = ER_CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" name="er_date[]" style="width:120px;border:1px solid #ddd;border-radius:6px;padding:5px;font-size:0.85em;"></td>
    <td><input type="text" name="er_desc[]" placeholder="Description" style="width:100%;border:1px solid #ddd;border-radius:6px;padding:5px;font-size:0.85em;"></td>
    <td><select name="er_cat[]" style="width:100%;border:1px solid #ddd;border-radius:6px;padding:5px;font-size:0.85em;"><option value="">Select…</option>${cats}</select></td>
    <td><input type="number" name="er_cost[]" placeholder="0.00" min="0" step="0.01" style="width:90px;border:1px solid #ddd;border-radius:6px;padding:5px;font-size:0.85em;" oninput="updateERTotal()"></td>
    <td><button type="button" onclick="this.closest('tr').remove();updateERTotal();" style="background:none;border:none;color:#e53935;cursor:pointer;font-size:1.1em;padding:4px;">✕</button></td>`;
  document.getElementById('er-items-body').appendChild(row);
}

function updateERTotal() {
  const costs = [...document.querySelectorAll('#er-items-body [name="er_cost[]"]')].map(i=>parseFloat(i.value)||0);
  const subtotal = costs.reduce((s,v)=>s+v,0);
  const advance = parseFloat(document.querySelector('#er-form [name="cashAdvance"]')?.value)||0;
  const total = Math.max(0, subtotal - advance);
  const el = document.getElementById('er-total-display');
  if (el) el.value = `$${total.toFixed(2)}  (Subtotal: $${subtotal.toFixed(2)})`;
}

// Compress an image File to a JPEG data URL via canvas, capped to maxDim px.
function compressImage(file, maxDim=1280, quality=0.7){
  return new Promise((resolve,reject)=>{
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('“'+file.name+'” is not an image.')); return; }
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Could not read '+file.name));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Invalid image: '+file.name));
      img.onload=()=>{
        let w=img.width, h=img.height;
        if (w>maxDim || h>maxDim){ const s=Math.min(maxDim/w, maxDim/h); w=Math.round(w*s); h=Math.round(h*s); }
        const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Read multiple images compressed, with count + total-size guards (Firestore 1MB doc cap).
async function readImagesCompressed(files, {maxDim=1280, quality=0.7, maxCount=8, maxTotalKB=850}={}){
  const arr=[...files].slice(0, maxCount);
  const out=[]; let totalKB=0;
  for (const f of arr){
    const url=await compressImage(f, maxDim, quality);
    totalKB += Math.round(url.length/1024);
    out.push(url);
  }
  if (totalKB > maxTotalKB) throw new Error('Photos are too large (~'+totalKB+'KB). Use fewer or smaller images (limit ~'+maxTotalKB+'KB total).');
  return out;
}

document.getElementById('er-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('[type="submit"]');
  btn.textContent = 'Saving…'; btn.disabled = true;
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

function renderERList() {
  const list = DB.expenseReports();
  const el = document.getElementById('er-list');
  if (!list.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No expense reports submitted yet.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Employee</th><th>Period</th><th>Purpose</th><th>Total</th><th>Submitted</th><th></th></tr></thead>
    <tbody>${list.slice().reverse().map(r=>`<tr>
      <td>${r.employeeName||'—'}</td>
      <td>${r.periodFrom?fmtDate(r.periodFrom)+' – '+fmtDate(r.periodTo):'—'}</td>
      <td>${r.businessPurpose||'—'}${r.receipts&&r.receipts.length?` <span class="badge badge-info" title="Receipts attached">🧾 ${r.receipts.length}</span>`:''}</td>
      <td><b>$${(r.totalReimbursement||0).toFixed(2)}</b></td>
      <td style="color:#999;font-size:0.82em;">${new Date(r.submittedAt).toLocaleDateString()}</td>
      <td><button class="btn btn-outline" style="padding:4px 10px;font-size:0.78em;" onclick="printER('${r._id}')">🖨 Print</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function printER(id) {
  const r = DB.expenseReports().find(x=>x._id===id);
  if (!r) return;
  const itemRows = (r.items||[]).map(item=>`
    <tr>
      <td>${fmtDate(item.date)||''}</td>
      <td>${item.description||''}</td>
      <td>${item.category||''}</td>
      <td class="right">$${(item.cost||0).toFixed(2)}</td>
    </tr>`).join('');
  const html = `
    <div class="er-print-doc">
      <div class="er-print-header">
        <h1>Expense Reimbursement Form</h1>
        <p>ReGroup Elite Squad &nbsp;·&nbsp; <em>Don't forget to attach receipts! Mileage reimbursement = $0.70/mile</em></p>
      </div>
      <table class="er-info-table">
        <tr><td><b>Name:</b></td><td>${r.employeeName||'_____________'}</td><td><b>Business Purpose:</b></td><td>${r.businessPurpose||'_____________'}</td></tr>
        <tr><td><b>Period From:</b></td><td>${fmtDate(r.periodFrom)||'_____________'}</td><td><b>Period To:</b></td><td>${fmtDate(r.periodTo)||'_____________'}</td></tr>
      </table>
      <table class="er-items-table">
        <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="right">Cost</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="er-totals">
        <div class="er-total-row"><span>Subtotal</span><span>$${(r.subtotal||0).toFixed(2)}</span></div>
        <div class="er-total-row"><span>Less Cash Advance</span><span>($${(r.cashAdvance||0).toFixed(2)})</span></div>
        <div class="er-total-row er-grand-total"><span>Total Reimbursement</span><span>$${(r.totalReimbursement||0).toFixed(2)}</span></div>
      </div>
      <div class="er-sig-row">
        <div>
          <div class="er-sig-line"></div>
          <div class="er-sig-label">EMPLOYEE SIGNATURE</div>
          <div class="er-sig-line" style="margin-top:8px;width:140px;"></div>
          <div class="er-sig-label">DATE</div>
        </div>
        <div>
          <div class="er-sig-line"></div>
          <div class="er-sig-label">APPROVAL SIGNATURE</div>
          <div class="er-sig-line" style="margin-top:8px;width:140px;"></div>
          <div class="er-sig-label">DATE</div>
        </div>
      </div>
      ${(r.receipts && r.receipts.length) ? `<div style="margin-top:22px;page-break-before:always;">
        <h2 style="font-size:13pt;margin-bottom:10px;">Attached Receipts (${r.receipts.length})</h2>
        ${r.receipts.map((src,i)=>`<div style="page-break-inside:avoid;margin-bottom:14px;"><div style="font-size:9pt;color:#666;margin-bottom:4px;">Receipt ${i+1}</div><img src="${src}" style="max-width:100%;max-height:8in;border:1px solid #ccc;"></div>`).join('')}
      </div>` : ''}
    </div>`;
  printDoc(html);
}

// Render arbitrary HTML into the top-level print root and open the print dialog.
function printDoc(html){
  const root = document.getElementById('print-root');
  if (!root) { window.print(); return; }
  root.innerHTML = html;
  // Clear only once printing is finished — never on a blind timer (so the
  // document can't get wiped while the print dialog is still open).
  const clear = () => { root.innerHTML=''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  setTimeout(()=>window.print(), 120);
}

// Download the built timesheet (copies the on-screen output into the print root)
function printTimesheet(){
  const out = document.getElementById('timesheet-output');
  if (!out || !out.innerHTML.trim()) { alert('Build the timesheet first.'); return; }
  printDoc(out.innerHTML);
}


export { renderFormReports, deleteReport, renderNAList, printNA,
  renderERList, printER, addERRow, updateERTotal, compressImage, readImagesCompressed };