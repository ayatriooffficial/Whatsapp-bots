# Charters WhatsApp Bot — Complete Guide

Everything you need to run, link, test, and manage the WhatsApp bot — from zero.

---

## 1. What this is

An automated WhatsApp assistant for **Charters Union of Business**. It:
- Reads leads from a **Google Sheet** (`cookie_import` tab)
- Splits them into **CBA / DGM / TBM** tabs automatically
- Sends **messages from the `Messages` tab** (editable in Excel) or **Gemini AI** if no template matches
- Replies to inbound WhatsApp messages (intent detection + AI)
- Sends follow-ups (max 3 sessions per lead) with anti-spam limits

---

## 2. Important links

| What | Link / Value |
|---|---|
| **Google Sheet** (all data + tabs) | `https://docs.google.com/spreadsheets/d/1bAO5B_OEQGWpFNLIJKLvj0ju0ogGk85N7NmNU6DORv4` |
| **Sheet tabs** | `cookie_import` (master, website writes here) · `CBA` · `DGM` · `TBM` · `Messages` |
| **Bot folder** (local) | `/Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master` |
| **QR page** (after bot starts) | `http://localhost:3000/qr` |
| **Bot service (Render, if deployed)** | Render dashboard → `charters-backend` (for the website backend, not the bot) |

---

## 3. First-time setup (from zero)

### 3.1 Install dependencies
```bash
cd /Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master
npm install
```

### 3.2 Configure `.env`
The `.env` file already exists with working values. Key ones:

| Variable | What it is | Current value |
|---|---|---|
| `SHEET_ID` | The Google Sheet ID | `1bAO5B_...DORv4` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account that reads/writes the sheet | `charters-sheets@charters-union.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | The service account's private key | (set) |
| `GEMINI_API_KEY` | Gemini key for AI messages | (set) |
| `GEMINI_MODEL` | Gemini model | `gemini-3.1-flash-lite` |
| `TEST_MODE` | `true` = only send to `TEST_PHONE`; `false` = send to all | `false` |
| `HEADLESS` | `false` = real browser (stealthier) | `false` |

### 3.3 Ensure the sheet is shared
The Google Sheet must be shared (Editor) with:
```
charters-sheets@charters-union.iam.gserviceaccount.com
```
(Already done — the bot can read/write.)

---

## 4. Linking / unlinking a WhatsApp number (phone)

> The **sender** number = the WhatsApp account that scans the QR. Use a **disposable number**, not your personal one.

### 4.1 Link a number (first time / after unlink)
1. Start the bot:
   ```bash
   cd /Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master
   npm start
   ```
2. A **QR code** prints in the terminal (also at `http://localhost:3000/qr`)
3. On the phone: **WhatsApp → Settings → Linked devices → Link a device** → scan the QR
4. Terminal shows `✅ BOT READY` → bot is linked

### 4.2 Unlink a number (remove the bot's access)
**Method A — from the phone (cleanest):**
- Phone → WhatsApp → **Settings → Linked devices** → tap the bot device → **Log out / Remove**

**Method B — delete the bot's saved session (codebase):**
```bash
cd /Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master
rm -rf .wwebjs_auth
```
Next `npm start` asks for a fresh QR.

### 4.3 Also reset local bot state (recommended after unlink)
```bash
rm -f messageStore.json engagement.json
```

### 4.4 Stop the bot
- In the terminal where it runs: **Ctrl+C**
- Or kill the process: `ps aux | grep "node server.js"` then `kill <PID>`

---

## 5. Running the bot

### Normal run
```bash
cd /Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master
npm start
```

### What happens on start
1. Connects to Google Sheet → lists tabs
2. Loads leads from `cookie_import`
3. **Syncs CBA/DGM/TBM tabs** (clears + rebuilds from `cookie_import`)
4. Ensures `Messages` tab has a header
5. Starts campaign (sends intro messages, 1-min randomized delays)
6. Starts scheduler (follow-ups, every minute check)
7. Starts reply engine (handles inbound messages)

---

## 6. The Google Sheet tabs

| Tab | Purpose | Who writes |
|---|---|---|
| `cookie_import` | Master list of all users (from the website) | Website backend (every 10 min) |
| `CBA` | CBA (Certified Management Professional) leads | Bot (auto, every 15 min) |
| `DGM` | DGM (Digital Growth Marketing) leads | Bot (auto, every 15 min) |
| `TBM` | TBM leads | Bot (auto, every 15 min) |
| `Messages` | **Message templates the bot sends** | **You (edit in Excel!)** |

> CBA/DGM/TBM are **rebuilt** each sync (they mirror `cookie_import`). `Messages` is **never wiped** — your edits persist.

---

## 7. The Messages tab — how to control what the bot sends

**Columns (header row):**
```
Course | Session | Score From | Score To | Content
```

| Column | Meaning | Example |
|---|---|---|
| `Course` | Which course: `CBA`, `DGM`, `TBM`, or `ALL` | `CBA` |
| `Session` | Which message (1st, 2nd, 3rd follow-up) | `1` |
| `Score From` | Min viewer score (blank = any) | `70` |
| `Score To` | Max viewer score (blank = any) | `100` |
| `Content` | The message text | `Hi {name}! ...` |

**Placeholders** in Content:
- `{name}` → lead's first name
- `{course}` → lead's course string
- `{score}` → lead's viewer score

**Example rows:**
```
CBA  | 1 |    |    | Hi {name}! The CBA program is filling fast. Reply YES.
CBA  | 1 | 70 | 100 | {name}, you've been exploring {course} a lot — ready to apply?
DGM  | 2 |    |    | {name}, here's a Digital Growth follow-up...
ALL  | 1 |    |    | Hi {name}! Admissions open at Charters Union of Business.
```

**How matching works** (most specific wins):
1. Course + Session + Score range
2. Course + Session
3. Course only
4. `ALL` (any course)
5. **No match → Gemini AI generates the message**

> **Edit a message in Excel → the bot sends it on the next message. No code change, no restart needed** (2-min cache).

---

## 8. Testing mode (safe — send only to one number)

In `.env`:
```env
TEST_MODE=true
TEST_PHONE=918303252446   # replace with the 10-digit test number
```
- `true` = only sends to `TEST_PHONE`, ignores all other leads
- `false` (or removed) = sends to all leads (production)

To test the Excel-message flow:
1. Add a row to `Messages` tab (e.g. `CBA | 1 | | | Hi {name}! TEST from Excel — {course} is waiting`)
2. Set `TEST_MODE=true` + `TEST_PHONE`
3. Restart the bot, scan QR
4. You'll receive the Excel message on the test number

---

## 9. Volume / anti-spam / anti-ban

| Setting | Default | Meaning |
|---|---|---|
| `SEND_INTERVAL_MS` | 60000 | Base delay between messages (1 min) |
| `SEND_INTERVAL_JITTER_MS` | 15000 | Random ±jitter (45-75s actual) |
| `MAX_DAILY_MESSAGES` | 150 | Max messages/day across all leads (after warm-up) |
| `WARMUP_DAYS` / `WARMUP_DAILY_MAX` | 3 / 50 | First N days capped lower |
| `MIN_HOURS_BETWEEN` | 10 | Min hours between follow-ups to one lead |
| `MAX_MESSAGES_PER_DAY` | 5 | Max follow-up messages/day to one lead |
| `MAX_SESSIONS` / `MAX_CAMPAIGN_SESSIONS` | 3 / 3 | Max sessions per user |

> **Reality check:** whatsapp-web.js is unofficial — Meta can still ban the sender number. These settings reduce risk. The only fully-safe path is the official WhatsApp Business Cloud API (not implemented). Use a disposable sender number.

---

## 10. Common tasks

| Task | Command / Action |
|---|---|
| Start bot | `cd .../whatsapp-bot-master && npm start` |
| Stop bot | `Ctrl+C` in terminal, or `kill <PID>` |
| Unlink phone | Phone → Linked devices → Remove, OR `rm -rf .wwebjs_auth` |
| Reset bot state | `rm -f messageStore.json engagement.json` |
| Check who's running | `ps aux \| grep "node server.js"` |
| See tabs | Open the Google Sheet, scroll bottom tab bar |
| Change a message | Edit the `Messages` tab (takes effect on next send) |
| Test only yourself | Set `TEST_MODE=true` + `TEST_PHONE` in `.env` |
| Back to all users | Set `TEST_MODE=false` in `.env` |

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| **No QR code** | Make sure `npm start` runs in the bot folder; QR prints to terminal + `http://localhost:3000/qr` |
| **"BOT READY" never appears** | Re-scan QR (expires in ~60s); check phone is linked |
| **Tabs missing** | Bot must run once with valid sheet access; tabs auto-create on `BOT READY` |
| **Messages tab empty** | It's blank until YOU add rows (header only is normal) |
| **Bot sends AI instead of Excel message** | Check the Messages row: correct header, Course/Session values, Content non-empty, 2-min cache |
| **"Sheet Users not found"** | Old bug — fixed; bot uses `cookie_import` now |
| **Wrong numbers receiving** | Check `cookie_import` Phone column (D) is correct; invalid phones are skipped |
| **Gemini fallback always** | Check `GEMINI_API_KEY` is valid + Generative Language API enabled |
| **Banned number** | Delete `.wwebjs_auth`, use a new disposable number, re-link |

---

## 12. Deployment (cloud)

- The bot is **not yet deployed** — it runs locally.
- To deploy on Render/VPS: push this folder, set the same `.env` values as env vars, run `npm start`, and **scan the QR once on the server** (headless with a VNC/display, or `HEADLESS=false` on a GUI box).
- **Do not** commit `.env` or `.wwebjs_auth` (gitignored).
