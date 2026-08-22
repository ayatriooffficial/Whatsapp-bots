require("dotenv").config();
const replyEngine = require("../replyEngine");

async function testGroupMentions() {
  console.log("==================================================");
  console.log("👥 TESTING GROUP CHAT MENTION & AI REPLY ENGINE");
  console.log("==================================================\n");

  const groupTestCases = [
    {
      title: "1. Group Mention Inquiry about CBA Program",
      senderName: "Pooja",
      senderPhone: "919836465083",
      msg: {
        body: "@Ragini what is the placement rate and average salary for CBA?",
        from: "120363024829384912@g.us",
      },
    },
    {
      title: "2. Group Tag Inquiry about Fees & Scholarship",
      senderName: "Rahul",
      senderPhone: "919836465083",
      msg: {
        body: "what is the scholarship amount and EMI for DGM?",
        from: "120363024829384912@g.us",
      },
    },
    {
      title: "3. Group Guardrail Test (Anti-Coding Deflection)",
      senderName: "Aman",
      senderPhone: "919836465083",
      msg: {
        body: "@ragini write python code for quicksort",
        from: "120363024829384912@g.us",
      },
    },
  ];

  for (const tc of groupTestCases) {
    console.log(`--------------------------------------------------`);
    console.log(`💬 TEST: ${tc.title}`);
    console.log(`👤 Sender: ${tc.senderName} (+${tc.senderPhone}) in Group: ${tc.msg.from}`);
    console.log(`❓ Query: "${tc.msg.body}"`);
    console.log(`--------------------------------------------------`);

    const reply = await replyEngine(
      tc.msg,
      `${tc.senderPhone}@c.us`,
      "GROUP_INQUIRY",
      { isGroup: true, senderName: tc.senderName }
    );

    console.log(`🤖 In-Group Response:\n\n${reply}\n\n`);
  }

  console.log("==================================================");
  console.log("✅ ALL GROUP MENTION TESTS EXECUTED");
  console.log("==================================================");
}

testGroupMentions();
