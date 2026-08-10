const { generateProgramContent } = require("./services/contentAgent");
const findProgram = require("./services/findProgram");
const askAI = require("./services/aiReply");
const { programs, institute, faculty, home } = require("./services/dataLoader");
const tracker = require("./services/engagementTracker");
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/* ================================================================
   SAFE HELPERS — handle any data type safely
================================================================ */
function safeJoin(value, separator = ", ") {
  if (Array.isArray(value)) return value.filter(Boolean).join(separator);
  if (value && typeof value === "string") return value;
  return "";
}

function safeStr(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/* ================================================================
   BUILD FULL DATA CONTEXT
   Passed to AI so it answers from real JSON — never invents facts
================================================================ */
function buildFullContext(program = null) {
  const allPrograms = (programs?.programs || []).map(p => {
    const pl = p.placement || p.career_growth || {};
    return `
Program: ${safeStr(p.name)}
Duration: ${safeStr(p.duration)}
Format: ${safeStr(p.format)}
Eligibility: ${safeStr(p.eligibility)}
EMI from: ${safeStr(p.fees?.emi_start)}
No-cost EMI: ${safeStr(p.fees?.no_cost_emi)}
Scholarship: ${safeStr(p.fees?.scholarship)}
Seat booking: ${safeStr(p.fees?.seat_booking)}
Next batch: ${safeStr(p.start_date)}
Placement rate: ${safeStr(pl.placement_rate || pl.promotion_rate)}
Average CTC: ${safeStr(pl.average_ctc)}
Salary range: ${safeStr(pl.salary_range)}
Career roles: ${safeJoin((p.career_roles || []).slice(0, 5))}
Global exposure: ${safeJoin(p.global_exposure)}
    `.trim();
  }).join("\n\n---\n\n");

  return `
INSTITUTE: Charters Union of Business
Overview: ${safeStr(institute?.overview)}
Global presence: ${safeJoin(institute?.global_presence)}

FACULTY:
${safeStr(faculty?.faculty_overview)}
Top institutions: ${safeJoin(faculty?.top_institutions)}
Mentor network: ${safeStr(faculty?.mentor_network)}

PLACEMENT HIGHLIGHTS:
Highest CTC: ${safeStr(home?.placement_highlights?.highest_ctc)}
Average CTC: ${safeStr(home?.placement_highlights?.average_ctc)}
Top recruiters: ${safeJoin(home?.placement_highlights?.recruiters)}

PROGRAMS:
${allPrograms}
  `.trim();
}

/* ================================================================
   AI FREE-FORM ANSWER
   Handles ANY question intelligently using JSON data as context
================================================================ */
async function aiAnswer(question, program = null, userName = "there") {
  const firstName = (userName || "there").split(" ")[0];
  const data = buildFullContext(program);

  const prompt = `
You are Priya Sharma, a friendly admissions counselor at Charters Union of Business on WhatsApp.

A student named ${firstName} asked: "${question}"

Answer their question using ONLY the information provided below.
If the answer is not in the data, say you will connect them with a counselor — do NOT invent facts.

DATA:
${data}

FORMAT RULES (strictly follow):
- Start with a relevant emoji and their first name
- Answer the question directly and clearly
- Use *bold* for key labels (WhatsApp bold)
- 2-4 bullet points with emojis if listing facts
- End with one soft helpful CTA like "Reply if you'd like more details"
- Keep total length under 200 words
- NO generic menu listing unless truly irrelevant
- WhatsApp-friendly spacing (blank line between sections)
- Do NOT use markdown headers (##)
`;

  try {
    const reply = await askAI(prompt, 400);
    if (reply && reply.trim().length > 20) return reply.trim();
  } catch (_) {}

  return null;
}

/* ================================================================
   MAIN REPLY ENGINE
================================================================ */
async function replyEngine(msg, user, intent = "OTHER") {
  const q = String(msg.body || "").toLowerCase().trim();
  const phone = String(user || "").split("@")[0].replace(/\D/g, "");
  const status = tracker.getStatus(user) || {};
  const userName = status.name || "";

  // ── Detect program from message ───────────────────────────────
  const program = findProgram(q);

  // ── Direct structured replies (fast, no AI needed) ────────────

  if (program) {
    if (q.includes("fee") || q.includes("cost") || q.includes("emi")) {
      return `💰 *${program.name} — Fee Details*\n\n💳 EMI Starts: ${safeStr(program.fees?.emi_start)}\n📆 EMI Duration: ${safeStr(program.fees?.emi_duration)}\n✅ No-Cost EMI: ${safeStr(program.fees?.no_cost_emi)}\n\n🎓 Scholarship Available:\n${safeStr(program.fees?.scholarship)}\n\n📝 Apply Now:\n${APP_BASE_URL}/a/${phone}`;
    }

    if (q.includes("placement") || q.includes("salary") || q.includes("ctc") || q.includes("package")) {
      const p = program.placement || program.career_growth || {};
      return `📈 *${program.name} — Career Outcomes*\n\n🏆 Placement Rate: ${safeStr(p.placement_rate || p.promotion_rate)}\n💼 Average CTC: ${safeStr(p.average_ctc)}\n💰 Salary Range:\n${safeStr(p.salary_range)}`;
    }

    if (q.includes("duration") || q.includes("how long") || q.includes("years")) {
      return `⏳ *${program.name} — Program Duration*\n\n📆 ${safeStr(program.duration)}\n💻 Format: ${safeStr(program.format)}\n📅 Next Batch: ${safeStr(program.start_date)}`;
    }

    if (q.includes("eligib") || q.includes("qualify") || q.includes("who can")) {
      return `📋 *${program.name} — Eligibility*\n\n${safeStr(program.eligibility)}\n\n📅 Next Batch: ${safeStr(program.start_date)}`;
    }
  }

  if (q.includes("placement report") || q.includes("recruiters") || q.includes("top recruiter")) {
    return `📊 *Placement Highlights*\n\n🏆 Highest CTC: ${safeStr(home?.placement_highlights?.highest_ctc)}\n💼 Average CTC: ${safeStr(home?.placement_highlights?.average_ctc)}\n🏢 Top Recruiters:\n${safeJoin(home?.placement_highlights?.recruiters, "\n")}`;
  }

  if (q.includes("faculty") || q.includes("professor") || q.includes("mentor")) {
    return `👨‍🏫 *Faculty & Mentors*\n\nOur faculty includes experts from:\n\n🏫 ${safeJoin(faculty?.top_institutions)}\n\n🤝 Mentor Network:\n${safeStr(faculty?.mentor_network)}`;
  }

  if (q.includes("global") || q.includes("countries") || q.includes("international")) {
    return `🌍 *Global Exposure*\n\nStudents gain international exposure in:\n\n${safeJoin(institute?.global_presence, "\n")}`;
  }

  if (/^(hi|hello|hey|namaste|hii|helo)/.test(q)) {
    return `👋 *Welcome to Charters Union!*\n\nI can help you with:\n\n🎓 Programs & Courses\n💰 Fees & Scholarships\n📈 Placement Insights\n📝 Admissions\n\nJust type your question and I'll guide you.`;
  }

  if ((q.includes("program") || q.includes("course")) && q.split(" ").length <= 4) {
    return `📚 *Available Programs*\n\n${(programs?.programs || []).map(p => `🎓 *${p.name}*\n⏳ ${p.duration} | ${p.format}`).join("\n\n")}\n\n💬 Reply with a program name to explore details.`;
  }

  // ── AI FREE-FORM ANSWER ───────────────────────────────────────
  try {
    const aiReply = await aiAnswer(msg.body || q, program, userName);
    if (aiReply && aiReply.length > 20) return aiReply;
  } catch (err) {
    console.log("AI free-form answer error:", err.message);
  }

  // ── ContentAgent fallback ─────────────────────────────────────
  try {
    const reply = await generateProgramContent(msg.body || "", {
      intent,
      phone: user,
      name: userName,
      lastQuestion: status.lastQuestion || null,
      lastCourse  : status.courseName   || null
    });
    if (reply && reply.length > 10) return reply;
  } catch (err) {
    console.log("ContentAgent reply error:", err.message);
  }

  // ── Final fallback ────────────────────────────────────────────
  return `✨ I'm here to help you explore career programs at Charters Union.\n\nYou can ask me about:\n\n🎓 Available Programs\n💰 Fees & EMI options\n📈 Placement & Salary outcomes\n📝 Admission process\n\nSimply type your question and I'll guide you.`;
}

module.exports = replyEngine;