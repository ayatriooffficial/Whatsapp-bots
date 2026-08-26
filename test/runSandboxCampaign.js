require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const client = require("../bot");
const { runSandboxStageCampaign } = require("../services/sandboxRunner");

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

async function checkServerRunning() {
  try {
    const res = await fetch(`${SERVER_URL}/sandbox/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function triggerViaServer({ targetPhone, targetCourse, delaySec, candidateName, approvedOnly, day, slot }) {
  console.log(`🌐 Connected to running WhatsApp Bot server at ${SERVER_URL}`);
  console.log(`🚀 Dispatching sandbox campaign request...`);

  let url = `${SERVER_URL}/sandbox/run?phone=${targetPhone}&course=${targetCourse}&delay=${delaySec}&name=${encodeURIComponent(candidateName)}`;
  if (approvedOnly) url += `&approvedOnly=true`;
  if (day) url += `&day=${day}`;
  if (slot) url += `&slot=${slot}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.success) {
    console.log(`\n✅ Sandbox campaign accepted by running WhatsApp Bot server!`);
    console.log(`📱 Delivering messages to +${targetPhone} with ${delaySec}s intervals.`);
    console.log(`📊 Check your bot server console for live delivery logs.\n`);
  } else {
    console.error(`❌ Server error:`, data.error || data.message);
  }
}

async function main() {
  const args = process.argv.slice(2);

  let targetPhone = process.env.SANDBOX_PHONE || "919836465083";
  let targetCourse = process.env.SANDBOX_COURSE || "ALL";
  let delaySec = Number(process.env.SANDBOX_FAST_DELAY_SEC || 8);
  let candidateName = process.env.SANDBOX_NAME || "Candidate";
  let approvedOnly = false;
  let targetDay = null;
  let targetSlot = null;

  const positional = [];

  for (const arg of args) {
    if (arg.startsWith("--phone=")) {
      targetPhone = arg.split("=")[1].trim();
    } else if (arg.startsWith("--course=")) {
      targetCourse = arg.split("=")[1].trim().toUpperCase();
    } else if (arg.startsWith("--delay=")) {
      delaySec = Number(arg.split("=")[1].trim());
    } else if (arg.startsWith("--name=")) {
      candidateName = arg.split("=")[1].trim();
    } else if (arg.startsWith("--day=")) {
      targetDay = Number(arg.split("=")[1].trim());
    } else if (arg.startsWith("--slot=")) {
      targetSlot = Number(arg.split("=")[1].trim());
    } else if (arg === "--approvedOnly" || arg === "--approved" || arg === "--published") {
      approvedOnly = true;
    } else if (!arg.startsWith("--")) {
      positional.push(arg.trim());
    }
  }

  // Handle positional arguments: [0] = phone, [1] = course
  if (positional.length > 0) {
    if (/^\d{10,13}$/.test(positional[0])) {
      targetPhone = positional[0];
    } else {
      targetCourse = positional[0].toUpperCase();
    }
  }
  if (positional.length > 1) {
    targetCourse = positional[1].toUpperCase();
  }

  targetPhone = String(targetPhone).replace(/\D/g, "");

  console.log(`\n======================================================`);
  console.log(`🚀 CLI WHATSAPP SANDBOX CAMPAIGN TRIGGER`);
  console.log(`📱 Target Phone : +${targetPhone}`);
  console.log(`🎓 Course       : ${targetCourse}`);
  if (targetDay) console.log(`📅 Target Day   : Day ${targetDay}`);
  if (targetSlot) console.log(`⏱️ Target Slot  : Slot ${targetSlot}`);
  console.log(`⏱️ Fast Delay   : ${delaySec}s between messages`);
  console.log(`👤 Student Name : ${candidateName}`);
  console.log(`🎯 Mode         : ${approvedOnly ? "Approved/Published Campaigns Only" : "Pure AI Drip Sequence"}`);
  console.log(`======================================================\n`);

  // 1. If server is already running, trigger through the authenticated bot server
  const isServerUp = await checkServerRunning();
  if (isServerUp) {
    await triggerViaServer({ targetPhone, targetCourse, delaySec, candidateName, approvedOnly, day: targetDay, slot: targetSlot });
    process.exit(0);
  }

  // 2. Otherwise initialize standalone WhatsApp Web client
  console.log("⏳ WhatsApp Bot server is not running on localhost:3000.");
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

  client.on("authenticated", () => {
    console.log("🔑 WhatsApp session authenticated.");
  });

  client.on("auth_failure", (err) => {
    console.error("❌ WhatsApp authentication failed:", err);
  });

  client.on("ready", async () => {
    console.log("✅ WhatsApp client is READY!\n");
    isReady = true;

    try {
      const result = await runSandboxStageCampaign({
        phone: targetPhone,
        course: targetCourse,
        delaySec,
        name: candidateName,
        approvedOnly,
        day: targetDay,
        slot: targetSlot
      });

      console.log("\n======================================================");
      if (result.success) {
        console.log(`🎉 SANDBOX RUN COMPLETED! Sent ${result.totalSent} messages to +${targetPhone}`);
      } else {
        console.log(`⚠️ SANDBOX RUN NOTICE: ${result.message || result.error || "Finished"}`);
      }
      console.log(`======================================================\n`);
    } catch (runErr) {
      console.error("❌ Execution error:", runErr);
    } finally {
      process.exit(0);
    }
  });

  try {
    await client.initialize();
  } catch (initErr) {
    console.error("❌ Failed to initialize WhatsApp client:", initErr.message);
    console.log("💡 Tip: You can also run the bot server with 'npm start' in whatsapp-bot-master, and then run this command again.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
