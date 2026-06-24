# ReGroup Meeting Agent Backend

This backend supports the ReGroup app calendar and meeting bot flow.

It provides:

- `/api/ics` for syncing Google/Outlook/iCloud iCal feeds into the app calendar.
- `/api/presentation/generate` for backend-only Presentation Studio generation with Gemini.
- `/api/session/login` for short-lived meeting-bot sessions that match the current app user.
- `/api/meetings/:meetingId/recording-bot` for sending a recording bot into a selected calendar meeting.
- `/api/meetings/:meetingId/recording-bot/retry` for retrying a failed bot request.
- `/api/meeting-agent/events` for bot lifecycle inspection and legacy clients.
- `/api/meeting-agent/webhook`, `/api/recall/webhook`, and `/webhook` for Recall status callbacks.
- A 60-second poller that can process finished bots even when the webhook is delayed.
- Legacy `/api/bot` support for older app code.

## Required services

1. Recall.ai API key.
2. Firebase service-account JSON for `regroup-elite-squad`.
3. Anthropic API key for backend-generated summaries.
4. Gemini API key for Presentation Studio generation.

The app can also summarize pasted transcripts from the browser with its saved Anthropic key. The recording-bot backend summary flow uses Anthropic/Claude and fails clearly if it is not configured.

## Render setup

Create a Render web service with:

```text
Root Directory: meeting-bot-server
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Environment variables:

```text
MEETING_BOT_PROVIDER=recall
RECALL_API_KEY=your Recall key
RECALL_WEBHOOK_SECRET=shared webhook secret for Recall callbacks
RECALL_REGION=us-west-2
APP_BASE_URL=https://your-backend-hostname
BOT_NAME=ReGroup Recording Bot
FIREBASE_SERVICE_ACCOUNT=the full Firebase service-account JSON
ALLOW_ORIGIN=https://cameronrthayes-star.github.io
ANTHROPIC_API_KEY=sk-ant key
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
GEMINI_API_KEY=your Gemini auth key or API key
GEMINI_MODEL=gemini-1.5-flash
```

`ANTHROPIC_MODEL` defaults to `claude-3-5-sonnet-latest` if omitted because this backend already supports env defaults, but setting it explicitly is recommended for deployments.

`GEMINI_MODEL` defaults to `gemini-1.5-flash` if omitted.

For local provider tests without calling Recall or Anthropic, use:

```text
MEETING_BOT_PROVIDER=mock
AI_PROVIDER=mock
NODE_ENV=development
```

Do not use the mock providers in production.

## App flow

1. Staff sync their Google calendar by pasting their secret iCal URL in the Calendar tab.
2. Synced events appear on the app calendar.
3. Clicking a synced event opens the meeting details pulled from the calendar, including video URL when present.
4. Pressing `Send Recording Bot` prompts once for the current app password, creates a short-lived backend session, and calls `/api/meetings/:meetingId/recording-bot`.
5. The backend verifies meeting access, prevents duplicate active bots, and asks Recall.ai to send the configured bot display name into the call.
6. When the call ends, the webhook or poller updates bot status, fetches the transcript, summarizes it with Claude, and writes the summary into the in-app inboxes of attendee app users.
7. Calendar records are mirrored with `botStatus`, `botEventId`, `botRequestedBy`, `recordingUrl`, `summary`, and `summarizedBy`.

## Health check

Open:

```text
https://YOUR-BACKEND/health
```

Expected important fields:

```json
{
  "ok": true,
  "meeting_bot_provider": "recall",
  "meeting_bot_configured": true,
  "ai_provider": "claude",
  "ai_configured": true,
  "firestore_configured": true
}
```

## Local testing

```text
cd meeting-bot-server
npm test
node --check index.js
```

To run the server locally against real services, set:

```text
MEETING_BOT_PROVIDER=recall
RECALL_API_KEY=...
RECALL_WEBHOOK_SECRET=...
APP_BASE_URL=http://127.0.0.1:3000
FIREBASE_SERVICE_ACCOUNT=...
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

Then run `npm start`.

Manual local verification:

1. Start the backend.
2. Open the app, sign in, and set the meeting-bot backend URL in Settings if needed.
3. Open a calendar meeting with a valid video link.
4. Click `Send Recording Bot` and enter the same app password you used to sign in.
5. Confirm the meeting detail status moves through `waiting_for_admission`, `recording`, `processing`, and `completed`.
6. POST a provider webhook payload to `/api/meeting-agent/webhook` or `/api/recall/webhook`.
7. Confirm the meeting summary appears on the calendar event and inbox messages appear for attendee app users.
