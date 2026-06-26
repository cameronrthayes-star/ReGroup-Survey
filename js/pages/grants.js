import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
import { meetingBotBaseUrl, ensureMeetingBotSession } from './calendar.js';

async function runGrantsAgent(){
  const status=document.getElementById('grants-status');
  const project=document.getElementById('gr-project').value.trim();
  const purpose=document.getElementById('gr-purpose').value.trim();
  if(!project || !purpose){ status.style.color='#e53935'; status.textContent='Enter at least a project name and purpose.'; return; }
  let token='';
  try{ token=await ensureMeetingBotSession(); }
  catch(err){ status.style.color='#e53935'; status.textContent='Could not authorize: '+err.message; return; }
  const details=
    'Project: '+project+'\n'+
    'Purpose/activities/impact: '+purpose+'\n'+
    'Who it serves: '+document.getElementById('gr-population').value.trim()+'\n'+
    'Geography: '+document.getElementById('gr-geo').value.trim()+'\n'+
    'Amount needed: '+document.getElementById('gr-amount').value.trim()+'\n'+
    'Timeline: '+document.getElementById('gr-timeline').value.trim()+'\n'+
    'Funding types of interest: '+document.getElementById('gr-types').value.trim()+'\n'+
    'Organization: '+document.getElementById('gr-org').value.trim();
  const prompt=
    'You are an expert grant researcher and nonprofit fundraising strategist. Using web search, find REAL, currently-open or recurring funding opportunities that fit the PROJECT IDEA below. '+
    'IMPORTANT: Match funders to the project\'s actual focus area and activities — do NOT limit the search to reentry or restorative-justice funders. '+
    'The organization is a reentry/RJ nonprofit, but the funding search should follow the project topic (e.g. housing, workforce/jobs, youth, education, health/mental health, food security, technology, arts, financial literacy, small business, etc.) and pursue EVERY relevant source. '+
    'Cast a wide net across: private & community foundations; federal, state, county and city government grants; corporate giving programs and sponsorships (name specific companies active in the project\'s sector and region); bank and CREDIT UNION community-investment / CRA / member-giving funds; civic clubs and service organizations; sector-specific funders; sponsorships; and crowdfunding. '+
    'Prioritize Oregon / Pacific Northwest and national sources, but breadth and fit to the idea matter more than the organization\'s usual category. '+
    'Then suggest other creative ways to fund the project, then a comprehensive funding plan. '+
    'Respond in Markdown with exactly these three sections and headers:\n'+
    '## Matching Funding Sources\n(Group by type — Foundations, Government, Corporate, Banks/Credit Unions, Other. For each: **name** — funder/type, approx amount, deadline if known, one-line fit to the idea, and a link.)\n'+
    '## Other Funding Ideas\n(Bulleted creative strategies — events, corporate sponsorship, earned income, memberships, individual/major giving, crowdfunding, in-kind, etc.)\n'+
    '## Comprehensive Funding Plan\n(A prioritized, time-phased plan combining the above into a realistic strategy, with rough dollar targets.)\n\n'+
    'PROJECT DETAILS:\n'+details;
  const btn=document.getElementById('grants-run-btn');
  btn.disabled=true; status.style.color='#666'; status.textContent='Researching grants & funding (this can take 20–60s)…';
  document.getElementById('grants-results').innerHTML='';
  let text='', searched=false;
  try{
    const resp=await fetch(meetingBotBaseUrl()+'/api/ai/grants',{
      method:'POST',
      headers:{'content-type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({prompt,use_web_search:true})
    });
    if(!resp.ok){ let d=''; try{const e=await resp.json(); d=(e.error&&(e.error.message||e.error))||'';}catch(_){} throw new Error('AI error '+(d||resp.status)); }
    const j=await resp.json();
    text=j.text||''; searched=!!j.searched;
  }catch(e2){ btn.disabled=false; status.style.color='#e53935'; status.textContent='AI error — '+e2.message; return; }
  btn.disabled=false;
  if(!text){ status.style.color='#e53935'; status.textContent='No results returned — try again.'; return; }
  status.style.color='#43a047'; status.textContent='✓ Done'+(searched?' (web search)':' (general knowledge — web search unavailable on this deployment)')+'. Summary sent to your inbox and the admin inbox.';
  document.getElementById('grants-results').innerHTML=`<div class="card"><div style="font-weight:700;color:var(--primary);margin-bottom:10px;">💰 Funding research — ${fEsc(project)}</div><div style="white-space:pre-wrap;font-size:0.9em;line-height:1.6;">${fEsc(text)}</div></div>`;
  let section=text; const m=text.match(/##\s*Matching Funding Sources([\s\S]*?)(?=\n##\s|$)/i); if(m) section=m[1].trim();
  const msg='🔎 Grant research for "'+project+'":\n\n'+section.slice(0,1500)+(section.length>1500?'…\n\n(See the Grants tab for the full plan.)':'');
  const me=currentUserName();
  try{ if(me) await DB.addMessage({mentorName:me, from:'Grants Agent', text:msg, read:false}); await DB.addMessage({mentorName:'Admin', from:'Grants Agent', text:msg, read:false}); }catch(_){}
}

export { runGrantsAgent };
