require("dotenv").config();

const askAI = require("./aiReply");
const detectIntent = require("./detectIntent");
const findProgram = require("./findProgram");
const { resolveTemplate } = require("./messageTemplates");
const { getWebsiteContext } = require("./websiteContext");

const HELPLINE_PHONE = process.env.SUPPORT_PHONE || "+91 9836465083";
const OFFICIAL_SITE = "chartersunion.com";
const APPLY_URL = "chartersunion.com/apply";

/* =========================================================
   MESSAGES-TAB TEMPLATE LOOKUP (Google Sheets)
   If the Messages tab has an approved template for that slot,
   it is used directly. Otherwise, Pure AI generates the copy.
========================================================= */

async function templateContent(lead, opts = {}) {
  const { loadSheet } = require("./sheetService");
  const resolved = await resolveTemplate(loadSheet, {
    name: lead.name || "there",
    course: lead.course || "",
    score: lead.score || 0,
    session: lead.session || opts.session || 1,
    day: opts.day,
    slot: opts.slot,
  });
  if (resolved) {
    console.log(`📄 [template] Used approved template from sheet: ${resolved.source || "Messages tab"}`);
    return resolved.content;
  }
  return null;
}

// ─── UTILITIES & FORMATTING ────────────────────────────────────────────────

function safeText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function cleanQuestion(text) {
  return safeText(text).replace(/\s+/g, " ").trim();
}

function titleCase(text) {
  return safeText(text).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Deterministic keyword bolding for WhatsApp (*word* format).
 * Bolds recruiter brands, tools, placement stats, and pricing.
 */
function boldWhatsAppKeywords(text) {
  if (!text || typeof text !== "string") return "";

  const KEYWORDS = [
    "KPMG", "PwC", "EY", "Deloitte", "Saudi Aramco", "CBD Accounting",
    "Amazon", "Google", "Flipkart", "Zomato", "GrowthX", "TATA",
    "SAP S/4HANA", "TallyPrime", "GA4", "Mixpanel", "Meta Ads", "Google Ads",
    "₹5,555", "₹5,555/mo", "₹16,000", "92%", "95%", "97.7%", "24.5 LPA", "7 Months",
    "Charters Union", "CBA™", "DGM™", "TBM™"
  ];

  let result = text;
  for (const kw of KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Only bold if not already preceded or followed by an asterisk
    const regex = new RegExp(`(?<![*\\w])(${escaped})(?![*\\w])`, "g");
    result = result.replace(regex, `*$1*`);
  }

  // Clean any nested/adjacent asterisks (*word1 *word2* -> *word1 word2*)
  result = result.replace(/\*{2,}/g, "*");
  result = result.replace(/\*\s+\*/g, " ");
  return result;
}

function buildSingleLineFooter() {
  return `🌐 *Visit:* ${OFFICIAL_SITE} | 📝 *Apply:* ${APPLY_URL} | 📞 *Call:* ${HELPLINE_PHONE}`;
}

// ─── PURE AI STAGE GENERATOR ──────────────────────────────────────────────

/**
 * Stage-specific copywriting frameworks for 3-Day WhatsApp sequence:
 * Day 1 (Awareness): Problem Quote + Degree vs Tool Gap + Curiosity
 * Day 2 (Engagement): Verified Proof + Real Simulations + Reply Invite
 * Day 3 (Conversion): Scholarship Breakdown + 3-Step Admission + Urgency
 */
function getStageFramework(day = 1, slot = 1, course = "CBA") {
  const isDGM = String(course || "").toUpperCase().includes("DGM") || String(course || "").toUpperCase().includes("MARKETING");
  const courseLabel = isDGM ? "Digital Growth & Marketing (DGM™)" : "Certified Business Accountant (CBA™)";

  if (day === 1) {
    return {
      stage: "Awareness",
      goal: "Hook with the standard degree gap vs real corporate tool requirements.",
      angle: isDGM
        ? "College taught marketing theories, but hiring managers demand proof of live Meta/Google ad spend and ROAS."
        : "College exams passed, but candidates freeze when asked for live SAP S/4HANA ledger closing and GST filing.",
      ctaQuestion: "_Would you like to check your AI Career-Readiness Score this week?_"
    };
  }

  if (day === 2) {
    return {
      stage: "Engagement",
      goal: "Demonstrate verified proof, placement records, and mentor oversight.",
      angle: isDGM
        ? "Why believe promises? Review our verified placement records at Google, Amazon, Flipkart, and GrowthX."
        : "Why believe promises? Review our verified Big 4 placement records at KPMG, PwC, EY, Deloitte, and Saudi Aramco.",
      ctaQuestion: "_Would you like us to send the graduate placement report PDF?_"
    };
  }

  // Day 3 (Conversion)
  return {
    stage: "Conversion",
    goal: "Accessible financial roadmap, merit scholarships, and simple 3-step admission.",
    angle: slot === 1
      ? "Zero-risk financial roadmap with No-Cost EMI starting from ₹5,555/mo and up to ₹16,000 merit scholarships."
      : "Round 1 admissions closing soon — only 3 simple steps to lock your seat with 100% in-class paid internship.",
    ctaQuestion: "_Would you like to verify your scholarship eligibility in 2 minutes?_"
  };
}

/**
 * Generates a full Pure AI WhatsApp campaign message grounded in live website data.
 */
async function generateDynamicWhatsAppMessage({ name = "Candidate", course = "CBA", day = 1, slot = 1 }) {
  const firstName = titleCase(name || "there").split(" ")[0];
  const greetingName = firstName.toLowerCase() === "there" ? "Candidate" : firstName;
  const isDGM = String(course || "").toUpperCase().includes("DGM") || String(course || "").toUpperCase().includes("MARKETING");
  const courseCode = isDGM ? "DGM" : "CBA";

  const { context: websiteContextText } = await getWebsiteContext(courseCode);
  const framework = getStageFramework(day, slot, courseCode);

  const prompt = `
You are a senior WhatsApp admissions counselor at Charters Union.
Write ONE high-converting, mobile-first WhatsApp campaign message for ${greetingName} promoting ${courseCode}™ (${isDGM ? "Digital Growth & Marketing" : "Certified Business Accountant"}).

=== LIVE WEBSITE DATA (PRIMARY SOURCE OF TRUTH) ===
${websiteContextText || "Charters Union offers CBA and DGM with 100% in-class paid internships across 7 countries and top MNC placements."}

=== CAMPAIGN SPECIFICATIONS ===
- Day: ${day}, Slot: ${slot} (Stage: ${framework.stage})
- Focus Angle: ${framework.angle}
- Audience: Ambitious commerce/marketing graduate looking for practical corporate launch

=== OUTPUT FORMAT (JSON ONLY) ===
{
  "quoteBlock": "2-line student problem quote describing standard degree theory vs corporate tool gap (without >)",
  "bridge": "At Charters Union, we bridge the degree-to-corporate gap through hands-on execution:",
  "sectionHeading": "*Why Top ${isDGM ? "Brands" : "Recruiters"} Hire ${courseCode}™ Graduates:*",
  "bulletPoints": [
    "• *${isDGM ? "Live Performance Labs" : "SAP S/4HANA & TallyPrime"}:* Concrete hands-on tool outcome",
    "• *${isDGM ? "AI Marketing Stack" : "Tax Compliance Lab"}:* Real practical simulation outcome",
    "• *100% In-Class Paid Internships:* Supervised client projects across 7 countries"
  ],
  "closingQuestion": "${framework.ctaQuestion}"
}

CRITICAL RULES:
- Output valid JSON only.
- Ground all facts in the LIVE WEBSITE DATA above. No fake names, no fake salaries.
- Keep bullets punchy, under 18 words each.
- Use native WhatsApp bolding (*text*).
`;

  let parsed = null;
  try {
    const raw = await askAI(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn("⚠️ WhatsApp AI generation fallback notice:", err.message);
  }

  // Pure dynamic assembly
  const quote = parsed?.quoteBlock || framework.angle;
  const bridge = parsed?.bridge || "At Charters Union, we bridge the degree-to-corporate gap through hands-on execution:";
  const sectionHeading = parsed?.sectionHeading || `*Why Top Recruiters Hire ${courseCode}™ Graduates:*`;
  const bullets = Array.isArray(parsed?.bulletPoints) && parsed.bulletPoints.length
    ? parsed.bulletPoints
    : [
        isDGM
          ? "• *Supervised Live Ad Spend:* Run real Meta & Google ad budgets with ROAS targets."
          : "• *SAP S/4HANA & TallyPrime:* End-to-end ledger closing & live GST return filing.",
        isDGM
          ? "• *AI Marketing Stack:* Build automated content & GA4 analytics pipelines."
          : "• *Tax Compliance Lab:* Corporate TDS, TCS, and GST audit defense simulations.",
        "• *100% In-Class Paid Internship:* Practical execution across 7 countries with verified placement outcomes."
      ];
  const closingQuestion = parsed?.closingQuestion || framework.ctaQuestion;

  const rawMessage = [
    `*${greetingName} ji,*`,
    `> ${quote}`,
    bridge,
    sectionHeading,
    bullets.join("\n"),
    closingQuestion,
    buildSingleLineFooter()
  ].join("\n\n");

  return boldWhatsAppKeywords(rawMessage);
}

// ─── OUTBOUND / INBOUND ROUTING ───────────────────────────────────────────

async function generateIntroContent(name = "there", course = "", phone = "", viewerLevel = "NO_ACTIVITY") {
  const template = await templateContent({ name, course, score: 0, session: 1 }, { session: 1, day: 1, slot: 1 });
  if (template) return template;
  return await generateDynamicWhatsAppMessage({ name, course, day: 1, slot: 1 });
}

async function generateFollowupContent(context, course, phone, viewerLevel = "NO_ACTIVITY", name = "there", session = 1, question = null) {
  const day = Math.min(3, Math.floor((session - 1) / 2) + 1);
  const slot = ((session - 1) % 2) + 1;

  const template = await templateContent({ name, course, score: 0, session }, { session, day, slot });
  if (template) return template;

  return await generateDynamicWhatsAppMessage({ name, course, day, slot });
}

async function generateProgramContent(userMessage, options = {}) {
  const course = options.course || "CBA";
  const name = options.name || "Candidate";
  const question = cleanQuestion(userMessage);

  const { context: websiteContextText } = await getWebsiteContext(course);

  const prompt = `
You are a friendly, helpful admissions mentor at Charters Union responding on WhatsApp.
Candidate Name: ${name}
Course: ${course}
Their Message/Question: "${question}"

=== LIVE WEBSITE DATA ===
${websiteContextText || "Charters Union offers industry-led CBA and DGM programs with 100% in-class paid internships."}

Format rules:
- Start with a direct, helpful 1-2 sentence answer.
- 2-3 short bullet points highlighting the real curriculum, tools, or placements.
- End with an interactive question asking if they want to see the brochure or fee breakdown.
- Include single-line footer: ${buildSingleLineFooter()}
- Use WhatsApp bolding (*text*) and clean single-line formatting.
`;

  try {
    const raw = await askAI(prompt);
    return boldWhatsAppKeywords(raw);
  } catch (err) {
    return boldWhatsAppKeywords(
      `Hi *${name}*, thank you for reaching out to *Charters Union*!\n\nOur *${course}* program features live tools (SAP S/4HANA / Meta Ads), *100% In-Class Paid Internships* across 7 countries, and Big 4 placements.\n\n_Would you like us to send the full syllabus and fee breakdown PDF?_\n\n${buildSingleLineFooter()}`
    );
  }
}

module.exports = {
  generateIntroContent,
  generateFollowupContent,
  generateProgramContent,
  generateDynamicWhatsAppMessage,
  boldWhatsAppKeywords,
  buildSingleLineFooter
};
