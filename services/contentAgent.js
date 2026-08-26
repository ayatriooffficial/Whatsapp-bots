require("dotenv").config();

const askAI = require("./aiReply");
const detectIntent = require("./detectIntent");
const findProgram = require("./findProgram");
const { resolveSlotTemplate } = require("./messageTemplates");
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
  const resolved = await resolveSlotTemplate(loadSheet, {
    name: lead.name || "there",
    course: lead.course || "",
    score: lead.score || 0,
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
 * Mirrors the email system's BOLD_KEYWORDS + word-boundary logic so
 * short keywords (EY, PwC, GST, TDS, Meta) don't false-match inside
 * words, and every bold is a clean single *keyword*.
 */
const BOLD_KEYWORDS = [
  "CBA™", "DGM™", "TBM™", "Certified Business Accountant", "Digital Growth & Marketing",
  "Technology & Business Management", "AI Career Engine", "7 countries", "7 Countries",
  "100% In-Class Paid Internships", "in-class paid internships", "SAP S/4HANA", "TallyPrime",
  "GST", "TDS", "GA4", "Meta", "Google Ads", "ROAS", "KPMG", "PwC", "EY", "Deloitte",
  "Saudi Aramco", "₹5,555", "₹16,000", "No-Cost EMI", "scholarship", "Scholarship",
  "97.7%", "92%", "98%", "95%", "placement rate", "Placement Rate", "26.5 LPA", "24.5 LPA",
  "38.5 LPA", "CTC", "salary jump", "Salary Jump"
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boldWhatsAppKeywords(text) {
  if (!text || typeof text !== "string") return "";

  // Split into segments: existing *bold* spans stay untouched; only the
  // plain-text segments get keyword bolding. This prevents re-bolding a
  // keyword that already sits inside a bolded heading/span.
  const segments = String(text).split(/(\*[^*]+\*)/g);
  const sorted = [...BOLD_KEYWORDS].sort((a, b) => b.length - a.length);

  const boldSegment = (seg) => {
    let out = seg;
    for (const kw of sorted) {
      const needsWordBoundary = kw.replace(/[^a-zA-Z0-9]/g, "").length <= 4;
      const escaped = escapeRegex(kw);
      // Don't match if the keyword is adjacent to (or inside) an existing
      // bold boundary on either side.
      const pattern = needsWordBoundary
        ? `(?<![\\w*])${escaped}(?![\\w*])`
        : `${escaped}`;
      const re = new RegExp(`(?<![\\w*])${pattern}(?![\\w*])`, "gi");
      out = out.replace(re, `*${kw}*`);
    }
    return out;
  };

  return segments.map((p) => (p.startsWith("*") && p.endsWith("*") ? p : boldSegment(p))).join("");
}

function buildSingleLineFooter() {
  return `*Visit:* ${OFFICIAL_SITE} | *Apply:* ${APPLY_URL} | *Call:* ${HELPLINE_PHONE}`;
}

// ─── PURE AI STAGE GENERATOR ──────────────────────────────────────────────

/**
 * WhatsApp-Owned Stage Behavioral Directives (Zero Hardcoded Facts):
 * All curriculum tools, recruiters, placement stats, and fees are extracted
 * dynamically by the AI from LIVE WEBSITE DATA (chartersunion.com/api/website-data).
 */
function getStageFramework(day = 1, slot = 1) {
  if (day === 1 && slot === 1) {
    return {
      stage: "1_AWARENESS",
      goal: "1:1 Tool Diagnostic & Practical Career Roadmap",
      directive: "Open as an admissions counselor checking in on the student's practical tool baseline. Contrast theoretical college exams with the live practical tools found in LIVE WEBSITE DATA. Invite them to explore the career roadmap. ZERO enrollment push, NO pricing.",
      pointsHeading: "*What corporate interviews actually test:*",
      solutionDirective: "The SOLUTION line (1 tight line): how Charters Union fixes this — supervised live-tool execution on the exact tools named in LIVE WEBSITE DATA, plus the guaranteed 100% in-class paid internship across 7 countries.",
      ctaDirective: `Explore the complete tool roadmap: ${OFFICIAL_SITE}/career-path`
    };
  }

  if (day === 1 && slot === 2) {
    return {
      stage: "1_AWARENESS",
      goal: "Day-in-the-Life & Practical Weekly Structure",
      directive: "Describe a typical week in the cohort using the curriculum and format from LIVE WEBSITE DATA (contrast practical lab execution with passive lectures). Mention the 100% in-class paid internship across 7 countries.",
      pointsHeading: "*Your typical week in the cohort:*",
      solutionDirective: "The SOLUTION line (1 tight line): at Charters Union the week IS the internship — every day is structured hands-on corporate work (labs Mon-Thu, boardroom polish Friday), so students graduate with real execution hours, not just notes.",
      ctaDirective: `Reply *WEEK* if you'd like to see the full weekly schedule breakdown.`
    };
  }

  if (day === 2 && slot === 1) {
    return {
      stage: "2_ENGAGEMENT",
      goal: "Single Verified Proof Byte & Hiring Outcomes",
      directive: "Deliver hard outcome proof using ONLY the placement rate, average CTC, and named top recruiters from LIVE WEBSITE DATA. Keep it tight and credible.",
      pointsHeading: "*Session Focus:*",
      solutionDirective: "The SOLUTION line (1 tight line): connecting that proof to Charters Union — these verified placement outcomes are exactly what the cohort achieves, and the student can be part of it.",
      ctaDirective: `Reply *PROOF* to see the audited recruiter list and verified salary benchmarks.`
    };
  }

  if (day === 2 && slot === 2) {
    return {
      stage: "2_ENGAGEMENT",
      goal: "1:1 Industry Mentorship Model",
      directive: "Highlight the 1:1 mentorship model with practicing industry leaders and mock interview simulations from LIVE WEBSITE DATA.",
      pointsHeading: "*How the mentorship works:*",
      solutionDirective: "The SOLUTION line (1 tight line): Charters Union pairs every student with a practicing industry mentor (CA/CMA partner or Growth Head/CMO) for 1:1 mock interviews and career mapping until placement-ready.",
      ctaDirective: `Reply *CALL* or call us directly: ${HELPLINE_PHONE}`
    };
  }

  if (day === 3 && slot === 1) {
    return {
      stage: "3_CONVERSION",
      goal: "Plain-Language Logistics, Schedule & Flexible Financing",
      directive: "Provide transparent cohort logistics from LIVE WEBSITE DATA: batch start timing, flexible hybrid schedule, and starting No-Cost EMI / scholarship funding from LIVE WEBSITE DATA.",
      pointsHeading: "*What's included in this batch:*",
      solutionDirective: "The SOLUTION line (1 tight line): removing financial friction — Charters Union's No-Cost EMI from ₹5,555/month and merit scholarships up to ₹16,000 (figures from LIVE WEBSITE DATA) make the program accessible now.",
      ctaDirective: `Reply *ELIGIBLE* to check your merit scholarship bracket.`
    };
  }

  // Day 3 Slot 2
  return {
    stage: "3_CONVERSION",
    goal: "Round 1 Fast-Track Seat Allocation Notice",
    directive: "Provide a transparent admissions closing notice for Round 1 from LIVE WEBSITE DATA. Outline the 3-step evaluation (Online Application -> AI Aptitude Test -> 1:1 Mentor Interview).",
    pointsHeading: "*Your 3-step path to a seat:*",
    solutionDirective: "The SOLUTION line (1 tight line): Round 1 seats are allocated first-come — a 3-step application (form -> AI aptitude test -> 1:1 interview) locks the student's place.",
    ctaDirective: `Lock your seat: ${APPLY_URL} | Call: ${HELPLINE_PHONE}`
  };
}

/**
 * Generates a full Pure AI WhatsApp campaign message grounded in live website data.
 */
async function generateDynamicWhatsAppMessage({ name = "Candidate", course = "CBA", day = 1, slot = 1 }) {
  const firstName = titleCase(name || "there").split(" ")[0];
  const greetingName = firstName.toLowerCase() === "there" ? "Candidate" : firstName;
  const targetCourse = String(course || "CBA").toUpperCase();

  const websiteData = await getWebsiteContext(targetCourse);
  const websiteContextText = websiteData?.context || "";
  const framework = getStageFramework(day, slot);

  const prompt = `
You are a senior WhatsApp admissions counselor at Charters Union.
Write ONE direct, human 1:1 WhatsApp message for ${greetingName} regarding the ${targetCourse} program.

=== CHANNEL SEPARATION (MANDATORY) ===
Email already covers macro degree gaps, comparison tables, and formal scholarship essays.
You MUST NOT write about those email-owned topics.
You MUST write exclusively about WhatsApp's unique angle:
- Stage: ${framework.stage} (Day ${day}, Slot ${slot})
- Behavioral Goal: ${framework.goal}
- Copywriting Directive: ${framework.directive}

=== LIVE WEBSITE DATA (PRIMARY SOURCE OF TRUTH) ===
${websiteContextText || "Charters Union offers CBA and DGM with 100% in-class paid internships across 7 countries and top MNC placements."}

=== OUTPUT FORMAT (JSON ONLY) ===
{
  "intro": "1 line greeting for ${greetingName}, e.g. 'Dear ${greetingName},' or 'Hi ${greetingName},' — warm and personal, NOT just the bare name",
  "body": "2 concise conversational sentences opening the topic directly to ${greetingName} based on the directive and LIVE WEBSITE DATA (NO fake quote box)",
  "pointsHeading": "${framework.pointsHeading} — the bold section heading introducing the key points (keep exactly this heading)",
  "keyPoints": [
    "• *BOLD HEADING 1:* Practical tool/feature extracted directly from LIVE WEBSITE DATA",
    "• *BOLD HEADING 2:* Real practical fact or placement metric extracted from LIVE WEBSITE DATA"
  ],
  "solution": "The SOLUTION line (1 tight line) — how Charters Union fixes this specific concern, per the solution directive below",
  "callToAction": "${framework.ctaDirective}"
}

=== SOLUTION DIRECTIVE ===
${framework.solutionDirective}

CRITICAL RULES:
- Output valid JSON only.
- NO artificial quote blocks (>). Open directly with natural counselor conversation.
- The message MUST contain all 6 parts in this exact order: intro, body, pointsHeading, keyPoints, solution, callToAction, footer.
- pointsHeading is a standalone bold line above the keyPoints (e.g. "*Session Focus:*") — use the provided heading.
- Every keyPoint MUST start with "• *BOLD HEADING:*" — the heading is the topic (e.g. *SAP S/4HANA*, *Placement Rate*, *Mon–Thu Labs*) in bold, followed by a colon and the detail. NO keyPoint without a bold heading.
- Extract ALL tools, recruiters, curriculum modules, and fees strictly from the LIVE WEBSITE DATA above.
- Use only real URLs: ${OFFICIAL_SITE}, ${OFFICIAL_SITE}/career-path, ${APPLY_URL}.
- Keep total message under 110 words.
- Use native WhatsApp bolding (*text*).
`;

  let parsed = null;
  try {
    const raw = await askAI(prompt);
    const jsonMatch = raw ? raw.match(/\{[\s\S]*\}/) : null;
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn("⚠️ WhatsApp AI generation fallback notice:", err.message);
  }

  // Dynamic fallback synthesis from live website data (Zero hardcoded text)
  const p = websiteData?.program || {};
  const placement = websiteData?.placement || {};
  const fees = websiteData?.fees || {};

  const dynamicOpening = `Admissions team at Charters Union here. Following up regarding your interest in our ${p.name || targetCourse} cohort.`;
  const dynamicBullets = [];

  if (p.curriculum && Array.isArray(p.curriculum) && p.curriculum.length > 0) {
    const mod1 = p.curriculum[0];
    dynamicBullets.push(`• *${mod1.title || "Core Curriculum"}:* ${mod1.skills ? mod1.skills.slice(0, 3).join(", ") : "Hands-on tool mastery"}.`);
  }
  if (placement.top_recruiters && Array.isArray(placement.top_recruiters) && placement.top_recruiters.length > 0) {
    dynamicBullets.push(`• *Top Recruiters:* Direct hires at ${placement.top_recruiters.slice(0, 4).join(", ")}.`);
  }
  if (dynamicBullets.length === 0) {
    dynamicBullets.push(`• *100% In-Class Paid Internships:* Practical industry execution across 7 countries.`);
  }

  const dynamicSolution = fees?.emi_start
    ? `At Charters Union, the ${p.name || targetCourse} program pairs ${fees.emi_start ? `No-Cost EMI from ${fees.emi_start}` : "flexible financing"} with hands-on tool mastery so you can start now.`
    : `At Charters Union, the ${p.name || targetCourse} program turns theory into hands-on corporate execution from Day 1.`;

  const intro = parsed?.intro || `Dear *${greetingName}*,`;
  const opening = parsed?.body || parsed?.counselorOpening || dynamicOpening;
  const pointsHeading = parsed?.pointsHeading || framework.pointsHeading || "";
  const bullets = Array.isArray(parsed?.keyPoints) && parsed.keyPoints.length
    ? parsed.keyPoints
    : (Array.isArray(parsed?.bulletPoints) && parsed.bulletPoints.length ? parsed.bulletPoints : dynamicBullets);
  const solution = parsed?.solution || dynamicSolution;
  const cta = parsed?.callToAction || framework.ctaDirective;

  const messageParts = [
    intro,                              // 1. INTRO
    opening,                            // 2. BODY
    pointsHeading,                      // 3. POINTS HEADING (section heading above bullets)
    bullets && bullets.length ? bullets.join("\n") : "",  // 4. KEY POINTS
    solution,                           // 5. SOLUTION
    cta,                                // CTA
    buildSingleLineFooter()             // 6. FOOTER
  ].filter(Boolean);

  const rawMessage = messageParts.join("\n\n");
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
