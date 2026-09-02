const store = require("./services/messageStore");
const tracker = require("./services/engagementTracker");
const { getCourseLeads, updateLeadProgress, cleanPhone, getTestLeads, updateTestLeadStatus } = require("./services/sheetService");
const { COURSE_TABS } = require("./services/courseCategories");
let isBound = false;

function getRealUser(id) {
  if (!id) return null;
  if (id.includes("@g.us")) return null;
  if (id.includes("@newsletter")) return null;
  if (id === "status@broadcast") return null;
  return store.normalizeUserId(id);
}

/**
 * Marks "WA Seen" on the lead's course-tab row in Google Sheets when a
 * sent message gets blue ticks (message_ack === 3 = read).
 */
async function markWaSeen(user) {
  try {
    const phoneDigits = cleanPhone(String(user || "").split("@")[0]);
    if (!phoneDigits) return;
    let foundInCourse = false;
    for (const tab of Object.values(COURSE_TABS)) {
      const leads = await getCourseLeads(tab);
      const lead = leads.find((l) => cleanPhone(l.phone) === phoneDigits);
      if (lead?.row) {
        await updateLeadProgress(lead, { waSeen: "yes" });
        console.log(`📊 WA Seen written for ${lead.name || phoneDigits} in ${tab}`);
        foundInCourse = true;
        break;
      }
    }
    try {
      const testLeads = await getTestLeads({ channel: "WHATSAPP" });
      const tLead = testLeads.find((l) => cleanPhone(l.phone) === phoneDigits);
      if (tLead?.row) {
        await updateTestLeadStatus(tLead, { waSeen: "yes" });
        console.log(`📊 Test Leads WA Seen written for ${phoneDigits}`);
      } else if (!foundInCourse) {
        const allTest = await getTestLeads({});
        const any = allTest.find((l) => cleanPhone(l.phone) === phoneDigits);
        if (any?.row) {
          await updateTestLeadStatus(any, { waSeen: "yes" });
          console.log(`📊 Test Leads WA Seen written for ${phoneDigits} (any channel)`);
        }
      }
    } catch (e) {
      console.log("Test Leads WA Seen note:", e.message);
    }
  } catch (err) {
    console.log("WA Seen write error:", err.message);
  }
}

function trackStatus(client) {
  if (isBound) return;
  isBound = true;

  client.on("message_ack", (msg, ack) => {
    if (!msg.fromMe) return;
    if (ack !== 3) return;

    const directUser = getRealUser(msg.to);
    if (!directUser) return;

    const users = store.getStore();
    const user = users[directUser] ? directUser : store.findUserByChatId(msg.to);
    // Tracked store user (course-tab drip) — keep full engagement tracking.
    if (user && users[user]) {
      tracker.trackRead(user);
      console.log("👀 Read →", user);
    } else {
      // Bulk / Test Leads recipient — not in messageStore. Still write WA Seen
      // by phone so the blue tick lands on the Test Leads + course-tab row.
      console.log("👀 Read (bulk/test) →", directUser);
    }

    // Write blue-tick (seen) back to the Google Sheets course tab + Test Leads
    markWaSeen(user || directUser);
  });
}

module.exports = trackStatus;
