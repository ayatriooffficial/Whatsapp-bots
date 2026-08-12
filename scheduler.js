require("dotenv").config();

const cron = require("node-cron");
const client = require("./bot");
const MessageMedia = require("whatsapp-web.js").MessageMedia;
const {
  getCourseLeads,
  updateLeadProgress,
} = require("./services/sheetService");
const {
  resolveSlotTemplate,
  timeToMinutes,
} = require("./services/messageTemplates");
const { generateFollowupContent } = require("./services/contentAgent");
const { COURSE_TABS } = require("./services/courseCategories");

let reminderStarted = false;
let isSendingReminders = false;

/* ================================================================
   ⏰ CAMPAIGN CONFIG (env-overridable)
================================================================ */
const CONFIG = {
  // Fallback times if a slot has no Time in the Messages tab
  slotDefaultTimes: {
    1: process.env.SLOT1_TIME || "10:00",
    2: process.env.SLOT2_TIME || "18:00",
  },
  maxMessagesPerDay: Number(process.env.MAX_MESSAGES_PER_DAY || 2),
  totalSessions: Number(process.env.TOTAL_SESSIONS || 6), // 3 days x 2 slots
  globalDailyCap: Number(process.env.MAX_DAILY_MESSAGES || 150),
  minDelayMs: Number(process.env.SEND_INTERVAL_MS || 60000),
  jitterMs: Number(process.env.SEND_INTERVAL_JITTER_MS || 15000),
};

/* ================================================================
   TIME HELPERS
================================================================ */

function currentMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isSlotDue(slotTime) {
  return currentMinutes() >= timeToMinutes(slotTime);
}

function isSameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function randomDelay() {
  const base = CONFIG.minDelayMs;
  const jitter = CONFIG.jitterMs;
  return Math.max(1000, base - jitter + Math.floor(Math.random() * jitter * 2));
}

function getViewerLevel(score) {
  const s = Number(score || 0);
  if (s >= 77) return "HOT";
  if (s >= 34) return "WARM";
  if (s >= 1) return "COLD";
  return "NO_ACTIVITY";
}

/* ================================================================
   CAMPAIGN RUNNER — per-minute check
================================================================ */

let globalSentToday = 0;
let lastGlobalResetDay = "";

function resetGlobalDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastGlobalResetDay) {
    globalSentToday = 0;
    lastGlobalResetDay = today;
  }
}

async function sendBulk() {
  if (isSendingReminders) return;
  isSendingReminders = true;
  resetGlobalDailyIfNeeded();

  try {
    let poster = null;
    try {
      poster = MessageMedia.fromFilePath("./poster.jpeg");
    } catch (_) {
      console.log("⚠️ poster.jpeg missing — text only mode");
    }

    const now = new Date();
    console.log(`📋 Campaign check ${now.toLocaleTimeString()}`);

    // TEST MODE — restrict to one phone
    const testPhone = process.env.TEST_MODE === "true"
      ? String(process.env.TEST_PHONE || "").replace(/\D/g, "")
      : "";

    for (const tab of Object.values(COURSE_TABS)) {
      let leads = [];
      try {
        leads = await getCourseLeads(tab);
      } catch (err) {
        console.log(`  ${tab} read failed:`, err.message);
        continue;
      }

      if (testPhone) {
        leads = leads.filter((l) =>
          String(l.phone || "").replace(/\D/g, "").endsWith(testPhone.slice(-10))
        );
        console.log(`  🧪 TEST MODE ${tab}: ${leads.length} matching lead(s)`);
      }

      for (const lead of leads) {
        if (globalSentToday >= CONFIG.globalDailyCap) {
          console.log(`⏹️  Global daily cap (${CONFIG.globalDailyCap}) reached — stopping.`);
          isSendingReminders = false;
          return;
        }

        const messagesSent = Number(lead.messagesSent || 0);
        if (messagesSent >= CONFIG.totalSessions) {
          await updateLeadProgress(lead, { stage: "done", status: "done" });
          console.log(`   ✅ ${lead.name || lead.phone}: all ${CONFIG.totalSessions} done → stage=done`);
          continue;
        }

        // Determine current day (1-3) + slot (1-2) from messagesSent
        const day = Math.floor(messagesSent / 2) + 1; // 0-1→1, 2-3→2, 4-5→3
        const slot = (messagesSent % 2) + 1;          // 0,2,4→1 ; 1,3,5→2

        // Resolve template (message + time) for this slot
        let template = null;
        try {
          template = await resolveSlotTemplate(require("./services/sheetService").loadSheet, {
            course: lead.course,
            day,
            slot,
            score: Number(lead.score || 0),
            name: lead.name,
          });
        } catch (err) {
          console.log("   Template resolve error:", err.message);
        }

        const slotTime = template?.time || CONFIG.slotDefaultTimes[String(slot)] || "10:00";

        // Already sent this slot today?
        const alreadySentThisSlot =
          Number(lead.day || 0) === day &&
          Number(lead.slot || 0) === slot &&
          lead.lastSentAt &&
          isSameDay(Number(lead.lastSentAt), now);
        if (alreadySentThisSlot) {
          console.log(`   ⏭️  ${lead.name || lead.phone}: day${day} slot${slot} already sent today`);
          continue;
        }

        if (!isSlotDue(slotTime)) {
          console.log(`   ⏳ ${lead.name || lead.phone}: day${day} slot${slot} not due yet (${slotTime})`);
          continue;
        }

        /* ---------------- RESOLVE RECIPIENT ---------------- */
        const phoneDigits = String(lead.phone || "").replace(/\D/g, "");
        let recipient = `${phoneDigits}@c.us`;
        try {
          const id = await client.getNumberId(phoneDigits);
          if (id?._serialized) recipient = id._serialized;
        } catch (_) {}

        /* ---------------- BUILD MESSAGE ---------------- */
        let message = template?.content || null;
        if (!message) {
          try {
            message = await generateFollowupContent(
              { program: null, topic: `day${day}-slot${slot}` },
              lead.course || "",
              recipient,
              getViewerLevel(Number(lead.score || 0)),
              lead.name,
              day,
              null
            );
          } catch (_) {
            message = null;
          }
        }
        if (!message || message.trim().length < 20) {
          message = `Hi ${lead.name || "there"}! Admissions open for ${lead.course || "our programs"}.\nReply YES to know more.`;
        }

        /* ---------------- SEND ---------------- */
        try {
          if (poster) {
            await client.sendMessage(recipient, poster, { caption: message });
          } else {
            await client.sendMessage(recipient, message);
          }
          console.log(`   ✅ Sent day${day} slot${slot} to ${lead.name || lead.phone} (${recipient})`);

          const newCount = messagesSent + 1;
          const newStage = newCount >= CONFIG.totalSessions
            ? "done"
            : `day${Math.floor(newCount / 2) + 1}`;

          await updateLeadProgress(lead, {
            stage: newStage,
            day: String(day),
            slot: String(slot),
            status: newCount >= CONFIG.totalSessions ? "done" : "active",
            messagesSent: newCount,
            lastSentAt: String(Date.now()),
          });

          globalSentToday += 1;
          console.log(`   📈 ${lead.name || lead.phone}: ${newCount}/${CONFIG.totalSessions} | ${globalSentToday}/${CONFIG.globalDailyCap} today`);

          const wait = randomDelay();
          console.log(`   ⏳ waiting ${Math.round(wait / 1000)}s`);
          await new Promise((r) => setTimeout(r, wait));
        } catch (err) {
          console.log(`   ❌ Send failed for ${lead.name || lead.phone}: ${err.message}`);
          if (String(err.message || "").toLowerCase().includes("no lid")) {
            await updateLeadProgress(lead, { status: "not_exist" });
          }
        }
      }
    }
  } catch (err) {
    console.log("Campaign error:", err.message);
  } finally {
    isSendingReminders = false;
  }
}

/* ================================================================
   START
================================================================ */

function startReminder() {
  if (reminderStarted) return;
  reminderStarted = true;

  // Check every minute for due slots
  cron.schedule("* * * * *", () => {
    void sendBulk();
  });

  console.log("⏰ Scheduled campaign started");
  console.log(`   3 days × 2 slots = ${CONFIG.totalSessions} messages/lead | global cap ${CONFIG.globalDailyCap}/day`);
}

module.exports = startReminder;
module.exports.sendBulk = sendBulk;
