# ReGroup Meeting Agent Backend

This backend supports the ReGroup app calendar and meeting bot flow.

It provides:

- `/api/ics` for syncing Google/Outlook/iCloud iCal feeds into the app calendar.
- `/api/meeting-agent/events` for sending a Recall.ai bot into a selected meeting.
- `/api/recall/webhook` and `/webhook` for Recall status callbacks.
- A 60-second poller that can process finished bots even when the webhook is delayed.
- Legacy `/api/bot` support for older app code.

## Required services

1. Recall.ai API key.
2. Firebase service-account JSON for `regroup-elite-squad`.
3. Optional Anthropic or OpenAI key for backend-generated summaries.

The app can also summarize from the browser with its saved Anthropic key, so the backend summary key is useful but not the only path.

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
RECALL_API_KEY=your Recall key
RECALL_REGION=us-west-2
FIREBASE_SERVICE_ACCOUNT=the full Firebase service-account JSON
ALLOW_ORIGIN=https://cameronrthayes-star.github.io
ANTHROPIC_API_KEY=optional sk-ant key
OPENAI_API_KEY=optional OpenAI key
```

## App flow

1. Staff sync their Google calendar by pasting their secret iCal URL in the Calendar tab.
2. Synced events appear on the app calendar.
3. Clicking a synced event opens the meeting details pulled from the calendar, including video URL when present.
4. Pressing `Send Bot To This Meeting` imports the synced meeting into the app calendar and calls `/api/meeting-agent/events`.
5. The backend asks Recall.ai to send `ReGroup Summary Agent` into the call.
6. When the call ends, the backend webhook or poller processes the transcript and exposes the summary for the app inbox flow.

## Health check

Open:

```text
https://YOUR-BACKEND/health
```

Expected important fields:

```json
{
  "ok": true,
  "recall_configured": true,
  "recall_auth_ok": true,
  "recall_region": "us-west-2",
  "firestore_configured": true
}
```
