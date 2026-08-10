require("dotenv").config();

const client = require("./bot");

const MessageMedia = require("whatsapp-web.js").MessageMedia;

const {
  generateIntroContent,
} = require("./services/contentAgent");

const {
  getNewLeads,
  markSent,
  markLeadStatus,
  getViewerScore,
} = require("./services/sheetService");

const store = require("./services/messageStore");

/* =========================================================
   VOLUME / TIMING CONFIG (env-overridable)
========================================================= */

function delayMs() {
  // 1-minute randomized delay (45–75s) between individual sends
  const base = Number(process.env.SEND_INTERVAL_MS || 60000);
  const jitter = Number(process.env.SEND_INTERVAL_JITTER_MS || 15000);
  return Math.max(1000, base - jitter + Math.floor(Math.random() * jitter * 2));
}

const MAX_DAILY_MESSAGES = Number(process.env.MAX_DAILY_MESSAGES || 150);
const WARMUP_DAYS = Number(process.env.WARMUP_DAYS || 3);
const WARMUP_DAILY_MAX = Number(process.env.WARMUP_DAILY_MAX || 50);

/* =========================================================
   HELPERS
========================================================= */

function sanitizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function resolveRecipientId(phone) {
  try {
    const id = await client.getNumberId(phone);
    return id?._serialized || null;
  } catch (_) {
    return null;
  }
}

function getViewerLevel(score) {
  const s = Number(score || 0);
  if (s >= 77) return "HOT";
  if (s >= 34) return "WARM";
  if (s >= 1) return "COLD";
  return "NO_ACTIVITY";
}

function getDayIndex() {
  // Days since the bot started (used for warm-up ramp)
  return Math.floor(Date.now() / 86400000);
}

function dailyLimit() {
  const day = getDayIndex();
  if (WARMUP_DAYS > 0 && day < WARMUP_DAYS) {
    return WARMUP_DAILY_MAX;
  }
  return MAX_DAILY_MESSAGES;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================================================
   MAIN CAMPAIGN
========================================================= */

let isBulkSending = false;

async function sendBulk() {
  if (isBulkSending) {
    console.log("⏳ sendBulk already running, skipping this tick.");
    return;
  }
  isBulkSending = true;

  console.log("📋 Starting campaign...");

  let poster = null;
  try {
    poster = MessageMedia.fromFilePath("./poster.jpeg");
  } catch (_) {
    console.log("⚠️ poster.jpeg missing — text only mode");
  }

  const leads = await getNewLeads();

  if (!leads.length) {
    console.log("No new leads found");
    isBulkSending = false;
    return;
  }

  // TEST MODE — only send to the configured test phone (ignores all other leads)
  let campaignLeads = leads;
  if (process.env.TEST_MODE === "true") {
    const testPhone = String(process.env.TEST_PHONE || "").replace(/\D/g, "");
    campaignLeads = leads.filter((l) => {
      const digits = String(l.phone || "").replace(/\D/g, "");
      return testPhone && digits.endsWith(testPhone.slice(-10));
    });
    console.log(
      `🧪 TEST MODE — restricted to ${campaignLeads.length} lead(s) matching ${testPhone} (of ${leads.length} total)`
    );
  }

  // Warm-up + daily cap
  const limit = dailyLimit();
  console.log(`📨 ${campaignLeads.length} leads — daily limit ${limit}`);

  // Respect daily cap: only process up to the limit per day
  let sentToday = 0;
  const selected = shuffle(campaignLeads);
  const capped = selected.slice(0, limit);

  console.log(`📨 Processing ${capped.length} leads (shuffled, capped at ${limit})`);

  for (const lead of capped) {
    const name = (lead.name || "there").trim();
    const phone = sanitizePhone(lead.phone);

    if (!phone || phone.length < 10 || phone.length > 13) {
      console.log("Skipping invalid phone:", lead.phone);
      await markLeadStatus(lead, "not_exist");
      continue;
    }

    const fallbackUser = `${phone}@c.us`;

    /* ---------------- SKIP EXISTING ORGANIC ---------------- */
    const existingUser = store.getStore()[store.normalizeUserId(fallbackUser)];
    if (existingUser?.source === "organic") {
      console.log("Skipping organic user:", fallbackUser);
      await markSent(lead);
      continue;
    }

    try {
      /* ---------------- RESOLVE NUMBER ---------------- */
      const resolvedRecipient = await resolveRecipientId(phone);
      const recipient = resolvedRecipient || fallbackUser;
      if (!resolvedRecipient) {
        console.log("Using fallback recipient:", recipient);
      }

      /* ---------------- VIEWER SCORE + LEVEL ---------------- */
      let viewerScore = 0;
      try {
        viewerScore = await getViewerScore(fallbackUser);
      } catch (_) {}

      const viewerLevel = getViewerLevel(viewerScore);

      console.log(
        `viewerScore for ${phone}: ${viewerScore} → ${viewerLevel} | course: ${lead.course || "?"}`
      );

      /* ---------------- GENERATE MESSAGE (template-first, AI fallback) ---------------- */
      let msg = await generateIntroContent(
        name,
        lead.course || "",
        fallbackUser,
        viewerLevel
      );

      if (!msg || msg.length < 20) {
        msg =
          "Admissions open for job-ready programs.\nReply YES to know more.";
      }

      msg = msg
        .replace(/["']/g, "")
        .replace(/Here's.*message:/i, "")
        .trim();

      /* ---------------- SEND ---------------- */
      if (poster) {
        await client.sendMessage(recipient, poster, { caption: msg });
      } else {
        await client.sendMessage(recipient, msg);
      }

      /* ---------------- STORE USER ---------------- */
      const user = store.normalizeUserId(fallbackUser);
      const existingData = store.getStore()[user] || {};

      store.setUser(user, {
        ...existingData,
        session: 1,
        lastSent: Date.now(),
        optOut: existingData.optOut || false,
        chatId: recipient,
        source: "campaign",
        name,
        course: lead.course || existingData.course || "",
      });

      /* ---------------- MARK SENT + COUNT ---------------- */
      await markSent(lead);
      sentToday += 1;

      console.log(`✅ Sent to ${name} (${recipient}) — ${sentToday}/${limit} today`);

    } catch (err) {
      console.log("Send error:", fallbackUser, err.message);

      const message = String(err.message || "").toLowerCase();
      if (
        message.includes("invalid wid") ||
        message.includes("not a whatsapp user") ||
        message.includes("no whatsapp account") ||
        message.includes("invalid") ||
        message.includes("wid error")
      ) {
        await markLeadStatus(lead, "not_exist");
      }
    }

    // 1-minute randomized delay between messages (human-like)
    const wait = delayMs();
    console.log(`⏳ Waiting ${Math.round(wait / 1000)}s before next message...`);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.log("✅ Campaign completed");
  isBulkSending = false;
}

module.exports = { sendBulk };
