import { DB } from '../state.js';
import { fEsc, currentUserName, isAdmin } from '../utils.js';

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
      quiz: [
        { q: 'What organization operates the ReGroup program?',
          options: ['Oregon DHS', 'TJC Oregon', 'Multnomah County', 'Oregon Youth Authority'], correct: 1 },
        { q: 'What primary approach does TJC Oregon use when working with clients?',
          options: ['Restorative justice', 'Cognitive behavioral therapy', 'Motivational interviewing', 'Incarceration'], correct: 0 },
        { q: 'When you have questions about your responsibilities, who should you contact first?',
          options: ['The Executive Director', 'HR', 'Your supervisor', 'A peer colleague'], correct: 2 },
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
      quiz: [
        { q: 'What is the core goal of a restorative justice approach?',
          options: ['Deterring future offenses', 'Reducing court caseloads', 'Repairing harm and restoring relationships', 'Imposing swift accountability'], correct: 2 },
        { q: 'What does trauma-informed care require staff to understand?',
          options: ['Trauma cannot be addressed in this program', 'How past trauma shapes behavior and needs', 'Clients must have a trauma diagnosis to receive services', 'Only licensed counselors need trauma training'], correct: 1 },
        { q: 'Which principle guides all work at TJC Oregon?',
          options: ['Mandatory participation for all clients', 'Court-ordered supervision only', 'Zero-tolerance enforcement', 'Community-centered restoration and healing'], correct: 3 },
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
      quiz: [
        { q: 'How should clients be identified in all documentation?',
          options: ['Full legal name', 'Date of birth', 'Client number', 'Social security number'], correct: 2 },
        { q: 'What is the first step when beginning work with a new client?',
          options: ['Creating a service plan', 'Contacting their family', 'Scheduling group activities', 'Intake and assessment'], correct: 3 },
        { q: 'Who has authorized access to a client case file?',
          options: ['Any staff member at the organization', 'Staff assigned to the case and authorized supervisors', 'Family members by default', 'The general public upon request'], correct: 1 },
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
      quiz: [
        { q: 'What tool is used for submitting timesheets and expense reports?',
          options: ['A separate payroll system', 'Email to the director', 'Paper forms submitted weekly', 'The ReGroup app'], correct: 3 },
        { q: 'What should a progress note include?',
          options: ['Date and hours worked only', 'Client feedback on services only', 'Services provided, goals addressed, and next steps', 'Budget codes and grant allocations only'], correct: 2 },
        { q: 'When should a progress note be submitted after service delivery?',
          options: ['Same day or within 24 hours', 'Within 72 hours', 'Within the pay period', 'Whenever convenient'], correct: 0 },
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
      quiz: [
        { q: 'If you witness suspected abuse or neglect, what must you do?',
          options: ['Wait to see if it happens again', 'Discuss it with a colleague first', 'Document it in the next progress note', 'Report it immediately as a mandatory reporter'], correct: 3 },
        { q: 'What is the first priority in any emergency situation?',
          options: ['Documenting the incident', 'Notifying the director', 'Contacting HR', 'Ensuring immediate safety'], correct: 3 },
        { q: 'Where should safety incidents be recorded?',
          options: ['In a personal log', 'Verbally to a supervisor only', 'In an incident report', 'In the next scheduled progress note'], correct: 2 },
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
      quiz: [
        { q: 'What is a dual relationship?',
          options: ['Working on two cases at once', 'Having both a personal and professional relationship with a client', 'Collaborating with two partner agencies', 'Working two jobs simultaneously'], correct: 1 },
        { q: 'What is the appropriate response when a client offers a gift?',
          options: ['Accept if it is small', 'Ask the director first', 'Accept only if it is for the organization', 'Decline politely and explain the policy'], correct: 3 },
        { q: 'What should you do if you are experiencing burnout or secondary trauma?',
          options: ['Push through on your own', 'Reduce your caseload without notice', 'Speak with your supervisor and use available wellness resources', 'Take unannounced leave'], correct: 2 },
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
      quiz: [
        { q: 'What is the main purpose of the volunteer program?',
          options: ['Replacing paid staff positions', 'Fundraising only', 'Managing caseloads independently', 'Supporting restorative justice work alongside staff'], correct: 3 },
        { q: 'What must be completed before starting volunteer work?',
          options: ['A one-day job shadow', 'Full orientation', 'A background check only', 'An interview with the director'], correct: 1 },
        { q: 'Who is your primary point of contact as a volunteer?',
          options: ['Your assigned volunteer coordinator or supervisor', 'The Executive Director', 'Any available staff member', 'A fellow volunteer'], correct: 0 },
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
      quiz: [
        { q: 'What is the primary goal of restorative justice?',
          options: ['Repairing harm and restoring relationships', 'Punishing offenders proportionally', 'Reducing prison populations', 'Speeding up court processes'], correct: 0 },
        { q: 'How does restorative justice differ from traditional criminal justice?',
          options: ['It is faster', 'It involves more supervision', 'It removes community involvement', 'It focuses on repairing harm rather than punishment'], correct: 3 },
        { q: 'In a restorative process, who are the key participants?',
          options: ['Only the offender and the judge', 'Attorneys and court officials only', 'Only the victim and their family', 'The person who caused harm, those harmed, and the community'], correct: 3 },
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
      quiz: [
        { q: 'Which activity falls within the volunteer role?',
          options: ['Making independent case decisions', 'Supporting staff-led activities and providing presence', 'Writing official documentation alone', 'Providing clinical therapy'], correct: 1 },
        { q: 'Who is responsible for supervising volunteers during their work?',
          options: ['Assigned staff members', 'Volunteers are self-directed', 'The client', 'Other volunteers'], correct: 0 },
        { q: 'What should you do if you are uncertain whether an action is in your role?',
          options: ['Use your best judgment and proceed', 'Ask the client', 'Wait for the next scheduled meeting', 'Ask your supervisor or coordinator'], correct: 3 },
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
      quiz: [
        { q: 'What should you do if a client shares information suggesting harm to themselves or others?',
          options: ['Keep it confidential and do not share', 'Share with friends for advice', 'Write it in a personal journal', 'Report to your supervisor or coordinator immediately'], correct: 3 },
        { q: 'Can you share what you observe during volunteer work with friends or family?',
          options: ['Yes, using only first names', 'No, confidentiality must be maintained', 'Yes, as long as it is not on social media', 'Only positive information may be shared'], correct: 1 },
        { q: 'What should you do if a client contacts you outside of your volunteer role?',
          options: ['Respond as a friend', 'Block them immediately', 'Redirect them to appropriate organizational channels', 'Share their contact with other staff'], correct: 2 },
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
      quiz: [
        { q: 'What is your first action if an emergency occurs during a volunteer activity?',
          options: ['Document the incident first', 'Continue the activity and report later', 'Ensure immediate safety and contact 911 if needed', 'Contact the Executive Director'], correct: 2 },
        { q: 'After any safety incident, who must you notify?',
          options: ['No one if it resolved itself', 'Your volunteer coordinator or supervisor', 'Only the client involved', 'The police automatically'], correct: 1 },
        { q: 'What should you do if you feel personally unsafe during a volunteer activity?',
          options: ['Stay and resolve the situation alone', 'Continue working until the session ends', 'Ask the client to leave', 'Leave the situation and contact your supervisor'], correct: 3 },
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
    ? ' &mdash; completed ' + fEsc(s.orientationCompletedAt.slice(0, 10))
    : allDone ? ' &mdash; all sections done' : '';

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
    : '<p style="font-size:0.75em;color:#9ca3af;margin-top:12px;margin-bottom:0;">Open each section, review the content with your supervisor, and pass the knowledge check to mark it complete.</p>';

  return '<div class="card" style="margin-bottom:18px;">' +
    '<h3>Orientation <span style="font-size:0.7em;font-weight:400;color:#9ca3af;margin-left:6px;">' + fEsc(typeLabel) + ' track</span></h3>' +
    typeBtns +
    progressBar +
    '<div>' + moduleRows + '</div>' +
    footer +
    '</div>';
}

function buildQuizHTML(mod, moduleId) {
  const questions = mod.quiz.map((q, i) => {
    const opts = q.options.map((opt, j) =>
      '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:7px;cursor:pointer;font-size:0.85em;color:#374151;border:1.5px solid #e5e7eb;margin-bottom:6px;">' +
        '<input type="radio" name="quiz-q' + i + '-' + moduleId + '" value="' + j + '" style="flex-shrink:0;width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">' +
        fEsc(opt) +
      '</label>'
    ).join('');
    return '<div style="margin-bottom:16px;">' +
      '<div style="font-weight:600;font-size:0.87em;color:#374151;margin-bottom:8px;">' + (i + 1) + '. ' + fEsc(q.q) + '</div>' +
      opts +
      '</div>';
  }).join('');

  return '<div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:4px;">' +
    '<div style="font-size:0.85em;font-weight:600;color:#374151;margin-bottom:12px;">Knowledge Check</div>' +
    questions +
    '<div id="quiz-error-' + moduleId + '" style="color:#dc2626;font-size:0.8em;margin-bottom:8px;display:none;"></div>' +
    '<button class="btn btn-primary" onclick="submitModuleQuiz(\'' + moduleId + '\')" style="width:100%;padding:13px;margin-top:4px;">Submit Quiz</button>' +
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

  const quizContent = done
    ? '<div style="background:#f0fdf4;border-radius:10px;padding:14px;border:1px solid #bbf7d0;margin-bottom:20px;">' +
      '<div style="color:#16a34a;font-weight:600;font-size:0.87em;">&#10003; Section completed</div>' +
      '</div>'
    : mod.quiz && mod.quiz.length
      ? '<div id="orientation-quiz-section" data-module="' + moduleId + '" style="margin-bottom:20px;">' + buildQuizHTML(mod, moduleId) + '</div>'
      : '<div style="background:#f9fafb;border-radius:10px;padding:14px;margin-bottom:20px;border:1px solid #e5e7eb;">' +
        '<div style="font-size:0.85em;font-weight:600;color:#374151;margin-bottom:4px;">Knowledge Check</div>' +
        '<div style="font-size:0.78em;color:#9ca3af;margin-bottom:10px;">Quiz not yet available for this section.</div>' +
        '<button class="btn btn-primary" onclick="markSectionComplete(\'' + moduleId + '\')" style="width:100%;padding:13px;">Mark Complete</button>' +
        '</div>';

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
        '<p style="font-size:0.8em;color:#6b7280;margin:0;">Full handbook content will be available in Phase 3C. Review the section topics with your supervisor before taking the quiz.</p>' +
      '</div>' +
      quizContent +
      '<button class="btn btn-outline" onclick="closeOrientationModule()" style="width:100%;padding:13px 8px;">Close</button>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOrientationModule(); });
}

export function closeOrientationModule() {
  const el = document.getElementById('orientation-module-overlay');
  if (el) el.remove();
}

export async function submitModuleQuiz(moduleId) {
  const s = myStaff();
  if (!s) { alert('No staff record found.'); return; }
  const type = s.orientationType || 'staff';
  const mods = MODULES[type] || MODULES.staff;
  const mod = mods.find(m => m.id === moduleId);
  if (!mod || !mod.quiz) return;

  const answers = mod.quiz.map((q, i) => {
    const sel = document.querySelector('input[name="quiz-q' + i + '-' + moduleId + '"]:checked');
    return sel ? parseInt(sel.value, 10) : -1;
  });

  if (answers.includes(-1)) {
    const errEl = document.getElementById('quiz-error-' + moduleId);
    if (errEl) { errEl.textContent = 'Please answer all questions before submitting.'; errEl.style.display = 'block'; }
    return;
  }

  const total = mod.quiz.length;
  const score = mod.quiz.reduce((sum, q, i) => sum + (answers[i] === q.correct ? 1 : 0), 0);
  const pass = score === total;

  const now = new Date().toISOString();
  const existingAttempts = s.quizAttempts || {};
  const typedId = type + ':' + moduleId;
  const priorAttempts = Array.isArray(existingAttempts[typedId]) ? existingAttempts[typedId] : [];
  const attempt = { ts: now, answers, score, total, pass };
  const newAttempts = Object.assign({}, existingAttempts, { [typedId]: [...priorAttempts, attempt] });

  const quizSection = document.getElementById('orientation-quiz-section');

  if (pass) {
    const existingSections = s.completedSections || [];
    const completedSections = existingSections.includes(typedId) ? existingSections : [...existingSections, typedId];
    const allDone = mods.every(m => completedSections.includes(type + ':' + m.id));
    const update = { completedSections, quizAttempts: newAttempts, orientationLastUpdated: now };
    if (allDone) update.orientationCompletedAt = now;
    await DB.updateRecord('staff', s._id, update);

    if (quizSection) {
      quizSection.innerHTML =
        '<div style="background:#f0fdf4;border-radius:10px;padding:16px;border:1px solid #bbf7d0;margin-top:4px;">' +
        '<div style="color:#16a34a;font-weight:700;font-size:0.87em;margin-bottom:4px;">All correct! Section complete.</div>' +
        '<div style="font-size:0.8em;color:#15803d;">Score: ' + score + '/' + total + '</div>' +
        '</div>';
    }
    setTimeout(() => closeOrientationModule(), 1400);
    setTimeout(() => { if (typeof window.renderProfile === 'function') window.renderProfile(); }, 1500);

  } else {
    await DB.updateRecord('staff', s._id, { quizAttempts: newAttempts, orientationLastUpdated: now });

    const wrongIndices = mod.quiz
      .map((q, i) => (answers[i] !== q.correct ? i + 1 : 0))
      .filter(n => n > 0);
    const wrongLabel = wrongIndices.length === 1
      ? 'Question ' + wrongIndices[0] + ' needs'
      : 'Questions ' + wrongIndices.join(', ') + ' need';

    if (quizSection) {
      quizSection.innerHTML =
        '<div style="background:#fef2f2;border-radius:10px;padding:16px;border:1px solid #fecaca;margin-top:4px;">' +
        '<div style="color:#dc2626;font-weight:700;font-size:0.87em;margin-bottom:4px;">Score: ' + score + '/' + total + ' &mdash; not all answers were correct.</div>' +
        '<div style="font-size:0.8em;color:#7f1d1d;margin-bottom:12px;">' + wrongLabel + ' review. You must answer all questions correctly to pass.</div>' +
        '<button class="btn btn-primary" onclick="retryModuleQuiz(\'' + moduleId + '\')" style="width:100%;padding:12px;">Try Again</button>' +
        '</div>';
    }
  }
}

export function retryModuleQuiz(moduleId) {
  const s = myStaff();
  const type = (s && s.orientationType) || 'staff';
  const mods = MODULES[type] || MODULES.staff;
  const mod = mods.find(m => m.id === moduleId);
  if (!mod) return;
  const quizSection = document.getElementById('orientation-quiz-section');
  if (quizSection) quizSection.innerHTML = buildQuizHTML(mod, moduleId);
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
  if (completedSections.length === allIds.length) update.orientationCompletedAt = now;
  await DB.updateRecord('staff', s._id, update);
  closeOrientationModule();
  if (typeof window.renderProfile === 'function') window.renderProfile();
}

export async function resetOrientationProgress(staffId) {
  if (!isAdmin()) { alert('Admin access required.'); return; }
  if (!confirm('Reset orientation progress for this staff member? All completed sections and quiz attempts will be cleared.')) return;
  await DB.updateRecord('staff', staffId, {
    orientationType: '',
    orientationStartedAt: '',
    orientationCompletedAt: '',
    completedSections: [],
    quizAttempts: {},
    orientationLastUpdated: new Date().toISOString(),
  });
}
