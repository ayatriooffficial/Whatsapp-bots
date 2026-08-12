/**
 * Message template service — reads the "Messages" tab from Google Sheets.
 *
 * Tab layout (row 1 = header):
 *   Course | Day | Slot | Time | Score From | Score To | Content
 *
 * - Course: "CBA", "DGM", "TBM", or "ALL" (case-insensitive)
 * - Day: 1, 2, 3 or "ALL"
 * - Slot: 1, 2 or "ALL"
 * - Time: HH:MM (24h) — when this message is sent on that day
 * - Score From / Score To: viewer-score range (inclusive), blank = any
 * - Content: the message, with {name} / {course} / {score} placeholders
 *
 * Resolution: exact course+day+slot+score → course+day+slot → course → ALL
 * → null (caller falls back to AI). Results cached 2 min.
 */

const CACHE_TTL_MS = 2 * 60 * 1000;

const { classifyCourse } = require("./courseCategories");

const HEADERS = [
  "Course",
  "Day",
  "Slot",
  "Time",
  "Score From",
  "Score To",
  "Content",
];

let cache = { at: 0, rows: null };

function fillPlaceholders(text, lead) {
  const firstName = String(lead.name || "there").trim().split(" ")[0];
  return String(text || "")
    .replace(/\{name\}/g, firstName)
    .replace(/\{course\}/g, String(lead.course || ""))
    .replace(/\{score\}/g, String(lead.score ?? ""));
}

function scoreInRange(score, from, to) {
  const s = Number(score || 0);
  const lo = from === "" || from === null || from === undefined ? -Infinity : Number(from);
  const hi = to === "" || to === null || to === undefined ? Infinity : Number(to);
  return s >= lo && s <= hi;
}

function timeToMinutes(t) {
  const [h, m] = String(t || "10:00").split(":").map(Number);
  return (Number.isFinite(h) ? h : 10) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Seeds the Messages header (new format) or migrates the old
 * Course|Session|Score From|Score To|Content layout to the new one
 * (day=session, slot=1, time=10:00). Idempotent.
 */
async function migrateMessagesTab(loadSheet) {
  const sheet = await loadSheet("Messages");
  await sheet.loadCells("A1:G1");
  const a1 = sheet.getCell(0, 0).value;

  if (!a1) {
    // Empty tab — seed new header
    for (let c = 0; c < HEADERS.length; c++) sheet.getCell(0, c).value = HEADERS[c];
    await sheet.saveUpdatedCells();
    console.log("   ↳ Messages: seeded new header (Course|Day|Slot|Time|Score|Score|Content)");
    return;
  }

  const c1 = sheet.getCell(0, 2).value;
  if (String(c1 || "").trim().toLowerCase() === "score from") {
    // OLD format — migrate: Course|Session|ScoreFrom|ScoreTo|Content
    //              → Course|Day|Slot|Time|ScoreFrom|ScoreTo|Content
    console.log("   ↳ Messages: migrating old session format → day/slot/time");
    const rows = await sheet.getRows();
    const migrated = rows.map((r) => {
      const raw = r._rawData || [];
      return [
        String(raw[0] ?? ""),
        String(raw[1] ?? ""), // session → day
        "1",                  // slot = 1
        "10:00",              // default time
        String(raw[2] ?? ""),
        String(raw[3] ?? ""),
        String(raw[4] ?? ""),
      ];
    });

    await sheet.clear();
    await sheet.loadCells("A1:G1");
    for (let c = 0; c < HEADERS.length; c++) sheet.getCell(0, c).value = HEADERS[c];
    await sheet.saveUpdatedCells();
    for (const r of migrated) await sheet.addRow(r);
    console.log(`   ↳ Migrated ${migrated.length} old rows to day/slot/time`);
  }
}

async function readRows(loadSheet) {
  const sheet = await loadSheet("Messages");
  const rows = await sheet.getRows();
  return rows
    .map((row) => {
      const raw = row._rawData || [];
      return {
        course: String(raw[0] ?? "").trim(),
        day: String(raw[1] ?? "").trim(),
        slot: String(raw[2] ?? "").trim(),
        time: String(raw[3] ?? "").trim(),
        scoreFrom: String(raw[4] ?? "").trim(),
        scoreTo: String(raw[5] ?? "").trim(),
        content: String(raw[6] ?? ""),
      };
    })
    .filter((r) => r.content && r.content.trim().length > 5);
}

/**
 * Resolves the message + time for a (course, day, slot, score) combination.
 * Returns { content, time, source } or null → caller falls back to AI.
 */
async function resolveSlotTemplate(loadSheet, opts = {}) {
  const { course = "", day = 1, slot = 1, score = 0, name = "there" } = opts;
  await migrateMessagesTab(loadSheet);

  const now = Date.now();
  if (!cache.at || now - cache.at > CACHE_TTL_MS) {
    try {
      cache = { at: now, rows: await readRows(loadSheet) };
    } catch (err) {
      console.log("Message templates unavailable:", err.message);
      return null;
    }
  }

  const c = String(course || "").toLowerCase().trim();
  const dayS = String(day);
  const slotS = String(slot);
  const leadTab = classifyCourse(course) || ""; // CBA/DGM/TBM from the lead's full course string

  const matches = (cache.rows || []).filter((r) => {
    const rc = String(r.course || "").toLowerCase().trim();
    const rd = String(r.day || "").toLowerCase().trim();
    const rs = String(r.slot || "").toLowerCase().trim();

    // Course match: template uses tab code (CBA/DGM) OR a substring of the lead's course
    const courseOk =
      rc === "all" ||
      rc === leadTab.toLowerCase() ||
      (c && c.includes(rc)) ||
      (rc && String(course || "").toLowerCase().includes(rc));

    if (!courseOk) return false;
    if (!(rd === "all" || rd === dayS)) return false;
    if (!(rs === "all" || rs === slotS)) return false;
    return scoreInRange(score, r.scoreFrom, r.scoreTo);
  });

  if (!matches.length) return null;

  const specificity = (r) => {
    let s = 0;
    if (String(r.course || "").toLowerCase() !== "all") s += 4;
    if (String(r.day || "").toLowerCase() !== "all") s += 2;
    if (String(r.slot || "").toLowerCase() !== "all") s += 1;
    if (r.scoreFrom !== "" || r.scoreTo !== "") s += 1;
    return s;
  };

  matches.sort((a, b) => specificity(b) - specificity(a));
  const best = matches[0];

  return {
    content: fillPlaceholders(best.content, { name, course, score }),
    time: String(best.time || "").trim() || (Number(slot) === 2 ? "18:00" : "10:00"),
    source: `Messages tab (course=${best.course}, day=${best.day}, slot=${best.slot})`,
  };
}

function invalidateCache() {
  cache = { at: 0, rows: null };
}

module.exports = { resolveSlotTemplate, migrateMessagesTab, invalidateCache, timeToMinutes, fillPlaceholders };
