const { MessageMedia } = require("whatsapp-web.js");
const client = require("../bot");
const { generateDynamicWhatsAppMessage } = require("./contentAgent");
const { getCourseLeads, updateLeadProgress, loadSheet } = require("./sheetService");
const { resolveSlotTemplate, invalidateCache } = require("./messageTemplates");
const { pickPoster } = require("./posterPicker");

let isSandboxRunning = false;

/**
 * Builds a WhatsApp message for sandbox testing.
 * Resolves the approved template from the Google Sheets "Messages" tab first (exact match).
 * Falls back to dynamic AI generation ONLY if the sheet has no approved entry for that slot
 * AND approvedOnly is not set. When approvedOnly is set, a missing approved message is a
 * hard failure (never silently send AI content).
 */
async function buildWhatsAppMessage({ name = "Candidate", course = "CBA", day = 1, slot = 1, approvedOnly = false }) {
  try {
    invalidateCache(); // Ensure fresh read from Google Sheets
    const template = await resolveSlotTemplate(loadSheet, {
      course,
      day,
      slot,
      name,
    });
    if (template && template.content && template.content.trim().length > 10) {
      console.log(`   📋 [Google Sheets] Using approved message from Messages tab for ${course} Day ${day} Slot ${slot}`);
      return template.content;
    }
    if (approvedOnly) {
      throw new Error(`No approved WhatsApp message for ${course} Day ${day} Slot ${slot} in the Messages tab (approvedOnly mode — no AI fallback).`);
    }
  } catch (err) {
    if (approvedOnly) throw err;
    console.log(`   ⚠️ Could not read from Google Sheets Messages tab: ${err.message}. Falling back to AI generator.`);
  }

  return await generateDynamicWhatsAppMessage({ name, course, day, slot });
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
  console.log("🚀 STARTING PURE AI WHATSAPP SANDBOX CAMPAIGN");
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
      const posterPath = pickPoster();
      if (posterPath) poster = MessageMedia.fromFilePath(posterPath);
    } catch (_) {
      console.log("⚠️ no poster image found — sending text only");
    }

    let stages = [
      { day: 1, slot: 1, label: "Day 1 — Slot 1 (1:1 Tool Diagnostic & Career Roadmap)" },
      { day: 1, slot: 2, label: "Day 1 — Slot 2 (Day-in-the-Life & Practical Weekly Structure)" },
      { day: 2, slot: 1, label: "Day 2 — Slot 1 (Single Verified Proof Byte & Recruiter Outcomes)" },
      { day: 2, slot: 2, label: "Day 2 — Slot 2 (1:1 Practicing Mentor Access & Mock Boardrooms)" },
      { day: 3, slot: 1, label: "Day 3 — Slot 1 (Plain-Language Logistics, Schedule & EMI)" },
      { day: 3, slot: 2, label: "Day 3 — Slot 2 (Round 1 Fast-Track Seat Allocation Notice)" },
    ];

    if (options.day) {
      const targetDay = Number(options.day);
      stages = stages.filter((s) => s.day === targetDay);
    }

    if (options.slot) {
      const targetSlot = Number(options.slot);
      stages = stages.filter((s) => s.slot === targetSlot);
    }

    const totalMessages = coursesToRun.length * stages.length;
    let overallIndex = 0;

    for (const course of coursesToRun) {
      console.log(`\n──────────────────────────────────────────────────`);
      console.log(`📚 DELIVERING ${course} PURE AI CAMPAIGN (${stages.length} STAGE MESSAGES)`);
      console.log(`──────────────────────────────────────────────────\n`);

      for (let i = 0; i < stages.length; i++) {
        overallIndex++;
        const stage = stages[i];
        console.log(`📤 [${overallIndex}/${totalMessages} | ${course}] Generating & Sending ${stage.label}...`);

        try {
          const message = await buildWhatsAppMessage({
            name: candidateName,
            course,
            day: stage.day,
            slot: stage.slot,
            approvedOnly: Boolean(options.approvedOnly),
          });

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
            preview: message.slice(0, 90) + "..."
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
