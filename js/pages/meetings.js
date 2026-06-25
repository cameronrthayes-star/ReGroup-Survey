import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderMeetingsList() {
  const el = document.getElementById('meetings-list');
  if (!el) return;
  const meetings = DB.meetings().slice().reverse();
  if (!meetings.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No meetings logged yet.</p>'; return; }
  el.innerHTML = meetings.map(m => {
    return '<div class="card" style="margin-bottom:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">' +
        '<div>' +
          '<div style="font-weight:700;font-size:1.05em;color:var(--primary);">🤝 ' + _esc(m.topic||'Meeting') + '</div>' +
          '<div style="font-size:0.8em;color:#999;">' + (m.meetingDate?fmtDate(m.meetingDate)+' · ':'') + '📍 ' + _esc(m.location||'No location') + (m.loggedBy?' · Logged by '+_esc(m.loggedBy):'') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:6px;"><strong>Attendees:</strong> ' + _esc(m.attendees||'—') + '</div>' +
      (m.notes ? '<div style="margin-top:8px;background:#f8f9fa;border-radius:8px;padding:12px;font-size:0.875em;white-space:pre-wrap;line-height:1.6;">' + _esc(m.notes) + '</div>' : '') +
    '</div>';
  }).join('');
}

export { renderMeetingsList };
