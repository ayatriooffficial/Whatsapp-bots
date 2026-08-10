require("dotenv").config();
const store = require("./services/messageStore");

/* ================================================================
   Load leads from the master `cookie_import` tab into the store.
   Uses the shared sheetService (correct columns, auto-create).
   Reads up to MAX_LOAD_ROWS rows (default 50).
================================================================ */

const MAX_LOAD_ROWS = Number(process.env.LEAD_LOAD_ROWS || 50);

async function loadLeadsIntoStore() {
  console.log("📋 Loading leads from Google Sheet (cookie_import)...");

  try {
    const sheetService = require("./services/sheetService");
    const { loadSheet } = sheetService;

    const sheet = await loadSheet("cookie_import");
    console.log("   ✅ Sheet connected:", sheet._doc?.title || "cookie_import");

    // Load only columns A-K (0-10) and first N rows — fast
    const lastCol = "K";
    await sheet.loadCells(`A1:${lastCol}${Math.min(MAX_LOAD_ROWS, 100)}`);
    console.log("   ✅ Cells loaded");

    const existing = store.getStore();
    let loaded = 0;
    let skipped = 0;
    let updated = 0;

    // Start from row 1 (skip header at row 0)
    for (let i = 1; i < Math.min(MAX_LOAD_ROWS, 100); i++) {
      const name   = String(sheet.getCell(i, 1)?.value || "").trim();
      const email  = String(sheet.getCell(i, 2)?.value || "").trim();
      const phone  = String(sheet.getCell(i, 3)?.value || "").trim();
      const course = String(sheet.getCell(i, 4)?.value || "").trim();
      const role   = String(sheet.getCell(i, 5)?.value || "").trim().toLowerCase();

      // Stop at empty rows
      if (!name && !phone && !email) continue;

      // Skip admins
      if (role === "admin") { skipped++; continue; }

      // Clean phone
      const phoneDigits = phone.replace(/\D/g, "");

      // Skip invalid phones
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) {
        if (name) console.log(`   ⚠️  Skipping ${name} — invalid phone: "${phone}"`);
        skipped++;
        continue;
      }

      const userId = `${phoneDigits}@c.us`;

      // ── Existing user — don't reset session ───────────────────
      if (existing[userId]) {
        const needsUpdate =
          (!existing[userId].name || existing[userId].name === "there") ||
          (!existing[userId].course || existing[userId].course === "the program");

        if (needsUpdate) {
          store.updateUser(userId, {
            name  : name || existing[userId].name || "there",
            course: (course && course !== "N/A") ? course : existing[userId].course || "the program"
          });
          updated++;
          console.log(`   🔄 Updated → ${name} (${phoneDigits})`);
        } else {
          skipped++;
        }
        continue;
      }

      // ── New user — add to store ────────────────────────────────
      store.setUser(userId, {
        session        : 1,
        lastSent       : 0,
        lastInteraction: Date.now(),
        lastMessageDate: 0,
        messagesToday  : 0,
        sentTopics     : [],
        optOut         : false,
        chatId         : userId,
        source         : "campaign",
        name           : name || "there",
        course         : (course && course !== "N/A") ? course : "the program",
      });

      loaded++;
      console.log(`   ✅ New lead → ${name} (${phoneDigits}) — ${course || "N/A"}`);
    }

    console.log(`\n📊 Lead Load Complete:`);
    console.log(`   ✅ New     : ${loaded}`);
    console.log(`   🔄 Updated : ${updated}`);
    console.log(`   ⏭️  Skipped : ${skipped}`);
    if (loaded > 0) {
      console.log(`   📨 Scheduler will send messages to ${loaded} new users\n`);
    } else {
      console.log(`   💤 No new users — scheduler continuing with existing users\n`);
    }

  } catch (err) {
    console.log("❌ Failed to load leads:", err.message);
  }
}

module.exports = { loadLeadsIntoStore };
