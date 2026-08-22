require("dotenv").config();
const replyEngine = require("../replyEngine");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 TESTING RAGINI AI COUNSELOR INBOUND ENGINE");
  console.log("==================================================\n");

  const testCases = [
    {
      title: "1. Greeting Query",
      msg: { body: "Hi" },
      user: "919836465083@c.us",
    },
    {
      title: "2. General Institute Query ('what is chaterunion')",
      msg: { body: "what is chaterunion" },
      user: "919836465083@c.us",
    },
    {
      title: "3. CBA Specific Fee & Scholarship Query",
      msg: { body: "what is the fee and scholarship for CBA" },
      user: "919836465083@c.us",
    },
    {
      title: "4. Placements & Recruiters for DGM",
      msg: { body: "tell me about placements and recruiters for DGM" },
      user: "919836465083@c.us",
    },
    {
      title: "5. ROI Comparison (CBA vs DGM)",
      msg: { body: "What is the ROI of CBA compared to DGM?" },
      user: "919836465083@c.us",
    },
    {
      title: "6. Domain Guardrail Test (Anti-Coding / Off-Topic)",
      msg: { body: "Write a python function to find prime numbers" },
      user: "919836465083@c.us",
    },
  ];

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------------`);
    console.log(`💬 TEST: ${tc.title}`);
    console.log(`❓ Query: "${tc.msg.body}"`);
    console.log(`--------------------------------------------------`);
    try {
      const reply = await replyEngine(tc.msg, tc.user);
      console.log(`🤖 Ragini's Response:\n\n${reply}\n`);
    } catch (err) {
      console.error(`❌ Test failed:`, err.message);
    }
  }

  console.log("\n==================================================");
  console.log("✅ ALL TESTS EXECUTED");
  console.log("==================================================");
}

runTests();
