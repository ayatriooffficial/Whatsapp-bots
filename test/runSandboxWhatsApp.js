require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateDynamicWhatsAppMessage } = require("../services/contentAgent");

async function main() {
  const args = process.argv.slice(2);
  const targetCourse = args.find((a) => a.startsWith("--course="))?.split("=")[1] || "CBA";
  const name = args.find((a) => a.startsWith("--name="))?.split("=")[1] || "Ravi Patel";

  console.log("\n==================================================");
  console.log("🧪 TESTING PURE AI WHATSAPP MESSAGE GENERATION");
  console.log(`👤 Candidate Name: ${name}`);
  console.log(`🎓 Target Course : ${targetCourse}`);
  console.log("==================================================\n");

  const stages = [
    { day: 1, slot: 1, label: "Day 1 — Slot 1 (Awareness / Problem Hook)" },
    { day: 1, slot: 2, label: "Day 1 — Slot 2 (Curriculum & Live Tools)" },
    { day: 2, slot: 1, label: "Day 2 — Slot 1 (Placement Records & Big 4 Proof)" },
    { day: 2, slot: 2, label: "Day 2 — Slot 2 (1:1 Mentors & 7-Country Internships)" },
    { day: 3, slot: 1, label: "Day 3 — Slot 1 (No-Cost EMI & Scholarships)" },
    { day: 3, slot: 2, label: "Day 3 — Slot 2 (Round 1 Fast-Track Admission)" },
  ];

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
  console.log("🎉 PURE AI WHATSAPP GENERATION TEST COMPLETE!");
  console.log("==================================================\n");
}

main().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
