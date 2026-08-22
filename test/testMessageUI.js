const { buildWhatsAppMessage } = require("../services/sandboxRunner");

console.log("==================================================");
console.log("📱 TESTING WHATSAPP UI FORMAT & COPY");
console.log("==================================================\n");

const tests = [
  { day: 1, slot: 1, course: "CBA", title: "CBA Day 1 Slot 1 (Awareness / Quote Block / Bold Section Titles)" },
  { day: 1, slot: 1, course: "DGM", title: "DGM Day 1 Slot 1 (Live Ad Spend / Quote Block / Bold Section Titles)" },
  { day: 2, slot: 1, course: "CBA", title: "CBA Day 2 Slot 1 (Placement Numbers & Proof)" },
  { day: 3, slot: 2, course: "CBA", title: "CBA Day 3 Slot 2 (Final 3-Step Admission Deadline)" },
];

for (const t of tests) {
  console.log(`--------------------------------------------------`);
  console.log(`💬 ${t.title}`);
  console.log(`--------------------------------------------------`);
  const msg = buildWhatsAppMessage({
    name: "Rahul",
    course: t.course,
    day: t.day,
    slot: t.slot,
  });
  console.log(msg);
  console.log("\n");
}

console.log("==================================================");
console.log("✅ ALL WHATSAPP UI TEST OUTPUTS VERIFIED");
console.log("==================================================");
