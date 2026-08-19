/**
 * Sheet splitter — keeps the CBA / DGM / TBM tabs in sync with
 * the master `cookie_import` tab.
 *
 * CBA/DGM/TBM are now PERMANENT master lists (append-only):
 *   - DB leads from cookie_import are appended when new (dedupe by phone)
 *   - Manual leads typed by workers persist here
 *   - Leads who finished all 6 messages (Stage=done) are REMOVED
 *   - Section divider rows (starting with "—" or blank name) are preserved
 *
 * Progress columns:
 *   User ID | Name | Email | Phone | Course | Stage | Day | Slot | Status |
 *   Messages Sent | Last Sent At | Added By
 */

const { classifyCourse, COURSE_TABS } = require("./courseCategories");
const { migrateMessagesTab } = require("./messageTemplates");

let isSyncing = false;

const HEADERS = [
  "User ID",
  "Name",
  "Email",
  "Phone Number",
  "Course Interested In",
  "Stage",
  "Day",
  "Slot",
  "Status",
  "Messages Sent",
  "Last Sent At",
  "Added By",
  "Sent Today",
  "Email Sent",
];

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isDividerRow(row) {
  const name = String(row?._rawData?.[1] || "").trim();
  const phone = String(row?._rawData?.[3] || "").trim();
  return name.startsWith("—") || name.startsWith("-") || name.startsWith("=") || (!name && !phone);
}

function rowToLead(row) {
  const raw = row._rawData || [];
  return {
    row,
    userId: String(raw[0] ?? ""),
    name: String(raw[1] ?? ""),
    email: String(raw[2] ?? ""),
    phone: String(raw[3] ?? ""),
    course: String(raw[4] ?? ""),
    stage: String(raw[5] ?? ""),
    day: String(raw[6] ?? ""),
    slot: String(raw[7] ?? ""),
    status: String(raw[8] ?? ""),
    messagesSent: String(raw[9] ?? ""),
    lastSentAt: String(raw[10] ?? ""),
    addedBy: String(raw[11] ?? ""),
  };
}

/**
 * Ensures a course tab exists with the correct header.
 * Migrates old header (11 cols) to new progress header (12 cols)
 * AND normalizes existing rows into the new progress columns
 * (Stage=from old col5? no — set pending/1/1/active/0; keep old cols as fallback).
 */
async function ensureCourseTab(loadSheet, tabName) {
  const sheet = await loadSheet(tabName);
  await sheet.loadCells("A1:N1");
  const a1 = sheet.getCell(0, 0).value;
  const existingHeaders = [];
  for (let c = 0; c < 14; c++) existingHeaders.push(String(sheet.getCell(0, c).value || ""));

  // Already has progress header but missing "Sent Today" (col M) → append it
  if (String(a1 || "").trim() === "User ID" && existingHeaders[5] === "Stage" && existingHeaders[12] !== "Sent Today") {
    console.log(`   ↳ ${tabName}: adding "Sent Today" column`);
    sheet.getCell(0, 12).value = "Sent Today";
    await sheet.saveUpdatedCells();
  }

  // Has progress header but missing "Email Sent" (col N) → append it
  if (String(a1 || "").trim() === "User ID" && existingHeaders[5] === "Stage" && existingHeaders[13] !== "Email Sent") {
    console.log(`   ↳ ${tabName}: adding "Email Sent" column`);
    sheet.getCell(0, 13).value = "Email Sent";
    await sheet.saveUpdatedCells();
  }

  if (String(a1 || "").trim() === "User ID" && existingHeaders[5] !== "Stage") {
    console.log(`   ↳ ${tabName}: migrating to progress header + normalizing rows`);
    for (let c = 0; c < HEADERS.length; c++) sheet.getCell(0, c).value = HEADERS[c];
    await sheet.saveUpdatedCells();

    // Normalize existing rows into new progress columns
    try {
      const rows = await sheet.getRows();
      for (const r of rows) {
        const raw = r._rawData || [];
        if (isDividerRow(r)) continue;
        const oldRole = String(raw[5] || "");
        const oldProfile = String(raw[6] || "");
        const oldSigned = String(raw[7] || "");
        const oldLogin = String(raw[8] || "");
        const oldScore = String(raw[9] || "");
        const oldBand = String(raw[10] || "");

        // Old layout: [0]=id [1]=name [2]=email [3]=phone [4]=course
        //             [5]=role [6]=profile [7]=signed [8]=login [9]=score [10]=band
        // New layout: [0..4] same, [5]=Stage [6]=Day [7]=Slot [8]=Status
        //             [9]=Sent [10]=LastSent [11]=AddedBy
        raw[5] = "pending";   // Stage
        raw[6] = "1";         // Day
        raw[7] = "1";         // Slot
        raw[8] = "active";    // Status
        raw[9] = "0";         // Messages Sent
        raw[10] = "";         // Last Sent At
        raw[11] = "db";       // Added By
        raw[12] = "0";        // Sent Today
        raw[13] = "0";        // Email Sent
        await r.save();
      }
      console.log(`   ↳ ${tabName}: normalized ${rows.length} rows to progress format`);
    } catch (err) {
      console.log(`   ↳ ${tabName}: row normalization failed:`, err.message);
    }
  } else if (!a1) {
    for (let c = 0; c < HEADERS.length; c++) sheet.getCell(0, c).value = HEADERS[c];
    await sheet.saveUpdatedCells();
  }
  return sheet;
}

/**
 * Reads a course tab, returns leads (skipping dividers + done).
 */
async function readCourseLeads(loadSheet, tabName) {
  const sheet = await loadSheet(tabName);
  const rows = await sheet.getRows();
  return rows.filter((r) => !isDividerRow(r)).map(rowToLead);
}

/**
 * Syncs new DB users from cookie_import into the course tabs (append-only).
 * Removes leads whose Stage=done.
 * Preserves divider rows.
 */
async function syncCourseTabs(loadSheet) {
  if (isSyncing) {
    console.log("⏳ Course-tab sync already running — skipping this tick.");
    return;
  }
  isSyncing = true;

  try {
    await migrateMessagesTab(loadSheet);
    const manualSheet = await loadSheet("Manual Leads");
    const manualRows = await manualSheet.getRows();

    // Read cookie_import DB users
    const master = await loadSheet("cookie_import");
    const dbRows = await master.getRows();

    console.log(`📊 Split sync: ${dbRows.length} db rows in cookie_import`);

    // Existing phones per course tab (to dedupe)
    const existingByTab = { CBA: new Set(), DGM: new Set(), TBM: new Set() };
    for (const tab of Object.values(COURSE_TABS)) {
      const sheet = await ensureCourseTab(loadSheet, tab); // migrate header first
      const rows = await sheet.getRows();
      for (const r of rows) {
        if (isDividerRow(r)) continue;
        const p = digitsOnly(String(r._rawData[3] || ""));
        if (p) existingByTab[tab].add(p);
      }
    }

    // Append new DB users to their course tab (if not already present)
    for (const r of dbRows) {
      const raw = r._rawData || [];
      const course = String(raw[4] ?? "").trim();
      const tab = classifyCourse(course);
      if (!tab) continue;

      const phone = digitsOnly(String(raw[3] ?? ""));
      if (!phone || phone.length < 10 || phone.length > 13) continue;
      if (String(raw[5] ?? "").toLowerCase() === "admin") continue;
      if (existingByTab[tab].has(phone)) continue;

      const sheet = await loadSheet(tab);
      await sheet.addRow([
        String(raw[0] ?? ""),
        String(raw[1] ?? ""),
        String(raw[2] ?? ""),
        String(raw[3] ?? ""),
        course,
        "pending",   // Stage
        "1",         // Day
        "1",         // Slot
        "active",    // Status
        "0",         // Messages Sent
        "",
        "db",        // Added By
        "0",         // Sent Today
        "0",         // Email Sent
      ]);
      existingByTab[tab].add(phone);
      console.log(`   ➕ ${tab}: new DB lead ${raw[1] || phone}`);
    }

    // Add manual leads from Manual Leads tab to their course tab (if not present)
    for (const r of manualRows) {
      const raw = r._rawData || [];
      const name = String(raw[0] ?? "").trim();
      const phone = digitsOnly(String(raw[2] ?? ""));
      const course = String(raw[3] ?? "").trim();
      const tab = classifyCourse(course) || "CBA"; // default CBA if unclassified
      if (!phone || phone.length < 10 || phone.length > 13) continue;
      if (existingByTab[tab].has(phone)) continue;

      const sheet = await loadSheet(tab);
      await sheet.addRow([
        "",
        name,
        String(raw[1] ?? ""),
        String(raw[2] ?? ""),
        course,
        "pending",
        "1",
        "1",
        "active",
        "0",
        "",
        "manual",
        "0",         // Sent Today
        "0",         // Email Sent
      ]);
      existingByTab[tab].add(phone);
      console.log(`   ➕ ${tab}: new manual lead ${name || phone}`);
    }

    // Remove done leads (Stage=done) from course tabs
    for (const tab of Object.values(COURSE_TABS)) {
      const sheet = await loadSheet(tab);
      const rows = await sheet.getRows();
      for (const r of rows) {
        if (isDividerRow(r)) continue;
        const stage = String(r._rawData[5] || "").trim().toLowerCase();
        if (stage === "done") {
          await r.delete();
          console.log(`   🗑️  ${tab}: removed done lead ${r._rawData[1] || r._rawData[3]}`);
        }
      }
    }

    const summary = Object.keys(existingByTab)
      .map((t) => `${t}: ${existingByTab[t].size} leads`)
      .join(" | ");
    console.log(`✅ Split sync complete — ${summary}`);
  } catch (err) {
    console.log("❌ Split sync failed:", err.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Appends a section divider row (e.g. "— CBA LEADS —") to a course tab.
 */
async function addSectionDivider(loadSheet, tabName, label) {
  const sheet = await loadSheet(tabName);
  await sheet.addRow([label]);
}

async function ensureManualLeadsTab(loadSheet) {
  const sheet = await loadSheet("Manual Leads");
  await sheet.loadCells("A1:E1");
  const first = sheet.getCell(0, 0).value;
  const hasHeader = first && String(first).trim().toLowerCase() === "name";
  if (!hasHeader) {
    const M = ["Name", "Email", "Phone Number", "Course Interested In", "Sent"];
    for (let c = 0; c < M.length; c++) sheet.getCell(0, c).value = M[c];
    await sheet.saveUpdatedCells();
    console.log("   ↳ Manual Leads: seeded header row");
  }
}

async function ensureMessagesTab(loadSheet) {
  const { migrateMessagesTab } = require("./messageTemplates");
  await migrateMessagesTab(loadSheet);
}

module.exports = {
  syncCourseTabs,
  ensureManualLeadsTab,
  ensureMessagesTab,
  readCourseLeads,
  addSectionDivider,
  rowToLead,
};
