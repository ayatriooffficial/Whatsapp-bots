const cron = require("node-cron");
const client = require("./bot");
const MessageMedia = require("whatsapp-web.js").MessageMedia;
const tracker = require("./services/engagementTracker");
const store = require("./services/messageStore");
const { programs } = require("./services/dataLoader");
const {
  generateFollowupContent,
} = require("./services/contentAgent");

let reminderStarted = false;
let isSendingReminders = false;

/* ================================================================
   ⏰ ANTI-SPAM CONFIG (env-overridable, defaults raised)
================================================================ */
const ANTI_SPAM = {
  minHoursBetweenMessages: Number(process.env.MIN_HOURS_BETWEEN || 10), // min 10hrs between messages
  maxMessagesPerDay: Number(process.env.MAX_MESSAGES_PER_DAY || 5), // per-user daily cap (default 5)
  organicInactivityWait: 30 * 60 * 1000, // 30 min after last reply
  maxSessions: Number(process.env.MAX_SESSIONS || 3), // organic users
  maxCampaignSessions: Number(process.env.MAX_CAMPAIGN_SESSIONS || 3), // campaign users — 3 sessions
};

/* ================================================================
   SESSION TOPICS — 3 sessions per program
================================================================ */
const SESSION_TOPICS = ["placement", "faculty", "fees"];

/* ================================================================
   HELPERS
================================================================ */

function isSameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function hoursSince(ts) {
  return (Date.now() - (ts || 0)) / (1000 * 60 * 60);
}

function getViewerLevel(score) {
  const s = Number(score || 0);
  if (s >= 77) return "HOT";
  if (s >= 34) return "WARM";
  if (s >= 1) return "COLD";
  return "NO_ACTIVITY";
}

/* ================================================================
   PROGRAM MATCHER
   Matches user's course string from sheet to a program object
================================================================ */
function matchProgram(courseStr) {
  if (!courseStr) return null;
  const c = courseStr.toLowerCase();

  // Direct ID match
  const byId = (programs?.programs || []).find(p => p.id === c);
  if (byId) return byId;

  // Keyword match
  if (c.includes("executive") || c.includes("product growth") || c.includes("emba")) {
    return (programs?.programs || []).find(p => p.id === "executive") || null;
  }
  if (c.includes("pgdm") || c.includes("post graduate") || c.includes("diploma")) {
    return (programs?.programs || []).find(p => p.id === "pgdm") || null;
  }
  if (c.includes("mba") || c.includes("master") || c.includes("business admin")) {
    return (programs?.programs || []).find(p => p.id === "mba") || null;
  }

  // Default to MBA if no match
  return (programs?.programs || []).find(p => p.id === "mba") || null;
}

/* ================================================================
   ANTI-SPAM CHECK
================================================================ */
function checkAntiSpam(userData, now) {
  const lastSent = userData.lastSent || 0;
  const messagesToday = userData.messagesToday || 0;
  const lastMessageDate = userData.lastMessageDate || 0;

  if (isSameDay(lastMessageDate, now) && messagesToday >= ANTI_SPAM.maxMessagesPerDay) {
    return { allowed: false, reason: `max ${ANTI_SPAM.maxMessagesPerDay} messages/day reached` };
  }
  if (lastSent && hoursSince(lastSent) < ANTI_SPAM.minHoursBetweenMessages) {
    const left = (ANTI_SPAM.minHoursBetweenMessages - hoursSince(lastSent)).toFixed(1);
    return { allowed: false, reason: `${left}h remaining before next message` };
  }
  return { allowed: true };
}

/* ================================================================
   LOAD POSTER SAFELY
================================================================ */
let poster = null;
try {
  poster = MessageMedia.fromFilePath("./poster.jpeg");
} catch (_) {
  console.log("⚠️  poster.jpeg not found — sending text only");
}

/* ================================================================
   MAIN REMINDER LOOP
================================================================ */
function startReminder() {
  if (reminderStarted) return;
  reminderStarted = true;

  cron.schedule("* * * * *", async () => {
    if (isSendingReminders) {
      console.log("⏳ Reminder scheduler already running, skipping this tick.");
      return;
    }
    isSendingReminders = true;
    try {
      const users = store.getStore();
      const now = Date.now();

      for (let user in users) {
        if (!user.endsWith("@c.us")) continue;
        if (user.includes("@newsletter")) continue;
        if (user.includes("@g.us")) continue;
        if (user === "status@broadcast") continue;

        const s = users[user];
        const session = Number(s.session || 1);
        const isOrganic = s.source === "organic";
        const maxSession = isOrganic
          ? ANTI_SPAM.maxSessions
          : ANTI_SPAM.maxCampaignSessions;

        if (s.optOut) continue;
        if (session > maxSession) { store.deleteUser(user); continue; }

        // ── Anti-spam check ────────────────────────────────────────
        const spamCheck = checkAntiSpam(s, now);
        if (!spamCheck.allowed) continue;

        // ── Organic: wait for inactivity ───────────────────────────
        if (isOrganic) {
          const lastInteraction = s.lastInteraction || s.lastSent || 0;
          if ((now - lastInteraction) < ANTI_SPAM.organicInactivityWait) continue;
        }

        // ── Get user's program from sheet course ───────────────────
        const courseStr = s.course || "";
        const program = matchProgram(courseStr);
        const name = (s.name || "there").split(" ")[0];
        const recipient = s.chatId || user;

        // ── Pick next topic not yet sent ───────────────────────────
        const sentTopics = s.sentTopics || [];
        const nextTopic = SESSION_TOPICS.find(t => !sentTopics.includes(t));

        if (!nextTopic) {
          console.log(`✅ All sessions complete → ${user}`);
          store.deleteUser(user);
          continue;
        }

        console.log(`\n📨 Sending to ${user}`);
        console.log(`   name:${name} | course:${courseStr} | program:${program?.id || "mba"}`);
        console.log(`   session:${session} | topic:${nextTopic} | sent:[${sentTopics.join(", ") || "none"}]`);

        // ── Build message (template-first via Messages tab, AI fallback) ──
        const message = await generateFollowupContent(
          { program, topic: nextTopic },
          courseStr,
          user,
          getViewerLevel(Number(s.score || 0)),
          name,
          session,
          null
        );

        // ── Send ───────────────────────────────────────────────────
        try {
          if (poster) {
            await client.sendMessage(recipient, poster, { caption: message });
          } else {
            await client.sendMessage(recipient, message);
          }
          console.log(`   ✅ Sent topic "${nextTopic}" to ${name}`);

          // Anti-spam delay between individual reminder messages to avoid rate limits
          await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
          console.log(`   ❌ Send failed: ${err.message}`);
          if (err.message.includes("No LID")) store.deleteUser(user);
          continue;
        }

        // ── Update tracker ─────────────────────────────────────────
        await tracker.completeSession(user);

        // ── Update store ───────────────────────────────────────────
        const updatedTopics = [...sentTopics, nextTopic];
        const updatedCount = isSameDay(s.lastMessageDate || 0, now)
          ? (s.messagesToday || 0) + 1
          : 1;

        if (session < maxSession) {
          store.updateUser(user, {
            session: session + 1,
            lastSent: now,
            lastMessageDate: now,
            messagesToday: updatedCount,
            sentTopics: updatedTopics,
          });
          console.log(`   📋 Next session: ${session + 1} | remaining topics: ${SESSION_TOPICS.filter(t => !updatedTopics.includes(t)).join(", ")}`);
        } else {
          store.deleteUser(user);
          console.log(`   ✅ All sessions complete — removed from queue`);
        }
      }
    } finally {
      isSendingReminders = false;
    }
  });

  console.log("⏰ Reminder scheduler started");
  console.log(`   Max ${ANTI_SPAM.maxMessagesPerDay} msg/day | Min ${ANTI_SPAM.minHoursBetweenMessages}h gap | ${SESSION_TOPICS.length} sessions per user`);
}

module.exports = startReminder;