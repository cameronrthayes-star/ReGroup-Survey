import { DB } from '../state.js';
import { fEsc, currentUserName } from '../utils.js';

// Placeholder modules based on Staff & Volunteer handbook sections.
// Full content will be sourced via RAG in Phase 3C.
const MODULES = {
  staff: [
    {
      id: 'welcome',
      title: 'Welcome to TJC Oregon',
      mins: 10,
      summary: 'Introduction to TJC Oregon, the ReGroup program, and your role on the team.',
      subsections: [
        'About TJC Oregon and ReGroup',
        'Program goals and population served',
        'Your role and responsibilities',
      ],
    },
    {
      id: 'mission',
      title: 'Mission, Values and Philosophy',
      mins: 15,
      summary: 'Core mission, values, and the restorative justice philosophy that guides all work.',
      subsections: [
        'Organizational mission and vision',
        'Restorative justice principles',
        'Trauma-informed care basics',
      ],
    },
    {
      id: 'client-services',
      title: 'Client Services and Support',
      mins: 20,
      summary: 'How to work with clients, provide support, and document services.',
      subsections: [
        'Client intake and assessment',
        'Types of support services',
        'Progress note documentation',
        'Client confidentiality requirements',
      ],
    },
    {
      id: 'documentation',
      title: 'Documentation and Reporting',
      mins: 15,
      summary: 'Required documentation, reporting timelines, and how to use the ReGroup app.',
      subsections: [
        'Progress notes and activity logs',
        'Needs assessments',
        'Expense reports and timesheets',
        'Using the ReGroup app',
      ],
    },
    {
      id: 'safety',
      title: 'Safety and Emergency Protocols',
      mins: 10,
      summary: 'Safety procedures, mandatory reporting requirements, and emergency contacts.',
      subsections: [
        'Mandatory reporting obligations',
        'Safety planning with clients',
        'Emergency procedures',
        'Incident reporting',
      ],
    },
    {
      id: 'boundaries',
      title: 'Professional Boundaries',
      mins: 10,
      summary: 'Maintaining professional boundaries and self-care practices.',
      subsections: [
        'Dual relationships and boundaries',
        'Social media guidelines',
        'Staff wellness and self-care',
      ],
    },
  ],
  volunteer: [
    {
      id: 'welcome',
      title: 'Welcome and Overview',
      mins: 10,
      summary: 'Welcome to TJC Oregon and an overview of the volunteer program.',
      subsections: [
        'About TJC Oregon and ReGroup',
        'What volunteers do',
        'Your volunteer agreement',
      ],
    },
    {
      id: 'rj-intro',
      title: 'Introduction to Restorative Justice',
      mins: 15,
      summary: 'Core concepts of restorative justice and how they apply to your work.',
      subsections: [
        'What is restorative justice',
        'How RJ differs from traditional approaches',
        'Our population and their needs',
      ],
    },
    {
      id: 'volunteer-role',
      title: 'Your Role and Responsibilities',
      mins: 10,
      summary: 'What is expected of you as a volunteer and what you can expect from us.',
      subsections: [
        'Scope of the volunteer role',
        'Supervision and support',
        'Communication expectations',
      ],
    },
    {
      id: 'boundaries',
      title: 'Boundaries and Confidentiality',
      mins: 15,
      summary: 'Essential boundaries and confidentiality requirements for working with clients.',
      subsections: [
        'Confidentiality basics',
        'Professional boundaries',
        'What to do if you are unsure',
      ],
    },
    {
      id: 'safety',
      title: 'Safety and Emergency Procedures',
      mins: 10,
      summary: 'Safety guidelines and what to do in an emergency.',
      subsections: [
        'Site safety guidelines',
        'Emergency contact procedures',
        'Mandatory reporting overview',
      ],
    },
  ],
};

export function orientationPct(s) {
  const type = s && s.orientationType;
  if (!type) return 0;
  const mods = MODULES[type] || MODULES.staff;
  const all = s.completedSections || [];
  const prefix = type + ':';
  const done = all.filter(id => id.startsWith(prefix));
  return mods.length ? Math.round(done.length / mods.length * 100) : 0;
}

function myStaff() {
  return DB.staff().find(s => s.name === currentUserName()) || null;
}

export function renderOrientationCard(s) {
  const type = s ? (s.orientationType || '') : '';
  const mods = type ? (MODULES[type] || MODULES.staff) : [];
  const completed = s ? (s.completedSections || []) : [];
  const pct = s ? orientationPct(s) : 0;
  const allDone = type && pct >= 100;
  const typeLabel = type ? (type.charAt(0).toUpperCase() + type.slice(1)) : '';

  const typeBtns =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
      '<button class="btn ' + (type === 'staff' ? 'btn-primary' : 'btn-outline') + '" onclick="setOrientationType(\'staff\')" style="flex:1;min-width:110px;padding:11px 8px;">Staff</button>' +
      '<button class="btn ' + (type === 'volunteer' ? 'btn-primary' : 'btn-outline') + '" onclick="setOrientationType(\'volunteer\')" style="flex:1;min-width:110px;padding:11px 8px;">Volunteer</button>' +
    '</div>';

  if (!type) {
    return '<div class="card" style="margin-bottom:18px;">' +
      '<h3>Orientation</h3>' +
      '<p style="font-size:0.84em;color:#888;margin-bottom:14px;">Select your orientation track to begin.</p>' +
      typeBtns +
      '</div>';
  }

  const barColor = allDone ? '#43a047' : pct > 0 ? '#f59e0b' : '#d1d5db';
  const completedLabel = allDone && s.orientationCompletedAt
    ? ' — completed ' + fEsc(s.orientationCompletedAt.slice(0, 10))
    : allDone ? ' — all sections done' : '';

  const progressBar =
    '<div style="background:#e5e7eb;border-radius:8px;height:8px;margin-bottom:6px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:8px;transition:width 0.3s;"></div>' +
    '</div>' +
    '<div style="font-size:0.78em;color:#6b7280;margin-bottom:16px;">' + pct + '% complete' + completedLabel + '</div>';

  const moduleRows = mods.map(m => {
    const done = completed.includes(type + ':' + m.id);
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6;">' +
      '<span style="font-size:1em;color:' + (done ? '#43a047' : '#9ca3af') + ';flex-shrink:0;width:20px;text-align:center;">' + (done ? '&#10003;' : '&#9675;') + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;font-size:0.87em;color:#1f2937;">' + fEsc(m.title) + '</div>' +
        '<div style="font-size:0.74em;color:#9ca3af;">~' + m.mins + ' min</div>' +
      '</div>' +
      '<button class="btn ' + (done ? 'btn-outline' : 'btn-accent') + '" style="padding:7px 12px;font-size:0.76em;flex-shrink:0;min-width:64px;" onclick="openOrientationModule(\'' + fEsc(m.id) + '\')">' +
        (done ? 'Review' : 'Start') +
      '</button>' +
      '</div>';
  }).join('');

  const footer = allDone
    ? '<p style="font-size:0.8em;color:#43a047;font-weight:600;margin-top:12px;margin-bottom:0;">Orientation complete. Great work!</p>'
    : '<p style="font-size:0.75em;color:#9ca3af;margin-top:12px;margin-bottom:0;">Work through each section with your supervisor, then mark it complete. Full handbook content will be available in a future update.</p>';

  return '<div class="card" style="margin-bottom:18px;">' +
    '<h3>Orientation <span style="font-size:0.7em;font-weight:400;color:#9ca3af;margin-left:6px;">' + fEsc(typeLabel) + ' track</span></h3>' +
    typeBtns +
    progressBar +
    '<div>' + moduleRows + '</div>' +
    footer +
    '</div>';
}

export function openOrientationModule(moduleId) {
  const s = myStaff();
  const type = (s && s.orientationType) || 'staff';
  const mods = MODULES[type] || MODULES.staff;
  const mod = mods.find(m => m.id === moduleId);
  if (!mod) { alert('Module not found.'); return; }

  const completed = s ? (s.completedSections || []) : [];
  const done = completed.includes(type + ':' + moduleId);

  const existing = document.getElementById('orientation-module-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'orientation-module-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px;box-sizing:border-box;-webkit-overflow-scrolling:touch;';

  const subsRows = mod.subsections.map(sub =>
    '<li style="font-size:0.85em;color:#4b5563;margin-bottom:6px;">' + fEsc(sub) + '</li>'
  ).join('');

  const actionBtn = done
    ? '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#43a047;font-size:0.85em;font-weight:600;">&#10003; Completed</div>'
    : '<button class="btn btn-primary" onclick="markSectionComplete(\'' + moduleId + '\')" style="flex:1;min-width:140px;padding:13px 8px;">Mark Complete</button>';

  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;width:100%;max-width:560px;padding:24px;box-sizing:border-box;margin:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:10px;">' +
        '<h2 style="font-size:1.05em;font-weight:700;color:var(--primary);margin:0;flex:1;">' + fEsc(mod.title) + '</h2>' +
        '<button onclick="closeOrientationModule()" style="background:none;border:none;font-size:1.3em;color:#9ca3af;cursor:pointer;padding:10px;margin:-10px;line-height:1;flex-shrink:0;" aria-label="Close">&#10005;</button>' +
      '</div>' +
      '<p style="font-size:0.85em;color:#6b7280;margin-bottom:16px;">~' + mod.mins + ' min</p>' +
      '<p style="font-size:0.87em;color:#374151;margin-bottom:16px;">' + fEsc(mod.summary) + '</p>' +
      '<h4 style="font-size:0.85em;font-weight:600;color:#374151;margin:0 0 8px;">In this section:</h4>' +
      '<ul style="margin:0 0 18px;padding-left:20px;">' + subsRows + '</ul>' +
      '<div style="background:#f9fafb;border-radius:10px;padding:14px;margin-bottom:16px;border:1px solid #e5e7eb;">' +
        '<p style="font-size:0.8em;color:#6b7280;margin:0;">Full handbook content will be available in Phase 3C. Review the section topics with your supervisor, then mark it complete below.</p>' +
      '</div>' +
      '<div style="background:#f9fafb;border-radius:10px;padding:14px;margin-bottom:20px;border:1px solid #e5e7eb;">' +
        '<div style="font-size:0.85em;font-weight:600;color:#374151;margin-bottom:4px;">Knowledge Check</div>' +
        '<div style="font-size:0.78em;color:#9ca3af;">Quiz questions will be available in a future update.</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button class="btn btn-outline" onclick="closeOrientationModule()" style="flex:1;min-width:100px;padding:13px 8px;">Close</button>' +
        actionBtn +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOrientationModule(); });
}

export function closeOrientationModule() {
  const el = document.getElementById('orientation-module-overlay');
  if (el) el.remove();
}

export async function setOrientationType(type) {
  if (type !== 'staff' && type !== 'volunteer') return;
  const s = myStaff();
  if (!s) { alert('No staff record found. Ask an admin to add you under Settings.'); return; }
  const now = new Date().toISOString();
  const update = {
    orientationType: type,
    quizAttempts: s.quizAttempts || {},
    orientationLastUpdated: now,
  };
  if (!s.orientationStartedAt) update.orientationStartedAt = now;
  await DB.updateRecord('staff', s._id, update);
  if (typeof window.renderProfile === 'function') window.renderProfile();
}

export async function markSectionComplete(moduleId) {
  const s = myStaff();
  if (!s) { alert('No staff record found.'); return; }
  const type = s.orientationType || 'staff';
  const mods = MODULES[type] || MODULES.staff;
  const allIds = mods.map(m => m.id);
  if (!allIds.includes(moduleId)) return;
  const typedId = type + ':' + moduleId;
  const existing = s.completedSections || [];
  if (existing.includes(typedId)) { closeOrientationModule(); return; }
  const completedSections = [...existing, typedId];
  const now = new Date().toISOString();
  const update = { completedSections, orientationLastUpdated: now };
  if (completedSections.length === allIds.length) {
    update.orientationCompletedAt = now;
  }
  await DB.updateRecord('staff', s._id, update);
  closeOrientationModule();
  if (typeof window.renderProfile === 'function') window.renderProfile();
}

export { renderOrientationCard as _renderOrientationCard };
