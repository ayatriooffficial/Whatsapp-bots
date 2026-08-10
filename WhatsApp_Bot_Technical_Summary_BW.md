# Technical Summary: WhatsApp Bot — 3-Tab Sheet + Gemini + Anti-Ban Upgrade

_Date: Aug 2026_

This document summarizes the **post-upgrade** state of the WhatsApp bot. It replaces the earlier May 1–20 summary.

---

## Executive Summary

The bot was upgraded from a single-tab, Groq-powered sender to a **3-tab Google Sheet architecture with Gemini AI, Excel-driven messages, and anti-ban hardening**:

- **3-tab sheet**: `cookie_import` (master, unchanged) → bot auto-splits into **CBA / DGM / TBM** tabs; a **Messages** tab drives what the bot sends (editable in Excel, no code change).
- **AI provider**: Switched from **Groq (llama-3.1-8b-instant)** to **Gemini (`gemini-3.1-flash-lite`)** — same endpoint pattern as the website backend's blog generator.
- **Message source**: **Messages tab is primary** (template with `{name}`/`{course}`/`{score}` placeholders); Gemini AI is the fallback when no template matches.
- **Volume/timing**: 1-minute randomized delays (45–75s), configurable daily cap (default 150) + 3-day warm-up, shuffled lead order.
- **Anti-ban**: added stealth Puppeteer flags, realistic user-agent, non-headless default, randomized timing, opt-out compliance.
- **Critical bug fixes**: wrong sheet tab name (`"Users"` → `cookie_import`), wrong phone column (E → D), wrong score column (G → J).

---

## Changed / Added Files

| File | Status | Change |
|---|---|---|
| `services/courseCategories.js` | **NEW** | Maps course strings → CBA/DGM/TBM tabs |
| `services/sheetSplitter.js` | **NEW** | Reads `cookie_import`, clears + rebuilds CBA/DGM/TBM; seeds Messages header |
| `services/messageTemplates.js` | **NEW** | Reads Messages tab; resolves most-specific template (course+session+score); placeholders |
| `services/sheetService.js` | Rewritten | Shared `loadSheet(title)` (auto-creates tabs); correct columns (Phone=D/3, Course=E/4, Score=J/9, Sent=P/15) |
| `services/aiReply.js` | Rewritten | Groq → Gemini (`gemini-3.1-flash-lite`); keeps rate-limit guard + fallback |
| `services/contentAgent.js` | Modified | Template-first in `generateIntroContent`/`generateFollowupContent`; AI fallback |
| `campaign.js` | Rewritten | TEST_MODE filter, 1-min randomized delay, daily cap + warm-up, shuffle, course+score into generation |
| `scheduler.js` | Modified | Env-configurable anti-spam; template/AI followups; removed legacy hardcoded builders |
| `bot.js` | Modified | Added 12+ stealth Puppeteer flags + realistic Chrome user-agent |
| `server.js` | Modified | Wired `syncCourseTabs` on boot + every 15 min; `splitSyncTimer` lifecycle |
| `leadLoader.js` | Modified | Aligned to correct columns (Phone=D/3); reads A1:K50 |
| `.env` | **NEW** | All config: sheet creds, Gemini key, volume/timing, TEST_MODE |
| `README.md` | **NEW** | Setup + Messages-tab docs |
| `GUIDE.md` | **NEW** | Complete from-zero guide: links, link/unlink phone, commands, troubleshooting |

---

## Architecture

```
Google Sheet (single spreadsheet)
 ├── cookie_import   ← MASTER: website exports ALL users here (unchanged)
 ├── CBA             ← derived: bot copies CMP / Certified Management Professional users
 ├── DGM             ← derived: bot copies Digital Growth Marketing users
 ├── TBM             ← derived: bot copies TBM users
 └── Messages        ← message content the bot sends (editable in Excel!)
```

- Website still writes only to `cookie_import` — **no changes to admin/client repos**.
- Bot syncs CBA/DGM/TBM every `SPLIT_SYNC_INTERVAL_MS` (default 15 min): **clear + rebuild** (deletions in master propagate).
- Messages tab is **never wiped**; bot reads it with a 2-min cache.

---

## Messages Tab Format

```
Course | Session | Score From | Score To | Content
```

- Course: `CBA` / `DGM` / `TBM` / `ALL`
- Session: `1` / `2` / `3` / `ALL`
- Score From/To: viewer-score range (inclusive); blank = any
- Content: message text with `{name}` / `{course}` / `{score}` placeholders

Resolution: course+session+score → course+session → course → ALL → **Gemini AI fallback**.

---

## Anti-ban measures (honest)

- Randomized 45–75s delays, daily cap + warm-up ramp, shuffled lead order
- Stealth Puppeteer flags, realistic UA, non-headless default
- Opt-out compliance ("stop"/"unsubscribe")
- **Caveat**: whatsapp-web.js is unofficial — Meta can still ban the sender number. The only fully-safe path is the official WhatsApp Business Cloud API (future work).

---

## Verification (completed)

- Sheet connectivity with `charters-sheets` service account: ✅
- Tab creation: CBA (7 rows), DGM (4), TBM (0, header), Messages (header) ✅
- Template resolution unit test: ✅ (CBA+session+score → specific; DGM → ALL fallback; no-match → null)
- Gemini key + model (`gemini-3.1-flash-lite`) live test: ✅
- End-to-end: test lead (om) received poster + Excel template message ✅

---

## Config Summary (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TEST_MODE` / `TEST_PHONE` | `false` / — | `true` = only send to one test number |
| `SEND_INTERVAL_MS` / `SEND_INTERVAL_JITTER_MS` | 60000 / 15000 | 1-min randomized delay |
| `MAX_DAILY_MESSAGES` | 150 | Daily cap (after warm-up) |
| `WARMUP_DAYS` / `WARMUP_DAILY_MAX` | 3 / 50 | Warm-up ramp |
| `MIN_HOURS_BETWEEN` / `MAX_MESSAGES_PER_DAY` | 10 / 5 | Per-user anti-spam |
| `SPLIT_SYNC_INTERVAL_MS` | 900000 | CBA/DGM/TBM rebuild interval |
| `LEAD_LOAD_ROWS` | 50 | Rows of cookie_import loaded into store |
| `GEMINI_MODEL` | gemini-3.1-flash-lite | AI model |
| `AI_MAX_REQ_PER_MIN` | 25 | Gemini rate-limit guard |

---

## Known issues / future work

- TBM tab has no users yet (correct — no TBM signups in data)
- Poster image (`poster.jpeg`) is a fixed old file ("UG Admissions 2026 / masters' union"); per-course images not yet supported (would need an image column in Messages tab)
- No streak/badge gamification (not requested)
- Official WhatsApp Business Cloud API migration (future, to eliminate ban risk)
