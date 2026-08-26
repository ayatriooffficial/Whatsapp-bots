require("dotenv").config();
const chartersKnowledge = require("./data/chartersKnowledge.json");
const findProgram = require("./services/findProgram");
const askAI = require("./services/aiReply");
const tracker = require("./services/engagementTracker");
const { getWebsiteContext } = require("./services/websiteContext");

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
    return `\n\n────────────────────────────\n*Admissions Helpline:* ${HELPLINE_PHONE} | *Apply:* ${APPLY_URL}`;
  }

  const cleanPhoneDigits = String(phone || "").replace(/\D/g, "");
  const applyLink = cleanPhoneDigits ? `${APP_BASE_URL}/a/${cleanPhoneDigits}` : APPLY_URL;

  return `\n\n────────────────────────────
*Need personalized career guidance?*
Our admission experts can help you choose the right path.

*Talk to Us:* ${HELPLINE_PHONE}
*Join WhatsApp Group:* ${WHATSAPP_GROUP_URL}
*Apply Now:* ${applyLink}`;
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
   GEMINI AI DYNAMIC REPLIES
================================================================ */
async function getAIReply(question, program = null, userName = "there", isGroup = false) {
  const firstName = (userName || "there").split(" ")[0];

  let liveContextText = "";
  try {
    const ws = await getWebsiteContext();
    if (ws && ws.context) {
      liveContextText = ws.context;
    }
  } catch (_) {}

  const knowledgeBaseText = liveContextText
    ? `=== LIVE CHARTERS UNION KNOWLEDGE BASE (from chartersunion.com) ===\n${liveContextText}`
    : `CHARTERS UNION VERIFIED KNOWLEDGE BASE:\n${JSON.stringify(chartersKnowledge, null, 2)}`;

  const systemInstruction = `You are Ragini, the dedicated AI Admission Counselor for Charters Union of Business (also referred to as Charters Business College).

${knowledgeBaseText}

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
2. Structure for counselor replies:
   - Greet the student warmly
   - Provide direct, concise answers grounded in live website data
   - Highlight practical simulations, 1:1 CXO mentors, and 100% in-class paid internships across 7 countries
   - Conclude with a warm invitation to ask about specific programs, fees, or placements.
3. Keep the total response concise, structured, and easy to read on mobile screens (under ${isGroup ? 180 : 250} words).`;

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

Charters Union is an industry-led institution providing high-impact, experiential career programs (*CBA™*, *DGM™*, *TBM™*).

💡 *Core Highlights:*
• 100% In-Class Paid Internships across 7 countries (USA, Dubai, Singapore, etc.)
• 1:1 Mentorship from top 1% CA/CMA/CFA professionals & Fortune 500 CXOs
• AI Career Engine real-time skill-gap tracking & mock interview scoring
• Flexible financing: Merit Scholarships and No-Cost EMI options available

Feel free to ask any question regarding our programs, syllabus, fees, or placement outcomes!`;
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

  // 5. Inquire program dynamically via Gemini RAG
  const aiAnswerText = await getAIReply(rawBody, program, userName, isGroup);
  return `${aiAnswerText}${buildAdmissionFooter(phone, isGroup)}`;
}

module.exports = replyEngine;