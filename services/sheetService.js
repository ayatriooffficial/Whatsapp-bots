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
           Messages Sent|Last Sent At|Added By|Sent Today
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
  SENT_TODAY: 12,
  EMAIL_SENT: 13,
  WA_SEEN: 14,
  EMAIL_SEEN: 15,
  WA_CLICKED: 16,
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
        sentToday: Number(raw[COURSE_COL.SENT_TODAY] || 0),
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
    if (updates.emailSent !== undefined) raw[COURSE_COL.EMAIL_SENT] = String(updates.emailSent);
    if (updates.waSeen !== undefined) raw[COURSE_COL.WA_SEEN] = String(updates.waSeen);
    if (updates.emailSeen !== undefined) raw[COURSE_COL.EMAIL_SEEN] = String(updates.emailSeen);
    if (updates.waClicked !== undefined) raw[COURSE_COL.WA_CLICKED] = String(updates.waClicked);
    if (updates.lastSentAt !== undefined) raw[COURSE_COL.LAST_SENT_AT] = updates.lastSentAt;
    if (updates.sentToday !== undefined) raw[COURSE_COL.SENT_TODAY] = String(updates.sentToday);
    await lead.row.save();
  } catch (err) {
    console.log("updateLeadProgress error:", err.message);
  }
}

/* =========================================================
   TEST LEADS TAB — universal bulk-test recipients (email + WhatsApp)
   Headers: Name | Email | Phone | Course | Channel | Status |
            WA Sent | Email Sent | Last Sent At | Last Result
   Channel: EMAIL | WHATSAPP | BOTH
========================================================= */

const TEST_LEADS_COL = {
  NAME: 0, EMAIL: 1, PHONE: 2, COURSE: 3, CHANNEL: 4,
  STATUS: 5, WA_SENT: 6, EMAIL_SENT: 7, LAST_SENT_AT: 8, LAST_RESULT: 9,
  WA_SEEN: 10, WA_CLICKED: 11, EMAIL_SEEN: 12,
};
const TEST_LEADS_HEADERS = [
  "Name", "Email", "Phone", "Course", "Channel",
  "Status", "WA Sent", "Email Sent", "Last Sent At", "Last Result",
  "WA Seen", "WA Clicked", "Email Seen",
];

async function loadTestLeadsTab() {
  const sheet = await loadSheet("Test Leads");
  await sheet.loadHeaderRow().catch(() => {});
  const headersRaw = sheet.headerValues || [];
  const headers = headersRaw.filter((h) => String(h || "").trim() !== "");
  if (headers.length < TEST_LEADS_HEADERS.length) {
    const missing = TEST_LEADS_HEADERS.slice(headers.length);
    if (headers.length > 0 && headers.length < TEST_LEADS_HEADERS.length) {
      await sheet.loadCells(`A1:${String.fromCharCode(64 + TEST_LEADS_HEADERS.length)}1`);
      for (let i = headers.length; i < TEST_LEADS_HEADERS.length; i++) {
        sheet.getCell(0, i).value = TEST_LEADS_HEADERS[i];
      }
      await sheet.saveUpdatedCells();
      console.log(`   ↳ Test Leads: added ${missing.join(", ")} columns`);
    } else {
      await sheet.setHeaderRow(TEST_LEADS_HEADERS);
      console.log(`   ↳ Test Leads: added ${missing.join(", ")} columns`);
    }
  }
  return sheet;
}

async function getTestLeads({ channel = "", course = "" } = {}) {
  const sheet = await loadTestLeadsTab();
  const rows = await sheet.getRows();
  const want = String(channel || "").toUpperCase().trim();
  const courseFilter = String(course || "").toUpperCase().trim();

  return rows
    .map((row) => {
      const raw = row._rawData || [];
      return {
        row,
        name: String(raw[TEST_LEADS_COL.NAME] || "").trim(),
        email: String(raw[TEST_LEADS_COL.EMAIL] || "").toLowerCase().trim(),
        phone: String(raw[TEST_LEADS_COL.PHONE] || "").trim(),
        course: String(raw[TEST_LEADS_COL.COURSE] || "").toUpperCase().trim(),
        channel: String(raw[TEST_LEADS_COL.CHANNEL] || "").toUpperCase().trim(),
        status: String(raw[TEST_LEADS_COL.STATUS] || "").toLowerCase().trim(),
        waSent: String(raw[TEST_LEADS_COL.WA_SENT] || "").trim(),
        emailSent: String(raw[TEST_LEADS_COL.EMAIL_SENT] || "").trim(),
        lastSentAt: String(raw[TEST_LEADS_COL.LAST_SENT_AT] || "").trim(),
        lastResult: String(raw[TEST_LEADS_COL.LAST_RESULT] || "").trim(),
        waSeen: String(raw[TEST_LEADS_COL.WA_SEEN] || "").trim(),
        waClicked: String(raw[TEST_LEADS_COL.WA_CLICKED] || "").trim(),
        emailSeen: String(raw[TEST_LEADS_COL.EMAIL_SEEN] || "").trim(),
      };
    })
    .filter((l) => {
      if (!l.email && !l.phone) return false;
      if (l.status === "done") return false;
      if (want && l.channel !== want && l.channel !== "BOTH") return false;
      if (courseFilter && l.course !== courseFilter && l.course !== "ALL") return false;
      return true;
    });
}

async function updateTestLeadStatus(lead, updates) {
  try {
    if (!lead?.row) return;
    const raw = lead.row._rawData;
    if (updates.status !== undefined) raw[TEST_LEADS_COL.STATUS] = updates.status;
    if (updates.waSent !== undefined) raw[TEST_LEADS_COL.WA_SENT] = String(updates.waSent);
    if (updates.emailSent !== undefined) raw[TEST_LEADS_COL.EMAIL_SENT] = String(updates.emailSent);
    if (updates.lastSentAt !== undefined) raw[TEST_LEADS_COL.LAST_SENT_AT] = String(updates.lastSentAt);
    if (updates.lastResult !== undefined) raw[TEST_LEADS_COL.LAST_RESULT] = String(updates.lastResult);
    if (updates.waSeen !== undefined) raw[TEST_LEADS_COL.WA_SEEN] = String(updates.waSeen);
    if (updates.waClicked !== undefined) raw[TEST_LEADS_COL.WA_CLICKED] = String(updates.waClicked);
    if (updates.emailSeen !== undefined) raw[TEST_LEADS_COL.EMAIL_SEEN] = String(updates.emailSeen);
    await lead.row.save();
  } catch (err) {
    console.log("updateTestLeadStatus error:", err.message);
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
  loadTestLeadsTab,
  getTestLeads,
  updateTestLeadStatus,
  TEST_LEADS_COL,
  TEST_LEADS_HEADERS,
  COL,
  cleanPhone,
};
