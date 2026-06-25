import { db, DB, _sessions, _activities, _staff, _needsAssessments, _expenseReports,
         _clients, _tasks, _projects, _events, _meetings, _fundContacts,
         _dashboardConfig, _securityConfig, _messages, _calendar, _rjCases, _servicePlans,
         collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, orderBy, serverTimestamp
       } from '../state.js';
import { fEsc, fmtMoney, fmtDate, fmtDateSlash, fmtTime, calcHours, uuid, getDate,
         getActivityLabel, safeConcernBadge, currentUserName, isAdmin, isOwnerOrAdmin,
         requireAdmin, firstNameOf, fileToDataURL, printDoc, profileEmails, primaryProfileEmail
       } from '../utils.js';
function renderGrantsKey(){
  const el=document.getElementById('grants-key-setup'); if(!el) return;
  const key=(localStorage.getItem('rg_anthropic_key')||'').trim();
  if(key){
    el.innerHTML=`<div style="background:#e7f6ec;border:1px solid #b7e1c4;border-radius:10px;padding:10px 14px;font-size:0.84em;color:#15803d;">✓ AI key connected — the funding agent is ready.</div>`;
  } else {
    el.innerHTML=`<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 14px;">
      <div style="font-weight:600;font-size:0.85em;color:#9a3412;margin-bottom:6px;">⚙ Connect an Anthropic API key to use the funding agent</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="grants-key" type="password" placeholder="sk-ant-…" style="flex:1;min-width:200px;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:0.88em;">
        <button class="btn btn-accent" style="font-size:0.82em;" onclick="saveGrantsKey()">Save Key</button>
      </div>
      <p style="font-size:0.76em;color:#777;margin:8px 0 0;">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style="color:#2f9bb5;">console.anthropic.com</a>. For live grant search, enable <b>web search</b> on your Anthropic account.</p>
    </div>`;
  }
}
function saveGrantsKey(){
  const v=(document.getElementById('grants-key')?.value||'').trim();
  if(!/^sk-ant-/.test(v)){ alert('That doesn’t look like an Anthropic key (it should start with sk-ant-).'); return; }
  localStorage.setItem('rg_anthropic_key', v);
  const si=document.getElementById('anthropic-key-input'); if(si) si.value=v;
  renderGrantsKey();
}
async function runGrantsAgent(){
  const key=(localStorage.getItem('rg_anthropic_key')||'').trim();
  const status=document.getElementById('grants-status');
  if(!key){ status.style.color='#e53935'; status.textContent='Connect an API key above first.'; renderGrantsKey(); return; }
  const project=document.getElementById('gr-project').value.trim();
  const purpose=document.getElementById('gr-purpose').value.trim();
  if(!project || !purpose){ status.style.color='#e53935'; status.textContent='Enter at least a project name and purpose.'; return; }
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
  const mkBody=(useTool)=>JSON.stringify(Object.assign({model:'claude-opus-4-8',max_tokens:4096,messages:[{role:'user',content:prompt}]}, useTool?{tools:[{type:'web_search_20250305',name:'web_search',max_uses:6}]}:{}));
  async function call(useTool){
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:mkBody(useTool)});
    if(!resp.ok){ let d=''; try{const e=await resp.json(); d=(e.error&&e.error.message)||'';}catch(_){} throw new Error('Anthropic API '+resp.status+(d?': '+d:'')); }
    const j=await resp.json();
    return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  }
  let text='', searched=true;
  try{ text=await call(true); }
  catch(e){ try{ text=await call(false); searched=false; } catch(e2){ btn.disabled=false; status.style.color='#e53935'; status.textContent='AI error — '+e2.message; return; } }
  btn.disabled=false;
  if(!text){ status.style.color='#e53935'; status.textContent='No results returned — try again.'; return; }
  status.style.color='#43a047'; status.textContent='✓ Done'+(searched?' (web search)':' (general knowledge — enable web search for live grants)')+'. Summary sent to your inbox and the admin inbox.';
  document.getElementById('grants-results').innerHTML=`<div class="card"><div style="font-weight:700;color:var(--primary);margin-bottom:10px;">💰 Funding research — ${fEsc(project)}</div><div style="white-space:pre-wrap;font-size:0.9em;line-height:1.6;">${fEsc(text)}</div></div>`;
  // Send the matching-grants summary to the staff inbox + admin inbox
  let section=text; const m=text.match(/##\s*Matching Funding Sources([\s\S]*?)(?=\n##\s|$)/i); if(m) section=m[1].trim();
  const msg='🔎 Grant research for "'+project+'":\n\n'+section.slice(0,1500)+(section.length>1500?'…\n\n(See the Grants tab for the full plan.)':'');
  const me=currentUserName();
  try{ if(me) await DB.addMessage({mentorName:me, from:'Grants Agent', text:msg, read:false}); await DB.addMessage({mentorName:'Admin', from:'Grants Agent', text:msg, read:false}); }catch(_){}
}

export { renderGrantsKey, saveGrantsKey, runGrantsAgent };
