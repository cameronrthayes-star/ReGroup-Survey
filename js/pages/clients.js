import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';

const CLIENT_SEED = [
  {clientId:'1101',firstName:'Melissa',lastName:'Salazar',email:'msalazar1264@gmail.com',phone:'971-500-0766',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1102',firstName:'Daniel',lastName:'De Jesus',email:'ddejese@gmail.com',phone:'(503) 812-6980',address:'',confirmation:'',notes:''},
  {clientId:'1103',firstName:'Trevor',lastName:'Walraven',email:'trevor@ojrc.info',phone:'5039496907',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1104',firstName:'Jay',lastName:'Brown',email:'jay.brown@pearlbuckcenter.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1105',firstName:'Wendell',lastName:'Butler',email:'butlerwg@comcast.net',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1106',firstName:'Adam',lastName:'Gilliam',email:'agilliam8673@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1107',firstName:'Mustafa',lastName:'Moore',email:'mustafa7@comcast.net',phone:'541 337-1979',address:'',confirmation:'',notes:''},
  {clientId:'1108',firstName:'Cameron',lastName:'Hayes',email:'cameronrthayes@gmail.com',phone:'808-773-2991',address:'',confirmation:'',notes:''},
  {clientId:'1109',firstName:'Justin',lastName:'Lester',email:'justin@sageorchard.net',phone:'5038710956',address:'',confirmation:'',notes:''},
  {clientId:'1110',firstName:'Matt',lastName:'',email:'foreverleatherusa@outlook.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1111',firstName:'Thomas "Zinn"',lastName:'Dickerson',email:'tcardelldickerson@gmail.com',phone:'5039156643',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1112',firstName:'Carlos Jr',lastName:'Rubio Calderon',email:'carlitos.calderon1@icloud.com',phone:'(503) 975-1925',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1113',firstName:'Kyle',lastName:'Black',email:'kblack@ojrc.info',phone:'503-915-9746',address:'',confirmation:'',notes:''},
  {clientId:'1114',firstName:'Taryn',lastName:'VanderPyl',email:'tvanderpyl@tjcoregon.org',phone:'(602)320-8401',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1115',firstName:'Jann (JR)',lastName:'Oslund',email:'jroslund21@gmail.com',phone:'971-389-6170',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1116',firstName:'Lorie',lastName:'Perkins',email:'lorie@housingourveterans.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1117',firstName:'Jason',lastName:'Hice',email:'jasonhice760@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1118',firstName:'Kaesha',lastName:'Green',email:'brooksbella38@gmail.com',phone:'9714204278',address:'',confirmation:'',notes:''},
  {clientId:'1119',firstName:'Elaine',lastName:'Walters',email:'ewalters@healingattention.org',phone:'541-687-9447',address:'',confirmation:'',notes:''},
  {clientId:'1120',firstName:'Carlos',lastName:'Ortega',email:'carlosortegac83@gmail.com',phone:'(503) 868-9266',address:'',confirmation:'',notes:''},
  {clientId:'1121',firstName:'Brandon',lastName:'Gillespie',email:'gillespiebrandon502@gmail.com',phone:'541-292-4822',address:'',confirmation:'',notes:''},
  {clientId:'1122',firstName:'',lastName:'',email:'khoehl@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1123',firstName:'Jerome',lastName:'Sloan',email:'j.sloan.pdx@gmail.com',phone:'971-204-5735',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1124',firstName:'Mike',lastName:'Wilson',email:'wilsonm@mail.wou.edu',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1125',firstName:'Skylar',lastName:'Connolly',email:'sconnolly19@mail.wou.edu',phone:'9713124494',address:'',confirmation:'',notes:''},
  {clientId:'1126',firstName:'Philip Scott',lastName:'Cannon',email:'pscottcannon@gmail.com',phone:'9712739887',address:'',confirmation:'',notes:''},
  {clientId:'1127',firstName:'Charles C.',lastName:'Lane',email:'Charles42lane@gmail.com',phone:'5417357724',address:'',confirmation:'',notes:''},
  {clientId:'1128',firstName:'Damon',lastName:'',email:'damonwg5572@icloud.com',phone:'5415208145',address:'',confirmation:'',notes:''},
  {clientId:'1129',firstName:'Melissa',lastName:'Buis',email:'mbuis@tjcoregon.org',phone:'(503) 881-2773',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1130',firstName:'Troy',lastName:'Ramsey',email:'ramseytroy21@gmail.com',phone:'5037801743',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1131',firstName:'Melinda',lastName:'Venegas',email:'reyes77@comcast.net',phone:'503-890-2557',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1132',firstName:'India',lastName:'Hall',email:'indiah2001@yahoo.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1133',firstName:'Benjamin',lastName:'Pervish',email:'benpervish@gmail.com',phone:'503-919-6883',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1134',firstName:'Sterling',lastName:'Cunio',email:'regroup@tjcoregon.org',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1135',firstName:'Sarah',lastName:'Lester',email:'Tazaroo2014@yahoo.com',phone:'503-798-5657',address:'',confirmation:'',notes:''},
  {clientId:'1136',firstName:'Alex',lastName:'Cortez',email:'alexcortez0097@gmail.com',phone:'9712838391',address:'',confirmation:'',notes:''},
  {clientId:'1137',firstName:'Robert',lastName:'Howard',email:'rchowardiv@icloud.com',phone:'925-324-5236',address:'',confirmation:'',notes:''},
  {clientId:'1138',firstName:'Tacuma',lastName:'Jackson',email:'tacumaj2021@gmail.com',phone:'',address:'',confirmation:'',notes:'Need a new #'},
  {clientId:'1139',firstName:'Scott',lastName:'Spencer-Wolff',email:'drscott_ac@icloud.com',phone:'(503) 747-9272',address:'',confirmation:'',notes:''},
  {clientId:'1140',firstName:'Tony',lastName:'Bonner',email:'deliverybyjamesllc@gmail.com',phone:'6019830494',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1141',firstName:'Leo',lastName:'Robles',email:'roblesleo257@gmail.com',phone:'971-454-2527',address:'',confirmation:'',notes:''},
  {clientId:'1142',firstName:'Tyrone',lastName:'Jones',email:'tynangie@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1143',firstName:'Ron',lastName:'Edgemon',email:'ronedgemon3@gmail.com',phone:'503-215-8025',address:'',confirmation:'',notes:''},
  {clientId:'1144',firstName:'Kyle',lastName:'Hedquist',email:'kylehedquist@icloud.com',phone:'5416435055',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1145',firstName:'D\'Angello',lastName:'Andrade',email:'dangelloandrade@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1146',firstName:'Richard',lastName:'Dutra',email:'dutrarick51724@icloud.com',phone:'',address:'',confirmation:'360',notes:''},
  {clientId:'1147',firstName:'Adam',lastName:'Gilliam',email:'a.gilliam8673@gmail.com',phone:'541-514-3840',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1148',firstName:'Ivan',lastName:'Dixon',email:'ivan.dixon@hotmail.com',phone:'360-728-7881',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1149',firstName:'Mindy',lastName:'Johnston',email:'mjohnston@lcsnw.org',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1150',firstName:'Cory',lastName:'Adair',email:'corybenadair@gmail.com',phone:'541-690-0462',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1151',firstName:'Denna',lastName:'Fulton',email:'dennafultonlcsw@gmail.com',phone:'541-232-3555',address:'',confirmation:'',notes:''},
  {clientId:'1152',firstName:'Nolan',lastName:'Perkins',email:'perkins_painting@yahoo.com',phone:'5517995427',address:'',confirmation:'',notes:''},
  {clientId:'1153',firstName:'Donovan',lastName:'Randle',email:'donovan.r.4564@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1154',firstName:'Scott',lastName:'Spencer-Wolff',email:'dscottsw@gmail.com',phone:'503-747-9272',address:'',confirmation:'',notes:''},
  {clientId:'1155',firstName:'Bobby',lastName:'Jackson',email:'boflex37@icloud.com',phone:'5035698794',address:'',confirmation:'',notes:''},
  {clientId:'1156',firstName:'',lastName:'',email:'sewsup2@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1157',firstName:'Damon',lastName:'Petrie',email:'damonlpetrie@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1158',firstName:'Wes',lastName:'Lewis',email:'wesleylewis194@gmail.com',phone:'419-677-2861',address:'',confirmation:'',notes:''},
  {clientId:'1159',firstName:'Randall',lastName:'Clegg',email:'Mrrandallc74@gmail.com',phone:'(971)280-4491',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1160',firstName:'Denna',lastName:'Fulton',email:'denna.fulton@lanecountyor.gov',phone:'541-232-3555',address:'',confirmation:'',notes:''},
  {clientId:'1161',firstName:'Stephanie',lastName:'',email:'stephanieowuor1334@gmail.com',phone:'9712762131',address:'',confirmation:'',notes:''},
  {clientId:'1162',firstName:'',lastName:'',email:'beardjessica8@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1163',firstName:'Lydia',lastName:'Smith',email:'lydiabsmith@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1164',firstName:'Trese',lastName:'',email:'dannieisom@yahoo.com',phone:'360-909-4234',address:'',confirmation:'',notes:''},
  {clientId:'1165',firstName:'Michael',lastName:'Kaiser',email:'mpatrick97524@gmail.com',phone:'971-389-0304',address:'',confirmation:'',notes:''},
  {clientId:'1166',firstName:'',lastName:'',email:'bmadison798@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1167',firstName:'Theresa',lastName:'Huggins',email:'thuggins@lcsnw.org',phone:'503-732-4169',address:'',confirmation:'',notes:''},
  {clientId:'1168',firstName:'Lisa',lastName:'Brumbaugh',email:'lisabrumbaugh123@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1169',firstName:'Robert',lastName:'Kelley',email:'kelleyarobert@icloud.com',phone:'503-572-3880',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1170',firstName:'Muhammad',lastName:'',email:'',phone:'503-339-4522',address:'',confirmation:'',notes:''},
  {clientId:'1171',firstName:'Jovahnee',lastName:'Hall',email:'Jovahnee.hall@gmail.com',phone:'360-718-0397',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1172',firstName:'Ricky',lastName:'Hall',email:'',phone:'971-331-8826',address:'',confirmation:'',notes:''},
  {clientId:'1173',firstName:'John',lastName:'Lewis',email:'',phone:'503-819-9177',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1174',firstName:'Derek',lastName:'Salley',email:'Keredsalley@gmail.com',phone:'682-802-0039',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1175',firstName:'Laurence',lastName:'Farmington',email:'Caringthroughtconcrete@gmail.com',phone:'503-709-2203',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1176',firstName:'Megan',lastName:'Fort Meyer',email:'Megannfortmeyer@gmail.com',phone:'503-550-8937',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1177',firstName:'Jose',lastName:'Ruiz Lona',email:'Josealona12gmail.com',phone:'503-730-6145',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1178',firstName:'Jennifer',lastName:'Reinhart',email:'Jenniferannwegner@gmail.com',phone:'541-270-0236',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1179',firstName:'Dale',lastName:'Casey',email:'dale.casey@gmail.com',phone:'503-954-7590',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1180',firstName:'LaTrese',lastName:'Isom',email:'Anyway.dannieisom@yahoo.com',phone:'360-909-4234',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1181',firstName:'Jade',lastName:'Noa',email:'Jade.noa.designs@gmail.com',phone:'503-496-8554',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1182',firstName:'Christopher',lastName:'Lambert',email:'rosecitychristopher@gmail.com',phone:'971-408-3605',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1183',firstName:'Rachel',lastName:'Guirsch-Webb',email:'rbguirsch@gmail.com',phone:'503-312-3087',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1184',firstName:'Moniell',lastName:'Holmes',email:'Moniell04holmes@gmail.com',phone:'971-263-5800',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1185',firstName:'Kavantae',lastName:'Powell',email:'',phone:'503-975-3684',address:'',confirmation:'',notes:''},
  {clientId:'1186',firstName:'Antonio',lastName:'Walker',email:'',phone:'971-512-5988',address:'',confirmation:'',notes:''},
  {clientId:'1187',firstName:'Lisa',lastName:'Kendall',email:'Lisakendall29@yahoo.com',phone:'971-359-7738',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1188',firstName:'',lastName:'',email:'drzohra@msn.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1189',firstName:'',lastName:'',email:'kmichaelson62@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1190',firstName:'',lastName:'',email:'troy.mccord@icloud.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1191',firstName:'',lastName:'',email:'jasonhauxhurst467@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1192',firstName:'',lastName:'',email:'brittmcmahon823@icloud.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1193',firstName:'',lastName:'',email:'abmoore@pdx.edu',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1194',firstName:'',lastName:'',email:'gabrielgrajiola1@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1195',firstName:'Micheal',lastName:'Walter',email:'mikegunny5975@gmail.com',phone:'',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1196',firstName:'Jason',lastName:'McLavey',email:'',phone:'841-971-5038',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1197',firstName:'Rafael',lastName:'Ramoa',email:'',phone:'971-707-3498',address:'',confirmation:'',notes:''},
  {clientId:'1198',firstName:'',lastName:'',email:'bdolphdory@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1199',firstName:'',lastName:'',email:'kiramgrimes@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1200',firstName:'',lastName:'',email:'Steve.M@1touchministry.org',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1201',firstName:'Angelinna',lastName:'',email:'angelinnaloganz@icloud.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1202',firstName:'Aaron',lastName:'Jackson',email:'aacir87@gmail.com',phone:'971-497-6412',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1203',firstName:'Martin',lastName:'Muigai',email:'',phone:'',address:'PRCF',confirmation:'',notes:''},
  {clientId:'1204',firstName:'Jaleese',lastName:'Bryant',email:'',phone:'',address:'CCCI',confirmation:'',notes:''},
  {clientId:'1205',firstName:'Illana',lastName:'Warren',email:'ilana.warren65@yahoo.com',phone:'360-991-3495',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1206',firstName:'Jonathan',lastName:'Busch',email:'',phone:'',address:'PRCF',confirmation:'',notes:'#14476350'},
  {clientId:'1207',firstName:'David',lastName:'Clay',email:'',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1208',firstName:'Joseph',lastName:'Wehage',email:'',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1209',firstName:'Jeremy',lastName:'Quinteros',email:'jeremyquinteros@gmail.com',phone:'971-329-3755',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1210',firstName:'Christopher',lastName:'Bolds',email:'',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1211',firstName:'Loren',lastName:'Lucus',email:'',phone:'971-718-8822',address:'',confirmation:'',notes:''},
  {clientId:'1212',firstName:'Armando',lastName:'Geiger',email:'',phone:'503-81-1183',address:'',confirmation:'',notes:''},
  {clientId:'1213',firstName:'Robert',lastName:'King Jr.',email:'',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1214',firstName:'Casey',lastName:'Koerner',email:'sacredlion@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1215',firstName:'Cody',lastName:'Hidebrandt',email:'codydeanhildebrandt2026@gmail.com',phone:'503-385-5366',address:'',confirmation:'',notes:''},
  {clientId:'1216',firstName:'Devon',lastName:'Balwin',email:'baldwin.devon@yahoo.com',phone:'541-405-6797',address:'',confirmation:'',notes:''},
  {clientId:'1217',firstName:'Brett',lastName:'Schneider',email:'',phone:'503-531-0443',address:'',confirmation:'',notes:''},
  {clientId:'1218',firstName:'Robert',lastName:'Twigger',email:'',phone:'503-410-2308',address:'',confirmation:'',notes:''},
  {clientId:'1219',firstName:'Mariah',lastName:'Gaut',email:'gautamariah3@gmail.com',phone:'541-378-2934',address:'',confirmation:'',notes:'Release: 5-25-2026'},
  {clientId:'1220',firstName:'Michael',lastName:'Anderson',email:'manderson71681@gmail.com',phone:'360-270-1276',address:'',confirmation:'',notes:'Release: 5-27-2026'},
  {clientId:'1221',firstName:'Eric',lastName:'Hayes',email:'',phone:'971-847-5060',address:'',confirmation:'',notes:''},
  {clientId:'1222',firstName:'Demarco',lastName:'Gonzales',email:'',phone:'971-409-8955',address:'',confirmation:'',notes:''},
  {clientId:'1223',firstName:'Lonnie',lastName:'Bickham',email:'',phone:'985-789-5182',address:'',confirmation:'',notes:''},
  {clientId:'1224',firstName:'Xavier',lastName:'Barron',email:'',phone:'971-433-6999',address:'',confirmation:'',notes:''},
  {clientId:'1225',firstName:'Gerardo',lastName:'Santiago',email:'santiagsc@gmail.com',phone:'971-487-9359',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1226',firstName:'Joshua',lastName:'Mulbreght',email:'jushuaim90@gmail.com',phone:'503-991-1686',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1227',firstName:'Megan',lastName:'Mercer',email:'ourlimitlesssouls@proton.me',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1228',firstName:'Hayden',lastName:'',email:'hgrahaminvestigations@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1229',firstName:'Oliver',lastName:'Loewy',email:'oliverwloewy@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1230',firstName:'Bill',lastName:'Benton',email:'billrellie@gmail.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1231',firstName:'Ashlee',lastName:'Albies',email:'Ashlee@albiesstark.com',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1232',firstName:'Casey',lastName:'Koerner',email:'sacredlion@gmail.com',phone:'',address:'',confirmation:'ION',notes:''},
  {clientId:'1233',firstName:'Cody',lastName:'Hildebrandt',email:'Codydeanhildebrandt@gmail.com',phone:'503-385-5366',address:'',confirmation:'Accurate ION',notes:''},
  {clientId:'1234',firstName:'Taron',lastName:'Daly',email:'dalytaron831@gmail.com',phone:'458-351-6098',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1235',firstName:'Shawn',lastName:'Bartmess',email:'shawnbartmess9@gmail.com',phone:'971-420-3549',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1236',firstName:'Austin',lastName:'Kountz',email:'akountz@gmail.com',phone:'971-519-8830',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1237',firstName:'Daeangelo',lastName:'Turner',email:'tdeangelo294@gmail.com',phone:'971-678-0546',address:'',confirmation:'Accurate',notes:''},
  {clientId:'1238',firstName:'Kalan',lastName:'Kince',email:'Kalan.kince83@gmai.com',phone:'541-406-8579',address:'',confirmation:'Accurate ION',notes:''},
  {clientId:'1239',firstName:'EliShama',lastName:'Mathews',email:'',phone:'',address:'',confirmation:'',notes:''},
  {clientId:'1240',firstName:'Lelan',lastName:'Prichett',email:'lelanprichett02@gmail.com',phone:'503-660-2559',address:'',confirmation:'Accurate',notes:''}
];

async function seedClientsIfEmpty() {
  if (_clients.length > 0) return;
  // Wait a moment for Firestore snapshot to confirm empty
  await new Promise(r => setTimeout(r, 1500));
  if (_clients.length > 0) return;
  for (const c of CLIENT_SEED) {
    await addDoc(collection(db,'clients'), {...c, _createdAt: serverTimestamp()});
  }
}

function clientHomeMeetings() {
  return [...new Set(DB.clients().map(c=>(c.homeMeeting||'').trim()).filter(Boolean))].sort();
}
function populateHomeMeetingList() {
  const dl = document.getElementById('home-meeting-list');
  if (dl) dl.innerHTML = clientHomeMeetings().map(m=>`<option value="${m.replace(/"/g,'&quot;')}">`).join('');
}
function clientFullName(c){ return [c.firstName,c.lastName].filter(Boolean).join(' '); }
function populateClientNameList(){
  const dl=document.getElementById('client-name-list');
  if (dl) dl.innerHTML = DB.clients().map(c=>`<option value="${fEsc(clientFullName(c))}">`).join('');
}
// Auto-fill the client ID when a client name is typed/selected on a note form
function fillClientId(prefix){
  const nameEl=document.getElementById(prefix+'-clientName');
  const idEl=document.getElementById(prefix+'-clientId');
  if(!nameEl||!idEl) return;
  const v=nameEl.value.trim().toLowerCase();
  const c=DB.clients().find(x=>clientFullName(x).toLowerCase()===v);
  if(c) idEl.value=c.clientId||'';
}

function renderClientDirectory() {
  populateHomeMeetingList();
  const q = (document.getElementById('client-search')?.value || '').toLowerCase();
  const rel = document.getElementById('client-rel-filter')?.value || '';
  let list = DB.clients();
  if (q) {
    list = list.filter(c => {
      const name = (c.firstName+' '+c.lastName).toLowerCase();
      return name.includes(q) || (c.email||'').toLowerCase().includes(q) ||
             (c.phone||'').includes(q) || (c.clientId||'').includes(q) ||
             (c.notes||'').toLowerCase().includes(q) || (c.homeMeeting||'').toLowerCase().includes(q);
    });
  }
  if (rel) list = list.filter(c => (c.relationship||'Client') === rel);
  const countEl = document.getElementById('client-count');
  if (countEl) countEl.textContent = `${list.length} of ${DB.clients().length} contacts`;
  const wrap = document.getElementById('client-table-wrap');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<p style="color:#bbb;font-size:0.875em;">No clients found.</p>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr>
      <th style="width:60px">ID</th>
      <th>Name</th>
      <th>Email</th>
      <th>Phone</th>
      <th style="width:100px">Relationship</th>
      <th>Home Meeting</th>
      <th style="width:90px">Status</th>
      <th style="width:84px">Actions</th>
    </tr></thead>
    <tbody>${list.map(c=>{
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '<span style="color:#bbb">—</span>';
      const badge = c.confirmation === 'Accurate' ? '<span class="badge badge-success">Accurate</span>' :
                    c.confirmation === 'ION' ? '<span class="badge badge-warn">ION</span>' :
                    c.confirmation === 'Accurate ION' ? '<span class="badge badge-info">Acc+ION</span>' :
                    c.confirmation ? `<span class="badge badge-info">${c.confirmation}</span>` : '';
      return `<tr>
        <td style="font-weight:700;color:var(--primary);">${c.clientId||'—'}</td>
        <td>${name}${c.notes?`<div style="font-size:0.75em;color:#888;margin-top:2px;">${c.notes}</div>`:''}</td>
        <td style="font-size:0.83em;color:#555;">${c.email||'—'}</td>
        <td style="font-size:0.85em;">${c.phone||'—'}</td>
        <td style="font-size:0.8em;"><span class="badge badge-info">${c.relationship||'Client'}</span></td>
        <td style="font-size:0.83em;">${c.homeMeeting?`<span class="badge badge-info">${c.homeMeeting}</span>`:'—'}</td>
        <td>${badge}</td>
        <td><button class="btn btn-outline" style="padding:4px 8px;font-size:0.75em;" onclick="openClientModal('${c._id}')">Edit Fields</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function openClientModal(id) {
  const modal = document.getElementById('client-modal');
  const deleteBtn = document.getElementById('cm-delete-btn');
  if (id) {
    const c = DB.clients().find(x=>x._id===id);
    if (!c) return;
    document.getElementById('client-modal-title').textContent = 'Edit Directory Contact';
    document.getElementById('cm-id').value = id;
    document.getElementById('cm-clientId').value = c.clientId||'';
    document.getElementById('cm-firstName').value = c.firstName||'';
    document.getElementById('cm-lastName').value = c.lastName||'';
    document.getElementById('cm-email').value = c.email||'';
    document.getElementById('cm-phone').value = c.phone||'';
    document.getElementById('cm-address').value = c.address||'';
    document.getElementById('cm-homeMeeting').value = c.homeMeeting||'';
    document.getElementById('cm-relationship').value = c.relationship||'Client';
    document.getElementById('cm-confirmation').value = c.confirmation||'';
    document.getElementById('cm-notes').value = c.notes||'';
    deleteBtn.style.display = 'inline-flex';
  } else {
    document.getElementById('client-modal-title').textContent = 'Add Directory Contact';
    document.getElementById('cm-id').value = '';
    ['cm-clientId','cm-firstName','cm-lastName','cm-email','cm-phone','cm-address','cm-homeMeeting','cm-notes'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('cm-confirmation').value = '';
    document.getElementById('cm-relationship').value = 'Client';
    // Auto-assign next ID
    const ids = DB.clients().map(c=>parseInt(c.clientId)||0);
    const nextId = ids.length ? Math.max(...ids)+1 : 1241;
    document.getElementById('cm-clientId').value = String(nextId);
    deleteBtn.style.display = 'none';
  }
  populateHomeMeetingList();
  modal.style.display = 'flex';
}

function closeClientModal() {
  document.getElementById('client-modal').style.display = 'none';
}

async function saveClient() {
  const id = document.getElementById('cm-id').value;
  const data = {
    clientId: document.getElementById('cm-clientId').value.trim(),
    firstName: document.getElementById('cm-firstName').value.trim(),
    lastName: document.getElementById('cm-lastName').value.trim(),
    email: document.getElementById('cm-email').value.trim(),
    phone: document.getElementById('cm-phone').value.trim(),
    address: document.getElementById('cm-address').value.trim(),
    homeMeeting: document.getElementById('cm-homeMeeting').value.trim(),
    relationship: document.getElementById('cm-relationship').value,
    confirmation: document.getElementById('cm-confirmation').value,
    notes: document.getElementById('cm-notes').value.trim(),
  };
  if (id) {
    await DB.updateClient(id, data);
  } else {
    await DB.addClient(data);
  }
  closeClientModal();
}

function deleteClient() {
  const id = document.getElementById('cm-id').value;
  if (!id) return;
  requireAdmin(async () => {
    if (!confirm('Remove this client from the directory? This cannot be undone.')) return;
    await DB.removeClient(id);
    closeClientModal();
  });
}

export { renderClientDirectory, openClientModal, closeClientModal, saveClient, deleteClient,
  seedClientsIfEmpty, clientHomeMeetings, populateHomeMeetingList, clientFullName,
  populateClientNameList, fillClientId };
