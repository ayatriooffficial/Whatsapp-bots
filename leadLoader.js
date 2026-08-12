require("dotenv").config();
const store = require("./services/messageStore");
const { COURSE_TABS } = require("./services/courseCategories");

/* ================================================================
   Load leads from the CBA / DGM / TBM course tabs into the store.
   Uses the shared sheetService.getCourseLeads (progress-aware).
   Skips: done, opt_out, not_exist, invalid phones, dividers.
================================================================ */

const MAX_LOAD_ROWS = Number(process.env.LEAD_LOAD_ROWS || 50);

async function loadLeadsIntoStore() {
  console.log("📋 Loading leads from course tabs (CBA/DGM/TBM)...");

  try {
    const { getCourseLeads } = require("./services/sheetService");
    const existing = store.getStore();
    let loaded = 0;
    let skipped = 0;

    for (const tab of Object.values(COURSE_TABS)) {
      let leads = [];
      try {
        leads = await getCourseLeads(tab);
      } catch (err) {
        console.log(`   ⚠️  ${tab} load failed:`, err.message);
        continue;
      }

      // Respect LEAD_LOAD_ROWS cap
      leads = leads.slice(0, MAX_LOAD_ROWS);

      for (const lead of leads) {
        const phoneDigits = String(lead.phone || "").replace(/\D/g, "");
        if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) {
          skipped++;
          continue;
        }

        const userId = `${phoneDigits}@c.us`;
        const messagesSent = Number(lead.messagesSent || 0);
        const stage = String(lead.stage || "").toLowerCase().trim();
        const status = String(lead.status || "").toLowerCase().trim();

        if (stage === "done" || status === "opt_out" || status === "not_exist") {
          skipped++;
          continue;
        }

        if (existing[userId]) {
          // Update name/course/messagesSent if changed
          const needsUpdate =
            (!existing[userId].name || existing[userId].name === "there") ||
            (!existing[userId].course || existing[userId].course === "the program") ||
            Number(existing[userId].messagesSent || 0) !== messagesSent;

          if (needsUpdate) {
            store.updateUser(userId, {
              name: lead.name || existing[userId].name || "there",
              course: (lead.course && lead.course !== "N/A") ? lead.course : existing[userId].course || "the program",
              messagesSent: messagesSent,
              day: lead.day,
              slot: lead.slot,
              stage: lead.stage,
            });
          } else {
            skipped++;
          }
          continue;
        }

        // New user
        store.setUser(userId, {
          session: Math.min(Math.floor(messagesSent / 2) + 1, 3),
          lastSent: Number(lead.lastSentAt || 0),
          lastInteraction: Date.now(),
          lastMessageDate: 0,
          messagesToday: 0,
          sentTopics: [],
          optOut: false,
          chatId: userId,
          source: "campaign",
          name: lead.name || "there",
          course: (lead.course && lead.course !== "N/A") ? lead.course : "the program",
          messagesSent: messagesSent,
          day: lead.day,
          slot: lead.slot,
          stage: lead.stage,
          tab: tab,
        });
        loaded++;
        console.log(`   ✅ New lead → ${lead.name || phoneDigits} (${phoneDigits}) — ${lead.course || "N/A"} [${tab}]`);
      }
    }

    console.log(`\n📊 Lead Load Complete:`);
    console.log(`   ✅ New     : ${loaded}`);
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
