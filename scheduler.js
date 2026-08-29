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
const { COURSE_TABS } = require("./services/courseCategories");
const { pickPoster } = require("./services/posterPicker");

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

/* ================================================================
   CAMPAIGN RUNNER — per-minute check
================================================================ */

let globalSentToday = 0;
let lastGlobalResetDay = "";

// Per-lead messages sent today (catch-up guard: max 2/day even when catching up)
const sentTodayByLead = new Map(); // key: phone → count
let sentTodayDay = "";

function resetDailyCounters() {
  const today = new Date().toDateString();
  if (today !== lastGlobalResetDay) {
    globalSentToday = 0;
    lastGlobalResetDay = today;
  }
  if (today !== sentTodayDay) {
    sentTodayByLead.clear();
    sentTodayDay = today;
  }
}

async function sendBulk() {
  if (isSendingReminders) return;
  if (process.env.TEST_PHASE === "true") {
    // In TEST_PHASE, the production drip is paused — bulk test sends run manually.
    return;
  }
  isSendingReminders = true;
  resetDailyCounters();

  try {
    let poster = null;
    try {
      const posterPath = pickPoster();
      if (posterPath) poster = MessageMedia.fromFilePath(posterPath);
    } catch (_) {
      console.log("⚠️ no poster image found — text only mode");
    }

    const now = new Date();
    console.log(`📋 Campaign check ${now.toLocaleTimeString()}`);

    // SANDBOX / TEST MODE — restrict to one designated test phone
    const isSandbox = process.env.SANDBOX === "true" || process.env.TEST_MODE === "true";
    const testPhone = isSandbox
      ? String(process.env.SANDBOX_PHONE || process.env.TEST_PHONE || "").replace(/\D/g, "")
      : "";

    for (const tab of Object.values(COURSE_TABS)) {
      let leads = [];
      try {
        leads = await getCourseLeads(tab);
      } catch (err) {
        console.log(`  ${tab} read failed:`, err.message);
        continue;
      }

      if (isSandbox && testPhone) {
        leads = leads.filter((l) =>
          String(l.phone || "").replace(/\D/g, "").endsWith(testPhone.slice(-10))
        );
        console.log(`  🧪 SANDBOX MODE ${tab}: ${leads.length} matching lead(s) for ${testPhone}`);
      } else if (isSandbox && !testPhone) {
        console.log(`  🛑 SANDBOX active but no SANDBOX_PHONE set — skipping live sends`);
        leads = [];
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

        // ── Catch-up guard: max 2/day per lead even when catching up ──
        // Uses the persisted "Sent Today" column; resets when the date changes
        // (checked below on each successful send).
        const phoneKey = String(lead.phone || "").replace(/\D/g, "");
        const leadSentToday = Number(lead.sentToday || 0);
        if (leadSentToday >= CONFIG.maxMessagesPerDay) {
          console.log(`   ⏳ ${lead.name || lead.phone}: daily cap (${CONFIG.maxMessagesPerDay}) reached — will retry tomorrow`);
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
          // NO FALLBACK: if no approved message exists in the Messages tab for
          // this course+day+slot, skip the lead entirely instead of sending
          // AI-generated or hardcoded fallback content.
          console.log(`⏭️ ${lead.name || lead.phone}: no approved message for ${lead.course || "CBA"} day${day} slot${slot} — skipping (no fallback)`);
          continue;
        }
        if (message.trim().length < 20) {
          console.log(`⏭️ ${lead.name || lead.phone}: approved message too short for day${day} slot${slot} — skipping (no fallback)`);
          continue;
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

          // Sent Today counter — reset if last send was a previous day, else increment
          const lastSentNum = Number(lead.lastSentAt || 0);
          const sentTodayValue =
            lead.lastSentAt && isSameDay(lastSentNum, now)
              ? (Number(lead.sentToday || 0) + 1)
              : 1;

          await updateLeadProgress(lead, {
            stage: newStage,
            day: String(day),
            slot: String(slot),
            status: newCount >= CONFIG.totalSessions ? "done" : "active",
            messagesSent: newCount,
            lastSentAt: String(Date.now()),
            sentToday: sentTodayValue,
          });

          // Track for the catch-up guard (in-memory mirror)
          sentTodayByLead.set(phoneKey, sentTodayValue);

          globalSentToday += 1;
          console.log(`   📈 ${lead.name || lead.phone}: ${newCount}/${CONFIG.totalSessions} | ${globalSentToday}/${CONFIG.globalDailyCap} today`);

          const wait = randomDelay();
          console.log(`   ⏳ waiting ${Math.round(wait / 1000)}s`);
          await new Promise((r) => setTimeout(r, wait));
        } catch (err) {
          // Failed send — do NOT count it, do NOT advance. Retry same slot next tick.
          const msg = String(err.message || "").toLowerCase();
          console.log(`   ❌ Send failed for ${lead.name || lead.phone}: ${err.message} (will retry)`);

          if (msg.includes("no lid") || msg.includes("invalid wid") || msg.includes("not a whatsapp user")) {
            // Number genuinely invalid — mark it and don't retry forever
            await updateLeadProgress(lead, { status: "not_exist" });
            console.log(`   🚫 ${lead.name || lead.phone}: number invalid — marked not_exist (no more sends)`);
          }
          // Other errors (network, timeout, temp) → leave progress unchanged → retried next minute
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
