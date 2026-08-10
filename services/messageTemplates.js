/**
 * Message template service — reads the "Messages" tab from Google Sheets.
 *
 * Tab layout (row 1 = header, must contain these columns):
 *   Course | Session | Score From | Score To | Content
 *
 * - Course: "CBA", "DGM", "TBM", or "ALL" (case-insensitive)
 * - Session: 1, 2, 3, or "ALL"
 * - Score From / Score To: viewer-score range (inclusive), blank = any
 * - Content: the WhatsApp message text, may use placeholders:
 *     {name}   -> lead's first name
 *     {course} -> lead's course string
 *     {score}  -> viewer score
 *
 * Resolution order: exact course+session+score match → course+session →
 * course only → ALL (any course) → null (caller falls back to AI).
 * Results are cached briefly to avoid hammering the Sheets API.
 */

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

let cache = { at: 0, rows: null, courseOptions: null, error: null };

function resolveSheet(loadSheet) {
  return loadSheet("Messages");
}

function fillPlaceholders(text, lead) {
  const firstName = String(lead.name || "there")
    .trim()
    .split(" ")[0];

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

function rowMatches(row, lead) {
  const courseMatch = (course, leadCourse) => {
    const c = String(course || "").trim().toLowerCase();
    const lc = String(leadCourse || "").trim().toLowerCase();
    if (!c || c === "all") return true;
    if (c === "cba") return lc.includes("cmp") || lc.includes("management professional") || lc.includes("certified management");
    if (c === "dgm") return lc.includes("digital growth") || lc.includes("digital marketing") || lc.includes("growth marketing");
    if (c === "tbm") return lc.includes("tbm") || lc.includes("technology & business") || lc.includes("technology and business") || lc.includes("business management");
    return lc.includes(c);
  };

  const sessionMatch = (sess, leadSession) => {
    const s = String(sess || "").trim().toLowerCase();
    return !s || s === "all" || Number(s) === Number(leadSession || 1);
  };

  const scoreMatch = (from, to) => scoreInRange(lead.score, from, to);

  return (
    courseMatch(row.course, lead.course) &&
    sessionMatch(row.session, lead.session) &&
    scoreMatch(row.scoreFrom, row.scoreTo)
  );
}

/**
 * Returns { content, source } or null.
 * `source` is the tab+row for debugging.
 */
async function resolveTemplate(loadSheet, lead) {
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL_MS && cache.rows) {
    return pickBest(lead, cache.rows);
  }

  try {
    const sheet = await resolveSheet(loadSheet);
    const rows = await sheet.getRows();

    const parsed = rows
      .map((row) => {
        const raw = row._rawData || [];
        return {
          course: raw[0],
          session: raw[1],
          scoreFrom: String(raw[2] ?? "").trim(),
          scoreTo: String(raw[3] ?? "").trim(),
          content: raw[4],
        };
      })
      .filter((r) => r.content && String(r.content).trim().length > 5);

    cache = { at: now, rows: parsed, courseOptions: null, error: null };
    return pickBest(lead, parsed);
  } catch (err) {
    console.log("Message templates unavailable:", err.message);
    cache = { at: now, rows: null, courseOptions: null, error: err.message };
    return null;
  }
}

/**
 * Pick the most specific matching template:
 * 1. course+session+score  2. course+session  3. course  4. ALL
 */
function pickBest(lead, rows) {
  const matches = rows.filter((r) => rowMatches(r, lead));
  if (!matches.length) return null;

  const specificity = (r) => {
    const course = String(r.course || "").toLowerCase();
    const session = String(r.session || "").toLowerCase();
    const hasScore = r.scoreFrom !== "" || r.scoreTo !== "";
    let score = 0;
    if (course && course !== "all") score += 4;
    if (session && session !== "all") score += 2;
    if (hasScore) score += 1;
    return score;
  };

  matches.sort((a, b) => specificity(b) - specificity(a));
  const best = matches[0];
  return {
    content: fillPlaceholders(best.content, lead),
    source: `Messages tab (course=${best.course}, session=${best.session}, score=${best.scoreFrom}-${best.scoreTo})`,
  };
}

function invalidateCache() {
  cache = { at: 0, rows: null, courseOptions: null, error: null };
}

module.exports = { resolveTemplate, invalidateCache };
