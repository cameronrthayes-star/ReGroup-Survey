# ReGroup Meeting Bot

A small server that sends a recording **bot into a meeting**, transcribes it, **summarizes** it, and drops the summary into the **inbox of everyone who attended** (the app's Firestore `messages`).

The app itself (a static site) can't join calls — that needs this service. You deploy it once.

## What you need (3 accounts/keys)
1. **Recall.ai** account → an **API key** (this is the service whose bot actually joins Zoom/Meet/Teams and records). Paid.
2. **Anthropic** API key (`sk-ant-…`) — already used by the app — for the summary.
3. A **Firebase service-account JSON** for project `regroup-elite-squad` (Firebase Console → Project settings → Service accounts → *Generate new private key*).

## Deploy (Render — free/cheap, ~10 min)
1. Push this `meeting-bot-server/` folder to a repo (it's already in your ReGroup-Survey repo).
2. Go to **render.com → New → Web Service**, connect the repo, set **Root Directory** = `meeting-bot-server`.
3. Build command `npm install`, Start command `npm start`.
4. Add **Environment Variables**:
   - `RECALL_API_KEY` = your Recall key
   - `RECALL_REGION` = your Recall region (e.g. `us-west-2`)
   - `ANTHROPIC_API_KEY` = `sk-ant-…`
   - `FIREBASE_SERVICE_ACCOUNT` = the **entire** service-account JSON, pasted as one value
   - (optional) `ALLOW_ORIGIN` = `https://cameronrthayes-star.github.io`
5. Deploy. Copy the service URL, e.g. `https://regroup-meeting-bot.onrender.com`.
6. Open `https://YOUR-URL/health` — you should see `recall_configured: true, anthropic_configured: true, firestore_configured: true`.
7. In **Recall.ai → Webhooks**, add `https://YOUR-URL/webhook`.

## Connect the app
In the ReGroup app: **Settings → Meeting Bot backend URL**, paste `https://YOUR-URL`, Save.

## Use it
Open a **Calendar** event that has a video link → **🤖 Send recording bot**. The bot joins, records, and when the call ends the summary is messaged to every invited staff member's inbox + Admin automatically.
