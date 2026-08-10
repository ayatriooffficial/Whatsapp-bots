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
   GET NEW LEADS — rows from cookie_import not yet sent
========================================================= */

async function getNewLeads() {
  const sheet = await loadSheet("cookie_import");
  const rows = await sheet.getRows();

  console.log("TOTAL ROWS:", rows.length);

  const leads = rows
    .map((row) => ({
      row,
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

  console.log("FILTERED (new leads):", leads.length);
  return leads;
}

/* =========================================================
   MARK SENT / MARK STATUS
========================================================= */

async function markSent(lead) {
  try {
    lead.row._rawData[COL.SENT] = "yes";
    await lead.row.save();
    console.log("Updated sent ->", lead.phone);
  } catch (err) {
    console.log("Sheet update error:", err.message);
  }
}

async function markLeadStatus(lead, status) {
  try {
    lead.row._rawData[COL.SENT] = String(status || "").trim();
    await lead.row.save();
    console.log("Lead status updated ->", lead.phone, "|", lead.row._rawData[COL.SENT]);
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
  markSent,
  markLeadStatus,
  updateScore,
  addNewLead,
  getViewerScore,
  COL,
  cleanPhone,
};
