# Charters WhatsApp Bot

Automated WhatsApp messaging bot for Charters Union of Business.
Reads leads from a Google Sheet, sends personalized messages (template-first, Gemini AI fallback), replies to inbound messages, and tracks engagement.

## Architecture

```
Google Sheet (single spreadsheet)
 ├── cookie_import   ← MASTER: website exports ALL users here (unchanged)
 ├── CBA             ← derived: bot copies CMP/Certified Management Professional users
 ├── DGM             ← derived: bot copies Digital Growth Marketing users
 ├── TBM             ← derived (optional): bot copies TBM users
 └── Messages        ← message content the bot sends (editable in Excel!)
```

- **The website still writes to `cookie_import` only** — nothing in the admin/client repos changed.
- **The bot keeps CBA/DGM/TBM in sync**: every `SPLIT_SYNC_INTERVAL_MS` (default 15 min) it reads `cookie_import`, classifies each row by course, and **clears + rebuilds** the course tabs.
- **The Messages tab drives the bot's content** — edit a message in Excel and the bot uses it on the next send (no code change, no restart).

## Setup

1. `npm install`
2. Copy `.env` values (already present in this repo — fill `GEMINI_API_KEY`)
3. Make sure the Google Sheet is shared with the service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) as **Editor**
4. `npm start`
5. Open `http://localhost:3000/qr` (or the terminal) → scan the QR with your phone → WhatsApp linked

## The Messages tab

Create a tab named **`Messages`** in the same spreadsheet with this header row:

```
Course | Session | Score From | Score To | Content
```

Rules:
- **Course**: `CBA`, `DGM`, `TBM`, or `ALL` (case-insensitive)
- **Session**: `1`, `2`, `3`, or `ALL`
- **Score From / Score To**: viewer-score range (inclusive). Blank = any score
- **Content**: the WhatsApp message. Placeholders:
  - `{name}` → lead's first name
  - `{course}` → lead's course string
  - `{score}` → lead's viewer score

Resolution order (most specific wins):
1. course + session + score
2. course + session
3. course only
4. `ALL` (any course)

If no template matches, the bot falls back to **Gemini AI-generated** content (existing behavior).

### Example rows

```
CBA | 1 | 70 | 100 | Hi {name}! You've been exploring {course} — the CBA batch is filling fast. Want details?
CBA | 2 |    |     | {name}, here's how CBA graduates are placing this year...
ALL | 1 |    |     | Hi {name}! Admissions open at Charters Union of Business.
```

## Key configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `SEND_INTERVAL_MS` | 60000 | Base delay between campaign messages (1 min) |
| `SEND_INTERVAL_JITTER_MS` | 15000 | Random ±jitter so delays look human |
| `MAX_DAILY_MESSAGES` | 150 | Max messages/day across all leads (after warm-up) |
| `WARMUP_DAYS` / `WARMUP_DAILY_MAX` | 3 / 50 | First N days capped lower to warm up the number |
| `MIN_HOURS_BETWEEN` | 10 | Min hours between follow-ups to one user |
| `MAX_MESSAGES_PER_DAY` | 5 | Max follow-up messages/day to one user |
| `SPLIT_SYNC_INTERVAL_MS` | 900000 | How often CBA/DGM tabs are rebuilt (15 min) |
| `LEAD_LOAD_ROWS` | 50 | Rows of cookie_import loaded into the message store |
| `HEADLESS` | false | Real browser (stealthier) when false |
| `GEMINI_MODEL` | gemini-2.5-flash-lite | Gemini model for AI content |

## Anti-ban notes (important, honest)

- whatsapp-web.js is **unofficial** — Meta can still ban the number. The changes here (randomized 1-min delays, daily caps, warm-up, varied messages, stealth flags, real browser) **reduce** the risk but don't eliminate it.
- Keep volume reasonable (default 150/day) and ramp up slowly.
- The only fully-safe path is the official **WhatsApp Business Cloud API** (paid, approved templates) — not implemented here.
- Reply quickly to user messages; honor opt-outs ("stop"/"unsubscribe") immediately — the bot does this.

## Troubleshooting

- **"Sheet Users not found"** (old error) — fixed: bot now uses `cookie_import` (see `services/sheetService.js`).
- **No CBA/DGM tabs appear** — the bot must run at least once with a valid service account that has Editor access; tabs are auto-created.
- **Messages not using the sheet** — check the `Messages` tab header is exactly `Course | Session | Score From | Score To | Content` and the Content cell is non-empty.
- **Gemini fallback used constantly** — check `GEMINI_API_KEY` is a valid `AIza...` key and the Sheets/Generative Language APIs are enabled in Google Cloud.
