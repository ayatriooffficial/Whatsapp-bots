const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

/* =========================================================
   AUTH — one shared JWT for the whole spreadsheet
   Uses the same service account as the website exporter.
========================================================= */

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

let docLoaded = false;

async function ensureLoaded() {
  if (!docLoaded) {
    await doc.loadInfo();
    docLoaded = true;
    console.log(
      "Available sheets:",
      Object.keys(doc.sheetsByTitle).join(", ")
    );
  }
  return doc;
}

/**
 * Load a sheet tab by title. Creates it if missing.
 * Throws if the tab cannot be created.
 */
async function loadSheet(title = "cookie_import") {
  const d = await ensureLoaded();
  let sheet = d.sheetsByTitle[title];

  if (!sheet) {
    console.log(`Tab "${title}" not found — creating it.`);
    sheet = await d.addSheet({ title });
  }

  return sheet;
}

/* =========================================================
   COLUMN INDICES (cookie_import layout)
   Based on the website exporter header:
   0  User ID
   1  Name
   2  Email
   3  Phone Number
   4  Course Interested In
   5  Role
   6  Profile Status
   7  Signed Up On
   8  Last Login
   9  Website Score
   10 Engagement Band
   11 Unique Pages
   12 Chat Interactions
   (13+ reserved for bot bookkeeping)
========================================================= */

const COL = {
  ID: 0,
  NAME: 1,
  EMAIL: 2,
  PHONE: 3,
  COURSE: 4,
  ROLE: 5,
  PROFILE_STATUS: 6,
  SIGNED_UP: 7,
  LAST_LOGIN: 8,
  SCORE: 9,
  BAND: 10,
  PAGES: 11,
  CHAT: 12,
  SENT: 15, // bot "sent" flag column
};

const PHONE_CACHE_TTL_MS = 5 * 60 * 1000;
const VIEWER_CACHE_TTL = 2 * 60 * 1000;

let phoneCache = { at: 0, set: new Set() };
const viewerScoreCache = {};

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function cleanPhone(raw) {
  const digits = digitsOnly(raw);
  return digits;
}

/* =========================================================
   PHONE CACHE (used by addNewLead to avoid duplicates)
========================================================= */

async function getPhoneSet(force = false) {
  const now = Date.now();

  if (
    !force &&
    now - phoneCache.at < PHONE_CACHE_TTL_MS &&
    phoneCache.set.size
  ) {
    return phoneCache.set;
  }

  const sheet = await loadSheet("cookie_import");
  const rows = await sheet.getRows();

  const set = new Set();
  for (const row of rows) {
    const phone = cleanPhone(row._rawData[COL.PHONE]);
    if (phone) set.add(phone);
  }

  phoneCache = { at: now, set };
  return set;
}

/* =========================================================
   GET MANUAL LEADS — rows from Manual Leads tab not yet sent
   Manual Leads layout: Name | Email | Phone | Course | Sent
========================================================= */

async function getManualLeads() {
  const sheet = await loadSheet("Manual Leads");
  const rows = await sheet.getRows();

  return rows
    .map((row) => ({
      row,
      isManual: true,
      name: String(row._rawData[0] ?? ""),
      email: String(row._rawData[1] ?? ""),
      phone: String(row._rawData[2] ?? ""),
      course: String(row._rawData[3] ?? ""),
      role: "",
      score: 0,
      sent: String(row._rawData[4] ?? ""),
    }))
    .filter((item) => {
      const status = String(item.sent || "").toLowerCase().trim();
      const phoneDigits = cleanPhone(item.phone);
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) return false;
      return status !== "yes" && status !== "not_exist";
    });
}

/* =========================================================
   GET NEW LEADS — rows from cookie_import not yet sent
========================================================= */

async function getNewLeads() {
  const sheet = await loadSheet("cookie_import");
  const rows = await sheet.getRows();

  console.log("TOTAL ROWS:", rows.length);

  const leads = rows
    .map((row) => ({
      row,
      isManual: false,
      name: String(row._rawData[COL.NAME] ?? ""),
      email: String(row._rawData[COL.EMAIL] ?? ""),
      phone: String(row._rawData[COL.PHONE] ?? ""),
      course: String(row._rawData[COL.COURSE] ?? ""),
      role: String(row._rawData[COL.ROLE] ?? ""),
      score: Number(row._rawData[COL.SCORE] || 0),
      sent: String(row._rawData[COL.SENT] ?? ""),
    }))
    .filter((item) => {
      const status = String(item.sent || "").toLowerCase().trim();
      const phoneDigits = cleanPhone(item.phone);

      // Skip admins, invalid phones, and already-sent rows
      if (String(item.role || "").toLowerCase() === "admin") return false;
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) return false;
      return status !== "yes" && status !== "not_exist";
    });

  // Merge with manual leads, dedupe by phone (manual wins for name/course)
  let manual = [];
  try {
    manual = await getManualLeads();
  } catch (err) {
    console.log("Manual leads unavailable:", err.message);
  }

  const byPhone = new Map();
  for (const l of leads) byPhone.set(cleanPhone(l.phone), l);
  for (const l of manual) byPhone.set(cleanPhone(l.phone), l);

  const merged = [...byPhone.values()];
  console.log(`FILTERED (new leads): ${merged.length} (${leads.length} db + ${manual.length} manual, deduped)`);
  return merged;
}

/* =========================================================
   MARK SENT / MARK STATUS
   Manual lead: Sent lives in Manual Leads column E (index 4)
   DB lead:      Sent lives in cookie_import column P (index 15)
========================================================= */

async function markSent(lead) {
  try {
    if (lead.isManual) {
      lead.row._rawData[4] = "yes";
    } else {
      lead.row._rawData[COL.SENT] = "yes";
    }
    await lead.row.save();
    console.log("Updated sent ->", lead.phone, lead.isManual ? "(manual)" : "");
  } catch (err) {
    console.log("Sheet update error:", err.message);
  }
}

async function markLeadStatus(lead, status) {
  try {
    if (lead.isManual) {
      lead.row._rawData[4] = String(status || "").trim();
    } else {
      lead.row._rawData[COL.SENT] = String(status || "").trim();
    }
    await lead.row.save();
    console.log("Lead status updated ->", lead.phone, "|", lead.isManual ? "(manual)" : "");
  } catch (err) {
    console.log("Sheet status update error:", err.message);
  }
}

/* =========================================================
   ADD NEW LEAD (organic user who messages the bot)
========================================================= */

async function addNewLead(phone, name = "") {
  try {
    const target = cleanPhone(phone);
    if (!target) return;

    const phones = await getPhoneSet();
    if (phones.has(target)) return;

    const sheet = await loadSheet("cookie_import");
    await sheet.addRow(["", name, "", target, ""]);

    phones.add(target);
    console.log("New lead added:", target);
  } catch (err) {
    console.log("addNewLead error:", err.message);
  }
}

/* =========================================================
   COURSE-TAB LEADS (CBA/DGM/TBM) — permanent master lists
   Header: User ID|Name|Email|Phone|Course|Stage|Day|Slot|Status|
           Messages Sent|Last Sent At|Added By
========================================================= */

const COURSE_COL = {
  ID: 0,
  NAME: 1,
  EMAIL: 2,
  PHONE: 3,
  COURSE: 4,
  STAGE: 5,
  DAY: 6,
  SLOT: 7,
  STATUS: 8,
  SENT_COUNT: 9,
  LAST_SENT_AT: 10,
  ADDED_BY: 11,
};

function isDividerRow(row) {
  const name = String(row?._rawData?.[1] || "").trim();
  const phone = String(row?._rawData?.[3] || "").trim();
  return name.startsWith("—") || name.startsWith("-") || name.startsWith("=") || (!name && !phone);
}

/**
 * Reads all active (non-done, non-divider) leads from a course tab.
 */
async function getCourseLeads(tabName) {
  const sheet = await loadSheet(tabName);
  const rows = await sheet.getRows();

  return rows
    .filter((r) => !isDividerRow(r))
    .map((row) => {
      const raw = row._rawData || [];
      return {
        row,
        isCourseLead: true,
        tab: tabName,
        userId: String(raw[COURSE_COL.ID] ?? ""),
        name: String(raw[COURSE_COL.NAME] ?? ""),
        email: String(raw[COURSE_COL.EMAIL] ?? ""),
        phone: String(raw[COURSE_COL.PHONE] ?? ""),
        course: String(raw[COURSE_COL.COURSE] ?? ""),
        stage: String(raw[COURSE_COL.STAGE] ?? ""),
        day: String(raw[COURSE_COL.DAY] ?? ""),
        slot: String(raw[COURSE_COL.SLOT] ?? ""),
        status: String(raw[COURSE_COL.STATUS] ?? ""),
        messagesSent: Number(raw[COURSE_COL.SENT_COUNT] || 0),
        lastSentAt: String(raw[COURSE_COL.LAST_SENT_AT] ?? ""),
        addedBy: String(raw[COURSE_COL.ADDED_BY] ?? ""),
        score: 0,
      };
    })
    .filter((l) => {
      const stage = String(l.stage || "").toLowerCase().trim();
      const status = String(l.status || "").toLowerCase().trim();
      const phoneDigits = cleanPhone(l.phone);
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) return false;
      if (stage === "done") return false;
      if (status === "opt_out" || status === "not_exist") return false;
      return true;
    });
}

/**
 * Writes progress back to a course-tab lead row after sending.
 */
async function updateLeadProgress(lead, updates) {
  try {
    if (!lead?.row) return;
    const raw = lead.row._rawData;
    if (updates.stage !== undefined) raw[COURSE_COL.STAGE] = updates.stage;
    if (updates.day !== undefined) raw[COURSE_COL.DAY] = updates.day;
    if (updates.slot !== undefined) raw[COURSE_COL.SLOT] = updates.slot;
    if (updates.status !== undefined) raw[COURSE_COL.STATUS] = updates.status;
    if (updates.messagesSent !== undefined) raw[COURSE_COL.SENT_COUNT] = String(updates.messagesSent);
    if (updates.lastSentAt !== undefined) raw[COURSE_COL.LAST_SENT_AT] = updates.lastSentAt;
    await lead.row.save();
  } catch (err) {
    console.log("updateLeadProgress error:", err.message);
  }
}

/* =========================================================
   UPDATE SCORE — write engagement score back to cookie_import
========================================================= */

async function updateScore(phone, score, level) {
  const target = cleanPhone(phone);
  if (!target) {
    console.log("Score row not found for:", phone);
    return;
  }

  const sheet = await loadSheet("cookie_import");
  const rows = await sheet.getRows();

  let updated = false;
  for (const row of rows) {
    if (cleanPhone(row._rawData[COL.PHONE]) === target) {
      row._rawData[COL.SCORE] = score;
      row._rawData[COL.BAND] = level;
      await row.save();
      console.log("Score Updated:", target, score, level);
      updated = true;
      break;
    }
  }

  if (!updated) {
    console.log("Score row not found for:", target);
  }
}

/* =========================================================
   GET VIEWER SCORE
========================================================= */

async function getViewerScore(phone) {
  const target = cleanPhone(phone);
  if (!target) return 0;

  const cached = viewerScoreCache[target];
  if (cached && Date.now() - cached.at < VIEWER_CACHE_TTL) {
    return cached.score;
  }

  try {
    const sheet = await loadSheet("cookie_import");
    const rows = await sheet.getRows();

    for (const row of rows) {
      if (cleanPhone(row._rawData[COL.PHONE]) === target) {
        const score = Number(row._rawData[COL.SCORE] || 0);
        viewerScoreCache[target] = { score, at: Date.now() };
        return score;
      }
    }
  } catch (err) {
    console.log("getViewerScore error:", err.message);
  }

  return 0;
}

module.exports = {
  loadSheet,
  getNewLeads,
  getManualLeads,
  getCourseLeads,
  updateLeadProgress,
  markSent,
  markLeadStatus,
  updateScore,
  addNewLead,
  getViewerScore,
  COL,
  cleanPhone,
};
