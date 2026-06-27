import { DB, db, getDocs, collection, query, orderBy } from '../state.js';
import { fEsc, currentUserName, isAdmin } from '../utils.js';
import { where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const STAFF_CHUNK_COUNT    = 44;
const VOLUNTEER_CHUNK_COUNT = 16;

// ─── Quiz checkpoint definitions ─────────────────────────────────────────────

const QUIZ_CHECKPOINTS = {
  staff:     [6, 13, 19, 26, 34, 43],
  volunteer: [6, 15],
};

const REQUIRED_CHECKPOINTS = {
  staff:     ['staff:q_after_6','staff:q_after_13','staff:q_after_19','staff:q_after_26','staff:q_after_34','staff:q_after_43'],
  volunteer: ['volunteer:q_after_6','volunteer:q_after_15'],
};

const QUIZ_DATA = {
  'staff:q_after_6': {
    label: 'Mission, At-Will Employment & Harassment Policy',
    questions: [
      {
        q: "What is TJC's mission, as stated in the handbook?",
        options: [
          'To provide legal representation for incarcerated individuals',
          'To promote transformative justice through personal transformation, healing, and dismantling systems of oppression',
          'To reduce recidivism through strict supervision programs',
          "To manage Oregon's community correction programs",
        ],
        correct: 1,
        explanation: 'TJC\'s mission is "to promote transformative justice through recognition of the intersection of personal transformation, healing, and the need to dismantle systems of oppression."',
        citation: 'TJC Staff Handbook, p. 4 — Section I. Mission',
      },
      {
        q: "What does TJC's at-will employment policy mean?",
        options: [
          'Employees must give 30 days written notice before leaving',
          'TJC can only terminate employees for documented cause',
          'Employees may be terminated with or without cause, and may also leave with or without cause',
          'Employment is guaranteed for the duration of a signed contract',
        ],
        correct: 2,
        explanation: '"That means that employees may be terminated from employment with TJC with or without cause, and employees are free to leave the employment of TJC with or without cause."',
        citation: 'TJC Staff Handbook, p. 5 — Section III. Voluntary At-Will Employment',
      },
      {
        q: 'If you experience or witness harassment at TJC, what should you do?',
        options: [
          'Document it privately and address it when convenient',
          'Report it only if it happens more than once',
          'Discuss it with trusted co-workers first',
          'Report it immediately to your supervisor or the Executive Director',
        ],
        correct: 3,
        explanation: 'TJC policy requires that harassment be reported immediately. Filing a harassment complaint is protected — retaliation against those who report is also prohibited.',
        citation: 'TJC Staff Handbook, p. 7-8 — Section V. Policy Against Workplace Harassment',
      },
    ],
  },
  'staff:q_after_13': {
    label: 'Workplace Policies, Compensation & Performance',
    questions: [
      {
        q: 'How are paychecks distributed at TJC?',
        options: [
          'Monthly on the 1st of each month',
          'Weekly on Fridays',
          'Bi-weekly on Tuesdays (or the preceding workday if a holiday)',
          'Semi-monthly on the 1st and 15th',
        ],
        correct: 2,
        explanation: '"Paychecks are distributed on the bi-weekly on Tuesdays except on holidays, in which case paychecks will be distributed on the preceding workday."',
        citation: 'TJC Staff Handbook, p. 11 — Section IX. Position Description and Salary Administration',
      },
      {
        q: 'Who must authorize overtime work for non-exempt employees?',
        options: [
          "The employee's direct supervisor alone",
          'The HR department',
          "The Executive Director or their designee, upon the supervisor's request",
          'Any manager on duty',
        ],
        correct: 2,
        explanation: '"Only the Executive Director or their designee, upon the request of an employee\'s supervisor, may authorize overtime."',
        citation: 'TJC Staff Handbook, p. 10 — Section VII. Remote Work, Conduct, Punctuality, and Attendance',
      },
      {
        q: 'How is a Full-Time Employee defined at TJC?',
        options: [
          'An employee who works at least 40 hours per week',
          'An employee who works at least 38 hours per week',
          'An employee on a permanent salaried contract',
          'An employee approved directly by the Board of Directors',
        ],
        correct: 1,
        explanation: '"A Full Time Employee regularly works at least 38 hours per week."',
        citation: 'TJC Staff Handbook, p. 10 — Section VIII. Employment Policies and Terms',
      },
    ],
  },
  'staff:q_after_19': {
    label: 'Leave Benefits & Work Policies',
    questions: [
      {
        q: 'How many paid holidays per year are Full-Time Employees eligible for at TJC?',
        options: ['8', '9', '11', '12'],
        correct: 2,
        explanation: '"Full-Time Employees are eligible for 11 holidays per year" — including New Year\'s Day, MLK Jr. Birthday, President\'s Day, Memorial Day, Juneteenth, Independence Day, Labor Day, Indigenous People\'s Day, Veteran\'s Day, Thanksgiving, and Christmas Day.',
        citation: 'TJC Staff Handbook, p. 13 — Section XII.A Holidays',
      },
      {
        q: 'What is the maximum vacation leave balance an employee can accrue at TJC?',
        options: ['10 days', '15 days', '20 days', '30 days'],
        correct: 3,
        explanation: '"Employees may not accrue more than the maximum leave balance of 30 days."',
        citation: 'TJC Staff Handbook, p. 14 — Section XII. Leave Benefits and Other Work Policies',
      },
      {
        q: 'What does TJC make available to employees who experience domestic violence, sexual assault, or stalking?',
        options: [
          'Paid leave equal to full salary for up to six months',
          'Statutory leave to obtain medical care, counseling, legal assistance, and other safety steps',
          'Immediate unpaid leave with guaranteed job protection',
          'Flexible scheduling adjustments only',
        ],
        correct: 1,
        explanation: '"Statutory leave may be available to employees to obtain services or treatment relating to domestic violence, sexual assault or stalking... Purposes for this leave include obtaining medical care, counseling, and advice from legal counsel, law enforcement assistance, or other steps to help better ensure their health and safety."',
        citation: 'TJC Staff Handbook, p. 16 — Domestic Violence and Crime Victim Leave',
      },
    ],
  },
  'staff:q_after_26': {
    label: 'Expense Reimbursement & Separation',
    questions: [
      {
        q: 'What must accompany all expense reimbursement requests at TJC?',
        options: [
          'Approval from the Board of Directors',
          'A description (who, what, when, where, why) and the necessary general ledger coding',
          'A personal letter explaining each expense',
          'Sign-off from at least two supervisors',
        ],
        correct: 1,
        explanation: '"All such expense reimbursement requests must be accompanied by a description (who, what, when, where, why) of the expense and the necessary coding for general ledger purposes."',
        citation: 'TJC Staff Handbook, p. 17 — Section XIII.B Procedures and Policy',
      },
      {
        q: 'Which of the following expenses will TJC NOT reimburse?',
        options: [
          'Coach airfare booked well in advance',
          'Receipted rideshare or taxi transportation',
          'Single hotel room costs plus tax',
          'Childcare or pet care',
        ],
        correct: 3,
        explanation: "TJC's policy explicitly lists childcare or pet care as non-reimbursable, along with personal credit card fees, motor vehicle violations, and spa or fitness club costs.",
        citation: 'TJC Staff Handbook, p. 19 — Section XIII.B Procedures and Policy',
      },
      {
        q: 'How much written notice does TJC encourage employees to give before resigning?',
        options: [
          '5 business days',
          'At least 10 business days (two weeks)',
          '30 calendar days',
          'No notice is required',
        ],
        correct: 1,
        explanation: '"Employees are encouraged to give at least 10 business days of written notice" before resigning.',
        citation: 'TJC Staff Handbook, p. 19 — Section XIV. Separation',
      },
    ],
  },
  'staff:q_after_34': {
    label: 'Technology Use, Credit Cards & Return of Property',
    questions: [
      {
        q: 'Who is authorized to use TJC credit or debit cards for purchases?',
        options: [
          'Any TJC supervisor',
          'Any full-time staff member',
          'Staff approved by HR',
          'Only those specifically authorized by the Executive Director',
        ],
        correct: 3,
        explanation: '"Only those who have been specifically authorized by the executive director may use credit or debit cards for organizational purchases."',
        citation: 'TJC Staff Handbook, p. 23 — Section XVII. Credit/Debit Card Policy',
      },
      {
        q: 'If a TJC credit or debit card is lost or stolen, who must be notified immediately?',
        options: [
          'The direct supervisor only',
          'HR and the payroll department',
          'The issuing bank and the Board Chair or Treasurer',
          'The Executive Director and all staff members',
        ],
        correct: 2,
        explanation: '"If a credit or debit card is lost or stolen, the cardholder must report it immediately to the issuing bank and the Board Chair or Treasurer."',
        citation: 'TJC Staff Handbook, p. 24 — Section XVII.5 Lost or Stolen Cards',
      },
      {
        q: 'When must employees return TJC property and equipment?',
        options: [
          'Only at the end of each fiscal year',
          'On separation from employment, or immediately upon request by the Executive Director or their designee',
          'Within 30 days of leaving the organization',
          'Only when the property is worth more than $500',
        ],
        correct: 1,
        explanation: '"In the event of separation from employment, or immediately upon request by the Executive Director or their designee. Employees must return all TJC property that is in their possession or control."',
        citation: 'TJC Staff Handbook, p. 24 — Section XVIII. Return of Property',
      },
    ],
  },
  'staff:q_after_43': {
    label: 'Personnel Records, Confidentiality & Gift Acceptance',
    questions: [
      {
        q: 'If you disagree with a personnel action or performance review, what is the correct first step?',
        options: [
          'Contact HR directly',
          'File a formal grievance with the Board',
          'Discuss it with your immediate supervisor',
          'Submit a written complaint to the Executive Director',
        ],
        correct: 2,
        explanation: '"Employees are expected first to discuss their concern with their immediate supervisor. If further discussion is desired, the employee may then discuss the situation with the Executive Director. The decision of the Executive Director is final."',
        citation: 'TJC Staff Handbook, p. 24 — Section XIX. Review of Personnel Action',
      },
      {
        q: "What constitutes confidential information under TJC's non-disclosure policy?",
        options: [
          'Only information marked "confidential" in writing',
          'Only donor financial contribution data',
          'Any information about TJC or its members that is not otherwise publicly available',
          'Only individual client case files',
        ],
        correct: 2,
        explanation: '"Any information that an employee learns about TJC, or its members or donors, as a result of working for TJC that is not otherwise publicly available constitutes confidential information."',
        citation: 'TJC Staff Handbook, p. 26 — Section XXII. Non-Disclosure of Confidential Information',
      },
      {
        q: 'Which criteria must a gift meet for TJC to accept it?',
        options: [
          'The gift must be worth at least $500',
          'The gift must come from a current or past donor',
          "The gift must align with TJC's mission, be legal and ethical, and not impose undue burdens",
          'All gifts must be approved by a two-thirds Board vote',
        ],
        correct: 2,
        explanation: 'TJC will accept gifts that "align with the organization\'s mission and strategic goals, are legal and ethical, can be effectively managed and utilized, and do not impose undue burdens on the organization."',
        citation: 'TJC Staff Handbook, p. 30 — Section XXV. Gift Acceptance Policy',
      },
    ],
  },
  'volunteer:q_after_6': {
    label: "TJC's Mission, Volunteers & Charter",
    questions: [
      {
        q: "What is TJC's mission, as stated in the volunteer handbook?",
        options: [
          'To provide legal representation for incarcerated individuals',
          'To promote transformative justice through personal transformation, healing, and dismantling systems of oppression',
          'To reduce recidivism through strict supervision programs',
          "To manage Oregon's community corrections programs",
        ],
        correct: 1,
        explanation: '"TJC\'s Mission is to promote transformative justice through recognition of the intersection of personal transformation, healing, and the need to dismantle systems of oppression."',
        citation: 'TJC Volunteer Handbook, p. 6 — What is TJC?',
      },
      {
        q: 'What is the minimum age requirement to volunteer with TJC?',
        options: ['16 years old', '18 years old', '21 years old', 'There is no age requirement'],
        correct: 1,
        explanation: '"There is no upper age limit to who can volunteer, but we do require that all volunteers be at least 18 years old."',
        citation: 'TJC Volunteer Handbook, p. 8 — Who are our volunteers?',
      },
      {
        q: 'According to the Volunteer Charter, what can volunteers expect from TJC?',
        options: [
          'A paid stipend for completed hours',
          'Guaranteed placement in a specific program',
          'An introduction to TJC, appropriate training, a volunteer supervisor, and fair resolution of any problems',
          'Reimbursement for all transportation costs',
        ],
        correct: 2,
        explanation: 'The Volunteer Charter states TJC will provide an introduction to TJC and its programs, training appropriate for your role, on-going support, a delegated volunteer supervisor, regular support and supervision, and fair hearing and resolution of any problems.',
        citation: 'TJC Volunteer Handbook, p. 9 — Volunteer Charter',
      },
    ],
  },
  'volunteer:q_after_15': {
    label: 'Volunteer Opportunities, Policies & Confidentiality',
    questions: [
      {
        q: 'What must volunteers pass to work inside Oregon State Prison with the ReGroup program?',
        options: [
          'A medical examination',
          'A financial background check',
          "A Department of Corrections LEDS check or the DOC badging process",
          'An interview with the Executive Director',
        ],
        correct: 2,
        explanation: '"Parenting Classes and Programming Inside OSP: Volunteers must pass a Department of Correction\'s (DOC) LEDS check or who have gone through the DOC badging process."',
        citation: 'TJC Volunteer Handbook, p. 10 — Volunteer Opportunities',
      },
      {
        q: "What is TJC's policy on alcohol use during volunteer hours?",
        options: [
          'Moderate use is acceptable at off-site community events',
          'Use is permitted only after all volunteer activities have ended',
          'Use, possession, and being under the influence during volunteer hours are all strictly prohibited',
          'Volunteers may consume alcohol only when not working directly with participants',
        ],
        correct: 2,
        explanation: '"The use, possession, manufacture, and distribution, dispensation or sale of illegal drugs, alcohol, or any controlled substance at TJC programs... during volunteer hours is strictly prohibited. Similarly, it is prohibited for any volunteer to be under the influence... during volunteer hours."',
        citation: 'TJC Volunteer Handbook, p. 11 — Drug-Free Workplace',
      },
      {
        q: 'What must happen before confidential TJC information can be released to any party?',
        options: [
          'Notify your supervisor via email',
          'Wait for a scheduled team review meeting',
          'Obtain advance written approval from the Chief Executive Officer',
          'Confirm the release in writing with two witnesses',
        ],
        correct: 2,
        explanation: '"Release of confidential information to any unauthorized parties must be approved in advance in writing by the Chief Executive Officer."',
        citation: 'TJC Volunteer Handbook, p. 13 — Confidentiality of Information',
      },
    ],
  },
};

// ─── Legacy module data (kept for backwards compat) ──────────────────────────

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

// ─── Reader module state ──────────────────────────────────────────────────────
let _hbChunks         = [];
let _hbCurrent        = 0;
let _hbMaxViewed      = 0;
let _hbIsAdminPreview = false;
let _hbStaffId        = null;
let _hbQueryToken     = 0;
let _hbHandbookType    = 'staff';
let _hbQuizzesPassed   = [];
let _hbQuizOpen        = false;
let _hbAlreadyComplete = false;

export function orientationPct(s) {
  const type = s && s.orientationType;
  if (!type) return 0;
  const mods = MODULES[type] || MODULES.staff;
  const all = s.completedSections || [];
  const prefix = type + ':';
  const done = all.filter(id => id.startsWith(prefix));
  return mods.length ? Math.round(done.length / mods.length * 100) : 0;
}

export function isOrientationComplete(s) {
  return !!(s && s.orientationCompletedAt);
}

function myStaff() {
  return DB.staff().find(s => s.name === currentUserName()) || null;
}

export function renderOrientationCard(s) {
  // Admins get a preview-only card — no progress tracking
  if (isAdmin()) {
    return '<div class="card" style="margin-bottom:18px;">' +
      '<h3>Handbook <span style="font-size:0.7em;font-weight:400;color:#9ca3af;margin-left:6px;">Admin Preview</span></h3>' +
      '<div style="font-size:0.8em;color:#6b7280;margin-bottom:14px;">Preview the handbook content without affecting any staff record.</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button class="btn btn-outline" onclick="openHandbookReader(\'staff\')" style="flex:1;min-width:120px;padding:11px 8px;">Preview Staff Handbook</button>' +
        '<button class="btn btn-outline" onclick="openHandbookReader(\'volunteer\')" style="flex:1;min-width:120px;padding:11px 8px;">Preview Volunteer Handbook</button>' +
      '</div>' +
    '</div>';
  }

  if (!s) return '';

  const type = s.orientationType || '';
  const locked = !!(window._orientationLocked);
  const lockBanner = locked
    ? '<div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:10px;padding:14px 16px;margin-bottom:16px;">' +
      '<div style="font-weight:700;color:#92400e;font-size:0.9em;margin-bottom:3px;">Orientation required</div>' +
      '<div style="font-size:0.82em;color:#78350f;">Please complete orientation before using the rest of the app.</div>' +
      '</div>'
    : '';

  const typeBtns =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
      '<button class="btn ' + (type === 'staff' ? 'btn-primary' : 'btn-outline') + '" onclick="setOrientationType(\'staff\')" style="flex:1;min-width:110px;padding:11px 8px;">Staff</button>' +
      '<button class="btn ' + (type === 'volunteer' ? 'btn-primary' : 'btn-outline') + '" onclick="setOrientationType(\'volunteer\')" style="flex:1;min-width:110px;padding:11px 8px;">Volunteer</button>' +
    '</div>';

  if (!type) {
    return '<div class="card" style="margin-bottom:18px;">' +
      '<h3>Orientation</h3>' +
      lockBanner +
      '<p style="font-size:0.84em;color:#888;margin-bottom:14px;">Select your orientation track to begin.</p>' +
      typeBtns +
      '</div>';
  }

  const typeLabel    = type === 'volunteer' ? 'Volunteer' : 'Staff';
  const totalChunks  = type === 'volunteer' ? VOLUNTEER_CHUNK_COUNT : STAFF_CHUNK_COUNT;

  // Already completed — preserve existing completion for legacy users
  if (isOrientationComplete(s)) {
    const completedDate = s.orientationCompletedAt ? s.orientationCompletedAt.slice(0, 10) : '';
    return '<div class="card" style="margin-bottom:18px;">' +
      '<h3>Orientation <span style="font-size:0.7em;font-weight:400;color:#9ca3af;margin-left:6px;">' + fEsc(typeLabel) + ' track</span></h3>' +
      '<div style="background:#f0fdf4;border-radius:10px;padding:14px 16px;border:1px solid #bbf7d0;margin-bottom:14px;display:flex;align-items:center;gap:10px;">' +
        '<span style="color:#16a34a;font-size:1.2em;flex-shrink:0;">&#10003;</span>' +
        '<div>' +
          '<div style="font-weight:700;color:#15803d;font-size:0.9em;">Orientation Complete</div>' +
          (completedDate ? '<div style="font-size:0.75em;color:#16a34a;">Completed ' + fEsc(completedDate) + '</div>' : '') +
        '</div>' +
      '</div>' +
      typeBtns +
      '<button class="btn btn-outline" onclick="openHandbookReader(\'' + fEsc(type) + '\')" style="width:100%;padding:11px 8px;font-size:0.87em;">Review Handbook</button>' +
    '</div>';
  }

  // In-progress reader card
  const hbMaxViewed     = typeof s.hbMaxViewed === 'number' ? s.hbMaxViewed : -1;
  const hbCurrentChunk  = typeof s.hbCurrentChunk === 'number' ? s.hbCurrentChunk : 0;
  const chunksRead      = hbMaxViewed >= 0 ? hbMaxViewed + 1 : 0;
  const pct             = Math.round(chunksRead / totalChunks * 100);
  const barColor        = pct > 0 ? '#f59e0b' : '#d1d5db';
  const progressLabel   = chunksRead > 0
    ? chunksRead + ' of ' + totalChunks + ' sections read'
    : 'Not started — open to begin';
  const resumeNote      = chunksRead > 0
    ? '<div style="font-size:0.76em;color:#6b7280;margin-bottom:12px;">Will resume at section ' + (hbCurrentChunk + 1) + '</div>'
    : '';
  const btnLabel        = chunksRead > 0 ? 'Continue Reading' : 'Open Handbook';

  return '<div class="card" style="margin-bottom:18px;">' +
    '<h3>Orientation <span style="font-size:0.7em;font-weight:400;color:#9ca3af;margin-left:6px;">' + fEsc(typeLabel) + ' track</span></h3>' +
    lockBanner +
    typeBtns +
    '<div style="background:#e5e7eb;border-radius:8px;height:8px;margin-bottom:6px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:8px;transition:width 0.3s;"></div>' +
    '</div>' +
    '<div style="font-size:0.78em;color:#6b7280;margin-bottom:10px;">' + pct + '% — ' + fEsc(progressLabel) + '</div>' +
    resumeNote +
    '<button class="btn btn-accent" onclick="openHandbookReader(\'' + fEsc(type) + '\')" style="width:100%;padding:13px 8px;">' + fEsc(btnLabel) + '</button>' +
    '<p style="font-size:0.75em;color:#9ca3af;margin-top:12px;margin-bottom:0;">Read each section of the handbook. Quizzes will appear at key checkpoints.</p>' +
  '</div>';
}

// ─── Handbook Reader ──────────────────────────────────────────────────────────

export async function openHandbookReader(type) {
  const adminPreview  = isAdmin();
  const s             = adminPreview ? null : myStaff();
  const handbookType  = type || (s && s.orientationType) || 'staff';

  if (!adminPreview && !s) { alert('No staff record found.'); return; }

  _hbIsAdminPreview = adminPreview;
  _hbStaffId        = s ? s._id : null;
  _hbHandbookType    = handbookType;
  _hbQuizzesPassed   = (!adminPreview && s && Array.isArray(s.hbQuizzesPassed)) ? [...s.hbQuizzesPassed] : [];
  _hbQuizOpen        = false;
  _hbAlreadyComplete = !adminPreview && !!(s && s.orientationCompletedAt);

  // Saved progress (ignored for admin preview)
  const savedCurrent   = (!adminPreview && s && typeof s.hbCurrentChunk === 'number') ? s.hbCurrentChunk : 0;
  const savedMaxViewed = (!adminPreview && s && typeof s.hbMaxViewed    === 'number') ? s.hbMaxViewed    : 0;

  // Guard against double-tap / rapid re-open
  const token = ++_hbQueryToken;

  // Remove any existing reader or quiz
  const existing = document.getElementById('hb-reader-overlay');
  if (existing) existing.remove();
  const existingQuiz = document.getElementById('hb-quiz-overlay');
  if (existingQuiz) existingQuiz.remove();

  // Loading screen
  const overlay = document.createElement('div');
  overlay.id = 'hb-reader-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.5);display:flex;flex-direction:column;';
  overlay.innerHTML =
    '<div style="background:#fff;flex:1;display:flex;align-items:center;justify-content:center;">' +
      '<div style="font-size:0.9em;color:#6b7280;">Loading handbook…</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Fetch chunks — query by handbookType only (confirmed working); filter + sort in memory
  let chunks;
  try {
    const snap = await getDocs(query(
      collection(db, 'handbookChunks'),
      where('handbookType', '==', handbookType)
    ));
    chunks = snap.docs
      .map(d => ({ ...d.data(), _id: d.id }))
      .filter(c => c.approved === true)
      .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
  } catch (err) {
    if (token !== _hbQueryToken) return;
    overlay.remove();
    alert('Could not load handbook. Please check your connection and try again.');
    return;
  }

  if (token !== _hbQueryToken) return; // A newer call superseded this one

  if (!chunks.length) {
    overlay.remove();
    alert('No approved handbook content found. Please contact an administrator.');
    return;
  }

  _hbChunks    = chunks;
  _hbCurrent   = Math.min(Math.max(0, savedCurrent),   chunks.length - 1);
  _hbMaxViewed = Math.min(Math.max(0, savedMaxViewed),  chunks.length - 1);

  _hbRenderChunk(overlay);
}

function _hbRenderChunk(existingOverlay) {
  const overlay = existingOverlay || document.getElementById('hb-reader-overlay');
  if (!overlay) return;

  const chunk = _hbChunks[_hbCurrent];
  if (!chunk) return;

  // Always update maxViewed to at least current (user is now reading this chunk)
  _hbMaxViewed = Math.max(_hbMaxViewed, _hbCurrent);

  const total      = _hbChunks.length;
  const typeLabel  = (chunk.handbookType || 'staff') === 'volunteer' ? 'Volunteer' : 'Staff';
  const isFirst    = _hbCurrent === 0;
  const isLast     = _hbCurrent === total - 1;

  // Quiz checkpoint awareness
  const chunkIdx          = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : _hbCurrent;
  const handbookType      = chunk.handbookType || _hbHandbookType;
  const cpList            = QUIZ_CHECKPOINTS[handbookType] || [];
  const isCheckpointChunk = cpList.includes(chunkIdx);
  const checkpointId      = handbookType + ':q_after_' + chunkIdx;
  const quizPassed        = _hbIsAdminPreview || _hbQuizzesPassed.includes(checkpointId);
  const showQuizButton    = isCheckpointChunk && !quizPassed;
  // Next is disabled only when it is the last chunk AND no quiz needs to be taken
  const nextDisabled      = isLast && !showQuizButton;
  const nextLabel         = showQuizButton ? 'Take Quiz →' : 'Next →';

  const adminBanner = _hbIsAdminPreview
    ? '<div style="background:#fffbeb;padding:10px 16px;font-size:0.78em;color:#92400e;border-bottom:1px solid #fde68a;flex-shrink:0;font-weight:600;letter-spacing:0.01em;">Admin Preview — reading progress is not saved</div>'
    : '';

  const prevStyle = 'flex:1;min-height:44px;padding:12px 6px;font-size:0.87em;border:1.5px solid #e5e7eb;border-radius:8px;cursor:' + (isFirst ? 'default' : 'pointer') + ';background:' + (isFirst ? '#f9fafb' : '#fff') + ';color:' + (isFirst ? '#d1d5db' : '#374151') + ';';
  const nextActive = !nextDisabled;
  const nextStyle  = 'flex:1;min-height:44px;padding:12px 6px;font-size:0.87em;border-radius:8px;border:1.5px solid ' + (nextActive ? 'var(--primary)' : '#e5e7eb') + ';cursor:' + (nextActive ? 'pointer' : 'default') + ';background:' + (nextActive ? 'var(--primary)' : '#f9fafb') + ';color:' + (nextActive ? '#fff' : '#d1d5db') + ';font-weight:' + (nextActive ? '600' : '400') + ';';

  // Quiz badge shown on checkpoint chunks where quiz has been passed
  const quizBadge = (isCheckpointChunk && quizPassed && !_hbIsAdminPreview)
    ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;padding:3px 10px;font-size:0.72em;color:#15803d;font-weight:600;margin-bottom:12px;">&#10003; Quiz passed</div>'
    : '';

  // Completion section — shown only on final chunk when all checkpoints passed and not already complete
  const reqCps         = REQUIRED_CHECKPOINTS[handbookType] || [];
  const allCpsPassed   = reqCps.every(function(id) { return _hbQuizzesPassed.includes(id); });
  const showCompletion = isLast && !_hbIsAdminPreview && !_hbAlreadyComplete && allCpsPassed;

  overlay.innerHTML =
    '<div style="background:#fff;flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
      adminBanner +
      // Header
      '<div style="padding:14px 16px 12px;border-bottom:1px solid #e5e7eb;flex-shrink:0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
          '<div style="font-size:0.78em;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            fEsc(typeLabel) + ' Handbook' +
            '<span style="color:#d1d5db;margin:0 6px;">•</span>' +
            (_hbCurrent + 1) + ' of ' + total +
          '</div>' +
          '<button onclick="closeHandbookReader()" aria-label="Close" ' +
            'style="background:none;border:none;font-size:1.2em;color:#9ca3af;cursor:pointer;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;">' +
            '&#10005;' +
          '</button>' +
        '</div>' +
      '</div>' +
      // Scrollable content
      '<div style="flex:1;overflow-y:auto;padding:20px 16px 24px;-webkit-overflow-scrolling:touch;">' +
        '<h2 style="font-size:1em;font-weight:700;color:var(--primary);margin:0 0 4px;word-break:break-word;overflow-wrap:break-word;">' +
          fEsc(chunk.sectionTitle || '') +
        '</h2>' +
        '<div style="font-size:0.75em;color:#9ca3af;margin-bottom:16px;">Page ' + fEsc(String(chunk.pageNumber || '')) + '</div>' +
        '<div style="font-size:0.9em;color:#1f2937;line-height:1.7;word-break:break-word;overflow-wrap:break-word;white-space:pre-line;">' +
          fEsc(chunk.chunkText || '') +
        '</div>' +
        '<div style="font-size:0.72em;color:#9ca3af;margin-top:20px;padding-top:12px;border-top:1px solid #f3f4f6;word-break:break-word;overflow-wrap:break-word;">' +
          fEsc(chunk.sourceCitation || '') +
        '</div>' +
        (quizBadge ? '<div style="margin-top:14px;">' + quizBadge + '</div>' : '') +
        (showCompletion
          ? '<div style="margin-top:20px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:14px 16px;">' +
            '<div style="font-weight:700;font-size:0.85em;color:#15803d;margin-bottom:3px;">&#10003; Orientation ready to complete</div>' +
            '<div style="font-size:0.78em;color:#16a34a;">You\'ve read the full handbook and passed all checkpoints.</div>' +
            '</div>'
          : '') +
      '</div>' +
      // Footer
      (showCompletion
        ? '<div style="padding:12px 16px;border-top:1px solid #e5e7eb;flex-shrink:0;">' +
          '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<button onclick="hbPrev()" ' + (isFirst ? 'disabled' : '') + ' style="' + prevStyle + '">← Previous</button>' +
            '<button onclick="closeHandbookReader()" style="flex:1;min-height:44px;padding:12px 6px;font-size:0.87em;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;">Close</button>' +
          '</div>' +
          '<button onclick="hbCompleteOrientation()" style="width:100%;min-height:48px;padding:13px;font-size:0.95em;font-weight:600;background:#16a34a;color:#fff;border:none;border-radius:10px;cursor:pointer;word-break:break-word;">Complete Orientation</button>' +
          '</div>'
        : '<div style="padding:12px 16px;border-top:1px solid #e5e7eb;flex-shrink:0;display:flex;gap:8px;">' +
          '<button onclick="hbPrev()" ' + (isFirst ? 'disabled' : '') + ' style="' + prevStyle + '">← Previous</button>' +
          '<button onclick="closeHandbookReader()" style="flex:1;min-height:44px;padding:12px 6px;font-size:0.87em;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;">Close</button>' +
          '<button onclick="hbNext()" ' + (nextDisabled ? 'disabled' : '') + ' style="' + nextStyle + '">' + nextLabel + '</button>' +
          '</div>') +
    '</div>';
}

export async function hbPrev() {
  if (_hbQuizOpen) return;
  if (_hbCurrent <= 0) return;
  _hbCurrent--;
  _hbRenderChunk();
  _hbSaveProgress();
}

export async function hbNext() {
  if (_hbQuizOpen) return;

  const chunk = _hbChunks[_hbCurrent];
  if (!chunk) return;

  // Check for unfinished quiz checkpoint on the current chunk
  if (!_hbIsAdminPreview) {
    const handbookType = chunk.handbookType || _hbHandbookType;
    const cpList       = QUIZ_CHECKPOINTS[handbookType] || [];
    const chunkIdx     = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : _hbCurrent;
    if (cpList.includes(chunkIdx)) {
      const checkpointId = handbookType + ':q_after_' + chunkIdx;
      if (!_hbQuizzesPassed.includes(checkpointId)) {
        _hbOpenQuiz(checkpointId);
        return;
      }
    }
  }

  if (_hbCurrent >= _hbChunks.length - 1) return;
  _hbCurrent++;
  _hbMaxViewed = Math.max(_hbMaxViewed, _hbCurrent);
  _hbRenderChunk();
  _hbSaveProgress();
}

export async function closeHandbookReader() {
  _hbQuizOpen = false;
  const quizOv = document.getElementById('hb-quiz-overlay');
  if (quizOv) quizOv.remove();
  await _hbSaveProgress();
  const overlay = document.getElementById('hb-reader-overlay');
  if (overlay) overlay.remove();
  if (typeof window.renderProfile === 'function') window.renderProfile();
}

async function _hbSaveProgress() {
  if (_hbIsAdminPreview || !_hbStaffId) return;
  try {
    await DB.updateRecord('staff', _hbStaffId, {
      hbCurrentChunk:        _hbCurrent,
      hbMaxViewed:           _hbMaxViewed,
      hbQuizzesPassed:       _hbQuizzesPassed,
      orientationLastUpdated: new Date().toISOString(),
    });
  } catch (_) {
    // Silently swallow — don't block reading if a write fails
  }
}

// ─── Quiz overlay ─────────────────────────────────────────────────────────────

function _hbOpenQuiz(checkpointId) {
  const quiz = QUIZ_DATA[checkpointId];
  if (!quiz) return;

  const existing = document.getElementById('hb-quiz-overlay');
  if (existing) existing.remove();

  const qHTML = quiz.questions.map(function(q, qi) {
    var opts = q.options.map(function(opt, oi) {
      return '<label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:8px;cursor:pointer;font-size:0.87em;color:#374151;border:1.5px solid #e5e7eb;margin-bottom:8px;min-height:44px;box-sizing:border-box;word-break:break-word;overflow-wrap:break-word;">' +
        '<input type="radio" name="hbq-' + qi + '" value="' + oi + '" style="flex-shrink:0;width:18px;height:18px;margin-top:1px;accent-color:var(--primary);cursor:pointer;">' +
        '<span>' + fEsc(opt) + '</span>' +
      '</label>';
    }).join('');
    return '<div style="margin-bottom:20px;">' +
      '<div style="font-weight:600;font-size:0.88em;color:#1f2937;margin-bottom:10px;line-height:1.5;word-break:break-word;overflow-wrap:break-word;">' +
        (qi + 1) + '. ' + fEsc(q.q) +
      '</div>' +
      opts +
    '</div>';
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'hb-quiz-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1001;display:flex;flex-direction:column;';
  overlay.innerHTML =
    '<div style="background:#fff;flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:14px 16px 12px;border-bottom:1px solid #e5e7eb;flex-shrink:0;background:#fafafa;">' +
        '<div style="font-size:0.72em;color:#9ca3af;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px;">Knowledge Check</div>' +
        '<div style="font-weight:700;font-size:0.95em;color:var(--primary);line-height:1.4;word-break:break-word;overflow-wrap:break-word;">' + fEsc(quiz.label) + '</div>' +
        '<div style="font-size:0.76em;color:#6b7280;margin-top:4px;">Answer all 3 questions correctly to continue.</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:20px 16px 16px;-webkit-overflow-scrolling:touch;">' +
        qHTML +
      '</div>' +
      '<div style="padding:12px 16px;border-top:1px solid #e5e7eb;flex-shrink:0;">' +
        '<div id="hb-quiz-error" style="color:#dc2626;font-size:0.82em;margin-bottom:8px;display:none;"></div>' +
        '<button onclick="hbSubmitQuiz(\'' + checkpointId + '\')" ' +
          'style="width:100%;min-height:48px;padding:13px;font-size:0.95em;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;">Submit Answers</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  _hbQuizOpen = true;
}

export async function hbSubmitQuiz(checkpointId) {
  const quiz = QUIZ_DATA[checkpointId];
  if (!quiz) return;

  // Collect answers
  const answers = quiz.questions.map(function(_, qi) {
    const sel = document.querySelector('input[name="hbq-' + qi + '"]:checked');
    return sel ? parseInt(sel.value, 10) : -1;
  });

  // Validate all answered
  if (answers.includes(-1)) {
    const errEl = document.getElementById('hb-quiz-error');
    if (errEl) { errEl.textContent = 'Please answer all questions before submitting.'; errEl.style.display = 'block'; }
    return;
  }

  const total = quiz.questions.length;
  const score = quiz.questions.reduce(function(s, q, i) { return s + (answers[i] === q.correct ? 1 : 0); }, 0);
  const pass  = score === total;
  const now   = new Date().toISOString();

  // Save attempt to quizAttempts (keyed by checkpointId)
  if (!_hbIsAdminPreview && _hbStaffId) {
    const staffRec   = DB.staff().find(function(r) { return r._id === _hbStaffId; });
    const existing   = (staffRec && staffRec.quizAttempts) ? staffRec.quizAttempts : {};
    const prior      = Array.isArray(existing[checkpointId]) ? existing[checkpointId] : [];
    const attempt    = { ts: now, answers: answers, score: score, total: total, pass: pass };
    const newAttempts = Object.assign({}, existing, { [checkpointId]: [...prior, attempt] });
    try {
      await DB.updateRecord('staff', _hbStaffId, {
        quizAttempts:          newAttempts,
        orientationLastUpdated: now,
      });
    } catch (_) {}
  }

  if (pass) {
    if (!_hbQuizzesPassed.includes(checkpointId)) {
      _hbQuizzesPassed = [..._hbQuizzesPassed, checkpointId];
    }
    await _hbSaveProgress();
    _hbShowQuizPass(checkpointId);
  } else {
    _hbShowQuizFail(checkpointId, quiz, answers, score, total);
  }
}

function _hbShowQuizPass(checkpointId) {
  const overlay = document.getElementById('hb-quiz-overlay');
  if (!overlay) return;

  const isLast = _hbCurrent >= _hbChunks.length - 1;
  const continueBtn = isLast
    ? '<button onclick="hbCloseQuizDone()" style="width:100%;min-height:48px;padding:13px;font-size:0.95em;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;">Close</button>'
    : '<button onclick="hbContinueAfterQuiz()" style="width:100%;min-height:48px;padding:13px;font-size:0.95em;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;">Continue Reading →</button>';

  overlay.innerHTML =
    '<div style="background:#fff;flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:32px 24px;">' +
        '<div style="text-align:center;max-width:320px;width:100%;">' +
          '<div style="font-size:2.5em;margin-bottom:16px;color:#16a34a;">&#10003;</div>' +
          '<div style="font-weight:700;font-size:1.1em;color:#15803d;margin-bottom:8px;">All correct!</div>' +
          '<div style="font-size:0.87em;color:#6b7280;margin-bottom:24px;">' +
            ((_hbCurrent >= _hbChunks.length - 1)
              ? "You've passed all checkpoints. Great work reading through the handbook!"
              : 'You passed this checkpoint. Keep reading!') +
          '</div>' +
          continueBtn +
        '</div>' +
      '</div>' +
    '</div>';
}

function _hbShowQuizFail(checkpointId, quiz, answers, score, total) {
  const overlay = document.getElementById('hb-quiz-overlay');
  if (!overlay) return;

  const reviewHTML = quiz.questions.map(function(q, qi) {
    const correct = answers[qi] === q.correct;
    const bg      = correct ? '#f0fdf4' : '#fef2f2';
    const border  = correct ? '#bbf7d0' : '#fecaca';
    const icon    = correct ? '✓' : '✗';
    const iconCol = correct ? '#15803d' : '#dc2626';
    return '<div style="background:' + bg + ';border:1.5px solid ' + border + ';border-radius:8px;padding:12px;margin-bottom:10px;">' +
      '<div style="font-weight:600;font-size:0.85em;color:#1f2937;margin-bottom:6px;word-break:break-word;overflow-wrap:break-word;">' +
        '<span style="color:' + iconCol + ';margin-right:6px;">' + icon + '</span>' +
        (qi + 1) + '. ' + fEsc(q.q) +
      '</div>' +
      (!correct
        ? '<div style="font-size:0.82em;color:#7f1d1d;margin-bottom:4px;">Your answer: ' + fEsc(q.options[answers[qi]] !== undefined ? q.options[answers[qi]] : '—') + '</div>' +
          '<div style="font-size:0.82em;color:#15803d;font-weight:600;margin-bottom:6px;">Correct: ' + fEsc(q.options[q.correct]) + '</div>' +
          '<div style="font-size:0.8em;color:#374151;margin-bottom:4px;word-break:break-word;overflow-wrap:break-word;">' + fEsc(q.explanation) + '</div>' +
          '<div style="font-size:0.73em;color:#9ca3af;font-style:italic;word-break:break-word;overflow-wrap:break-word;">' + fEsc(q.citation) + '</div>'
        : ''
      ) +
    '</div>';
  }).join('');

  overlay.innerHTML =
    '<div style="background:#fff;flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:14px 16px 12px;border-bottom:1px solid #e5e7eb;flex-shrink:0;background:#fef2f2;">' +
        '<div style="font-weight:700;font-size:0.95em;color:#dc2626;">Score: ' + score + '/' + total + ' — Not all answers were correct</div>' +
        '<div style="font-size:0.78em;color:#6b7280;margin-top:4px;">Review the explanations below, then try again. All answers must be correct to continue.</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch;">' +
        reviewHTML +
      '</div>' +
      '<div style="padding:12px 16px;border-top:1px solid #e5e7eb;flex-shrink:0;">' +
        '<button onclick="hbRetryQuiz(\'' + checkpointId + '\')" ' +
          'style="width:100%;min-height:48px;padding:13px;font-size:0.95em;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;">Try Again</button>' +
      '</div>' +
    '</div>';
}

export function hbRetryQuiz(checkpointId) {
  _hbOpenQuiz(checkpointId);
}

export async function hbContinueAfterQuiz() {
  _hbQuizOpen = false;
  const quizOv = document.getElementById('hb-quiz-overlay');
  if (quizOv) quizOv.remove();
  // _hbQuizzesPassed already includes this checkpoint, so hbNext() advances normally
  await hbNext();
}

export function hbCloseQuizDone() {
  _hbQuizOpen = false;
  const quizOv = document.getElementById('hb-quiz-overlay');
  if (quizOv) quizOv.remove();
  // Re-render the reader to show the "Quiz passed" badge / completion section on the final chunk
  _hbRenderChunk();
}

export async function hbCompleteOrientation() {
  if (_hbIsAdminPreview || !_hbStaffId) return;
  const handbookType = _hbHandbookType;
  const reqCps = REQUIRED_CHECKPOINTS[handbookType] || [];
  if (!reqCps.every(function(id) { return _hbQuizzesPassed.includes(id); })) return;
  if (_hbMaxViewed < _hbChunks.length - 1) return;

  const now = new Date().toISOString();
  try {
    await DB.updateRecord('staff', _hbStaffId, {
      orientationCompletedAt: now,
      orientationLastUpdated: now,
      hbCurrentChunk:         _hbCurrent,
      hbMaxViewed:            _hbMaxViewed,
      hbQuizzesPassed:        _hbQuizzesPassed,
    });
  } catch (_) {
    alert('Could not save completion. Please check your connection and try again.');
    return;
  }

  // Remove overlays; onSnapshot will detect orientationCompletedAt, unlock nav, navigate to dashboard
  const quizOv = document.getElementById('hb-quiz-overlay');
  if (quizOv) quizOv.remove();
  const readerOv = document.getElementById('hb-reader-overlay');
  if (readerOv) readerOv.remove();
  if (typeof window.renderProfile === 'function') window.renderProfile();
}

// ─── Legacy module overlay (kept for backwards compat; not shown in main card) ─

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
        '<div style="color:#dc2626;font-weight:700;font-size:0.87em;margin-bottom:4px;">Score: ' + score + '/' + total + ' — not all answers were correct.</div>' +
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
  // Reset reader position when switching tracks so the index stays in range
  if (s.orientationType && s.orientationType !== type) {
    update.hbCurrentChunk = 0;
    update.hbMaxViewed    = 0;
  }
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
  if (!confirm('Reset orientation progress for this staff member? All completed sections, quiz attempts, and handbook reading progress will be cleared.')) return;
  await DB.updateRecord('staff', staffId, {
    orientationType:        '',
    orientationStartedAt:   '',
    orientationCompletedAt: '',
    completedSections:      [],
    quizAttempts:           {},
    hbCurrentChunk:         0,
    hbMaxViewed:            0,
    hbQuizzesPassed:        [],
    orientationLastUpdated: new Date().toISOString(),
  });
}
