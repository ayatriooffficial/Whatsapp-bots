/**
 * Sheet splitter — keeps the CBA / DGM (and optionally TBM) tabs in sync
 * with the master `cookie_import` tab.
 *
 * The website exports ALL users to `cookie_import` (one row per user, with a
 * course column). This service:
 *   1. Reads every row of `cookie_import`
 *   2. Classifies each row into CBA / DGM / TBM via courseCategories
 *   3. Clears + rebuilds each course tab (so deletions propagate)
 *   4. Ensures the Messages tab exists with a header row
 *
 * The course tabs are derived data — they are cleared and rebuilt on every
 * sync so they always mirror `cookie_import`.
 */

const { classifyCourse, COURSE_TABS } = require("./courseCategories");

let isSyncing = false;

const HEADERS = [
  "User ID",
  "Name",
  "Email",
  "Phone Number",
  "Course Interested In",
  "Role",
  "Profile Status",
  "Signed Up On",
  "Last Login",
  "Website Score",
  "Engagement Band",
];

/**
 * Reads all rows from the master tab, classifies, and rewrites course tabs.
 * `loadSheet(title)` must return a google-spreadsheet sheet object.
 */
async function syncCourseTabs(loadSheet) {
  if (isSyncing) {
    console.log("⏳ Course-tab sync already running — skipping this tick.");
    return;
  }
  isSyncing = true;

  try {
    const master = await loadSheet("cookie_import");
    const rows = await master.getRows();

    console.log(`📊 Split sync: ${rows.length} rows in cookie_import`);

    const grouped = { CBA: [], DGM: [], TBM: [] };

    for (const row of rows) {
      const raw = row._rawData || [];
      const course = String(raw[4] ?? "").trim();
      const tab = classifyCourse(course);

      const clean = [
        String(raw[0] ?? ""),
        String(raw[1] ?? ""),
        String(raw[2] ?? ""),
        String(raw[3] ?? ""),
        course,
        String(raw[5] ?? ""),
        String(raw[6] ?? ""),
        String(raw[7] ?? ""),
        String(raw[8] ?? ""),
        String(raw[9] ?? ""),
        String(raw[10] ?? ""),
      ];

      if (tab) grouped[tab].push(clean);
      else console.log(`   (no tab) ${raw[1] || raw[3] || "?"} — course: "${course}"`);
    }

    for (const tab of Object.values(COURSE_TABS)) {
      await rebuildTab(loadSheet, tab, grouped[tab] || []);
    }

    await ensureMessagesTab(loadSheet);

    const summary = Object.entries(grouped)
      .map(([t, arr]) => `${t}: ${arr.length}`)
      .join(" | ");
    console.log(`✅ Split sync complete — ${summary}`);
  } catch (err) {
    console.log("❌ Split sync failed:", err.message);
  } finally {
    isSyncing = false;
  }
}

async function rebuildTab(loadSheet, tabName, cleanRows) {
  const sheet = await loadSheet(tabName);

  // Clear existing content (leave header intact by clearing below row 1)
  try {
    const rows = await sheet.getRows();
    if (rows.length) {
      await sheet.clearRows({ start: 0, end: rows.length });
    }
  } catch (_) {
    // Fresh/empty tab is fine
  }

  const values = [HEADERS, ...cleanRows];
  await sheet.loadCells("A1:K1");
  sheet.getCell(0, 0).value = HEADERS[0];
  sheet.getCell(0, 1).value = HEADERS[1];
  sheet.getCell(0, 2).value = HEADERS[2];
  sheet.getCell(0, 3).value = HEADERS[3];
  sheet.getCell(0, 4).value = HEADERS[4];
  sheet.getCell(0, 5).value = HEADERS[5];
  sheet.getCell(0, 6).value = HEADERS[6];
  sheet.getCell(0, 7).value = HEADERS[7];
  sheet.getCell(0, 8).value = HEADERS[8];
  sheet.getCell(0, 9).value = HEADERS[9];
  sheet.getCell(0, 10).value = HEADERS[10];
  await sheet.saveUpdatedCells();

  // Append rows via addRow
  for (const r of cleanRows) {
    await sheet.addRow(r);
  }

  console.log(`   ↳ ${tabName}: ${cleanRows.length} rows`);
}

async function ensureMessagesTab(loadSheet) {
  try {
    const sheet = await loadSheet("Messages");

    const MESSAGE_HEADERS = [
      "Course",
      "Session",
      "Score From",
      "Score To",
      "Content",
    ];

    // Check if header already exists (A1)
    await sheet.loadCells("A1:E1");
    const first = sheet.getCell(0, 0).value;
    const hasHeader =
      first && String(first).trim().toLowerCase() === "course";

    if (!hasHeader) {
      for (let c = 0; c < MESSAGE_HEADERS.length; c++) {
        sheet.getCell(0, c).value = MESSAGE_HEADERS[c];
      }
      await sheet.saveUpdatedCells();
      console.log("   ↳ Messages: seeded header row");
    }
  } catch (err) {
    console.log("   ↳ Messages tab unavailable:", err.message);
  }
}

module.exports = { syncCourseTabs, ensureMessagesTab };
