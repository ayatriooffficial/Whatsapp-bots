require("dotenv").config();
const { MessageMedia } = require("whatsapp-web.js");
const client = require("../bot");
const { resolveSlotTemplate } = require("./messageTemplates");
const { loadSheet, getCourseLeads, updateLeadProgress } = require("./sheetService");

let isSandboxRunning = false;

function buildWhatsAppMessage({ name = "Candidate", course = "CBA", day = 1, slot = 1 }) {
  const isDGM = course.toUpperCase().includes("DGM") || course.toUpperCase().includes("MARKETING");
  const programTitle = isDGM ? "Digital Growth & Marketing (DGM™)" : "Certified Business Accountant (CBA™ / MBA)";
  const firstName = name.split(" ")[0] || "Candidate";

  if (day === 1 && slot === 1) {
    return isDGM
      ? `*${firstName} ji,*\n\n> 3 years of college taught marketing terms, but brands demand proof of live ad spend and real-world ROAS.\n\nAt Charters Union, we help you bridge the degree-to-corporate gap with zero friction:\n\n*Why Top Brands Hire DGM™ Graduates:*\n• *Supervised Live Ad Spend:* Run real Meta & Google ad budgets with ROAS targets.\n• *AI Workflow Automations:* Build automated content & lead-generation pipelines.\n• *100% In-Class Paid Internship:* Practical execution across 7 countries.\n• *Placement Outcomes:* 92% placement rate | ₹24.5 LPA average CTC.\n\n_Would you like to check your AI Career-Readiness Score this week?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`
      : `*${firstName} ji,*\n\n> 3 years of college exams passed, but freezing when interviewers ask for practical SAP, GST filing, or corporate modeling.\n\nAt Charters Union, we help you bridge the degree-to-corporate gap with zero friction:\n\n*Why Top Recruiters Hire CBA™ Graduates:*\n• *SAP S/4HANA & TallyPrime:* End-to-end ledger closing & live GST return filing.\n• *100% In-Class Paid Internship:* Supervised corporate projects across 7 countries.\n• *AI Career Engine:* Weekly skill-gap tracking & simulated Big 4 interviews.\n• *Placement Outcomes:* 97.7% placement rate | ₹26.5 LPA average CTC.\n\n_Would you like to check your AI Career-Readiness Score this week?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
  }

  if (day === 1 && slot === 2) {
    return isDGM
      ? `*${firstName} ji,*\n\n> Saved 40 marketing reels but never handled a real dashboard? Self-teaching ends where live budgets begin.\n\nAt Charters Union, we replace theory with supervised execution:\n\n*The DGM™ Practical Learning Framework:*\n• *Live Performance Labs:* Manage real campaigns with mentor oversight.\n• *AI Marketing Stack:* Master GA4, Mixpanel, and AI content engines.\n• *Top Recruiters:* Placements at Google, Amazon, Flipkart, Zomato & GrowthX.\n• *Risk-Free Seat Booking:* Lock your batch seat for just ₹2,000.\n\n_Would you like to explore the full 7-month curriculum today?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`
      : `*${firstName} ji,*\n\n> Freshers don't fail from lack of hard work — they fail from lack of an industry-standard system.\n\nAt Charters Union, we replace theory with structured corporate training:\n\n*The CBA™ Career Launchpad:*\n• *USCMA & ACCA Standards:* Enterprise accounting & dynamic DCF financial modelling.\n• *Tax Compliance Lab:* Corporate TDS, TCS, and GST audit defense.\n• *Top Recruiters:* Placements at KPMG, PwC, EY, Deloitte, and Saudi Aramco.\n• *Risk-Free Seat Booking:* Lock your batch seat for just ₹2,000.\n\n_Would you like to explore the full 7-month curriculum today?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
  }

  if (day === 2 && slot === 1) {
    return isDGM
      ? `*${firstName} ji,*\n\n> Why believe promises? Judge our program strictly on verified recruiter data and salary records.\n\nAt Charters Union, numbers are our only marketing:\n\n*Verified DGM™ Placement Records:*\n• *Placement Success:* 92% placement rate across past cohorts.\n• *Average Salary:* ₹24.5 LPA average CTC (2.5x salary hike).\n• *Recruiting Partners:* Google, Meta Partners, Amazon, Flipkart, GrowthX.\n• *Success-Fee Model:* We earn only when you succeed in your career.\n\n_Would you like us to send the graduate placement report PDF?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`
      : `*${firstName} ji,*\n\n> Why believe promises? Judge our program strictly on verified recruiter data and salary records.\n\nAt Charters Union, numbers are our only marketing:\n\n*Verified CBA™ Placement Records:*\n• *Placement Success:* 97.7% placement rate across past cohorts.\n• *Average Salary:* ₹26.5 LPA average CTC (3.05x salary jump).\n• *Recruiting Partners:* Saudi Aramco, CBD Accounting, KPMG, PwC, EY, Deloitte.\n• *Success-Fee Model:* We earn only when you succeed in your career.\n\n_Would you like us to send the graduate placement report PDF?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
  }

  if (day === 2 && slot === 2) {
    return isDGM
      ? `*${firstName} ji,*\n\n> Growth marketers don't scale alone — they scale under mentors who have managed 8-figure ad budgets.\n\nAt Charters Union, you learn directly from industry leaders:\n\n*1:1 Mentorship & Global Immersion:*\n• *Top 1% Mentors:* 1:1 guidance from active Growth Heads & CMOs.\n• *Fortune 500 CXOs:* Regular boardroom strategy & interview reviews.\n• *Global Projects:* Live exposure across 7 international tech hubs.\n• *Corporate English:* Spoken communication & presentation mastery.\n\n_Would you like to book a free 1:1 career mapping session with a mentor?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`
      : `*${firstName} ji,*\n\n> One mentor from a Big 4 firm is worth more than hundreds of theoretical online tutorials.\n\nAt Charters Union, you learn directly from industry leaders:\n\n*1:1 Mentorship & Global Immersion:*\n• *Top 1% Mentors:* 1:1 guidance from active CA/CMA/CFA leaders.\n• *Fortune 500 CXOs:* Regular corporate interview & case reviews.\n• *Global Projects:* Paid internship mandates across 7 countries.\n• *Corporate English:* Spoken confidence & boardroom interview polish.\n\n_Would you like to book a free 1:1 career mapping session with a mentor?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
  }

  if (day === 3 && slot === 1) {
    return `*${firstName} ji,*\n\n> ₹50,000 for a high-growth career path? Here is the exact zero-risk financial math.\n\nAt Charters Union, quality career education is made accessible:\n\n*Affordability & Scholarship Stack:*\n• *No-Cost EMI:* Starts at just ₹5,555/month (less than a weekly bill).\n• *Merit Scholarships:* Up to ₹16,000 for Round 1 applicants.\n• *Success-Fee Model:* The institute carries the placement risk with you.\n• *Seat Reservation:* Lock your slot with ₹2,000 initial booking.\n\n_Would you like to verify your scholarship eligibility in 2 minutes?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
  }

  // Day 3 Slot 2
  return `*${firstName} ji,*\n\n> Only 30 seats per cohort receive 100% in-class paid internship allocation — Round 1 closes soon.\n\nAt Charters Union, fast-track admissions take only 3 simple steps:\n\n*3-Step Fast-Track Admission:*\n• *Step 1:* Online Application (takes 2 minutes).\n• *Step 2:* AI Career Aptitude Assessment.\n• *Step 3:* 1:1 Industry Leader Interview.\n\n_Would you like to lock your seat before Round 1 admissions close?_\n\n🌐 *Visit:* chartersunion.com\n📝 *Apply:* chartersunion.com/apply\n📞 *Call:* +91 9836465083`;
}

async function runSandboxStageCampaign(options = {}) {
  if (isSandboxRunning) {
    return { success: false, message: "Sandbox campaign is already running." };
  }

  const phoneDigits = String(options.phone || process.env.SANDBOX_PHONE || "").replace(/\D/g, "");
  if (!phoneDigits || phoneDigits.length < 10) {
    return {
      success: false,
      message: "Please provide a valid 10-12 digit phone number in SANDBOX_PHONE in .env or query param."
    };
  }

  let coursesToRun = ["CBA", "DGM"];
  if (options.course && options.course !== "ALL" && options.course !== "BOTH") {
    coursesToRun = [options.course.toUpperCase()];
  }

  // Fetch 1st lead from Google Sheets for personalization & live tracking
  let sheetLead = null;
  try {
    const cbaLeads = await getCourseLeads("CBA");
    if (cbaLeads && cbaLeads.length > 0) {
      sheetLead = cbaLeads[0];
    }
  } catch (err) {
    console.log("Sheet lead load note:", err.message);
  }

  const candidateName = sheetLead?.name || String(options.name || process.env.SANDBOX_NAME || "Candidate");
  const delaySec = Number(options.delaySec || process.env.SANDBOX_FAST_DELAY_SEC || 8);

  isSandboxRunning = true;
  const totalMessages = coursesToRun.length * 6;

  console.log("\n==================================================");
  console.log("🚀 STARTING COMBINED SANDBOX CAMPAIGN (CBA & DGM)");
  console.log(`📱 Recipient Phone : +${phoneDigits}`);
  console.log(`👤 Candidate Name  : ${candidateName}`);
  console.log(`🎓 Target Courses  : ${coursesToRun.join(" & ")} (${totalMessages} total messages)`);
  console.log(`⏱️  Inter-stage Delay: ${delaySec}s`);
  console.log("==================================================\n");

  const results = [];

  try {
    let recipient = `${phoneDigits}@c.us`;
    try {
      const id = await client.getNumberId(phoneDigits);
      if (id?._serialized) recipient = id._serialized;
    } catch (_) {}

    let poster = null;
    try {
      poster = MessageMedia.fromFilePath("./poster.jpeg");
    } catch (_) {
      console.log("⚠️ poster.jpeg not found — sending text only");
    }

    const stages = [
      { day: 1, slot: 1, label: "Day 1 — Slot 1 (Awareness / Foundation)" },
      { day: 1, slot: 2, label: "Day 1 — Slot 2 (Curriculum & Learning)" },
      { day: 2, slot: 1, label: "Day 2 — Slot 1 (Placement & ROI)" },
      { day: 2, slot: 2, label: "Day 2 — Slot 2 (Global Exposure & Internships)" },
      { day: 3, slot: 1, label: "Day 3 — Slot 1 (Scholarship & EMI Options)" },
      { day: 3, slot: 2, label: "Day 3 — Slot 2 (Final Admission Call-to-Action)" },
    ];

    let overallIndex = 0;

    for (const course of coursesToRun) {
      console.log(`\n──────────────────────────────────────────────────`);
      console.log(`📚 DELIVERING ${course} CAMPAIGN (6 STAGE MESSAGES)`);
      console.log(`──────────────────────────────────────────────────\n`);

      for (let i = 0; i < stages.length; i++) {
        overallIndex++;
        const stage = stages[i];
        console.log(`📤 [${overallIndex}/${totalMessages} | ${course}] Sending ${stage.label}...`);

        const message = buildWhatsAppMessage({
          name: candidateName,
          course,
          day: stage.day,
          slot: stage.slot,
        });

        try {
          // Send image poster with every stage message as requested
          if (poster) {
            await client.sendMessage(recipient, poster, { caption: message });
          } else {
            await client.sendMessage(recipient, message);
          }

          // Live Excel Tracking Synchronization
          if (sheetLead) {
            await updateLeadProgress(sheetLead, {
              stage: `day${stage.day}`,
              day: String(stage.day),
              slot: String(stage.slot),
              messagesSent: overallIndex,
              lastSentAt: String(Date.now()),
              status: "active",
            });
            console.log(`   📊 Excel sheet row updated for lead: ${sheetLead.name} (Day ${stage.day} Slot ${stage.slot})`);
          }

          console.log(`   ✅ Sent [${overallIndex}/${totalMessages}] ${course} ${stage.label} successfully!`);
          results.push({
            index: overallIndex,
            course,
            day: stage.day,
            slot: stage.slot,
            label: `${course} — ${stage.label}`,
            status: "sent",
            preview: message.slice(0, 80) + "..."
          });
        } catch (sendErr) {
          console.error(`   ❌ Failed to send ${course} ${stage.label}:`, sendErr.message);
          results.push({
            index: overallIndex,
            course,
            day: stage.day,
            slot: stage.slot,
            label: `${course} — ${stage.label}`,
            status: "failed",
            error: sendErr.message
          });
        }

        if (overallIndex < totalMessages && delaySec > 0) {
          console.log(`   ⏳ Waiting ${delaySec}s before next message...\n`);
          await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
        }
      }
    }

    console.log("\n==================================================");
    console.log(`🎉 ALL ${totalMessages} MESSAGES (BOTH CBA & DGM) COMPLETED`);
    console.log("==================================================\n");

    return {
      success: true,
      recipient: phoneDigits,
      courses: coursesToRun,
      totalSent: results.filter(r => r.status === "sent").length,
      stages: results
    };
  } catch (err) {
    console.error("❌ Sandbox campaign execution error:", err);
    return { success: false, error: err.message };
  } finally {
    isSandboxRunning = false;
  }
}

module.exports = {
  runSandboxStageCampaign,
  buildWhatsAppMessage,
  isSandboxRunning: () => isSandboxRunning
};
