import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
const PAY_ANCHOR = '2026-06-12';   // a known 14-day pay-cycle start
function populateTsCycles() {
  const sel = document.getElementById('ts-start');
  if (!sel) return;
  const anchor = new Date(PAY_ANCHOR + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const curIdx = Math.floor((today - anchor) / (14*86400000));
  let opts = '';
  for (let i = curIdx + 2; i >= curIdx - 12; i--) {
    const s = new Date(anchor); s.setDate(anchor.getDate() + i*14);
    const e = new Date(s); e.setDate(s.getDate() + 13);
    const sv = s.toISOString().slice(0,10);
    const label = fmtDate(sv) + ' – ' + fmtDate(e.toISOString().slice(0,10)) + (i===curIdx ? '  (current)' : '');
    opts += `<option value="${sv}" ${i===curIdx?'selected':''}>${label}</option>`;
  }
  sel.innerHTML = opts;
}
function populateTsMentors() {
  // Include everyone in staff (so salaried roles like ReGroup Director appear
  // even with no logged sessions) plus any mentor name that has entries.
  const fromStaff   = DB.staff().map(s=>s.name).filter(Boolean);
  const fromEntries = DB.allEntries().map(e=>e.mentorName).filter(Boolean);
  let mentors = [...new Set([...fromStaff, ...fromEntries])].sort();
  const sel = document.getElementById('ts-mentor');
  if (!sel) return;
  // Non-admins can only run their own timesheet
  if (!isAdmin() && currentUserName()) {
    mentors = mentors.filter(m=>m===currentUserName());
    sel.innerHTML = mentors.map(m=>`<option value="${m}">${m}</option>`).join('') || `<option value="${currentUserName()}">${currentUserName()}</option>`;
    sel.value = currentUserName();
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select mentor…</option>' + mentors.map(m=>`<option value="${m}">${m}</option>`).join('');
  }
}

function tsUpdateFromStaff() { /* fields removed — defaults now pulled from staff record */ }

// Add N days to a YYYY-MM-DD string, returning YYYY-MM-DD
function _addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

function generateTimesheet() {
  const mentor = document.getElementById('ts-mentor').value;
  const start  = document.getElementById('ts-start').value;
  if (!mentor) { alert('Please select a mentor.'); return; }
  if (!start)  { alert('Please choose a pay-period start date.'); return; }

  const staffInfo = DB.staff().find(s => s.name === mentor);
  const rate    = parseFloat(staffInfo?.rate) || 20;
  const regHrs  = parseFloat(staffInfo?.regularHrs) || 16;
  const lunch   = 0.5;
  // Two-week pay period: start through start+13 days
  const end = _addDays(start, 13);
  const startDate = staffInfo?.startDate || start || '';
  const isDirector = (staffInfo?.role || '').toLowerCase().includes('director');

  const grantTotals = {};
  GRANTS.forEach(g => grantTotals[g] = 0);
  let totReg=0, totOT=0, totLunch=0, totHrs=0, totBill=0;

  let dataRows;
  if (isDirector) {
    // ReGroup Director: salaried schedule — Mon–Fri, 9:00am–5:00pm,
    // "Administration / Organization", grants alternating CVI / CJC each day.
    dataRows = [];
    let dayIndex = 0;
    for (let i = 0; i < 14; i++) {
      const ymd = _addDays(start, i);
      const dow = new Date(ymd + 'T00:00:00').getDay(); // 0=Sun … 6=Sat
      if (dow === 0 || dow === 6) continue;             // weekdays only
      const rawH = 8;
      const lunchAmt = -lunch;
      const totalH = rawH + lunchAmt;                   // 7.5
      const grant = (dayIndex % 2 === 0) ? 'CVI' : 'CJC';
      const bill  = totalH * rate;
      dayIndex++;
      totReg += rawH; totLunch += lunchAmt; totHrs += totalH; totBill += bill;
      if (grantTotals.hasOwnProperty(grant)) grantTotals[grant] += bill;
      else grantTotals['General Fund'] += bill;
      dataRows.push({ date:ymd, task:'Administration / Organization', start:'09:00', end:'17:00',
                      regular:rawH, overtime:0, lunch:lunchAmt, total:totalH, grant, bill });
    }
  } else {
    let entries = DB.allEntries().filter(e => e.mentorName === mentor);
    entries = entries.filter(e => getDate(e) >= start && getDate(e) <= end);
    dataRows = entries.map(e => {
      const rawH = Math.max(0, calcHours(e.startTime, e.endTime));
      const lunchAmt = rawH > 0 ? -lunch : 0;
      const totalH = rawH + lunchAmt;
      const grant = e.grant || staffInfo?.defaultGrant || 'General Fund';
      const bill  = Math.max(0, totalH) * rate;
      totReg   += rawH;
      totLunch += lunchAmt;
      totHrs   += Math.max(0, totalH);
      totBill  += bill;
      if (grantTotals.hasOwnProperty(grant)) grantTotals[grant] += bill;
      else grantTotals['General Fund'] += bill;
      return { date:getDate(e), task:getActivityLabel(e), start:e.startTime, end:e.endTime,
               regular:rawH, overtime:0, lunch:lunchAmt, total:Math.max(0,totalH), grant, bill };
    });
  }

  // Pad to at least 18 rows (like original timesheet)
  const MIN_ROWS = 18;
  const padRows = [];
  for (let i = dataRows.length; i < MIN_ROWS; i++) {
    padRows.push(null);
  }

  // Build table rows HTML
  const rowsHTML = [...dataRows.map(r=>`
    <tr class="data-row">
      <td class="left">${fmtDate(r.date)}</td>
      <td class="left" style="max-width:180px;font-size:7.5pt;">${r.task}</td>
      <td>${fmtTime(r.start)}</td>
      <td>${fmtTime(r.end)}</td>
      <td style="text-align:right">${r.regular.toFixed(2)}</td>
      <td style="text-align:right">0.00</td>
      <td style="text-align:right"></td>
      <td style="text-align:right">${r.lunch.toFixed(1)}</td>
      <td style="text-align:right;font-weight:700;">${r.total.toFixed(2)}</td>
      <td style="color:#1565c0;font-weight:600">${r.grant}</td>
      <td style="text-align:right;font-weight:700;">$${r.bill.toFixed(2)}</td>
    </tr>`),
  ...padRows.map((_,i)=>`
    <tr class="data-row">
      <td>&nbsp;</td><td></td><td></td><td></td>
      <td style="text-align:right">0.00</td>
      <td style="text-align:right">0.00</td>
      <td></td>
      <td style="text-align:right">0.00</td>
      <td style="text-align:right;font-weight:700;">0.00</td>
      <td>General Fund</td>
      <td style="text-align:right">$0.00</td>
    </tr>`)
  ].join('');

  const totalRow = `
    <tr class="total-row">
      <td colspan="2" style="text-align:left;font-weight:800;letter-spacing:0.04em;">TOTAL HOURS</td>
      <td>—</td><td>—</td>
      <td style="text-align:right">${totReg.toFixed(2)}</td>
      <td style="text-align:right">${totOT.toFixed(2)}</td>
      <td style="text-align:right">0.00</td>
      <td style="text-align:right">${totLunch.toFixed(2)}</td>
      <td style="text-align:right">${totHrs.toFixed(2)}</td>
      <td></td>
      <td style="text-align:right">$${totBill.toFixed(2)}</td>
    </tr>`;

  const financeRows = GRANTS.map(g => `
    <tr>
      <td>${g}</td>
      <td class="right">${grantTotals[g]>0?grantTotals[g].toFixed(0):'0'}</td>
      <td class="right">${grantTotals[g]>0?(grantTotals[g]*0.1).toFixed(0):'0'}</td>
    </tr>`).join('');

  const html = `
    <div class="card ts-print-container">
      <div class="ts-logo-bar">
        <div>
          <div class="ts-logo-text">TRANSFORMATIVE JUSTICE COMMUNITY</div>
          <div class="ts-logo-sub">ReGroup Operations — Official Timesheet</div>
        </div>
      </div>
      <div class="ts-meta-row">
        <div class="ts-meta-item"><label>Employee</label><span>${mentor}</span></div>
        <div class="ts-meta-item"><label>Start Date</label><span>${startDate ? fmtDateSlash(startDate) : '—'}</span></div>
        <div class="ts-meta-item"><label>Regular Hrs</label><span>${regHrs.toFixed(2)}</span></div>
        <div class="ts-meta-item"><label>Rate</label><span>$${rate.toFixed(2)}</span></div>
      </div>
      <table class="ts-main-table">
        <thead>
          <tr>
            <th>DATE</th><th>Task name</th><th>Start time</th><th>Finish time</th>
            <th>Regular hrs</th><th>Overtime</th><th>Lunch Time</th><th>Total Lunch</th>
            <th>TOTAL HRS</th><th>Grant</th><th>BILLABLE</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}${totalRow}</tbody>
      </table>
      <div class="ts-footer-row">
        <div>
          <div class="ts-sig-line">SUPERVISOR SIGNATURE</div>
          <div style="font-size:8pt;margin-top:12px;">DATE &nbsp;&nbsp;_________________________</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:7pt;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:4px;">→</div>
        </div>
        <div class="ts-total-box">
          <div class="big-num">${totHrs.toFixed(2)}</div>
          <div class="big-lbl">TOTAL HOURS</div>
          <div style="margin-top:10px;"></div>
          <div class="bill-num">$${totBill.toFixed(2)}</div>
          <div class="big-lbl">TOTAL BILLABLE</div>
        </div>
      </div>
      <div style="border-top:1px solid #ddd;padding-top:16px;">
        <div class="ts-finance-grid">
          <div>
            <div class="ts-finance-title">For Finance Only:</div>
            <table class="ts-finance-table">
              <thead><tr><th></th><th style="text-align:right">Billable ($)</th><th style="text-align:right">Payroll Taxes</th></tr></thead>
              <tbody>
                ${financeRows}
                <tr class="total-row">
                  <td>TOTAL (should match above)</td>
                  <td class="right">${totBill.toFixed(0)}</td>
                  <td class="right">${(totBill*0.1).toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:8px;">
            <p style="font-size:7.5pt;color:#888;line-height:1.7;">
              Pay period: ${start?fmtDate(start):'—'} to ${end?fmtDate(end):'—'}<br>
              Generated: ${new Date().toLocaleString()}<br>
              Lunch deduction: ${lunch}h per shift<br>
              Entries: ${dataRows.length}
            </p>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('timesheet-output').innerHTML = html;
  document.getElementById('timesheet-output').style.display = 'block';
  document.getElementById('print-btn').style.display = 'inline-flex';
  document.getElementById('timesheet-output').scrollIntoView({behavior:'smooth',block:'start'});
}

// ALERT ENGINE
export { generateTimesheet, tsUpdateFromStaff, populateTsMentors, populateTsCycles };
