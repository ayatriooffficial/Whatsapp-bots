const store = require("./services/messageStore");
const tracker = require("./services/engagementTracker");
const { getCourseLeads, updateLeadProgress, cleanPhone } = require("./services/sheetService");
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
    for (const tab of Object.values(COURSE_TABS)) {
      const leads = await getCourseLeads(tab);
      const lead = leads.find((l) => cleanPhone(l.phone) === phoneDigits);
      if (lead?.row) {
        await updateLeadProgress(lead, { waSeen: "yes" });
        console.log(`📊 WA Seen written for ${lead.name || phoneDigits} in ${tab}`);
        return;
      }
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
    if (!user || !users[user]) return;

    tracker.trackRead(user);
    console.log("👀 Read →", user);

    // Write blue-tick (seen) back to the Google Sheets course tab
    markWaSeen(user);
  });
}

module.exports = trackStatus;
