// ReGroup meeting-agent backend.
// Provides the routes used by the static app:
//   GET  /api/ics
//   GET  /api/meeting-agent/events
//   POST /api/meeting-agent/events
//   POST /api/recall/webhook
// It also keeps the older /api/bot and /webhook routes for compatibility.

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_NAME = process.env.BOT_NAME || 'ReGroup Summary Agent';
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_REGIONS = Array.from(new Set([RECALL_REGION, 'us-west-2', 'us-east-1', 'eu-central-1']));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || process.env.FRONTEND_ORIGIN || '*';

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.apps.length ? admin.firestore() : null;

let activeRecallRegion = RECALL_REGION;
let recallAuthOk = false;
const memoryEvents = [];
const memoryWebhooks = [];

app.use(cors({ origin: ALLOW_ORIGIN === '*' ? '*' : ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: '25mb' }));

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function authHeader() {
  if (!RECALL_API_KEY) return '';
  return RECALL_API_KEY.startsWith('Token ') ? RECALL_API_KEY : `Token ${RECALL_API_KEY}`;
}

async function recallFetch(endpoint, options = {}) {
  if (!RECALL_API_KEY) {
    const err = new Error('RECALL_API_KEY is not configured');
    err.status = 503;
    throw err;
  }

  let lastError = null;
  for (const region of RECALL_REGIONS) {
    const response = await fetch(`https://${region}.recall.ai/api/v1${endpoint}`, {
      ...options,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

    if (response.ok) {
      activeRecallRegion = region;
      recallAuthOk = true;
      return data;
    }

    lastError = new Error(`Recall request failed with ${response.status}`);
    lastError.status = response.status;
    lastError.details = data;
    if (response.status !== 401 && response.status !== 403) break;
  }
  throw lastError;
}

async function checkRecallAuth() {
  if (!RECALL_API_KEY) return false;
  try {
    await recallFetch('/bot/?limit=1', { method: 'GET' });
    return true;
  } catch (_) {
    recallAuthOk = false;
    return false;
  }
}

function normalizeAttendees(attendees) {
  if (!Array.isArray(attendees)) return [];
  return attendees.map(a => {
    if (typeof a === 'string') return { email: a.trim(), name: a.trim().split('@')[0] };
    return {
      email: String(a.email || '').trim(),
      name: String(a.name || a.email || '').trim()
    };
  }).filter(a => a.email || a.name);
}

function detectPlatform(url) {
  const v = String(url || '').toLowerCase();
  if (v.includes('meet.google.com')) return 'Google Meet';
  if (v.includes('zoom.us') || v.includes('zoomgov.com')) return 'Zoom';
  if (v.includes('teams.microsoft.com')) return 'Microsoft Teams';
  if (v.includes('webex.com')) return 'Webex';
  return 'Unknown';
}

function cleanUrl(url) {
  return String(url || '').trim().replace(/[),.;\]]+$/, '');
}

function urlsFromText(value) {
  return (String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || []).map(cleanUrl).filter(Boolean);
}

function isVideoMeetingUrl(url) {
  return /meet\.google\.com|zoom\.us|zoomgov\.com|teams\.microsoft\.com|webex\.com|gotomeeting\.com|bluejeans\.com|whereby\.com/i.test(String(url || ''));
}

function extractMeetingUrl(...values) {
  const urls = values.flatMap(urlsFromText);
  return urls.find(isVideoMeetingUrl) || urls[0] || '';
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function icsUnescape(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return { date: '', time: '' };
  if (/^\d{8}$/.test(raw)) {
    return { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, time: '' };
  }
  const normalized = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/, '$1-$2-$3T$4:$5:$6Z');
  const d = new Date(normalized);
  if (!Number.isNaN(d.getTime())) {
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
}

function parseIcsEvents(text) {
  const body = unfoldIcs(text);
  const blocks = body.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const startWindow = new Date();
  startWindow.setMonth(startWindow.getMonth() - 1);
  const endWindow = new Date();
  endWindow.setMonth(endWindow.getMonth() + 3);

  return blocks.map(block => {
    const fields = {};
    const attendees = [];
    block.split(/\r?\n/).forEach(line => {
      const idx = line.indexOf(':');
      if (idx < 0) return;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = icsUnescape(line.slice(idx + 1));
      if (key === 'ATTENDEE') {
        const email = value.replace(/^mailto:/i, '').trim();
        if (email) attendees.push(email);
      } else if (!fields[key]) {
        fields[key] = value;
      }
    });
    const start = parseIcsDate(fields.DTSTART);
    const end = parseIcsDate(fields.DTEND);
    const dateObj = start.date ? new Date(`${start.date}T00:00:00Z`) : null;
    if (!dateObj || dateObj < startWindow || dateObj > endWindow) return null;
    return {
      uid: fields.UID || '',
      title: fields.SUMMARY || '(no title)',
      date: start.date,
      time: start.time ? `${start.time}${end.time ? `-${end.time}` : ''}` : '',
      location: fields.LOCATION || '',
      description: fields.DESCRIPTION || '',
      attendees,
      video: extractMeetingUrl(fields.LOCATION, fields.DESCRIPTION, fields.URL, fields.SUMMARY)
    };
  }).filter(Boolean).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

async function createRecallBot(eventRecord) {
  const payload = {
    meeting_url: eventRecord.meeting_url,
    bot_name: BOT_NAME,
    metadata: {
      regroup_event_id: eventRecord.id,
      calendar_event_id: eventRecord.eventId || '',
      title: eventRecord.title || ''
    }
  };
  if (eventRecord.starts_at) payload.join_at = eventRecord.starts_at;
  return recallFetch('/bot/', { method: 'POST', body: JSON.stringify(payload) });
}

async function createMeetingAgentEvent(body) {
  if (!body.title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  if (!body.meeting_url) {
    const err = new Error('meeting_url is required');
    err.status = 400;
    throw err;
  }
  if (!body.consent_confirmed) {
    const err = new Error('consent_confirmed is required');
    err.status = 400;
    throw err;
  }

  const eventRecord = {
    id: id('meet'),
    title: String(body.title || 'Meeting'),
    meeting_url: String(body.meeting_url || ''),
    platform: body.platform || detectPlatform(body.meeting_url),
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
    attendees: normalizeAttendees(body.attendees),
    eventId: body.eventId || null,
    notice_text: body.notice_text || '',
    consent_confirmed: !!body.consent_confirmed,
    send_to_attendees: body.send_to_attendees !== false,
    review_required: !!body.review_required,
    source: body.source || 'regroup_app',
    provider: 'recall.ai',
    provider_bot_id: null,
    bot_status: 'approved',
    summary_status: 'not_started',
    created_at: nowIso(),
    updated_at: nowIso()
  };

  if (body.create_bot_now !== false) {
    try {
      const bot = await createRecallBot(eventRecord);
      eventRecord.provider_bot_response = bot;
      eventRecord.provider_bot_id = findBotId(bot);
      eventRecord.bot_status = eventRecord.provider_bot_id ? 'scheduled' : 'scheduled_provider_id_unknown';
    } catch (e) {
      eventRecord.bot_status = 'approved_bot_create_failed';
      eventRecord.provider_error = { message: e.message, details: e.details || null };
    }
  }

  await saveEvent(eventRecord);
  return eventRecord;
}

function findBotId(response) {
  return response && (response.id || response.bot_id || (response.bot && response.bot.id) || (response.data && response.data.bot_id) || (response.data && response.data.bot && response.data.bot.id));
}

async function loadEvents() {
  if (!db) return memoryEvents;
  const snap = await db.collection('meetingAgentEvents').orderBy('created_at', 'desc').limit(200).get();
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

async function saveEvent(eventRecord) {
  if (db) {
    await db.collection('meetingAgentEvents').doc(eventRecord.id).set(eventRecord, { merge: true });
  }
  const idx = memoryEvents.findIndex(e => e.id === eventRecord.id);
  if (idx >= 0) memoryEvents[idx] = eventRecord;
  else memoryEvents.unshift(eventRecord);
  return eventRecord;
}

async function getEvent(eventId) {
  if (db) {
    const snap = await db.collection('meetingAgentEvents').doc(eventId).get();
    if (snap.exists) return { ...snap.data(), id: snap.id };
  }
  return memoryEvents.find(e => e.id === eventId) || null;
}

function flattenTranscript(transcript) {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript)) {
    return transcript.map(seg => {
      const speaker = seg.speaker || seg.speaker_name || (seg.participant && seg.participant.name) || 'Speaker';
      if (Array.isArray(seg.words)) return `${speaker}: ${seg.words.map(w => w.text || w.word || '').join(' ')}`.trim();
      return `${speaker}: ${seg.text || seg.transcript || ''}`.trim();
    }).filter(Boolean).join('\n');
  }
  if (Array.isArray(transcript.results)) return flattenTranscript(transcript.results);
  if (Array.isArray(transcript.transcript)) return flattenTranscript(transcript.transcript);
  return transcript.text || JSON.stringify(transcript, null, 2);
}

async function summarize(text, title) {
  if (!text || text.trim().length < 20) return 'No usable transcript was available yet.';
  const prompt = `You are a meeting-notes assistant for ReGroup / TJC Oregon. Summarize the meeting "${title || 'Meeting'}" in Markdown with sections: **Summary**, **Key Points**, **Decisions**, and **Action Items**. Be faithful and do not invent.\n\nTRANSCRIPT:\n${text.slice(0, 40000)}`;

  if (ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest', max_tokens: 1600, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || '(summary unavailable)';
  }

  if (OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: prompt })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.output_text || (j.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n').trim() || '(summary unavailable)';
  }

  return `Meeting Summary: ${title || 'Meeting'}\n\n${text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 220).join(' ')}...`;
}

async function deliverSummary(eventRecord) {
  if (!db || !eventRecord.summary_text) return;
  const recipients = new Set(['Admin']);
  normalizeAttendees(eventRecord.attendees).forEach(a => {
    if (a.name) recipients.add(a.name);
    else if (a.email) recipients.add(a.email);
  });
  const batch = db.batch();
  const msg = `Meeting summary - "${eventRecord.title || 'Meeting'}":\n\n${eventRecord.summary_text}`;
  recipients.forEach(name => {
    const ref = db.collection('messages').doc();
    batch.set(ref, { mentorName: name, from: 'Meeting Bot', text: msg, read: false, _createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  if (eventRecord.eventId) {
    batch.set(db.collection('calendar').doc(eventRecord.eventId), {
      summary: eventRecord.summary_text,
      summarizedBy: 'Meeting Bot',
      _updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
}

async function processEvent(eventRecord) {
  if (!eventRecord || !eventRecord.provider_bot_id || eventRecord.summary_status === 'sent') return eventRecord;
  const transcript = await recallFetch(`/bot/${encodeURIComponent(eventRecord.provider_bot_id)}/transcript/`, { method: 'GET' });
  const transcriptText = flattenTranscript(transcript);
  if (!transcriptText.trim()) return eventRecord;
  eventRecord.transcript_text = transcriptText;
  eventRecord.summary_text = await summarize(transcriptText, eventRecord.title);
  eventRecord.summary_status = eventRecord.send_to_attendees === false ? 'ready' : 'sent';
  eventRecord.bot_status = 'processed';
  eventRecord.updated_at = nowIso();
  if (eventRecord.send_to_attendees !== false) await deliverSummary(eventRecord);
  await saveEvent(eventRecord);
  return eventRecord;
}

async function handleRecallWebhookPayload(payload) {
  memoryWebhooks.unshift({ id: id('wh'), payload, received_at: nowIso() });
  const botId = payload.bot_id || (payload.data && (payload.data.bot_id || (payload.data.bot && payload.data.bot.id))) || (payload.bot && payload.bot.id);
  if (!botId) return;
  const events = await loadEvents();
  const eventRecord = events.find(e => e.provider_bot_id === botId);
  if (!eventRecord) return;
  eventRecord.last_webhook = payload;
  eventRecord.updated_at = nowIso();
  const type = String(payload.event || payload.type || '').toLowerCase();
  if (/done|ended|transcript|complete|recording/.test(type)) {
    await processEvent(eventRecord).catch(e => {
      eventRecord.summary_status = 'processing_failed';
      eventRecord.processing_error = e.message;
      return saveEvent(eventRecord);
    });
  } else {
    await saveEvent(eventRecord);
  }
}

async function pollFinishedEvents() {
  try {
    const events = await loadEvents();
    for (const eventRecord of events.filter(e => e.provider_bot_id && !e.summary_text)) {
      const bot = await recallFetch(`/bot/${encodeURIComponent(eventRecord.provider_bot_id)}/`, { method: 'GET' }).catch(() => null);
      const status = String((bot && (bot.status || bot.state || bot.call_status)) || '').toLowerCase();
      if (/done|ended|complete|finished/.test(status)) await processEvent(eventRecord);
    }
  } catch (e) {
    console.error('poll error', e.message);
  }
}

app.get('/health', async (_req, res) => {
  const authOk = await checkRecallAuth();
  res.json({
    ok: true,
    service: 'regroup-meeting-agent-backend',
    recall_configured: !!RECALL_API_KEY,
    recall_auth_ok: authOk,
    recall_region: activeRecallRegion,
    anthropic_configured: !!ANTHROPIC_API_KEY,
    openai_configured: !!OPENAI_API_KEY,
    firestore_configured: !!db,
    timestamp: nowIso()
  });
});

app.get('/api/ics', async (req, res, next) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Valid url query parameter is required' });
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `Could not fetch iCal feed: HTTP ${r.status}` });
    const text = await r.text();
    res.json({ events: parseIcsEvents(text), fetched_at: nowIso() });
  } catch (e) {
    next(e);
  }
});

app.get('/api/meeting-agent/events', async (_req, res, next) => {
  try {
    res.json({ events: await loadEvents() });
  } catch (e) {
    next(e);
  }
});

app.post('/api/meeting-agent/events', async (req, res, next) => {
  try {
    res.status(201).json({ event: await createMeetingAgentEvent(req.body || {}) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/meeting-agent/events/:eventId/process', async (req, res, next) => {
  try {
    const eventRecord = await getEvent(req.params.eventId);
    if (!eventRecord) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: await processEvent(eventRecord) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/recall/webhook', async (req, res, next) => {
  try {
    await handleRecallWebhookPayload(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Backward-compatible routes for the first meeting-bot integration.
app.post('/api/bot', async (req, res, next) => {
  try {
    const eventRecord = await createMeetingAgentEvent({
      title: req.body.title || 'Meeting',
      meeting_url: req.body.meeting_url,
      attendees: (req.body.attendees || []).map(a => typeof a === 'string' ? { name: a } : a),
      eventId: req.body.eventId,
      starts_at: req.body.join_at || null,
      consent_confirmed: true,
      create_bot_now: true,
      source: 'legacy_api_bot',
      send_to_attendees: true
    });
    res.json({ bot_id: eventRecord.provider_bot_id, status: eventRecord.bot_status, event: eventRecord });
  } catch (e) {
    next(e);
  }
});

app.post('/webhook', async (req, res, next) => {
  try {
    await handleRecallWebhookPayload(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error', details: err.details || undefined });
});

setInterval(pollFinishedEvents, 60000);

app.listen(PORT, () => {
  console.log(`ReGroup meeting-agent backend listening on port ${PORT}`);
});
