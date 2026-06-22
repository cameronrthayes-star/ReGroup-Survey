// ReGroup Meeting Bot server
// Sends a Recall.ai bot into a meeting, records + transcribes it, summarizes the
// transcript with Anthropic, and writes the summary straight into the app's
// Firestore "messages" collection so it lands in every attendee's inbox.
//
// Deploy on Render/Railway/Fly/any Node host. Env vars required:
//   RECALL_API_KEY            - from recall.ai
//   RECALL_REGION             - e.g. us-west-2 (default), us-east-1, eu-central-1
//   ANTHROPIC_API_KEY         - sk-ant-...
//   FIREBASE_SERVICE_ACCOUNT  - the full service-account JSON (one line) for project regroup-elite-squad
//   (optional) ALLOW_ORIGIN   - defaults to * ; set to https://cameronrthayes-star.github.io to lock it down
//
// After deploy, set the Recall webhook URL to:  https://YOUR-HOST/webhook
// and paste https://YOUR-HOST into the app: Settings → Meeting Bot backend URL.

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Constant-time string compare to avoid leaking the secret via timing.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION  = process.env.RECALL_REGION || 'us-west-2';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } catch (e) {
    // Don't crash the process on a malformed env var — log clearly and run without Firestore.
    // The /health endpoint will report firestore_configured:false so the misconfig is visible.
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON — Firestore disabled:', e.message);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// Optional shared secret for verifying Recall webhooks (M9). Set RECALL_WEBHOOK_SECRET
// to the value configured in the Recall dashboard to reject forged POSTs.
const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET || '';

const app = express();
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }));
app.use(express.json({ limit: '4mb' }));

app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'regroup-meeting-bot',
  recall_configured: !!RECALL_API_KEY,
  anthropic_configured: !!ANTHROPIC_API_KEY,
  firestore_configured: !!db
}));

// Create a bot for a meeting. Body: { meeting_url, title, attendees:[names], eventId }
app.post('/api/bot', async (req, res) => {
  try {
    if (!RECALL_API_KEY) return res.status(500).json({ error: 'RECALL_API_KEY not set' });
    const { meeting_url, title, attendees, eventId, join_at } = req.body || {};
    if (!meeting_url) return res.status(400).json({ error: 'meeting_url is required' });
    const body = {
      meeting_url,
      bot_name: 'ReGroup Summary Bot',
      transcription_options: { provider: 'meeting_captions' }
    };
    if (join_at) body.join_at = join_at; // schedule for future; omit to join now
    const r = await fetch(`${RECALL_BASE}/bot/`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${RECALL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    if (db) await db.collection('meetingBotJobs').doc(data.id).set({
      attendees: attendees || [], title: title || 'Meeting', eventId: eventId || null,
      delivered: false, createdAt: Date.now()
    });
    res.json({ bot_id: data.id, status: data.status || 'created' });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

// Recall webhook — fires as the bot's status changes / transcript is ready
app.post('/webhook', async (req, res) => {
  // Verify a shared secret before trusting the payload (M9). Without this, anyone
  // who learns the URL can forge bot_ids and inject summaries into every inbox.
  // Configure RECALL_WEBHOOK_SECRET and pass it as the `svix-signature` /
  // `x-webhook-secret` header or a `?secret=` query param from Recall.
  if (RECALL_WEBHOOK_SECRET) {
    const provided = req.get('x-webhook-secret') || req.get('svix-signature') || (req.query && req.query.secret) || '';
    if (!safeEqual(provided, RECALL_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'invalid webhook signature' });
    }
  }
  res.json({ ok: true }); // ack immediately
  try {
    const ev = req.body || {};
    const type = ev.event || ev.type || '';
    const botId = (ev.data && (ev.data.bot_id || (ev.data.bot && ev.data.bot.id))) || ev.bot_id;
    if (!botId || !db) return;
    if (!/done|transcript|complete|call_ended|recording\.done/i.test(type)) return;
    const jobRef = db.collection('meetingBotJobs').doc(botId);
    const jobSnap = await jobRef.get();
    const job = jobSnap.exists ? jobSnap.data() : null;
    if (!job || job.delivered) return;

    const tr = await fetch(`${RECALL_BASE}/bot/${botId}/transcript/`, { headers: { 'Authorization': `Token ${RECALL_API_KEY}` } });
    const transcript = await tr.json();
    const text = flattenTranscript(transcript);
    if (!text.trim()) return;
    const summary = await summarize(text, job.title);
    await deliver(summary, job);
    await jobRef.set({ delivered: true, summary, deliveredAt: Date.now() }, { merge: true });
  } catch (e) { console.error('webhook error', e); }
});

function flattenTranscript(t) {
  try {
    if (Array.isArray(t)) return t.map(seg => seg.words ? seg.words.map(w => w.text).join(' ') : (seg.text || '')).join('\n');
    return JSON.stringify(t).slice(0, 12000);
  } catch (e) { return ''; }
}

async function summarize(text, title) {
  const prompt = `You are a meeting-notes assistant for ReGroup / TJC Oregon. Summarize the meeting "${title}" in Markdown with sections: **Summary** (2-4 sentences), **Key Points**, **Decisions**, **Action Items** (each "owner — task — due if stated"). Be faithful; do not invent.\n\nTRANSCRIPT:\n${text.slice(0, 40000)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1600, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || '(summary unavailable)';
}

// Write the summary to each attendee's inbox (Firestore "messages") + Admin, and onto the calendar event
async function deliver(summary, job) {
  const msg = `🎙 Meeting summary — "${job.title}":\n\n${summary}`;
  // Use 'Administrator' to match the app's admin user record (the app names the
  // admin 'Administrator'; 'Admin' would route to a nonexistent inbox) (M12).
  const recipients = new Set([...(job.attendees || []), 'Administrator']);
  const batch = db.batch();
  recipients.forEach(name => {
    const ref = db.collection('messages').doc();
    batch.set(ref, { mentorName: name, from: 'Meeting Bot', text: msg, read: false, _createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  if (job.eventId) batch.set(db.collection('calendar').doc(job.eventId), { summary, summarizedBy: 'Meeting Bot', _updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

app.listen(process.env.PORT || 3000, () => console.log('ReGroup Meeting Bot server running'));
