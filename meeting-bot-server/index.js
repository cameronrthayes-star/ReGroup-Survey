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
const MEETING_BOT_PROVIDER = String(process.env.MEETING_BOT_PROVIDER || 'recall').trim().toLowerCase();
const RECALL_WEBHOOK_SECRET = String(process.env.RECALL_WEBHOOK_SECRET || '').trim();
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || process.env.FRONTEND_ORIGIN || '*';
const DEFAULT_ADMIN_PIN = '12345678';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ACTIVE_BOT_STATUSES = new Set(['pending', 'joining', 'waiting_for_admission', 'recording', 'processing']);

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
let db = admin.apps.length ? admin.firestore() : null;

let activeRecallRegion = RECALL_REGION;
let recallAuthOk = false;
const memoryEvents = [];
const memoryWebhooks = [];
const memorySessions = [];
const logger = console;

class AiProviderConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderConfigError';
    this.status = 503;
    this.code = 'AI_PROVIDER_CONFIG_MISSING';
  }
}

class AiProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status || 502;
    this.code = 'AI_PROVIDER_FAILED';
  }
}

class MeetingBotConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MeetingBotConfigError';
    this.status = 503;
    this.code = 'MEETING_BOT_PROVIDER_CONFIG_MISSING';
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.status = 401;
    this.code = 'AUTHENTICATION_FAILED';
  }
}

class AuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = 403;
    this.code = 'AUTHORIZATION_FAILED';
  }
}

function logInfo(message, meta = {}, log = logger) {
  if (log && typeof log.info === 'function') log.info(message, meta);
}

function logWarn(message, meta = {}, log = logger) {
  if (log && typeof log.warn === 'function') log.warn(message, meta);
}

function logError(message, meta = {}, log = logger) {
  if (log && typeof log.error === 'function') log.error(message, meta);
}

function buildMeetingSummaryPrompt({ transcript, title, attendees, startsAt }) {
  const attendeeNames = normalizeAttendees(attendees).map(a => a.name || a.email).filter(Boolean);
  const attendeeText = attendeeNames.length ? attendeeNames.join(', ') : 'Not provided';
  const meetingTimeText = String(startsAt || '').trim() || 'Not provided';
  return [
    `You are a meeting-notes assistant for ReGroup / TJC Oregon. Summarize the meeting "${title || 'Meeting'}".`,
    '',
    'Return Markdown with exactly these sections:',
    '**Summary** - 2 to 4 concise sentences. Mention the meeting title and date/time when it is available.',
    '**Attendees** - attendees provided below plus any clearly identified in the transcript.',
    '**Key Decisions** - bullets, or "None captured" if no decision is present.',
    '**Action Items** - bullets in the form "Owner - task - due date"; use "Unassigned" or "Not stated" only when unavailable.',
    '**Open Questions** - bullets, or "None captured" if none are present.',
    '',
    'Be faithful to the transcript. Do not invent facts, owners, due dates, or attendees.',
    '',
    `MEETING DATE/TIME: ${meetingTimeText}`,
    '',
    `KNOWN ATTENDEES: ${attendeeText}`,
    '',
    'TRANSCRIPT:',
    String(transcript || '').slice(0, 40000)
  ].join('\n');
}

function extractAnthropicText(responseBody) {
  return (responseBody && responseBody.content || [])
    .filter(block => block && block.type === 'text')
    .map(block => block.text || '')
    .join('')
    .trim();
}

function createClaudeProvider({ env = process.env, fetchImpl = fetch, log = logger } = {}) {
  const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const modelFromEnv = String(env.ANTHROPIC_MODEL || '').trim();
  const model = modelFromEnv || DEFAULT_ANTHROPIC_MODEL;

  return {
    name: 'claude',
    model,
    isConfigured() {
      return !!apiKey && !!model;
    },
    status() {
      return {
        provider: 'claude',
        configured: this.isConfigured(),
        model,
        model_configured: !!modelFromEnv,
        missing: [
          apiKey ? null : 'ANTHROPIC_API_KEY',
          model ? null : 'ANTHROPIC_MODEL'
        ].filter(Boolean)
      };
    },
    async summarizeMeeting(input) {
      if (!apiKey) {
        logWarn('meeting summary provider unavailable', { provider: 'claude', missing: 'ANTHROPIC_API_KEY' }, log);
        throw new AiProviderConfigError('ANTHROPIC_API_KEY is not configured');
      }
      if (!model) {
        logWarn('meeting summary provider unavailable', { provider: 'claude', missing: 'ANTHROPIC_MODEL' }, log);
        throw new AiProviderConfigError('ANTHROPIC_MODEL is not configured');
      }

      const prompt = buildMeetingSummaryPrompt(input);
      logInfo('meeting summary request started', {
        provider: 'claude',
        model,
        event_id: input.eventId || null,
        transcript_chars: String(input.transcript || '').length,
        attendee_count: normalizeAttendees(input.attendees).length
      }, log);

      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1800,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = (body.error && body.error.message) || `HTTP ${response.status}`;
        logError('meeting summary provider failed', {
          provider: 'claude',
          status: response.status,
          event_id: input.eventId || null,
          error: detail
        }, log);
        throw new AiProviderError(`Claude summary failed: ${detail}`, response.status >= 500 ? 502 : response.status);
      }

      const text = extractAnthropicText(body);
      if (!text) {
        logError('meeting summary provider returned empty text', { provider: 'claude', event_id: input.eventId || null }, log);
        throw new AiProviderError('Claude summary returned no text');
      }

      logInfo('meeting summary request completed', {
        provider: 'claude',
        model,
        event_id: input.eventId || null,
        summary_chars: text.length
      }, log);
      return text;
    }
  };
}

function createMockAiProvider({ summary } = {}) {
  return {
    name: 'mock',
    model: 'mock',
    isConfigured() {
      return true;
    },
    status() {
      return { provider: 'mock', configured: true, model: 'mock', model_configured: true, missing: [] };
    },
    async summarizeMeeting(input) {
      return summary || [
        '**Summary**',
        `Mock summary for ${input.title || 'Meeting'}.`,
        '',
        '**Attendees**',
        '- Not provided',
        '',
        '**Key Decisions**',
        '- None captured',
        '',
        '**Action Items**',
        '- Unassigned - none captured - Not stated',
        '',
        '**Open Questions**',
        '- None captured'
      ].join('\n');
    }
  };
}

const PRESENTATION_KNOWLEDGE_BASE = [
  'ReGroup / TJC Oregon builds practical, community-centered support for reentry, restorative justice, mentorship, case coordination, housing stabilization, basic needs, workforce readiness, and partner collaboration.',
  'Keep language plain, grounded, and report-friendly.',
  'Prefer outcomes, action steps, and operational clarity over hype.',
  'If the request references lived experience, treat it respectfully and do not overstate certainty.',
  'When data is mentioned, frame it as evidence or an example, not as a fabricated statistic.'
].join('\n');

const PRESENTATION_CONTENT_RULES = [
  'Return valid JSON only. No Markdown fences, commentary, or extra text.',
  'Include every required field from the schema.',
  'Keep slides concrete and concise.',
  'Do not invent statistics, funder commitments, or outcomes.',
  'Where a claim is uncertain, add it to factualReviewNotes.'
].join('\n');

function isMockPresentationMode(env = process.env) {
  return String(env.NODE_ENV || '').trim() === 'development' && !String(env.GEMINI_API_KEY || '').trim();
}

function normalizePresentationRequest(body = {}) {
  const audience = String(body.audience || '').trim();
  const purpose = String(body.purpose || '').trim();
  const durationMinutes = Number.isFinite(Number(body.durationMinutes)) ? Number(body.durationMinutes) : 20;
  if (!audience) {
    const err = new Error('audience is required');
    err.status = 400;
    throw err;
  }
  if (!purpose) {
    const err = new Error('purpose is required');
    err.status = 400;
    throw err;
  }
  return {
    audience,
    purpose,
    durationMinutes,
    slideCount: body.slideCount === null || body.slideCount === undefined || body.slideCount === '' ? null : body.slideCount,
    tone: String(body.tone || 'clear and practical').trim(),
    livedExperienceFraming: body.livedExperienceFraming == null ? null : String(body.livedExperienceFraming).trim() || null,
    dataInclusion: body.dataInclusion == null ? null : String(body.dataInclusion).trim() || null,
    callToAction: body.callToAction == null ? null : String(body.callToAction).trim() || null,
    keyMessage: body.keyMessage == null ? null : String(body.keyMessage).trim() || null,
    requiredPoints: body.requiredPoints == null ? null : String(body.requiredPoints).trim() || null,
    contextualMaterial: body.contextualMaterial == null ? null : String(body.contextualMaterial).trim() || null
  };
}

function buildPresentationPrompt(request) {
  return [
    'You are generating a ReGroup presentation plan for an internal team.',
    PRESENTATION_KNOWLEDGE_BASE,
    PRESENTATION_CONTENT_RULES,
    '',
    'Create a structured presentation in JSON with this shape:',
    '{',
    '  "title": string,',
    '  "audience": string,',
    '  "purpose": string,',
    '  "durationMinutes": number,',
    '  "slides": [',
    '    {',
    '      "number": number,',
    '      "title": string,',
    '      "bullets": [string],',
    '      "speakerNotes": string,',
    '      "visualSuggestion": string | null,',
    '      "sourceNotes": string | null,',
    '      "audienceAdaptation": string | null',
    '    }',
    '  ],',
    '  "handoutSummary": string | null,',
    '  "callToAction": string | null,',
    '  "followUpEmail": string | null,',
    '  "factualReviewNotes": [string]',
    '}',
    '',
    'Requirements:',
    '- Use 6 to 12 slides unless the request implies otherwise.',
    '- Keep bullets short and presentation-ready.',
    '- Include a strong title slide, context slide, body slides, and next steps.',
    '- Reflect the requested tone, key message, lived experience framing, and required points.',
    '- If contextual material is provided, incorporate it.',
    '- If slideCount is "auto", choose the best count based on duration.',
    '',
    `Audience: ${request.audience}`,
    `Purpose: ${request.purpose}`,
    `Duration minutes: ${request.durationMinutes}`,
    `Slide count: ${request.slideCount ?? 'auto'}`,
    `Tone: ${request.tone}`,
    `Lived experience framing: ${request.livedExperienceFraming || 'not specified'}`,
    `Data inclusion: ${request.dataInclusion || 'not specified'}`,
    `Call to action: ${request.callToAction || 'not specified'}`,
    `Key message: ${request.keyMessage || 'not specified'}`,
    `Required points: ${request.requiredPoints || 'not specified'}`,
    '',
    'Contextual material:',
    request.contextualMaterial || 'None provided'
  ].join('\n');
}

function extractJsonBlock(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function normalizePresentationResult(raw, request) {
  const slides = Array.isArray(raw && raw.slides) ? raw.slides.map((slide, index) => ({
    number: Number.isFinite(Number(slide && slide.number)) ? Number(slide.number) : index + 1,
    title: String(slide && slide.title || `Slide ${index + 1}`),
    bullets: Array.isArray(slide && slide.bullets) ? slide.bullets.map((item) => String(item)).filter(Boolean) : [],
    speakerNotes: String(slide && slide.speakerNotes || ''),
    visualSuggestion: slide && slide.visualSuggestion != null ? String(slide.visualSuggestion) : null,
    sourceNotes: slide && slide.sourceNotes != null ? String(slide.sourceNotes) : null,
    audienceAdaptation: slide && slide.audienceAdaptation != null ? String(slide.audienceAdaptation) : null
  })) : [];
  return {
    title: String(raw && raw.title || `ReGroup Presentation — ${request.audience}`),
    audience: String(raw && raw.audience || request.audience),
    purpose: String(raw && raw.purpose || request.purpose),
    durationMinutes: Number.isFinite(Number(raw && raw.durationMinutes)) ? Number(raw.durationMinutes) : request.durationMinutes,
    slides,
    handoutSummary: raw && raw.handoutSummary != null ? String(raw.handoutSummary) : null,
    callToAction: raw && raw.callToAction != null ? String(raw.callToAction) : request.callToAction,
    followUpEmail: raw && raw.followUpEmail != null ? String(raw.followUpEmail) : null,
    factualReviewNotes: Array.isArray(raw && raw.factualReviewNotes) && raw.factualReviewNotes.length
      ? raw.factualReviewNotes.map((item) => String(item)).filter(Boolean)
      : ['Review all factual claims, statistics, and outcome references before using this presentation.']
  };
}

async function generatePresentationWithGemini(request, { env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new MeetingBotConfigError('GEMINI_API_KEY is not configured');
  const model = String(env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPresentationPrompt(request) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && body.error && body.error.message ? body.error.message : `HTTP ${response.status}`;
    throw new AiProviderError(`Gemini presentation generation failed: ${message}`, response.status >= 500 ? 502 : response.status);
  }
  const text = (((body.candidates || [])[0] || {}).content || {}).parts || [];
  const joined = text.map((part) => part && part.text ? part.text : '').join('');
  const parsed = JSON.parse(extractJsonBlock(joined));
  return normalizePresentationResult(parsed, request);
}

function generateMockPresentation(request) {
  const slideCount = request.slideCount && request.slideCount !== 'auto' ? Number(request.slideCount) : 8;
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    number: index + 1,
    title: index === 0 ? 'Opening and purpose' : index === slideCount - 1 ? 'Next steps and close' : `Core message ${index}`,
    bullets: index === 0
      ? [request.purpose, request.keyMessage || 'Set the tone and frame the conversation.']
      : index === slideCount - 1
        ? [request.callToAction || 'Confirm next action and owner.', 'Thank the audience and invite follow-up.']
        : ['Support the presentation narrative with one concrete point.', 'Keep the message practical and readable.'],
    speakerNotes: 'Mock slide notes for development.',
    visualSuggestion: 'Simple title card',
    sourceNotes: request.contextualMaterial ? 'Derived from the provided context.' : null,
    audienceAdaptation: `Tailor for ${request.audience}.`
  }));
  return {
    title: `ReGroup Presentation — ${request.audience}`,
    audience: request.audience,
    purpose: request.purpose,
    durationMinutes: request.durationMinutes,
    slides,
    handoutSummary: `This presentation introduces ${request.purpose}.`,
    callToAction: request.callToAction || 'Follow up with the ReGroup team.',
    followUpEmail: `Thanks for meeting with ReGroup. We appreciate the conversation about ${request.purpose}.`,
    factualReviewNotes: ['Mock mode is active. Replace this draft with a reviewed deck before use.']
  };
}

function createAiProvider({ env = process.env, fetchImpl = fetch, log = logger } = {}) {
  const providerName = String(env.AI_PROVIDER || env.SUMMARY_AI_PROVIDER || 'claude').trim().toLowerCase();
  if (providerName === 'mock') {
    if (env.NODE_ENV === 'production') {
      throw new AiProviderConfigError('AI_PROVIDER=mock is not allowed in production');
    }
    logWarn('meeting summary mock AI provider selected', { provider: 'mock' }, log);
    return createMockAiProvider({ summary: env.MOCK_AI_SUMMARY });
  }
  if (providerName !== 'claude' && providerName !== 'anthropic') {
    throw new AiProviderConfigError(`Unsupported AI provider: ${providerName}`);
  }
  return createClaudeProvider({ env, fetchImpl, log });
}

let aiProvider = createAiProvider();

function mapRecallLifecycleStatus(value) {
  const status = String(value || '').toLowerCase();
  if (/lobby|wait/.test(status)) return 'waiting_for_admission';
  if (/join|ready|scheduled|pending/.test(status)) return 'joining';
  if (/record/.test(status)) return 'recording';
  if (/transcript|process|summar/.test(status)) return 'processing';
  if (/done|ended|complete|finished/.test(status)) return 'completed';
  if (/fail|error|denied|rejected/.test(status)) return 'failed';
  return 'pending';
}

function createRecallMeetingBotProvider({ env = process.env, fetchImpl = fetch, log = logger } = {}) {
  const apiKey = String(env.RECALL_API_KEY || '').trim();
  const regions = Array.from(new Set([
    String(env.RECALL_REGION || RECALL_REGION).trim() || RECALL_REGION,
    'us-west-2',
    'us-east-1',
    'eu-central-1'
  ]));
  const defaultBotName = String(env.BOT_NAME || BOT_NAME).trim() || BOT_NAME;

  function providerAuthHeader() {
    if (!apiKey) return '';
    return apiKey.startsWith('Token ') ? apiKey : `Token ${apiKey}`;
  }

  async function providerFetch(endpoint, options = {}) {
    if (!apiKey) throw new MeetingBotConfigError('RECALL_API_KEY is not configured');
    let lastError = null;
    for (const region of regions) {
      const response = await fetchImpl(`https://${region}.recall.ai/api/v1${endpoint}`, {
        ...options,
        headers: {
          Authorization: providerAuthHeader(),
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

  return {
    name: 'recall',
    isConfigured() {
      return !!apiKey;
    },
    status() {
      return {
        provider: 'recall',
        configured: !!apiKey,
        missing: apiKey ? [] : ['RECALL_API_KEY']
      };
    },
    async healthcheck() {
      if (!apiKey) return false;
      try {
        await providerFetch('/bot/?limit=1', { method: 'GET' });
        return true;
      } catch (_) {
        recallAuthOk = false;
        return false;
      }
    },
    async sendBotToMeeting(meetingUrl, metadata = {}) {
      if (!apiKey) throw new MeetingBotConfigError('RECALL_API_KEY is not configured');
      logInfo('meeting bot provider send started', {
        provider: 'recall',
        meeting_id: metadata.meetingId || null,
        requested_by: metadata.requestedBy || null
      }, log);
      const payload = {
        meeting_url: meetingUrl,
        bot_name: metadata.botDisplayName || defaultBotName,
        metadata: {
          regroup_event_id: metadata.eventId || '',
          calendar_event_id: metadata.meetingId || '',
          title: metadata.title || '',
          requested_by: metadata.requestedBy || ''
        }
      };
      if (metadata.startsAt) payload.join_at = metadata.startsAt;
      const bot = await providerFetch('/bot/', { method: 'POST', body: JSON.stringify(payload) });
      return {
        providerBotId: findBotId(bot),
        raw: bot,
        status: mapRecallLifecycleStatus(bot && (bot.status || bot.state || bot.call_status || 'scheduled'))
      };
    },
    async getBotStatus(providerBotId) {
      const bot = await providerFetch(`/bot/${encodeURIComponent(providerBotId)}/`, { method: 'GET' });
      return {
        providerBotId,
        raw: bot,
        status: mapRecallLifecycleStatus(bot && (bot.status || bot.state || bot.call_status))
      };
    },
    handleWebhook(payload) {
      const botId = payload.bot_id || (payload.data && (payload.data.bot_id || (payload.data.bot && payload.data.bot.id))) || (payload.bot && payload.bot.id);
      const type = String(payload.event || payload.type || '').toLowerCase();
      return {
        providerBotId: botId || '',
        status: mapRecallLifecycleStatus(type),
        isTerminal: /done|ended|complete|finished|recording/.test(type),
        transcriptReady: /transcript|complete|done|recording/.test(type),
        recordingReady: /recording|complete|done/.test(type),
        errorMessage: payload.error && (payload.error.message || payload.error) || ''
      };
    },
    async fetchTranscript(providerBotId) {
      return providerFetch(`/bot/${encodeURIComponent(providerBotId)}/transcript/`, { method: 'GET' });
    },
    async fetchRecording(providerBotId) {
      return providerFetch(`/bot/${encodeURIComponent(providerBotId)}/`, { method: 'GET' });
    }
  };
}

function createMockMeetingBotProvider() {
  return {
    name: 'mock',
    isConfigured() {
      return true;
    },
    status() {
      return { provider: 'mock', configured: true, missing: [] };
    },
    async healthcheck() {
      return true;
    },
    async sendBotToMeeting(_meetingUrl, metadata = {}) {
      return {
        providerBotId: `mock_bot_${Date.now().toString(36)}`,
        raw: { mock: true, metadata },
        status: 'waiting_for_admission'
      };
    },
    async getBotStatus(providerBotId) {
      return { providerBotId, raw: { mock: true }, status: 'recording' };
    },
    handleWebhook(payload) {
      return {
        providerBotId: payload.provider_bot_id || payload.bot_id || '',
        status: String(payload.status || '').trim() || 'processing',
        isTerminal: ['completed', 'failed'].includes(String(payload.status || '').trim()),
        transcriptReady: !!payload.transcript || !!payload.transcript_text || payload.status === 'processing' || payload.status === 'completed',
        recordingReady: !!payload.recording_url,
        errorMessage: payload.error_message || ''
      };
    },
    async fetchTranscript(providerBotId) {
      return [{ speaker: 'Mock Bot', text: `Transcript for ${providerBotId}` }];
    },
    async fetchRecording(providerBotId) {
      return { recording_url: `${APP_BASE_URL || 'https://example.invalid'}/recordings/${providerBotId}` };
    }
  };
}

function createMeetingBotProvider({ env = process.env, fetchImpl = fetch, log = logger } = {}) {
  const providerName = String(env.MEETING_BOT_PROVIDER || 'recall').trim().toLowerCase();
  if (providerName === 'mock') {
    if (env.NODE_ENV === 'production') throw new MeetingBotConfigError('MEETING_BOT_PROVIDER=mock is not allowed in production');
    return createMockMeetingBotProvider();
  }
  if (providerName !== 'recall') throw new MeetingBotConfigError(`Unsupported meeting bot provider: ${providerName}`);
  return createRecallMeetingBotProvider({ env, fetchImpl, log });
}

let meetingBotProvider = createMeetingBotProvider();

app.use(cors({ origin: ALLOW_ORIGIN === '*' ? '*' : ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: '25mb' }));

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function normalizeUserKey(name) {
  return String(name || '').trim().toLowerCase();
}

function authHeader() {
  if (!RECALL_API_KEY) return '';
  return RECALL_API_KEY.startsWith('Token ') ? RECALL_API_KEY : `Token ${RECALL_API_KEY}`;
}

async function loadStaffRecords(options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (!targetDb) return [];
  const snap = await targetDb.collection('staff').get();
  return snap.docs.map(docSnap => ({ ...docSnap.data(), _id: docSnap.id }));
}

async function loadAdminConfig(options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (!targetDb) return {};
  const snap = await targetDb.collection('config').doc('admin').get();
  return snap.exists ? snap.data() : {};
}

async function verifyAppPassword(password, options = {}) {
  const entered = String(password || '').trim();
  if (!entered) throw new AuthenticationError('Password is required');

  const adminConfig = await (options.loadAdminConfig || loadAdminConfig)(options);
  const adminPin = String((adminConfig && adminConfig.adminPIN) || '').trim() || DEFAULT_ADMIN_PIN;
  if (entered === adminPin) {
    return { name: 'Administrator', isAdmin: true, userId: 'administrator' };
  }

  const staffRecords = await (options.loadStaffRecords || loadStaffRecords)(options);
  const staff = staffRecords.find((record) => {
    const customPassword = String(record.password || '').trim();
    if (customPassword) return entered === customPassword;
    return (firstNameOf(record.name).toLowerCase() + '1234') === entered.toLowerCase();
  });
  if (!staff) throw new AuthenticationError('Invalid app password');

  return {
    name: staff.name,
    email: staff.email || '',
    isAdmin: !!staff.isAdmin,
    userId: staff._id || normalizeUserKey(staff.name)
  };
}

function assertExpectedAuthenticatedUser(user, expectedUserName) {
  const expected = normalizeUserKey(expectedUserName);
  if (!expected) return user;
  if (normalizeUserKey(user.name) !== expected) {
    throw new AuthorizationError('Meeting bot login must match the current app user');
  }
  return user;
}

async function saveSession(sessionRecord, options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (targetDb) await targetDb.collection('meetingAgentSessions').doc(sessionRecord.token).set(sessionRecord, { merge: true });
  const idx = memorySessions.findIndex((entry) => entry.token === sessionRecord.token);
  if (idx >= 0) memorySessions[idx] = sessionRecord;
  else memorySessions.unshift(sessionRecord);
  return sessionRecord;
}

async function createSessionForUser(user, options = {}) {
  const sessionRecord = {
    token: id('mbs'),
    user_id: user.userId || normalizeUserKey(user.name),
    user_name: user.name,
    is_admin: !!user.isAdmin,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  await saveSession(sessionRecord, options);
  return sessionRecord;
}

async function loadSession(token, options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (targetDb) {
    const snap = await targetDb.collection('meetingAgentSessions').doc(token).get();
    if (snap.exists) return snap.data();
  }
  return memorySessions.find((entry) => entry.token === token) || null;
}

function extractSessionToken(req) {
  const header = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-session-token'] || '').trim();
}

async function requireSession(req, options = {}) {
  const token = extractSessionToken(req);
  if (!token) throw new AuthenticationError('Meeting bot session is required');
  const session = await (options.loadSession || loadSession)(token, options);
  if (!session) throw new AuthenticationError('Meeting bot session was not found');
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) throw new AuthenticationError('Meeting bot session expired');
  return session;
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
  if (!meetingBotProvider || typeof meetingBotProvider.healthcheck !== 'function') return meetingBotProvider && typeof meetingBotProvider.isConfigured === 'function' ? meetingBotProvider.isConfigured() : false;
  return meetingBotProvider.healthcheck();
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

function splitCsvNames(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function attendeeNamesFromMeeting(meetingRecord) {
  return splitCsvNames(meetingRecord.invited);
}

function attendeeEmailsFromMeeting(meetingRecord, staffRecords) {
  const emails = [];
  const invitedNames = attendeeNamesFromMeeting(meetingRecord);
  invitedNames.forEach((name) => {
    const staff = staffRecords.find((record) => normalizeUserKey(record.name) === normalizeUserKey(name));
    if (staff && staff.email) {
      String(staff.email).split(/[;, ]+/).map((email) => email.trim()).filter((email) => /@/.test(email)).forEach((email) => emails.push(email));
    }
  });
  String(meetingRecord.external || '').split(/[;,]+/).map((entry) => entry.trim()).filter((entry) => /@/.test(entry)).forEach((email) => emails.push(email));
  return Array.from(new Set(emails));
}

function userCanAccessMeeting(session, meetingRecord, staffRecords) {
  if (!session || !meetingRecord) return false;
  if (session.is_admin) return true;
  if (normalizeUserKey(meetingRecord.createdBy) === normalizeUserKey(session.user_name)) return true;
  if (attendeeNamesFromMeeting(meetingRecord).some((name) => normalizeUserKey(name) === normalizeUserKey(session.user_name))) return true;
  const userStaff = staffRecords.find((record) => normalizeUserKey(record.name) === normalizeUserKey(session.user_name));
  const userEmails = userStaff && userStaff.email
    ? String(userStaff.email).split(/[;, ]+/).map((email) => email.trim().toLowerCase()).filter(Boolean)
    : [];
  const meetingEmails = attendeeEmailsFromMeeting(meetingRecord, staffRecords).map((email) => email.toLowerCase());
  return userEmails.some((email) => meetingEmails.includes(email));
}

async function getCalendarMeeting(meetingId, options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (targetDb) {
    const snap = await targetDb.collection('calendar').doc(meetingId).get();
    if (snap.exists) return { ...snap.data(), _id: snap.id };
  }
  return null;
}

function isActiveStatus(status) {
  return ACTIVE_BOT_STATUSES.has(String(status || '').trim());
}

async function findActiveBotForMeeting(meetingId, options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  if (targetDb) {
    const snap = await targetDb.collection('meetingAgentEvents')
      .where('meeting_id', '==', meetingId)
      .limit(10)
      .get();
    const existing = snap.docs
      .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return existing.find((record) => isActiveStatus(record.status) || isActiveStatus(record.bot_status)) || null;
  }
  return memoryEvents.find((record) => record.meeting_id === meetingId && (isActiveStatus(record.status) || isActiveStatus(record.bot_status))) || null;
}

async function createMeetingAgentEvent(body, options = {}) {
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

  const provider = options.meetingBotProvider || meetingBotProvider;
  const log = options.log || logger;

  const eventRecord = {
    id: id('meet'),
    meeting_id: body.meeting_id || body.eventId || null,
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
    provider: provider.name,
    provider_bot_id: null,
    requested_by_user_id: body.requested_by_user_id || body.requested_by_user_name || null,
    requested_by_user_name: body.requested_by_user_name || null,
    attendee_user_names: Array.isArray(body.attendee_user_names) ? body.attendee_user_names : [],
    recording_url: null,
    transcript_artifact_url: null,
    summary_text: '',
    error_message: '',
    bot_display_name: body.bot_display_name || BOT_NAME,
    status: 'pending',
    bot_status: 'pending',
    summary_status: 'not_started',
    created_at: nowIso(),
    updated_at: nowIso()
  };

  if (body.create_bot_now !== false) {
    try {
      const bot = await provider.sendBotToMeeting(eventRecord.meeting_url, {
        meetingId: eventRecord.meeting_id,
        eventId: eventRecord.id,
        requestedBy: eventRecord.requested_by_user_name,
        title: eventRecord.title,
        startsAt: eventRecord.starts_at,
        botDisplayName: eventRecord.bot_display_name
      });
      eventRecord.provider_bot_response = bot.raw;
      eventRecord.provider_bot_id = bot.providerBotId || findBotId(bot.raw);
      eventRecord.status = bot.status || 'joining';
      eventRecord.bot_status = eventRecord.status;
    } catch (e) {
      eventRecord.status = 'failed';
      eventRecord.bot_status = 'failed';
      eventRecord.error_message = e.message;
      eventRecord.provider_error = { message: e.message, details: e.details || null };
      logError('meeting bot create failed', {
        meeting_id: eventRecord.meeting_id,
        provider: provider.name,
        error: e.message
      }, log);
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
    if (eventRecord.meeting_id) {
      await db.collection('calendar').doc(eventRecord.meeting_id).set({
        botEventId: eventRecord.id,
        botStatus: eventRecord.status || eventRecord.bot_status || '',
        botProvider: eventRecord.provider || '',
        botError: eventRecord.error_message || '',
        botRequestedBy: eventRecord.requested_by_user_name || '',
        recordingUrl: eventRecord.recording_url || '',
        summary: eventRecord.summary_text || '',
        summarizedBy: eventRecord.summary_text ? 'Meeting Bot' : '',
        _updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
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

async function summarizeMeetingTranscript({ transcript, title, attendees, eventId, startsAt, provider = aiProvider, log = logger }) {
  const text = String(transcript || '').trim();
  if (text.length < 20) {
    logWarn('meeting summary skipped because transcript is not usable', {
      event_id: eventId || null,
      transcript_chars: text.length
    }, log);
    return 'No usable transcript was available yet.';
  }

  try {
    return await provider.summarizeMeeting({ transcript: text, title, attendees, eventId, startsAt });
  } catch (error) {
    logError('meeting summary failed closed with no fallback provider', {
      provider: provider && provider.name || 'unknown',
      event_id: eventId || null,
      error: error.message
    }, log);
    throw error;
  }
}

async function summarize(text, title, attendees, options = {}) {
  return summarizeMeetingTranscript({
    transcript: text,
    title,
    attendees,
    eventId: options.eventId,
    provider: options.provider || aiProvider,
    log: options.log || logger
  });
}

async function deliverSummary(eventRecord, options = {}) {
  const targetDb = options.db === undefined ? db : options.db;
  const adminImpl = options.admin || admin;
  if (!targetDb || !eventRecord.summary_text) return;
  const recipients = new Set();
  (Array.isArray(eventRecord.attendee_user_names) ? eventRecord.attendee_user_names : []).map((name) => String(name || '').trim()).filter(Boolean).forEach((name) => recipients.add(name));
  normalizeAttendees(eventRecord.attendees).forEach(a => {
    if (a.name && !/@/.test(a.name)) recipients.add(a.name);
  });
  if (!recipients.size) return;
  const batch = targetDb.batch();
  const msg = `Meeting summary - "${eventRecord.title || 'Meeting'}":\n\n${eventRecord.summary_text}`;
  recipients.forEach(name => {
    const ref = targetDb.collection('messages').doc();
    batch.set(ref, { mentorName: name, from: 'Meeting Bot', text: msg, read: false, _createdAt: adminImpl.firestore.FieldValue.serverTimestamp() });
  });
  if (eventRecord.eventId) {
    batch.set(targetDb.collection('calendar').doc(eventRecord.eventId), {
      summary: eventRecord.summary_text,
      summarizedBy: 'Meeting Bot',
      _updatedAt: adminImpl.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
  logInfo('meeting summary delivered to inbox recipients', {
    event_id: eventRecord.id || null,
    recipient_count: recipients.size
  }, options.log || logger);
}

async function processEvent(eventRecord, options = {}) {
  if (!eventRecord || !eventRecord.provider_bot_id || eventRecord.summary_status === 'sent') return eventRecord;
  const provider = options.meetingBotProvider || options.aiProviderBotProvider || options.providerBot || meetingBotProvider;
  const fetchTranscript = options.fetchTranscript || ((providerBotId) => provider.fetchTranscript(providerBotId));
  const fetchRecording = options.fetchRecording || ((providerBotId) => provider.fetchRecording(providerBotId));
  const save = options.saveEvent || saveEvent;
  const deliver = options.deliverSummary || ((record) => deliverSummary(record, options));
  const summaryProvider = options.aiProvider || options.provider || aiProvider;
  const log = options.log || logger;

  logInfo('meeting transcript processing started', {
    event_id: eventRecord.id || null,
    provider_bot_id: eventRecord.provider_bot_id,
    attendee_count: normalizeAttendees(eventRecord.attendees).length
  }, log);

  eventRecord.status = 'processing';
  eventRecord.bot_status = 'processing';
  eventRecord.updated_at = nowIso();
  await save(eventRecord);

  const transcript = await fetchTranscript(eventRecord.provider_bot_id);
  const transcriptText = flattenTranscript(transcript);
  if (!transcriptText.trim()) {
    logWarn('meeting transcript processing skipped because transcript is empty', {
      event_id: eventRecord.id || null,
      provider_bot_id: eventRecord.provider_bot_id
    }, log);
    return eventRecord;
  }
  eventRecord.transcript_text = transcriptText;
  eventRecord.summary_status = 'summarizing';
  eventRecord.updated_at = nowIso();
  await save(eventRecord);

  try {
    const recording = await fetchRecording(eventRecord.provider_bot_id).catch(() => null);
    const recordingUrl = recording && (recording.recording_url || recording.video_url || (recording.data && recording.data.recording_url)) || '';
    if (recordingUrl) eventRecord.recording_url = recordingUrl;
    eventRecord.summary_text = await summarizeMeetingTranscript({
      transcript: transcriptText,
      title: eventRecord.title,
      attendees: eventRecord.attendees,
      eventId: eventRecord.id,
      startsAt: eventRecord.starts_at,
      provider: summaryProvider,
      log
    });
    eventRecord.summary_status = eventRecord.send_to_attendees === false ? 'ready' : 'sent';
    eventRecord.status = 'completed';
    eventRecord.bot_status = 'completed';
    eventRecord.processing_error = null;
    eventRecord.error_message = '';
    eventRecord.updated_at = nowIso();
    if (eventRecord.send_to_attendees !== false) await deliver(eventRecord);
    await save(eventRecord);
    logInfo('meeting transcript processing completed', {
      event_id: eventRecord.id || null,
      summary_status: eventRecord.summary_status,
      delivered: eventRecord.send_to_attendees !== false
    }, log);
  } catch (error) {
    eventRecord.status = 'failed';
    eventRecord.summary_status = 'processing_failed';
    eventRecord.bot_status = 'failed';
    eventRecord.processing_error = error.message;
    eventRecord.error_message = error.message;
    eventRecord.updated_at = nowIso();
    await save(eventRecord);
    throw error;
  }
  return eventRecord;
}

async function handleRecallWebhookPayload(payload) {
  memoryWebhooks.unshift({ id: id('wh'), payload, received_at: nowIso() });
  logInfo('meeting bot webhook received', {
    provider: meetingBotProvider && meetingBotProvider.name || 'unknown',
    event_type: payload && (payload.event || payload.type) || null
  });
  const update = meetingBotProvider.handleWebhook(payload);
  const botId = update.providerBotId;
  if (!botId) return;
  const events = await loadEvents();
  const eventRecord = events.find(e => e.provider_bot_id === botId);
  if (!eventRecord) return;
  const priorStatus = eventRecord.status || eventRecord.bot_status || '';
  eventRecord.last_webhook = payload;
  eventRecord.updated_at = nowIso();
  if (update.status) {
    eventRecord.status = update.status;
    eventRecord.bot_status = update.status;
  }
  if (update.errorMessage) {
    eventRecord.error_message = update.errorMessage;
  }
  await saveEvent(eventRecord);
  logInfo('meeting bot status updated from webhook', {
    event_id: eventRecord.id || null,
    provider_bot_id: eventRecord.provider_bot_id || null,
    previous_status: priorStatus || null,
    status: eventRecord.status || null
  });
  if (update.transcriptReady || update.isTerminal && update.status === 'completed') {
    await processEvent(eventRecord).catch(e => {
      logError('recall webhook processing failed', {
        event_id: eventRecord.id || null,
        provider_bot_id: eventRecord.provider_bot_id || null,
        error: e.message
      });
    });
  }
}

async function pollFinishedEvents() {
  try {
    const events = await loadEvents();
    for (const eventRecord of events.filter(e => e.provider_bot_id && e.status !== 'completed' && e.status !== 'failed')) {
      const providerState = await meetingBotProvider.getBotStatus(eventRecord.provider_bot_id).catch(() => null);
      if (!providerState) continue;
      eventRecord.status = providerState.status || eventRecord.status;
      eventRecord.bot_status = eventRecord.status;
      eventRecord.updated_at = nowIso();
      await saveEvent(eventRecord);
      if (providerState.status === 'completed' || providerState.status === 'processing') await processEvent(eventRecord);
    }
  } catch (e) {
    logError('meeting event poll failed', { error: e.message });
  }
}

function verifyWebhookSecret(req) {
  if (!RECALL_WEBHOOK_SECRET) return;
  const provided = String(req.headers['x-webhook-secret'] || req.headers['x-recall-webhook-secret'] || '').trim();
  if (!provided || provided !== RECALL_WEBHOOK_SECRET) {
    const err = new Error('Webhook secret is invalid');
    err.status = 401;
    throw err;
  }
}

app.post('/api/session/login', async (req, res, next) => {
  try {
    const requestBody = req.body || {};
    const user = assertExpectedAuthenticatedUser(
      await verifyAppPassword(requestBody.password || '', { db }),
      requestBody.expected_user_name || ''
    );
    const session = await createSessionForUser(user, { db });
    logInfo('meeting bot session created', {
      user_name: session.user_name,
      is_admin: session.is_admin
    });
    res.json({
      session: {
        token: session.token,
        expires_at: session.expires_at
      },
      user: {
        name: session.user_name,
        isAdmin: session.is_admin
      }
    });
  } catch (e) {
    next(e);
  }
});

app.get('/health', async (_req, res) => {
  const authOk = await checkRecallAuth();
  const aiStatus = aiProvider.status();
  const botStatus = meetingBotProvider.status();
  res.json({
    ok: true,
    service: 'regroup-meeting-agent-backend',
    recall_configured: !!RECALL_API_KEY,
    recall_auth_ok: authOk,
    recall_region: activeRecallRegion,
    meeting_bot_provider: botStatus.provider,
    meeting_bot_configured: botStatus.configured,
    meeting_bot_missing_config: botStatus.missing,
    ai_provider: aiStatus.provider,
    ai_configured: aiStatus.configured,
    ai_missing_config: aiStatus.missing,
    anthropic_configured: aiStatus.provider === 'claude' ? aiStatus.configured : false,
    anthropic_model: aiStatus.provider === 'claude' ? aiStatus.model : null,
    anthropic_model_configured: aiStatus.provider === 'claude' ? aiStatus.model_configured : false,
    firestore_configured: !!db,
    timestamp: nowIso()
  });
});

app.get('/healthz', async (_req, res) => {
  const authOk = await checkRecallAuth();
  const aiStatus = aiProvider.status();
  const botStatus = meetingBotProvider.status();
  res.json({
    status: 'ok',
    service: 'regroup-meeting-agent-backend',
    recall_configured: !!RECALL_API_KEY,
    recall_auth_ok: authOk,
    recall_region: activeRecallRegion,
    meeting_bot_provider: botStatus.provider,
    meeting_bot_configured: botStatus.configured,
    ai_provider: aiStatus.provider,
    ai_configured: aiStatus.configured,
    timestamp: nowIso()
  });
});

app.post('/api/presentation/generate', async (req, res, next) => {
  try {
    const request = normalizePresentationRequest(req.body || {});
    const mockMode = isMockPresentationMode();
    const result = mockMode ? generateMockPresentation(request) : await generatePresentationWithGemini(request);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/meetings/:meetingId/recording-bot', async (req, res, next) => {
  try {
    const session = await requireSession(req, { db });
    const meetingRecord = await getCalendarMeeting(req.params.meetingId, { db });
    if (!meetingRecord) return res.status(404).json({ error: 'Meeting not found' });

    const staffRecords = await loadStaffRecords({ db });
    if (!userCanAccessMeeting(session, meetingRecord, staffRecords)) {
      throw new AuthorizationError('You do not have access to send a bot to this meeting');
    }
    if (!meetingRecord.video || !isVideoMeetingUrl(meetingRecord.video)) {
      return res.status(400).json({ error: 'Meeting is missing a valid video URL' });
    }

    const existing = await findActiveBotForMeeting(req.params.meetingId, { db });
    if (existing) {
      logInfo('meeting bot request reused existing active event', {
        meeting_id: req.params.meetingId,
        event_id: existing.id || null,
        user_name: session.user_name
      });
      return res.status(200).json({ event: existing, idempotent: true });
    }

    const attendeeNames = attendeeNamesFromMeeting(meetingRecord);
    const attendeeEmails = attendeeEmailsFromMeeting(meetingRecord, staffRecords);
    const event = await createMeetingAgentEvent({
      meeting_id: req.params.meetingId,
      title: meetingRecord.title || meetingRecord.topic || 'Meeting',
      meeting_url: meetingRecord.video,
      platform: detectPlatform(meetingRecord.video),
      starts_at: meetingRecord.date && meetingRecord.time ? `${meetingRecord.date}T${meetingRecord.time}` : null,
      attendees: attendeeEmails.map((email) => ({ email })),
      attendee_user_names: attendeeNames,
      eventId: req.params.meetingId,
      notice_text: 'A recording bot will request admission, record the meeting, and send a written summary to authorized attendee inboxes.',
      consent_confirmed: true,
      send_to_attendees: true,
      review_required: false,
      create_bot_now: true,
      source: 'regroup_app_calendar',
      requested_by_user_id: session.user_id,
      requested_by_user_name: session.user_name,
      bot_display_name: BOT_NAME
    }, { meetingBotProvider, log: logger });

    logInfo('meeting bot event created from calendar detail', {
      meeting_id: req.params.meetingId,
      event_id: event.id || null,
      status: event.status || null,
      requested_by: session.user_name
    });
    res.status(201).json({ event });
  } catch (e) {
    next(e);
  }
});

app.post('/api/meetings/:meetingId/recording-bot/retry', async (req, res, next) => {
  try {
    const session = await requireSession(req, { db });
    const meetingRecord = await getCalendarMeeting(req.params.meetingId, { db });
    if (!meetingRecord) return res.status(404).json({ error: 'Meeting not found' });
    const staffRecords = await loadStaffRecords({ db });
    if (!userCanAccessMeeting(session, meetingRecord, staffRecords)) {
      throw new AuthorizationError('You do not have access to retry this meeting bot');
    }

    const events = await loadEvents();
    const failed = events
      .filter((record) => record.meeting_id === req.params.meetingId)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .find((record) => record.status === 'failed' || record.bot_status === 'failed');
    if (!failed) return res.status(404).json({ error: 'No failed bot request was found for this meeting' });
    if (!meetingRecord.video || !isVideoMeetingUrl(meetingRecord.video)) return res.status(400).json({ error: 'Meeting is missing a valid video URL' });

    const attendeeNames = attendeeNamesFromMeeting(meetingRecord);
    const attendeeEmails = attendeeEmailsFromMeeting(meetingRecord, staffRecords);
    const retried = await createMeetingAgentEvent({
      meeting_id: req.params.meetingId,
      title: meetingRecord.title || meetingRecord.topic || 'Meeting',
      meeting_url: meetingRecord.video,
      platform: detectPlatform(meetingRecord.video),
      starts_at: meetingRecord.date && meetingRecord.time ? `${meetingRecord.date}T${meetingRecord.time}` : null,
      attendees: attendeeEmails.map((email) => ({ email })),
      attendee_user_names: attendeeNames,
      eventId: req.params.meetingId,
      notice_text: failed.notice_text || 'A recording bot will request admission, record the meeting, and send a written summary to authorized attendee inboxes.',
      consent_confirmed: true,
      send_to_attendees: true,
      review_required: false,
      create_bot_now: true,
      source: 'regroup_app_calendar_retry',
      requested_by_user_id: session.user_id,
      requested_by_user_name: session.user_name,
      bot_display_name: BOT_NAME
    }, { meetingBotProvider, log: logger });

    logInfo('meeting bot event retried', {
      meeting_id: req.params.meetingId,
      event_id: retried.id || null,
      retried_from_event_id: failed.id || null,
      requested_by: session.user_name
    });
    res.status(201).json({ event: retried, retried_from_event_id: failed.id });
  } catch (e) {
    next(e);
  }
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
    verifyWebhookSecret(req);
    await handleRecallWebhookPayload(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.post('/api/meeting-agent/webhook', async (req, res, next) => {
  try {
    verifyWebhookSecret(req);
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
    verifyWebhookSecret(req);
    await handleRecallWebhookPayload(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error', details: err.details || undefined });
});

function startServer({ port = PORT, pollMs = 60000 } = {}) {
  const poller = pollMs ? setInterval(pollFinishedEvents, pollMs) : null;
  const server = app.listen(port, () => {
    console.log(`ReGroup meeting-agent backend listening on port ${port}`);
  });
  return { server, poller };
}

function setDbForTesting(nextDb) {
  db = nextDb || null;
}

function setAiProviderForTesting(nextProvider) {
  aiProvider = nextProvider || createAiProvider();
}

function setMeetingBotProviderForTesting(nextProvider) {
  meetingBotProvider = nextProvider || createMeetingBotProvider();
}

function resetTestState() {
  memoryEvents.length = 0;
  memoryWebhooks.length = 0;
  memorySessions.length = 0;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  AiProviderConfigError,
  AiProviderError,
  AuthenticationError,
  AuthorizationError,
  MeetingBotConfigError,
  buildMeetingSummaryPrompt,
  createAiProvider,
  createClaudeProvider,
  createMeetingAgentEvent,
  createMeetingBotProvider,
  createMockAiProvider,
  createMockMeetingBotProvider,
  createRecallMeetingBotProvider,
  createSessionForUser,
  deliverSummary,
  extractAnthropicText,
  findActiveBotForMeeting,
  flattenTranscript,
  getCalendarMeeting,
  getEvent,
  handleRecallWebhookPayload,
  loadEvents,
  loadStaffRecords,
  normalizeAttendees,
  processEvent,
  requireSession,
  resetTestState,
  saveEvent,
  setAiProviderForTesting,
  setDbForTesting,
  setMeetingBotProviderForTesting,
  summarize,
  summarizeMeetingTranscript,
  userCanAccessMeeting,
  verifyAppPassword,
  verifyWebhookSecret,
  memoryEvents,
  memorySessions,
  memoryWebhooks
};
