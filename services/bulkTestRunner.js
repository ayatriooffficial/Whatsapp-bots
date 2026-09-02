/**
 * Bulk test-send runner for WhatsApp (testing phase).
 *
 * Reads recipients from the universal "Test Leads" tab (Channel = WHATSAPP or
 * BOTH), resolves the APPROVED message for each course+day+slot from the
 * Google Sheets "Messages" tab (no AI fallback), and sends via whatsapp-web.js
 * with human-like delays. Capped per run (BULK_WA_MAX_PER_RUN, default 5) to
 * protect the WhatsApp number during testing.
 *
 * Delay-based (NOT clock-based) — messages fire back-to-back, not at slot
 * times. Every result is appended to scripts/reports/bulk-test-whatsapp-*.csv
 * and written back to the Test Leads row.
 *
 * Usage:
 *   node test/runBulkWhatsAppTest.js [--course=CBA|DGM|ALL] [--delay=60]
 *     [--max=5] [--once] [--day=1] [--slot=1]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const client = require("../bot");
const { MessageMedia } = require("whatsapp-web.js");
const {
  getTestLeads,
  updateTestLeadStatus,
  loadSheet,
} = require("./sheetService");
const { resolveSlotTemplate, invalidateCache } = require("./messageTemplates");
const { pickPoster } = require("./posterPicker");
const { wrapWaUrls } = require("./waClickTracker");

let isBulkRunning = false;

const CONFIG = {
  minDelayMs: Number(process.env.BULK_WA_DELAY_MS || 60000),
  jitterMs: Number(process.env.BULK_WA_JITTER_MS || 15000),
  maxPerRun: Number(process.env.BULK_WA_MAX_PER_RUN || 5),
  totalSessions: Number(process.env.BULK_WA_TOTAL_SESSIONS || 6),
  globalDailyCap: Number(process.env.MAX_DAILY_MESSAGES || 150),
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rejects if the promise doesn't settle within ms. Prevents hangs on
 *  getNumberId/sendMessage when the WhatsApp client is mid-session-load. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || "operation"} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True when the whatsapp-web.js client has a live session (info populated). */
function isClientReady() {
  try {
    return !!client?.info?.wid?._serialized;
  } catch {
    return false;
  }
}

function randomDelay() {
  const base = CONFIG.minDelayMs;
  const jitter = CONFIG.jitterMs;
  return Math.max(1000, base - jitter + Math.floor(Math.random() * jitter * 2));
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeReport(rows) {
  const dir = path.join(__dirname, "..", "..", "scripts", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bulk-test-whatsapp-${timestamp()}.csv`);
  const header = [
    "Channel", "Recipient", "Name", "Course", "Day", "Slot",
    "Preview", "Status", "Error", "Sent At",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      "WHATSAPP", r.recipient, r.name, r.course, r.day, r.slot,
      r.preview, r.status, r.error, r.sentAt,
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

async function runBulkWhatsAppTest(options = {}) {
  if (isBulkRunning) {
    return { success: false, message: "A bulk WhatsApp test is already running." };
  }
  isBulkRunning = true;

  const report = [];
  const maxPerRun = Number(options.max || CONFIG.maxPerRun);
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    const leads = await getTestLeads({ channel: "WHATSAPP", course: options.course });
    const selected = leads.slice(0, maxPerRun);

    console.log(`\n=====================================================`);
    console.log(`🧪 BULK WHATSAPP TEST — ${selected.length} recipient(s) (max ${maxPerRun})`);
    console.log(`   Delay: ${Math.round(CONFIG.minDelayMs / 1000)}s ±${Math.round(CONFIG.jitterMs / 1000)}s | Approved-only (Messages tab, no AI fallback)`);
    console.log(`=====================================================\n`);

    if (selected.length === 0) {
      console.log("⚠️ No test leads found for channel WHATSAPP. Add rows to the 'Test Leads' tab.");
      return { success: true, message: "No test leads", report, file: null };
    }

    let poster = null;
    try {
      const posterPath = pickPoster();
      if (posterPath) poster = MessageMedia.fromFilePath(posterPath);
    } catch (_) {
      console.log("⚠️ no poster image found — sending text only");
    }

    let globalSentToday = 0;

    for (const lead of selected) {
      const phoneDigits = digitsOnly(lead.phone);
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 13) {
        console.log(`⏭️  ${lead.name || lead.phone}: invalid phone — skip`);
        skippedCount++;
        report.push({ recipient: lead.phone, name: lead.name, course: lead.course, day: "", slot: "", preview: "", status: "skipped", error: "INVALID_PHONE", sentAt: new Date().toISOString() });
        continue;
      }

      const coursesToRun = lead.course === "ALL" ? ["CBA", "DGM"] : [lead.course || "CBA"];
      const name = lead.name || "Candidate";

      console.log(`\n📱 Recipient: +${phoneDigits} (${coursesToRun.join(" & ")})`);

      for (const course of coursesToRun) {
        const startedCount = parseSentCount(lead.waSent);
        const startIdx = Math.min(startedCount, CONFIG.totalSessions);

        for (let idx = startIdx; idx < CONFIG.totalSessions; idx++) {
          const day = Math.floor(idx / 2) + 1;
          const slot = (idx % 2) + 1;

          if (options.once && idx > startIdx) break;
          if (options.day && day !== Number(options.day)) continue;
          if (options.slot && slot !== Number(options.slot)) continue;

          if (globalSentToday >= CONFIG.globalDailyCap) {
            console.log(`⏹️  Global daily cap (${CONFIG.globalDailyCap}) reached — stopping.`);
            isBulkRunning = false;
            const file = writeReport(report);
            return { success: true, sent: sentCount, failed: failedCount, skipped: skippedCount, report, file, message: "Global daily cap reached" };
          }

          invalidateCache();
          let template = null;
          try {
            template = await resolveSlotTemplate(loadSheet, { course, day, slot, score: 0, name });
          } catch (err) {
            console.log("Template resolve error:", err.message);
          }

          let message = template?.content || null;
          if (!message || message.trim().length < 20) {
            // NO FALLBACK — same gate as the production scheduler
            console.log(`⏭️  ${course} day${day} slot${slot}: no approved message — skipping (no fallback)`);
            skippedCount++;
            report.push({ recipient: phoneDigits, name, course, day, slot, preview: "", status: "skipped", error: "NO_APPROVED_CONTENT", sentAt: new Date().toISOString() });
            continue;
          }
          message = wrapWaUrls(message, phoneDigits);

          let recipient = `${phoneDigits}@c.us`;
          try {
            const id = await client.getNumberId(phoneDigits);
            if (id?._serialized) recipient = id._serialized;
          } catch (_) {}

          try {
            if (poster) {
              await client.sendMessage(recipient, poster, { caption: message });
            } else {
              await client.sendMessage(recipient, message);
            }
            sentCount++;
            globalSentToday++;

            const newCount = idx + 1;
            const newStatus = newCount >= CONFIG.totalSessions ? "done" : "in_progress";
            await updateTestLeadStatus(lead, {
              waSent: `${newCount}/${CONFIG.totalSessions}`,
              status: newStatus,
              lastSentAt: String(Date.now()),
              lastResult: `day${day} slot${slot} sent`,
            });

            report.push({
              recipient: phoneDigits, name, course, day, slot,
              preview: message.slice(0, 90) + (message.length > 90 ? "..." : ""),
              status: "sent",
              error: "",
              sentAt: new Date().toISOString(),
            });

            console.log(`✅ ${course} day${day} slot${slot} → +${phoneDigits}`);

            if (idx + 1 < CONFIG.totalSessions && !options.once) {
              const wait = randomDelay();
              console.log(`   ⏳ next message in ~${Math.round(wait / 1000)}s`);
              await sleep(wait);
            }
          } catch (err) {
            failedCount++;
            const msg = String(err.message || "").toLowerCase();
            const isInvalidNumber =
              msg.includes("no lid") || msg.includes("invalid wid") || msg.includes("not a whatsapp user");
            const errorLabel = isInvalidNumber ? "INVALID_NUMBER" : (err.message || "unknown");

            await updateTestLeadStatus(lead, {
              status: "failed",
              lastSentAt: String(Date.now()),
              lastResult: `day${day} slot${slot} failed: ${errorLabel}`,
            });

            report.push({
              recipient: phoneDigits, name, course, day, slot,
              preview: message.slice(0, 90) + (message.length > 90 ? "..." : ""),
              status: "failed",
              error: errorLabel,
              sentAt: new Date().toISOString(),
            });

            console.log(`❌ ${course} day${day} slot${slot} → +${phoneDigits}: ${err.message}`);
          }
        }
      }
    }

    const file = writeReport(report);
    console.log(`\n=====================================================`);
    console.log(`🎉 BULK WHATSAPP TEST COMPLETE`);
    console.log(`   Sent: ${sentCount} | Failed: ${failedCount} | Skipped (no approved): ${skippedCount}`);
    console.log(`   Report: ${file}`);
    console.log(`=====================================================\n`);

    return { success: true, sent: sentCount, failed: failedCount, skipped: skippedCount, report, file };
  } catch (err) {
    console.error("💥 Bulk WhatsApp test error:", err.message);
    const file = report.length ? writeReport(report) : null;
    return { success: false, error: err.message, report, file };
  } finally {
    isBulkRunning = false;
  }
}

/** Parses "3/6" or "3" into the number of messages already sent. */
function parseSentCount(val) {
  const m = String(val || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

module.exports = {
  runBulkWhatsAppTest,
  isBulkRunning: () => isBulkRunning,
};
