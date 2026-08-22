require("dotenv").config();
const http = require("http");

async function main() {
  const port = process.env.PORT || 3001;
  const phone = process.env.SANDBOX_PHONE || process.argv[2];
  const course = process.env.SANDBOX_COURSE || process.argv[3] || "ALL";
  const delaySec = Number(process.env.SANDBOX_FAST_DELAY_SEC || process.argv[4] || 8);

  if (!phone || String(phone).includes("X")) {
    console.error("❌ Please provide a valid phone number via SANDBOX_PHONE in .env or pass it as an argument:");
    console.error("   node test/runSandboxCampaign.js 918090572658 ALL 8");
    process.exit(1);
  }

  console.log("--------------------------------------------------");
  console.log(`⚡ TRIGGERING WHATSAPP SANDBOX CAMPAIGN ON PORT ${port}`);
  console.log(`📱 Phone: +${phone} | Course: ${course} | Delay: ${delaySec}s`);
  console.log("--------------------------------------------------");

  const url = `http://localhost:${port}/sandbox/run?phone=${encodeURIComponent(phone)}&course=${encodeURIComponent(course)}&delay=${delaySec}`;

  http.get(url, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try {
        const json = JSON.parse(data);
        console.log("✅ Response:", json.message || json);
        console.log("\n👀 Watch your main WhatsApp bot server terminal to see live message delivery progress!");
      } catch (_) {
        console.log("Response:", data);
      }
    });
  }).on("error", (err) => {
    console.error(`❌ Could not connect to WhatsApp Bot server on port ${port}:`, err.message);
    console.error("💡 Please make sure the WhatsApp bot server is running (`npm start` in whatsapp-bot-master).");
    process.exit(1);
  });
}

main();
