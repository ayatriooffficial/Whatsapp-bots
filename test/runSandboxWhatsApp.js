require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateDynamicWhatsAppMessage } = require("../services/contentAgent");

async function main() {
  const args = process.argv.slice(2);
  const targetCourse = args.find((a) => a.startsWith("--course="))?.split("=")[1]?.toUpperCase() || "CBA";
  const name = args.find((a) => a.startsWith("--name="))?.split("=")[1] || "Suman";
  const targetDay = args.find((a) => a.startsWith("--day=")) ? Number(args.find((a) => a.startsWith("--day=")).split("=")[1]) : null;
  const targetSlot = args.find((a) => a.startsWith("--slot=")) ? Number(args.find((a) => a.startsWith("--slot=")).split("=")[1]) : null;

  console.log("\n==================================================");
  console.log("🧪 TESTING PURE AI WHATSAPP MESSAGE GENERATION");
  console.log(`👤 Candidate Name: ${name}`);
  console.log(`🎓 Target Course : ${targetCourse}`);
  if (targetDay) console.log(`📅 Filter Day    : Day ${targetDay}`);
  if (targetSlot) console.log(`⏱️ Filter Slot   : Slot ${targetSlot}`);
  console.log("==================================================\n");

  let stages = [
    { day: 1, slot: 1, label: "Day 1 — Slot 1 (1:1 Tool Diagnostic & Career Roadmap)" },
    { day: 1, slot: 2, label: "Day 1 — Slot 2 (Day-in-the-Life & Practical Weekly Structure)" },
    { day: 2, slot: 1, label: "Day 2 — Slot 1 (Single Verified Proof Byte & Recruiter Outcomes)" },
    { day: 2, slot: 2, label: "Day 2 — Slot 2 (1:1 Practicing Mentor Access & Mock Boardrooms)" },
    { day: 3, slot: 1, label: "Day 3 — Slot 1 (Plain-Language Logistics, Schedule & EMI)" },
    { day: 3, slot: 2, label: "Day 3 — Slot 2 (Round 1 Fast-Track Seat Allocation Notice)" },
  ];

  if (targetDay) stages = stages.filter((s) => s.day === targetDay);
  if (targetSlot) stages = stages.filter((s) => s.slot === targetSlot);

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    console.log(`\n--------------------------------------------------`);
    console.log(`📱 ${stage.label}`);
    console.log(`--------------------------------------------------`);
    const message = await generateDynamicWhatsAppMessage({
      name,
      course: targetCourse,
      day: stage.day,
      slot: stage.slot,
    });
    console.log(message);
  }

  console.log("\n==================================================");
  console.log(`🎉 PURE AI WHATSAPP GENERATION TEST COMPLETE (${stages.length} messages rendered)!`);
  console.log("==================================================\n");
}

main().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
