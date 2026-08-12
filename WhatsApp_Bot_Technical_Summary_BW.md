# Technical Summary: WhatsApp Bot — 3-Day × 2-Slot Scheduled Campaign

_Date: Aug 2026_

This document summarizes the current state of the WhatsApp bot: **3-day × 2-slot scheduled campaigns**, permanent CBA/DGM lead lists, Excel-driven message schedule, Gemini AI, and anti-ban hardening.

---

## Executive Summary

The bot now runs a **structured 3-day campaign per lead** (2 messages/day at custom times = 6 total, all different), with:

- **Permanent CBA / DGM lead tabs** — DB leads auto-added from `cookie_import`, manual leads typed directly by workers, progress columns (Stage / Day / Slot / Status / Messages Sent / Last Sent At), and **auto-removal when done** (after all 6 messages).
- **Messages tab = schedule** — `Course | Day | Slot | Time | Score From | Score To | Content`; 6 slots per course, each with its own custom time; edit in Excel → bot sends it at that time (no code change).
- **AI provider**: **Gemini (`gemini-3.1-flash-lite`)** — fallback when no template matches.
- **Time-based scheduler** — checks every minute, sends when a slot time is due; respects per-user (2/day) + global daily caps; 1-min randomized delays.
- **Anti-ban**: stealth Puppeteer flags, realistic UA, non-headless default, randomized timing, opt-out compliance, daily caps.
- **Critical bug fixes**: wrong sheet tab (`"Users"` → `cookie_import`), wrong phone column (E → D), wrong score column (G → J).

---

## Changed / Added Files

| File | Status | Change |
|---|---|---|
| `services/courseCategories.js` | **NEW** | Maps course strings → CBA/DGM/TBM tabs |
| `services/sheetSplitter.js` | Rewritten | **Append-only CBA/DGM master lists**; auto-add DB leads; preserve manual rows + dividers; remove done leads; migrate headers |
| `services/messageTemplates.js` | Rewritten | **Day/Slot/Time schedule** matching; old-format migration; placeholders |
| `services/sheetService.js` | Modified | `getCourseLeads` + `updateLeadProgress` for course tabs; correct columns |
| `services/aiReply.js` | Rewritten | Groq → Gemini (`gemini-3.1-flash-lite`); rate-limit guard + fallback |
| `services/beautifySheet.js` | **NEW** | Formats Messages tab (frozen/colored header, autosize) + seeds 12 example rows |
| `scheduler.js` | Rewritten | **Time-based 3-day × 2-slot sends**; day/slot progression; progress updates; done-after-6 |
| `campaign.js` | Unused | Kept as reference; no longer imported (scheduler owns sends) |
| `bot.js` | Modified | Added 12+ stealth Puppeteer flags + realistic Chrome user-agent |
| `server.js` | Modified | Removed campaign blast; wired splitter + scheduler only |
| `leadLoader.js` | Rewritten | Loads from CBA/DGM course tabs (progress-aware) |
| `.env` | Modified | Schedule config: `SLOT1_TIME`, `SLOT2_TIME`, `TOTAL_SESSIONS`, `MAX_MESSAGES_PER_DAY` |
| `README.md` / `GUIDE.md` | Updated | New schedule docs |

---

## Architecture

```
Google Sheet (single spreadsheet)
 ├── cookie_import   ← MASTER: website exports ALL users here (unchanged)
 ├── CBA             ← PERMANENT: CMP leads + progress; DB auto-added, manual added
 ├── DGM             ← PERMANENT: Digital Growth leads + progress; DB auto-added, manual added
 ├── TBM             ← PERMANENT (future): TBM leads
 ├── Messages        ← SCHEDULE: Course|Day|Slot|Time|Score|Score|Content (editable in Excel!)
 └── Manual Leads    ← temporary holding for manual entries (copied to CBA/DGM)
```

- Website still writes only to `cookie_import` — **no changes to admin/client repos**.
- Bot appends new DB users to CBA/DGM (dedupe by phone) every `SPLIT_SYNC_INTERVAL_MS` (15 min).
- **Done leads (6 messages sent) are removed** from CBA/DGM; manual + DB leads both flow through the same schedule.
- Divider rows (e.g. `— CBA LEADS —`) are preserved for worker readability.
- Messages tab is **never wiped**; bot reads it with a 2-min cache.

---

## Messages Tab Format (schedule)

```
Course | Day | Slot | Time | Score From | Score To | Content
```

- Course: `CBA` / `DGM` / `TBM` / `ALL`
- Day: `1` / `2` / `3` / `ALL`
- Slot: `1` / `2` / `ALL`
- Time: `HH:MM` (24h) — when to send that day; fallback `10:00` (slot 1) / `18:00` (slot 2)
- Score From/To: viewer-score range (inclusive); blank = any
- Content: message text with `{name}` / `{course}` / `{score}` placeholders

**Schedule per lead:** 3 days × 2 slots = 6 messages (all can differ); after the 6th, `Stage=done` → removed from CBA/DGM.

Resolution: course+day+slot+score → course+day+slot → course → ALL → **Gemini AI fallback**.

---

## Anti-ban measures (honest)

- 2 messages/day per user max, global daily cap (default 150), 1-min randomized delays (45–75s)
- Time-based sends (no rapid blasts), stealth Puppeteer flags, realistic UA, non-headless default
- Opt-out compliance ("stop"/"unsubscribe")
- **Caveat**: whatsapp-web.js is unofficial — Meta can still ban the sender number. The only fully-safe path is the official WhatsApp Business Cloud API (future work).

---

## Verification (completed)

- Sheet connectivity with `charters-sheets` service account: ✅
- Messages tab migrated to day/slot/time + beautified (frozen/colored header) + 12 example rows seeded ✅
- CBA/DGM headers migrated to progress format (Stage/Day/Slot/Status/Sent/LastSent/AddedBy); existing rows normalized ✅
- Course-tab leads read correctly (CBA 6, DGM 4 active) ✅
- Template matching by course classification: CBA d1s1 → 10:00, CBA d3s2 → 18:00, DGM d2s1 → 10:00, TBM → AI fallback ✅
- Day/slot progression: 6 messages → day1s1, day1s2, day2s1, day2s2, day3s1, day3s2 → done ✅
- Gemini key + model (`gemini-3.1-flash-lite`) live test: ✅
- End-to-end: test lead (om) received poster + Excel template message ✅

---

## Config Summary (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TEST_MODE` / `TEST_PHONE` | `false` / — | `true` = only send to one test number |
| `SEND_INTERVAL_MS` / `SEND_INTERVAL_JITTER_MS` | 60000 / 15000 | 1-min randomized delay between sends |
| `MAX_DAILY_MESSAGES` | 150 | Global daily cap across all leads |
| `MAX_MESSAGES_PER_DAY` | 2 | Per-user daily cap (2 = the 2 slots) |
| `TOTAL_SESSIONS` | 6 | Total messages per lead (3 days × 2 slots) |
| `SLOT1_TIME` / `SLOT2_TIME` | 10:00 / 18:00 | Fallback slot times (Messages tab Time overrides) |
| `SPLIT_SYNC_INTERVAL_MS` | 900000 | How often CBA/DGM tabs sync new DB leads (15 min) |
| `LEAD_LOAD_ROWS` | 50 | Rows of course tabs loaded into store |
| `GEMINI_MODEL` | gemini-3.1-flash-lite | AI model |
| `AI_MAX_REQ_PER_MIN` | 25 | Gemini rate-limit guard |

---

## Known issues / future work

- TBM tab has no users yet (correct — no TBM signups in data)
- Poster image (`poster.jpeg`) is a fixed old file ("UG Admissions 2026 / masters' union"); per-course images not yet supported (would need an image column in Messages tab)
- No streak/badge gamification (not requested)
- Official WhatsApp Business Cloud API migration (future, to eliminate ban risk)
