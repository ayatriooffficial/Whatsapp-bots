/**
 * Beautify the Messages tab — readable formatting for workers.
 *
 * - Freezes header row
 * - Bold + colored header
 * - Auto-resizes columns
 * - Inserts example rows (CBA + DGM, 3 days x 2 slots) if the tab is empty
 *   (only header) — so workers see the expected format at a glance.
 *
 * Run manually: node services/beautifySheet.js
 */

require("dotenv").config();

async function beautifyMessagesTab() {
  const { loadSheet } = require("./sheetService");
  const { migrateMessagesTab } = require("./messageTemplates");

  const sheet = await loadSheet("Messages");
  await migrateMessagesTab(loadSheet);

  const spreadsheet = sheet._spreadsheet;
  const sheetId = sheet.sheetId;

  // 1. Freeze header row + bold/color it via batchUpdate
  const requests = [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.07, green: 0.2, blue: 0.29 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor)",
      },
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 7 },
      },
    },
  ];

  try {
    if (spreadsheet?._makeBatchUpdateRequest) {
      await spreadsheet._makeBatchUpdateRequest(requests);
      console.log("✅ Messages tab formatted (frozen header, colors, autosize)");
    } else {
      console.log("ℹ️  batchUpdate API not directly available — skipping format (non-fatal)");
    }
  } catch (err) {
    console.log("Format error (non-fatal):", err.message);
  }

  // 2. Seed example rows if only header exists
  const rows = await sheet.getRows();
  if (!rows.length) {
    const examples = [
      ["CBA", "1", "1", "10:00", "", "", "Hi {name}! Day 1 morning — CBA programs are open. Reply YES to learn more."],
      ["CBA", "1", "2", "18:00", "", "", "{name}, here's what CBA graduates achieve. Want details?"],
      ["CBA", "2", "1", "10:00", "", "", "Good morning {name}! Placement outcomes for CBA — check this."],
      ["CBA", "2", "2", "18:00", "", "", "{name}, fees & EMI options for CBA — affordable plans available."],
      ["CBA", "3", "1", "10:00", "", "", "{name}, final batch reminder — CBA seats filling up."],
      ["CBA", "3", "2", "18:00", "", "", "{name}, last chance! Apply for CBA now."],
      ["DGM", "1", "1", "10:00", "", "", "Hi {name}! Digital Growth Marketing — the career edge you need."],
      ["DGM", "1", "2", "18:00", "", "", "{name}, DGM program details — check the ROI."],
      ["DGM", "2", "1", "10:00", "", "", "Morning {name}! DGM placement highlights."],
      ["DGM", "2", "2", "18:00", "", "", "{name}, DGM fees & scholarship info."],
      ["DGM", "3", "1", "10:00", "", "", "{name}, DGM batch starting soon!"],
      ["DGM", "3", "2", "18:00", "", "", "{name}, last call for DGM admissions."],
    ];
    for (const r of examples) await sheet.addRow(r);
    console.log(`✅ Seeded ${examples.length} example rows (CBA + DGM, 3 days × 2 slots)`);
  } else {
    console.log(`ℹ️  Messages tab has ${rows.length} rows — no seeding (kept existing)`);
  }
}

// Run directly
if (require.main === module) {
  beautifyMessagesTab().then(() => process.exit(0)).catch((e) => {
    console.error("Beautify failed:", e.message);
    process.exit(1);
  });
}

module.exports = { beautifyMessagesTab };
