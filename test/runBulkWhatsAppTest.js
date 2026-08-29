/**
 * CLI entry point for the bulk WhatsApp test.
 *
 * Reads recipients from the "Test Leads" tab (Channel = WHATSAPP or BOTH) and
 * sends the approved drip (3 days x 2 slots) to each with human-like delays.
 * If the bot server is running on localhost:PORT it dispatches to /bulk/run;
 * otherwise it initializes a standalone WhatsApp client (QR login).
 *
 * Usage:
 *   npm run bulk:whatsapp
 *   npm run bulk:whatsapp -- --course=CBA --delay=60 --max=3
 *   npm run bulk:whatsapp -- --once
 */
require("dotenv").config();
const path = require("path");
const client = require("../bot");
const { runBulkWhatsAppTest } = require("../services/bulkTestRunner");

const PORT = process.env.PORT || 3001;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

async function checkServerRunning() {
  try {
    const res = await fetch(`${SERVER_URL}/bulk/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function triggerViaServer(options) {
  console.log(`🌐 Connected to running WhatsApp Bot server at ${SERVER_URL}`);
  const params = new URLSearchParams();
  if (options.course) params.set("course", options.course);
  if (options.delaySec) params.set("delay", String(options.delaySec));
  if (options.max) params.set("max", String(options.max));
  if (options.once) params.set("once", "true");
  if (options.day) params.set("day", String(options.day));
  if (options.slot) params.set("slot", String(options.slot));

  const res = await fetch(`${SERVER_URL}/bulk/run?${params.toString()}`);
  const data = await res.json();
  if (data.success) {
    console.log(`✅ Bulk WhatsApp test accepted by running server!`);
    console.log(`📊 Check the bot server console for live delivery logs.`);
  } else {
    console.error(`❌ Server error:`, data.message || data.error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    course: process.env.BULK_WA_COURSE || "",
    delaySec: Number(process.env.BULK_WA_DELAY_SEC || 60),
    max: Number(process.env.BULK_WA_MAX_PER_RUN || 5),
    once: false,
    day: null,
    slot: null,
  };

  for (const arg of args) {
    if (arg.startsWith("--course=")) options.course = arg.split("=")[1].trim().toUpperCase();
    else if (arg.startsWith("--delay=")) options.delaySec = Number(arg.split("=")[1].trim());
    else if (arg.startsWith("--max=")) options.max = Number(arg.split("=")[1].trim());
    else if (arg.startsWith("--day=")) options.day = Number(arg.split("=")[1].trim());
    else if (arg.startsWith("--slot=")) options.slot = Number(arg.split("=")[1].trim());
    else if (arg === "--once" || arg === "-1") options.once = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run bulk:whatsapp -- [--course=CBA|DGM|ALL] [--delay=60] [--max=5] [--once] [--day=1] [--slot=1]`);
      process.exit(0);
    }
  }

  console.log(`=====================================================`);
  console.log(`🚀 BULK WHATSAPP TEST TRIGGER`);
  console.log(`📚 Course       : ${options.course || "ALL (from Test Leads rows)"}`);
  console.log(`⏱️  Delay        : ${options.delaySec}s between messages`);
  console.log(`👥 Max recipients: ${options.max}`);
  console.log(`🎯 Mode         : ${options.once ? "ONE message per recipient" : "Full approved drip (6 slots)"}`);
  console.log(`=====================================================\n`);

  const isServerUp = await checkServerRunning();
  if (isServerUp) {
    await triggerViaServer(options);
    process.exit(0);
  }

  // Standalone WhatsApp client (QR login) — same pattern as runSandboxCampaign.js
  console.log(`⏳ WhatsApp Bot server not running on ${SERVER_URL}.`);
  console.log("🔌 Initializing standalone WhatsApp client (checking .wwebjs_auth session)...");

  let isReady = false;
  client.on("qr", (qr) => {
    console.log("\n📲 Scan this QR code in WhatsApp to link your session:");
    try {
      require("qrcode-terminal").generate(qr, { small: true });
    } catch {
      console.log(qr);
    }
  });
  client.on("auth_failure", (msg) => console.error("❌ WhatsApp authentication failed:", msg));
  client.on("ready", async () => {
    console.log("✅ WhatsApp client is READY!\n");
    isReady = true;
    try {
      const result = await runBulkWhatsAppTest(options);
      console.log(`\n${result.success ? "🎉 BULK WHATSAPP TEST COMPLETE" : "⚠️ " + (result.message || result.error || "Finished with issues")}`);
      if (result.file) console.log(`   Report: ${result.file}`);
    } catch (err) {
      console.error("❌ Execution error:", err);
    } finally {
      process.exit(0);
    }
  });

  try {
    await client.initialize();
  } catch (initErr) {
    console.error("❌ Failed to initialize WhatsApp client:", initErr.message);
    console.log("💡 Tip: run the bot server ('npm start' in whatsapp-bot-master), then run this command again.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Runner error:", err.message);
  process.exit(1);
});
