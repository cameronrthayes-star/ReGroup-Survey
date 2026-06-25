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
function generateSocialPost(data) {
  const rawTags = (data.hashtags||'').split(',').map(h=>h.trim()).filter(Boolean)
    .map(h=>'#'+h.replace(/\s+/g,'').replace(/^#+/,'')).join(' ');
  const tags = rawTags + ' #ReGroup #ReGroupEliteSquad #Reentry #Community';
  const loc  = data.location ? '\n📍 ' + data.location : '';
  const dt   = data.eventDate ? '  📅 ' + fmtDate(data.eventDate) : '';

  const instagram = '✨ ' + (data.title||'').toUpperCase() + ' ✨\n\n' +
    (data.summary||'') + '\n\n' +
    (data.impact ? '💪 ' + data.impact + '\n\n' : '') +
    tags;

  const facebook = '🎉 ' + (data.title||'') + '\n\n' +
    (data.summary||'') + '\n\n' +
    (data.impact ? data.impact + '\n\n' : '') +
    'Join us in supporting reentry and community transformation. Share this post!\n' +
    loc + dt + '\n\n' + rawTags;

  const twitterText = (data.title||'') + ' — ' + (data.summary||'').slice(0,140) + ((data.summary||'').length>140?'…':'');
  const twitter = twitterText.slice(0,250) + ' ' + rawTags.split(' ').slice(0,3).join(' ') + ' #ReGroup';

  const newsletter =
    '## ' + (data.title||'') + '\n' +
    (data.eventDate ? '_' + fmtDate(data.eventDate) + (data.location?' · '+data.location:'') + '_\n\n' : '') +
    (data.summary||'') + '\n\n' +
    (data.impact ? '**Impact:** ' + data.impact + '\n\n' : '') +
    (data.photoDesc ? '_Photos: ' + data.photoDesc + '_\n\n' : '') +
    '---';

  const linkedin = (data.title||'') + '\n\n' +
    (data.summary||'') + '\n\n' +
    (data.impact ? 'Impact: ' + data.impact + '\n\n' : '') +
    'At ReGroup Elite Squad — part of the Transformative Justice Community — we are committed to reentry support and community transformation.' +
    (loc?'\n'+loc.trim():'') + (dt?'\n'+dt.trim():'') + '\n\n' + tags;

  return {instagram, facebook, twitter, newsletter, linkedin};
}

async function generateAllPostsAI(data) {
  let token = '';
  try { token = await ensureMeetingBotSession({ silent: true }); } catch (_) {}
  if (!token) return null;
  const details =
    'Title: ' + (data.title||'') + '\n' +
    'Date: ' + (data.eventDate||'n/a') + '\n' +
    'Location: ' + (data.location||'n/a') + '\n' +
    'Summary: ' + (data.summary||'') + '\n' +
    'Impact / outcomes: ' + (data.impact||'n/a') + '\n' +
    'Photos available: ' + (data.photoDesc||'n/a') + '\n' +
    'Keywords: ' + (data.hashtags||'n/a');
  const prompt =
    'You are the social media manager for ReGroup Elite Squad, a reentry and mentorship ' +
    'organization within the Transformative Justice Community in Oregon. Using ONLY the event ' +
    'details below (do not invent facts), write platform-tailored copy for each channel and a ' +
    'newsletter blurb. Use a warm but credible tone throughout.\n\n' +
    'Channel requirements:\n' +
    '- instagram: punchy, visual, emoji-forward, 4–8 relevant hashtags at the end.\n' +
    '- facebook: community-minded, a couple short paragraphs, a clear call to engage/share, a few hashtags.\n' +
    '- twitter: a single post UNDER 280 characters total, 1–3 hashtags.\n' +
    '- linkedin: polished and professional, 120–200 words, strong opening line, 2–4 hashtags, tasteful emoji used sparingly.\n' +
    '- newsletter: a Markdown blurb starting with "## ' + (data.title||'Event') + '", an italic date/location line if available, 1–2 short paragraphs, and a bold "Impact:" line if outcomes are given. End with "---".\n\n' +
    'Return ONLY a JSON object with exactly these string keys: instagram, facebook, twitter, linkedin, newsletter. ' +
    'No commentary, no code fences.\n\nEVENT DETAILS:\n' + details;
  const resp = await fetch(meetingBotBaseUrl() + '/api/ai/social-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) { let detail=''; try{ const e=await resp.json(); detail=(e.error&&(e.error.message||e.error))||''; }catch(_){} throw new Error('AI error ' + (detail||resp.status)); }
  const j = await resp.json();
  let txt = (j.text || '').trim();
  if (!txt) return null;
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s>=0 && e>s) txt = txt.slice(s, e+1);
  const parsed = JSON.parse(txt);
  const out = {};
  ['instagram','facebook','twitter','linkedin','newsletter'].forEach(k => {
    if (parsed[k] && typeof parsed[k] === 'string' && parsed[k].trim()) out[k] = parsed[k].trim();
  });
  return Object.keys(out).length ? out : null;
}

function renderEvents() {
  const el = document.getElementById('events-list');
  if (!el) return;
  const events = DB.events().slice().reverse();
  if (!events.length) { el.innerHTML='<p style="color:#bbb;font-size:0.875em;">No events posted yet.</p>'; return; }
  el.innerHTML = events.map(ev => {
    const gp = ev.generatedPosts||{};
    const uid = ev._id;
    const panels = [
      {key:'linkedin',  label:'LinkedIn', content: gp.linkedin||''},
      {key:'instagram', label:'Instagram', content: gp.instagram||''},
      {key:'facebook',  label:'Facebook',  content: gp.facebook||''},
      {key:'twitter',   label:'X / Twitter', content: gp.twitter||''},
      {key:'newsletter',label:'Newsletter', content: gp.newsletter||''},
    ];
    return '<div class="card" style="margin-bottom:20px;">' +
      '<div style="margin-bottom:14px;">' +
        '<div style="font-weight:700;font-size:1.05em;color:var(--primary);">📸 ' + (ev.title||'Event') + '</div>' +
        '<div style="font-size:0.8em;color:#999;">' + (ev.eventDate?fmtDate(ev.eventDate)+' · ':'') + 'Posted by ' + (ev.postedBy||'Staff') + '</div>' +
      '</div>' +
      ((ev.photos&&ev.photos.length) ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' + ev.photos.map((src,i)=>'<a href="'+src+'" download="'+(ev.title||'event').replace(/[^a-z0-9]+/gi,'-')+'-'+(i+1)+'.jpg" title="Click to download photo"><img src="'+src+'" style="width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;"></a>').join('') + '</div>' : '') +
      '<div class="tabs" style="margin-bottom:14px;">' +
        panels.map((p,i) => '<button class="tab-btn' + (i===0?' active':'') + '" onclick="switchEvTab(this,\'ev-' + p.key + '-' + uid + '\')">' + p.label + '</button>').join('') +
      '</div>' +
      panels.map((p,i) =>
        '<div id="ev-' + p.key + '-' + uid + '" class="ev-tab-panel" style="display:' + (i===0?'block':'none') + ';">' +
          '<div style="background:#f8f9fa;border-radius:8px;padding:14px;font-size:0.875em;white-space:pre-wrap;font-family:inherit;line-height:1.6;">' + p.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>' +
          '<button class="btn btn-outline" style="margin-top:8px;font-size:0.78em;" onclick="copyEvText(\'ev-' + p.key + '-' + uid + '\')">📋 Copy</button>' +
        '</div>'
      ).join('') +
    '</div>';
  }).join('');
}

function switchEvTab(btn, panelId) {
  const card = btn.closest('.card');
  card.querySelectorAll('.ev-tab-panel').forEach(p=>p.style.display='none');
  card.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = 'block';
}

function copyEvText(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const text = el.querySelector('div').textContent;
  navigator.clipboard.writeText(text).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
}
const copyText = copyEvText;

export { generateSocialPost, generateAllPostsAI, renderEvents, switchEvTab, copyEvText, copyText };
