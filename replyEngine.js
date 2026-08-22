require("dotenv").config();
const chartersKnowledge = require("./data/chartersKnowledge.json");
const findProgram = require("./services/findProgram");
const askAI = require("./services/aiReply");
const tracker = require("./services/engagementTracker");

const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const WEBSITE_BASE_URL = (process.env.WEBSITE_BASE_URL || "https://chartersunion.com").replace(/\/+$/, "");
const HELPLINE_PHONE = process.env.HELPLINE_PHONE || process.env.SUPPORT_PHONE || "+91 9836465083";
const WHATSAPP_GROUP_URL = process.env.WHATSAPP_GROUP_URL || "https://chat.whatsapp.com/invite/charters-union";
const APPLY_URL = `${WEBSITE_BASE_URL}/apply`;

/* ================================================================
   STANDARDIZED ADMISSION FOOTER
================================================================ */
function buildAdmissionFooter(phone = "", isGroup = false) {
  if (isGroup) {
    return `\n\n────────────────────────────\n📞 *Admissions Helpline:* ${HELPLINE_PHONE} | 📝 *Apply:* ${APPLY_URL}`;
  }

  const cleanPhoneDigits = String(phone || "").replace(/\D/g, "");
  const applyLink = cleanPhoneDigits ? `${APP_BASE_URL}/a/${cleanPhoneDigits}` : APPLY_URL;

  return `\n\n────────────────────────────
💬 *Need personalized career guidance?*
Our admission experts can help you choose the right path.

📞 *Talk to Us:* ${HELPLINE_PHONE}
👥 *Join WhatsApp Group:* ${WHATSAPP_GROUP_URL}
📝 *Apply Now:* ${applyLink}`;
}

/* ================================================================
   DOMAIN GUARDRAIL CHECK
================================================================ */
function isOffTopicQuery(query) {
  const q = String(query || "").toLowerCase();
  
  const codingKeywords = [
    "python", "javascript", "react", "html", "css", "java", "c++", "c#",
    "write code", "write a script", "write function", "function to", "algorithm",
    "binary search", "fibonacci", "sql query", "debug this", "solve equation",
    "math problem", "write essay", "essay on", "recipe for", "who is the prime minister",
    "who won the match", "generate python"
  ];

  return codingKeywords.some(kw => q.includes(kw));
}

function getGuardrailDeflection(userName = "there") {
  const firstName = (userName || "there").split(" ")[0];
  return `Hello *${firstName}*! 👋

I am *Ragini*, Charters Union's AI Admission Counselor. I can assist you exclusively with our career programs (*CBA™*, *DGM™*, *TBM™*), fees, scholarships, admissions, and placement outcomes—not coding, academic homework, or general trivia.

Would you like to explore our industry-ready programs, placement statistics, or admission steps today?`;
}

/* ================================================================
   INSTANT DIRECT FACT RESPONSES
================================================================ */
function getFactReply(question, program, userName = "there") {
  const q = String(question || "").toLowerCase().trim();
  if (!program) return null;

  // 1. FEES / EMI / SCHOLARSHIP
  if (q.includes("fee") || q.includes("cost") || q.includes("emi") || q.includes("scholarship")) {
    return `💰 *${program.name} — Fee & Financial Details*

• *EMI Starts:* ${program.fees?.emi_start || "₹5,555/month"}
• *EMI Duration:* ${program.fees?.emi_duration || "8 months"}
• *No-Cost EMI:* ${program.fees?.no_cost_emi || "12, 18, 24, 36 months available"}
• *Scholarship Available:* ${program.fees?.scholarship || "Up to ₹16,000"}
• *Seat Booking:* ${program.fees?.seat_booking || "₹2,000"}`;
  }

  // 2. PLACEMENT / SALARY / CTC / ROI
  if (q.includes("placement") || q.includes("salary") || q.includes("ctc") || q.includes("package") || q.includes("recruit")) {
    const pl = program.placement || {};
    const recruiters = (pl.top_recruiters || []).join(", ");
    return `📈 *${program.name} — Placement Highlights*

🏆 *Placement / Promotion Rate:* ${pl.placement_rate || pl.promotion_rate || "95%+"}
💼 *Average CTC:* ${pl.average_ctc || "26.5 LPA"}
💰 *Salary Range:* ${pl.salary_range || "16 – 42 LPA"}
📈 *Salary Hike:* ${pl.salary_growth || "3.05x jump"}
🏢 *Top Recruiters:* ${recruiters || "Saudi Aramco, KPMG, PwC, EY, Genpact"}`;
  }

  // 3. DURATION & FORMAT
  if (q.includes("duration") || q.includes("how long") || q.includes("format") || q.includes("batch")) {
    return `⏱️ *${program.name} — Duration & Format*

📅 *Duration:* ${program.duration}
💻 *Format:* ${program.format}
🎯 *Focus:* ${program.focus}
🚀 *Next Batch:* ${program.start_date}`;
  }

  // 4. ELIGIBILITY
  if (q.includes("eligib") || q.includes("qualify") || q.includes("who can apply")) {
    return `📋 *${program.name} — Eligibility Criteria*

✅ ${program.eligibility}
🚀 *Next Batch:* ${program.start_date}`;
  }

  return null;
}

/* ================================================================
   GEMINI AI DYNAMIC REPLIES
================================================================ */
async function getAIReply(question, program = null, userName = "there", isGroup = false) {
  const firstName = (userName || "there").split(" ")[0];

  const systemInstruction = `You are Ragini, the dedicated AI Admission Counselor for Charters Union of Business (also referred to as Charters Business College).

CHARTERS UNION VERIFIED KNOWLEDGE BASE:
${JSON.stringify(chartersKnowledge, null, 2)}

CORE MISSION & PERSONALITY:
- Friendly, professional, highly encouraging, and deeply knowledgeable admission counselor.
- Answer user questions thoroughly using ONLY the verified Charters Union knowledge base provided above.
- Never invent facts, course names, or numbers outside this data.

STRICT FORMATTING RULES (NATIVE WHATSAPP FORMAT):
1. Use ONLY native WhatsApp formatting styles:
   - Bold: *text* (for titles, section headings, programs, numbers, key concepts)
   - Italics: _text_ (for tone, nuance, closing thoughts)
   - Strikethrough: ~text~ (for strikethrough comparisons)
   - Monospace: \`\`\`text\`\`\` (for code or monospace blocks)
   - Bullet lists: * text or - text or • text
   - Numbered lists: 1. text
   - Block quotes: > text (for quotes or highlighted excerpts)
   - Inline code: \`text\`
   - NEVER use HTML tags (<u>, </u>, <ins>, <b>, <i>, <h1>-<h6>) — WhatsApp renders them as broken raw text!
   - NEVER use Markdown heading tags (#, ##, ###) — use clean *Bold Section Titles* instead.
   - Leave a blank line between sections.
2. Structure for general questions ("what is charters union", "about college", etc.):
   - *About Charters Union* summary
   - *Core Learning Approach* (Industry-Led Education, Experiential Learning, Global Exposure across 7 countries, Mentorship with 100+ mentors)
   - *Core Programs* overview (CBA™ 2 Years / 7 Months, DGM™ 7 Months, TBM™ 12-18 Months)
   - *Key Highlights* (Placements, CTC, ROI, No-cost EMI from ₹5,555/mo, Scholarships up to ₹16,000, 3-step admission process)
   - Conclude with a warm invitation to ask about specific programs, fees, or placements.
3. For ROI (Return on Investment) queries:
   - Explain how affordable fees / low EMI starting at ₹5,555/month paired with high Average CTCs (CBA: 26.5 LPA with 3.05x jump, DGM: 24.5 LPA with 2.5x hike, TBM: 38.5 LPA with 1.8x increase) deliver exceptional ROI in just 7 to 24 months.
4. Keep the total response concise, structured, and easy to read on mobile screens (under ${isGroup ? 180 : 250} words).`;

  const prompt = `User Name: ${firstName}
Chat Context: ${isGroup ? "WhatsApp Group Thread" : "Direct WhatsApp Chat"}
Program Context: ${program ? program.name : "None specified"}
User Question: "${question}"

Provide a structured, engaging, and accurate counselor response for WhatsApp:`;

  try {
    const aiResponse = await askAI(prompt, 600, systemInstruction);
    if (aiResponse && aiResponse.trim().length > 20) {
      return aiResponse.trim();
    }
  } catch (err) {
    console.error("AI Reply error:", err.message);
  }

  return `✨ *Welcome to Charters Union of Business!*

Charters Union is an industry-led institution providing high-impact, experiential business programs:

🎓 *Available Programs:*
• *CBA™ (Certified Business Accountant)* — 7 Months / 2 Years (Avg CTC: 26.5 LPA)
• *DGM™ (Digital Growth & Marketing)* — 7 Months (Avg CTC: 24.5 LPA)
• *TBM™ (Technology & Business Management)* — 12-18 Months (Avg CTC: 38.5 LPA)

💡 *Key Benefits:*
• 100% Paid Internships & Top MNC placements (95%+)
• Global exposure across 7 countries (USA, Dubai, Singapore, etc.)
• No-cost EMI starting at ₹5,555/month & scholarships up to ₹16,000

Feel free to ask about fees, placements, or admission eligibility for any program!`;
}

/* ================================================================
   MAIN INBOUND REPLY ENGINE
================================================================ */
async function replyEngine(msg, user, intent = "OTHER", options = {}) {
  const rawBody = String(msg.body || msg.caption || "").trim();
  const q = rawBody.toLowerCase().trim();
  const isGroup = options.isGroup || false;
  const phone = String(user || "").split("@")[0].replace(/\D/g, "");
  const status = user ? (tracker.getStatus(user) || {}) : {};
  const userName = options.senderName || status.name || "";

  // 1. Opt-out check
  if (!isGroup && /^(stop|unsubscribe|optout|remove me)/.test(q)) {
    return "You have been unsubscribed from follow-ups. Reply anytime if you'd like more details.";
  }

  // 2. Strict Domain Guardrails
  if (isOffTopicQuery(q)) {
    const deflection = getGuardrailDeflection(userName);
    return `${deflection}${buildAdmissionFooter(phone, isGroup)}`;
  }

  // 3. Greetings
  if (/^(hi|hello|hey|namaste|hii|helo|good morning|good evening)\b/.test(q) && q.split(" ").length <= 3) {
    const nameStr = userName ? ` *${userName.split(" ")[0]}*` : "";
    return `👋 *Hello${nameStr}! Welcome to Charters Union of Business.*

I am *Ragini*, your AI Admission Counselor. I can assist you with:

🎓 *Programs & Curriculums* (CBA™, DGM™, TBM™)
💰 *Fees, Scholarships & EMI Options*
📈 *Placement Statistics & Salary Outcomes*
📝 *3-Step Admission Process*

How can I help you with your career goals today?${buildAdmissionFooter(phone, isGroup)}`;
  }

  // 4. Detect program from question
  const program = findProgram(q);

  // 5. General Programs list inquiry
  if (!program && (q === "programs" || q === "courses" || q.includes("what courses") || q.includes("available programs") || q.includes("what do you offer"))) {
    const pList = (chartersKnowledge.programs || []).map(p => 
      `🎓 *${p.name}*\n⏳ Duration: ${p.duration} | 💻 ${p.format}\n🏆 Avg CTC: ${p.placement?.average_ctc || "25+ LPA"}`
    ).join("\n\n");

    return `📚 *Programs at Charters Union*\n\n${pList}\n\n💬 *Reply with any program name (e.g., CBA, DGM, or TBM) for complete details!*${buildAdmissionFooter(phone, isGroup)}`;
  }

  // 6. Instant fact reply for specific program questions
  if (program) {
    const fact = getFactReply(q, program, userName);
    if (fact) {
      return `${fact}${buildAdmissionFooter(phone, isGroup)}`;
    }
  }

  // 7. General AI dynamic reply
  const aiAnswerText = await getAIReply(rawBody, program, userName, isGroup);
  return `${aiAnswerText}${buildAdmissionFooter(phone, isGroup)}`;
}

module.exports = replyEngine;