/**
 * Message template service — reads the "Messages" tab from Google Sheets.
 *
 * Tab layout (row 1 = header), NEW format (with Stage):
 *   Course | Stage | Day | Slot | Time | Score From | Score To | Content
 *
 * OLD format (no Stage, still supported):
 *   Course | Day | Slot | Time | Score From | Score To | Content
 *
 * - Course: "CBA", "DGM", "TBM", or "ALL" (case-insensitive)
 * - Stage: "Awareness", "Engagement", "Conversion", or blank/ALL
 * - Day: 1, 2, 3 or "ALL"
 * - Slot: 1, 2 or "ALL"
 * - Time: HH:MM (24h) — when this message is sent on that day
 * - Score From / Score To: viewer-score range (inclusive), blank = any
 * - Content: the message, with {name} / {course} / {score} placeholders
 *
 * Resolution: exact course+stage+day+slot+score → course+day+slot → course → ALL
 * → null (caller falls back to AI). Results cached 2 min.
 */

const CACHE_TTL_MS = 2 * 60 * 1000;

const { classifyCourse } = require("./courseCategories");

const HEADERS_NEW = [
  "Course",
  "Stage",
  "Day",
  "Slot",
  "Time",
  "Score From",
  "Score To",
  "Content",
];

let cache = { at: 0, rows: null, hasStage: false };

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
 * Detects whether the Messages tab has the Stage column (new format).
 * Migrates/upgrades the header if needed (adds Stage column after Course).
 */
async function migrateMessagesTab(loadSheet) {
  const sheet = await loadSheet("Messages");
  await sheet.loadCells("A1:H1");
  const a1 = sheet.getCell(0, 0).value;
  const b1 = String(sheet.getCell(0, 1).value || "").trim();
  const hasStage = String(b1 || "").toLowerCase() === "stage";

  if (!a1) {
    // Empty tab — seed new header
    for (let c = 0; c < HEADERS_NEW.length; c++) sheet.getCell(0, c).value = HEADERS_NEW[c];
    await sheet.saveUpdatedCells();
    console.log("   ↳ Messages: seeded header (Course|Stage|Day|Slot|Time|Score|Score|Content)");
    return;
  }

  // Old format without Stage → insert Stage column (B) and shift the rest
  if (!hasStage) {
    const oldC2 = String(sheet.getCell(0, 2).value || "").trim();
    if (oldC2.toLowerCase() === "score from") {
      // Legacy session format: Course|Session|ScoreFrom|ScoreTo|Content → new
      console.log("   ↳ Messages: migrating legacy session format → stage/day/slot/time");
      const rows = await sheet.getRows();
      const migrated = rows.map((r) => {
        const raw = r._rawData || [];
        return [
          String(raw[0] ?? ""),
          "",                      // Stage
          String(raw[1] ?? ""),    // session → day
          "1",                     // slot
          "10:00",                 // time
          String(raw[2] ?? ""),
          String(raw[3] ?? ""),
          String(raw[4] ?? ""),
        ];
      });
      await sheet.clear();
      await sheet.loadCells("A1:H1");
      for (let c = 0; c < HEADERS_NEW.length; c++) sheet.getCell(0, c).value = HEADERS_NEW[c];
      await sheet.saveUpdatedCells();
      for (const r of migrated) await sheet.addRow(r);
      console.log(`   ↳ Migrated ${migrated.length} legacy rows`);
      return;
    }

    // Day/slot/time format without Stage → insert Stage column
    console.log("   ↳ Messages: adding Stage column");
    // Write header row with Stage inserted
    await sheet.loadCells("A1:H1");
    for (let c = 0; c < HEADERS_NEW.length; c++) sheet.getCell(0, c).value = HEADERS_NEW[c];
    await sheet.saveUpdatedCells();

    // Shift existing data rows: old B..G → new C..H (Stage column stays blank)
    try {
      const rows = await sheet.getRows();
      for (const r of rows) {
        const raw = r._rawData || [];
        const newRow = [
          String(raw[0] ?? ""),
          "",                      // Stage
          String(raw[1] ?? ""),    // Day
          String(raw[2] ?? ""),    // Slot
          String(raw[3] ?? ""),    // Time
          String(raw[4] ?? ""),
          String(raw[5] ?? ""),
          String(raw[6] ?? ""),
        ];
        await r.delete();
        await sheet.addRow(newRow);
      }
      console.log(`   ↳ Shifted ${rows.length} rows for Stage column`);
    } catch (err) {
      console.log("   ↳ Stage shift error (non-fatal):", err.message);
    }
  }
}

async function readRows(loadSheet) {
  const sheet = await loadSheet("Messages");
  const rows = await sheet.getRows();

  // Detect layout from header
  await sheet.loadCells("A1:H1");
  const b1 = String(sheet.getCell(0, 1).value || "").trim();
  const hasStage = String(b1 || "").toLowerCase() === "stage";

  return rows
    .map((row) => {
      const raw = row._rawData || [];
      if (hasStage) {
        return {
          course: String(raw[0] ?? "").trim(),
          stage: String(raw[1] ?? "").trim(),
          day: String(raw[2] ?? "").trim(),
          slot: String(raw[3] ?? "").trim(),
          time: String(raw[4] ?? "").trim(),
          scoreFrom: String(raw[5] ?? "").trim(),
          scoreTo: String(raw[6] ?? "").trim(),
          content: String(raw[7] ?? ""),
        };
      }
      // Old format (no Stage)
      return {
        course: String(raw[0] ?? "").trim(),
        stage: "",
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
  const { course = "", day = 1, slot = 1, score = 0, name = "there", stage = "" } = opts;
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
  const stageS = String(stage || "").toLowerCase().trim();
  const leadTab = classifyCourse(course) || ""; // CBA/DGM/TBM from the lead's full course string

  const matches = (cache.rows || []).filter((r) => {
    const rc = String(r.course || "").toLowerCase().trim();
    const rd = String(r.day || "").toLowerCase().trim();
    const rs = String(r.slot || "").toLowerCase().trim();
    const rStage = String(r.stage || "").toLowerCase().trim();

    // Course match: template uses tab code (CBA/DGM) OR a substring of the lead's course
    const courseOk =
      rc === "all" ||
      rc === leadTab.toLowerCase() ||
      (c && c.includes(rc)) ||
      (rc && String(course || "").toLowerCase().includes(rc));

    if (!courseOk) return false;
    if (!(rd === "all" || rd === dayS)) return false;
    if (!(rs === "all" || rs === slotS)) return false;
    // Stage match (if provided and template has one)
    if (stageS && rStage && rStage !== "all" && rStage !== stageS) return false;
    return scoreInRange(score, r.scoreFrom, r.scoreTo);
  });

  if (!matches.length) return null;

  const specificity = (r) => {
    let s = 0;
    if (String(r.course || "").toLowerCase() !== "all") s += 4;
    if (String(r.stage || "").toLowerCase() !== "" && String(r.stage || "").toLowerCase() !== "all") s += 2;
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
    source: `Messages tab (course=${best.course}, stage=${best.stage || "any"}, day=${best.day}, slot=${best.slot})`,
  };
}

function invalidateCache() {
  cache = { at: 0, rows: null };
}

module.exports = { resolveSlotTemplate, migrateMessagesTab, invalidateCache, timeToMinutes, fillPlaceholders };
