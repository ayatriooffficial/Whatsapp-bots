require("dotenv").config();

const askAI = require("./aiReply");
const detectIntent = require("./detectIntent");
const findProgram = require("./findProgram");
const { resolveTemplate } = require("./messageTemplates");
const { programs, faculty, institute, home } = require("./dataLoader");
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "+91XXXXXXXXXX";

/* =========================================================
   MESSAGES-TAB TEMPLATE LOOKUP (primary content source)
   If the Messages tab has a matching template (course+session+score),
   it is used instead of AI generation. Edits in the sheet change
   the bot's messages without any code change.
========================================================= */

async function templateContent(lead, opts = {}) {
  const { loadSheet } = require("./sheetService");
  const resolved = await resolveTemplate(loadSheet, {
    name: lead.name || "there",
    course: lead.course || "",
    score: lead.score || 0,
    session: lead.session || opts.session || 1,
  });
  if (resolved) {
    console.log(`📄 [template] ${resolved.source}`);
    return resolved.content;
  }
  return null;
}

// ─── UTILITY ───────────────────────────────────────────────────────────────

function safeText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function safeJoin(value, limit = 0) {
  const items = Array.isArray(value) ? value.filter(Boolean) : [];
  const sliced = limit > 0 ? items.slice(0, limit) : items;
  return sliced.join(", ");
}

function cleanQuestion(text) {
  return safeText(text).replace(/\s+/g, " ").trim();
}

function titleCase(text) {
  return safeText(text).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function hashSeed(input) {
  const text = safeText(input) || "seed";
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildSeed(parts) {
  return hashSeed(parts.filter(Boolean).join("|"));
}

function pickVariant(items, seed, offset = 0) {
  if (!Array.isArray(items) || !items.length) return "";
  return items[(seed + offset) % items.length];
}

function dedupe(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const value = safeText(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

// ─── PROGRAM HELPERS ───────────────────────────────────────────────────────

function getPlacement(program) {
  return program?.placement || program?.career_growth || {};
}

function summarizeProgram(program) {
  if (!program) return null;
  const placement = getPlacement(program);
  return {
    name: program.name,
    duration: program.duration,
    format: program.format,
    emi: program.fees?.emi_start || "",
    placement: placement.placement_rate || placement.promotion_rate || ""
  };
}

function getProgramStats(program) {
  const placement = getPlacement(program);
  if (!program) {
    return [
      home?.placement_highlights?.highest_ctc ? `🏆 Highest CTC: ${home.placement_highlights.highest_ctc}` : null,
      home?.placement_highlights?.average_ctc ? `💼 Average CTC: ${home.placement_highlights.average_ctc}` : null,
      "📈 Placement Rate: 95%",
      home?.placement_highlights?.recruiters ? `🏢 Recruiters: ${home.placement_highlights.recruiters}` : null
    ].filter(Boolean);
  }
  return [
    placement.placement_rate ? `📈 Placement Rate: ${placement.placement_rate}` : null,
    placement.promotion_rate ? `📊 Promotion Rate: ${placement.promotion_rate}` : null,
    placement.average_ctc ? `💼 Average CTC: ${placement.average_ctc}` : null,
    placement.salary_range ? `💰 Salary Range: ${placement.salary_range}` : null,
    program.start_date ? `📅 Next Batch: ${program.start_date}` : null
  ].filter(Boolean);
}

// ─── VIEWER PROFILE ────────────────────────────────────────────────────────

function getViewerProfile(viewerLevel) {
  const profiles = {
    HOT: { tone: "confident and direct" },
    WARM: { tone: "helpful and specific" },
    COLD: { tone: "simple and trust-building" },
    NO_ACTIVITY: { tone: "friendly and informative" }
  };
  return profiles[viewerLevel] || profiles.NO_ACTIVITY;
}

// ─── INTENT → BULLETS MAP ─────────────────────────────────────────────────

function getQuestionInsight(intent, program) {
  const placement = getPlacement(program);
  const isWeekendFriendly = safeText(program?.format).toLowerCase().includes("weekend");

  const map = {
    ASK_DURATION: {
      heading: "Program Duration and Format",
      bullets: dedupe([
        program?.duration ? `⏳ *Duration:* ${program.duration}` : "",
        program?.format ? `💻 *Format:* ${program.format}` : "",
        program?.start_date ? `📅 *Next batch:* ${program.start_date}` : "",
        isWeekendFriendly ? "✅ *Schedule:* suitable for working professionals" : ""
      ])
    },
    ASK_FEE: {
      heading: "Fees and Payment Options",
      bullets: dedupe([
        program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
        program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
        program?.fees?.no_cost_emi ? `✅ *Flexible plans:* ${program.fees.no_cost_emi}` : "",
        program?.fees?.seat_booking ? `🔒 *Seat booking:* ${program.fees.seat_booking}` : ""
      ])
    },
    ASK_PLACEMENT: {
      heading: "Placement Outcomes",
      bullets: dedupe([
        placement.placement_rate ? `📈 *Placement rate:* ${placement.placement_rate}` : "",
        placement.promotion_rate ? `📊 *Promotion rate:* ${placement.promotion_rate}` : "",
        placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
        placement.salary_range ? `💰 *Salary range:* ${placement.salary_range}` : ""
      ])
    },
    ASK_PROGRAM: {
      heading: "Program Overview",
      bullets: dedupe([
        program?.duration ? `⏳ *Duration:* ${program.duration}` : "",
        program?.format ? `💻 *Format:* ${program.format}` : "",
        program?.eligibility ? `📋 *Eligibility:* ${program.eligibility}` : "",
        program?.career_roles?.length ? `🎯 *Career roles:* ${program.career_roles.slice(0, 3).join(", ")}` : ""
      ])
    },
    ASK_ELIGIBILITY: {
      heading: "Eligibility Details",
      bullets: dedupe([
        program?.eligibility ? `📋 *Eligibility:* ${program.eligibility}` : "",
        program?.start_date ? `📅 *Upcoming batch:* ${program.start_date}` : ""
      ])
    },
    ASK_ADMISSION: {
      heading: "Admission Details",
      bullets: dedupe([
        program?.start_date ? `📅 *Upcoming batch:* ${program.start_date}` : "",
        program?.fees?.seat_booking ? `🔒 *Seat booking:* ${program.fees.seat_booking}` : ""
      ])
    },
    ASK_FACULTY: {
      heading: "Faculty Highlights",
      bullets: dedupe([
        faculty?.top_institutions?.length
          ? `👨‍🏫 *Faculty from:* ${safeJoin(faculty.top_institutions, 3)}`
          : ""
      ])
    },
    ASK_GLOBAL: {
      heading: "Global Exposure",
      bullets: dedupe([
        program?.global_exposure?.length
          ? `🌍 *Program exposure:* ${safeJoin(program.global_exposure, 4)}`
          : "",
        institute?.global_presence?.length
          ? `🌐 *Institution reach:* ${safeJoin(institute.global_presence, 5)}`
          : ""
      ])
    },
    SESSION: {
      heading: "Class Schedule and Format",
      bullets: dedupe([
        program?.format ? `💻 *Format:* ${program.format}` : "",
        program?.duration ? `⏳ *Duration:* ${program.duration}` : "",
        program?.start_date ? `📅 *Batch timing:* ${program.start_date}` : ""
      ])
    },
    IRRELEVANT: {
      heading: "How I Can Help",
      bullets: [
        "🎓 *Programs:* MBA, PGDM, and Executive MBA",
        "💰 *Fees & EMI:* payment support and scholarship details",
        "📝 *Admissions:* eligibility, process, and next-step guidance",
        "📈 *Placements:* career outcomes and recruiter information"
      ]
    },
    OTHER: {
      heading: "Key Details",
      bullets: dedupe([
        program?.duration ? `⏳ *Duration:* ${program.duration}` : "",
        program?.format ? `💻 *Format:* ${program.format}` : "",
        program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
        placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : ""
      ])
    }
  };

  return map[intent] || map.OTHER;
}

function resolveQuestionInsight(intent, program) {
  const requestedIntent = safeText(intent || "OTHER").toUpperCase() || "OTHER";
  const requestedInsight = getQuestionInsight(requestedIntent, program);
  const minBulletCount = ["ASK_ADMISSION", "ASK_FACULTY", "ASK_GLOBAL"].includes(requestedIntent) ? 1 : 2;
  const hasAnswerData = requestedIntent !== "IRRELEVANT" && requestedInsight.bullets.length >= minBulletCount;

  if (hasAnswerData) {
    return { intent: requestedIntent, insight: requestedInsight, hasAnswerData: true, usedFallback: false };
  }
  return {
    intent: "IRRELEVANT",
    insight: getQuestionInsight("IRRELEVANT", program),
    hasAnswerData: false,
    usedFallback: true
  };
}

function getQuestionFollowupFrame(intent, program, firstName, session = 1) {
  const placement = getPlacement(program);
  const frames = {
    ASK_FEE: {
      heading: session >= 3 ? "Planning Your Investment" : "Cost to Career Value",
      intro: session >= 3
        ? `${firstName}, many students compare fees with outcomes before applying. That's why scholarship support and career value matter here.`
        : `${firstName}, if fees are on your mind, it helps to look at the support options and expected career upside together.`,
      cta: "💬 If you'd like, I can help you check the best payment path for you."
    },
    ASK_PLACEMENT: {
      heading: session >= 3 ? "Outcome Snapshot" : "Career Return Snapshot",
      intro: `${firstName}, placements become more meaningful when you compare them with program flexibility and the next available intake.`,
      cta: "💬 Reply if you want the role fit or recruiter-side details next."
    },
    ASK_DURATION: {
      heading: "Time and Flexibility",
      intro: `${firstName}, students usually shortlist faster once they see how the schedule fits with career growth and affordability.`,
      cta: "💬 I can also help compare timing, EMI, and outcomes in one message."
    },
    ASK_ADMISSION: {
      heading: "Ready for the Next Step",
      intro: `${firstName}, once eligibility looks clear, the next useful thing is to see the batch timeline and seat-booking details early.`,
      cta: "💬 Reply if you want the quickest way to move ahead."
    },
    ASK_ELIGIBILITY: {
      heading: "Your Fit for the Program",
      intro: `${firstName}, if you're eligible, the smartest next check is usually fees, scholarships, and the upcoming batch timeline.`,
      cta: "💬 I can help you review the next step based on your profile."
    },
    OTHER: {
      heading: "A Better Look at the Program",
      intro: `${firstName}, here are a few practical points that usually help students feel more confident about the next step.`,
      cta: "💬 Reply with any doubt and I'll help you evaluate it clearly."
    }
  };

  const selected = frames[intent] || frames.OTHER;
  const supportiveBullets = {
    ASK_FEE: dedupe([
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : "",
      program?.fees?.seat_booking ? `🔒 *Seat booking:* ${program.fees.seat_booking}` : ""
    ]),
    ASK_PLACEMENT: dedupe([
      program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : "",
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      program?.format ? `💻 *Format:* ${program.format}` : ""
    ]),
    ASK_DURATION: dedupe([
      program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
      placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : ""
    ]),
    ASK_ADMISSION: dedupe([
      program?.fees?.seat_booking ? `🔒 *Seat booking:* ${program.fees.seat_booking}` : "",
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : ""
    ]),
    ASK_ELIGIBILITY: dedupe([
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
      placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : ""
    ]),
    OTHER: dedupe([
      program?.fees?.emi_start ? `💳 *EMI from:* ${program.fees.emi_start}` : "",
      placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
      program?.fees?.scholarship ? `🎓 *Scholarship:* ${program.fees.scholarship}` : "",
      program?.start_date ? `📅 *Next batch:* ${program.start_date}` : ""
    ])
  };

  return {
    heading: selected.heading,
    intro: selected.intro,
    cta: selected.cta,
    bullets: supportiveBullets[intent] || supportiveBullets.OTHER
  };
}

// ─── WHATSAPP FOOTER ───────────────────────────────────────────────────────

function getFooter(phone) {
  const p = String(phone || "").replace("@c.us", "").replace(/\D/g, "");
  return `\n------------------------------\n🎯 *Take the next step toward your career*\n\n🔎 View program details:\n${APP_BASE_URL}/w/${p}\n\n📝 Apply now:\n${APP_BASE_URL}/a/${p}\n\n📞 Guidance & support:\n${SUPPORT_PHONE}\n------------------------------`;
}

function formatBullet(text) {
  const value = safeText(text);
  if (!value) return "";
  const clean = value.replace(/^(?:�\\s*)?/, "");
  const match = clean.match(/^(\S+\s+\*[^*]+\*:?)\s*(.+)$/);
  if (match) {
    const [, label, detail] = match;
    return `${label}\n${detail}`;
  }
  return clean;
}

function renderBulletSection(heading, bullets = []) {
  const lines = (bullets || []).map(formatBullet).filter(Boolean);
  if (!lines.length) return "";
  return `*${heading}*\n\n${lines.join("\n\n")}`;
}

function renderProgramList(programList = []) {
  const lines = (programList || [])
    .filter(item => item?.name)
    .map(item => {
      const shortName =
        item.name.includes("(MBA)") ? "MBA" :
          item.name.includes("(PGDM)") ? "PGDM" :
            item.name.includes("Executive MBA") ? "Executive MBA" :
              item.name;
      const details = [
        safeText(item.duration),
        item.emi ? `EMI from ${item.emi}` : ""
      ].filter(Boolean).join(" | ");
      return [`🎓 *${shortName}*`, details || ""].filter(Boolean).join("\n");
    });

  if (!lines.length) return "";
  return `*Programs:*\n\n${lines.join("\n──────────\n")}`;
}

function renderStatsSection(stats = []) {
  return renderBulletSection("📊 Quick Highlights:", stats);
}

function joinSections(parts = []) {
  return parts.map(part => safeText(part)).filter(Boolean).join("\n\n").trim();
}

function renderIntroMessage(firstName, content) {
  return joinSections([
    `Hello ${firstName} 👋`,
    "*✨ Welcome to Charters Union of Business*",
    content.intro,
    renderBulletSection("Why Students Consider Us:", content.bullets),
    renderStatsSection(content.stats),
    renderProgramList(content.programs),
    "👉 Reply *YES* to learn more."
  ]);
}

function renderFollowupMessage(course, content, phone, includeFooter = false) {
  const label = safeText(course || "our programs");
  return joinSections([
    `👋 Still thinking about *${label}*?`,
    content.intro,
    renderBulletSection(`✨ ${content.heading}:`, content.bullets),
    renderStatsSection(content.stats),
    content.program ? renderProgramList([content.program]) : "",
    content.cta || "💬 Reply with any question and I'll help you decide.",
    includeFooter ? getFooter(phone) : ""
  ]);
}

function renderReplyMessage(content) {
  return joinSections([
    content.intro,
    renderBulletSection(`✨ ${content.heading}:`, content.bullets),
    renderStatsSection(content.stats),
    content.program ? renderProgramList([content.program]) : "",
    "💬 Reply with your next question and I'll help."
  ]);
}

// ─── WHATSAPP MESSAGE FORMATTERS (AI-prompt based, original style) ────────

/**
 * Builds the rich data string passed to AI prompt — same as original buildData()
 * but uses the richer resolved content from the email bot's contentAgent logic.
 */
function buildRichData(program) {
  let ctx = `
Programs offered: ${safeJoin((programs?.programs || []).map(p => p.name))}
Institute overview: ${safeText(institute?.overview)}
Global presence: ${safeJoin(institute?.global_presence)}
Faculty overview: ${safeText(faculty?.faculty_overview)}
Top institutions: ${safeJoin(faculty?.top_institutions)}
Highest CTC: ${safeText(home?.placement_highlights?.highest_ctc)}
Average CTC: ${safeText(home?.placement_highlights?.average_ctc)}
Recruiters: ${safeJoin(home?.placement_highlights?.recruiters)}
  `.trim();

  if (program) {
    const p = program.placement || program.career_growth;
    ctx += `\nProgram: ${safeText(program.name)}`;
    ctx += `\nDuration: ${safeText(program.duration)}`;
    ctx += `\nFormat: ${safeText(program.format)}`;
    ctx += `\nEligibility: ${safeText(program.eligibility)}`;
    ctx += `\nEMI start: ${safeText(program.fees?.emi_start)}`;
    ctx += `\nNo cost EMI: ${safeText(program.fees?.no_cost_emi)}`;
    ctx += `\nScholarship: ${safeText(program.fees?.scholarship)}`;
    ctx += `\nNext batch: ${safeText(program.start_date)}`;
    if (p) {
      ctx += `\nPlacement rate: ${safeText(p.placement_rate || p.promotion_rate)}`;
      ctx += `\nAverage CTC: ${safeText(p.average_ctc)}`;
      ctx += `\nSalary range: ${safeText(p.salary_range)}`;
    }
  }

  return ctx;
}

/**
 * AI generates the full WhatsApp message in the correct format.
 * Falls back to static message if AI fails.
 */
async function aiWhatsAppMessage(prompt, fallback) {
  const reply = await askAI(prompt, 400);
  if (reply && reply.trim().length > 20) return reply.trim();
  return fallback;
}

// ─── AI HELPER (for heading/intro JSON only) ──────────────────────────────

async function tryAiVariation(prompt, fallback, maxWords = 30) {
  try {
    const raw = await askAI(prompt, 180);
    const clean = safeText(raw).replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const heading = safeText(parsed.heading) || fallback.heading;
    const intro = safeText(parsed.intro).replace(/\s+/g, " ").trim();
    if (!intro || intro.split(/\s+/).length > maxWords) return fallback;
    return { heading, intro };
  } catch (_) {
    return fallback;
  }
}

// ─── INTRO CONTENT BUILDER ────────────────────────────────────────────────

async function getIntroContent(name, viewerLevel = "NO_ACTIVITY", phone = "") {
  const viewer = getViewerProfile(viewerLevel);
  const firstName = titleCase(name || "there").split(" ")[0];
  const seed = buildSeed([name, phone, viewerLevel, "INTRO"]);

  const fallback = {
    heading: pickVariant([
      "A Quick Program Overview",
      "Programs Built for Career Growth",
      "A Better Look at Our Programs"
    ], seed),
    intro: pickVariant([
      `Charters Union of Business focuses on practical learning and career outcomes.`,
      `Charters Union of Business is built around applied learning and growth.`,
      `Explore Charters Union of Business through programs shaped for career progress.`
    ], seed)
  };

  const prompt = `
You are Priya Sharma, an admissions counselor at Charters Union of Business.

Return JSON only:
{
  "heading": "short heading under 6 words",
  "intro": "exactly two short sentences, under 30 words total, factual and natural"
}

Constraints:
- Mention "Charters Union of Business".
- Tone: ${viewer.tone}
- No placeholders. Do not invent any statistics.
`;

  const ai = await tryAiVariation(prompt, fallback, 30);

  const programList = (programs?.programs || []).map(p => summarizeProgram(p)).filter(p => p?.name).slice(0, 3);
  const bullets = dedupe([
    faculty?.top_institutions?.length ? `👨‍🏫 *Faculty:* ${safeJoin(faculty.top_institutions, 3)}` : "",
    institute?.global_presence?.length ? `🌍 *Global presence:* ${safeJoin(institute.global_presence, 4)}` : "",
    "📈 *Placement rate:* 95%",
    home?.placement_highlights?.average_ctc ? `💼 *Average CTC:* ${home.placement_highlights.average_ctc}` : ""
  ]).slice(0, 4);

  return {
    tag: "INTRO",
    heading: ai.heading,
    intro: ai.intro,
    stats: getProgramStats(null),
    bullets,
    programs: programList
  };
}

// ─── FOLLOWUP CONTENT BUILDER ─────────────────────────────────────────────

async function getFollowupContent(name, course, viewerLevel = "NO_ACTIVITY", session = 1, question = null, phone = "") {
  const normalizedQuestion = cleanQuestion(question);
  const inferredProgram = findProgram(normalizedQuestion) || findProgram(course);
  const viewer = getViewerProfile(viewerLevel);
  const firstName = titleCase(name || "there").split(" ")[0];
  const seed = buildSeed([name, phone, course, viewerLevel, session, normalizedQuestion]);

  // Detect intent only when user actually replied
  let intent = "OTHER";
  if (normalizedQuestion) {
    try { intent = String(await detectIntent(normalizedQuestion) || "OTHER").toUpperCase(); } catch (_) { }
  }

  const resolvedQuestion = resolveQuestionInsight(intent, inferredProgram);
  const insight = resolvedQuestion.insight;

  // ── Fallback intro ──
  let fallback;

  if (normalizedQuestion) {
    // User replied — answer their question
    fallback = {
      heading: resolvedQuestion.usedFallback ? "How I Can Help" : insight.heading,
      intro: resolvedQuestion.usedFallback
        ? `${firstName}, I couldn't find that exact detail. Here's what I can help you with:`
        : `${firstName}, here's a quick answer to your question about ${insight.heading.toLowerCase()}.`
    };
  } else if (session === 1) {
    // No reply — viewerScore-based
    fallback = {
      heading: pickVariant(["A Quick Follow-Up", "A Better Look at the Program", "Why Students Choose Us"], seed),
      intro: viewerLevel === "HOT"
        ? `${firstName}, here are the key details students usually review before moving ahead.`
        : viewerLevel === "WARM"
          ? `${firstName}, here are a few more details that students usually find helpful.`
          : `${firstName}, here's a short follow-up from Charters Union of Business.`
    };
  } else if (session === 2) {
    fallback = {
      heading: pickVariant(["A Closer Look at Outcomes", "Career Outcome Highlights", "Quick ROI Snapshot"], seed),
      intro: viewerLevel === "HOT"
        ? `${firstName}, here's a focused look at the program outcomes and next-step details.`
        : `${firstName}, a short follow-up focused on career outcomes from Charters Union of Business.`
    };
  } else {
    fallback = {
      heading: "Final Key Details",
      intro: viewerLevel === "HOT"
        ? `${firstName}, sharing one final summary in case you'd like to review the program clearly.`
        : viewerLevel === "WARM"
          ? `${firstName}, a final follow-up with the key details to review before shortlisting.`
          : `${firstName}, one last look at the program details in case you'd like to revisit.`
    };
  }

  const prompt = `
You are Priya Sharma, Admissions Counselor at Charters Union of Business.

Return JSON only:
{
  "heading": "short heading under 6 words",
  "intro": "exactly two short sentences, under 30 words total, factual and natural"
}

Context:
- Session: ${session}
- Viewer level: ${viewerLevel}
- Question: ${normalizedQuestion || "none"}
- Course: ${course || "not specified"}
- Tone: ${viewer.tone}
- Do not invent any statistics or urgency.
`;

  const ai = await tryAiVariation(prompt, fallback, 30);

  // ── Bullets ──
  let bullets;
  let customCta = "";
  if (normalizedQuestion) {
    const placement = getPlacement(inferredProgram);
    const frame = getQuestionFollowupFrame(resolvedQuestion.intent, inferredProgram, firstName, session);
    if (resolvedQuestion.usedFallback) {
      bullets = insight.bullets.slice(0, 4);
    } else if (session >= 3) {
      bullets = dedupe([
        ...insight.bullets.slice(0, 2),
        ...frame.bullets
      ]).slice(0, 4);
    } else {
      bullets = dedupe([
        ...insight.bullets.slice(0, 2),
        ...frame.bullets
      ]).slice(0, 4);
    }
    customCta = frame.cta;
    if (!resolvedQuestion.usedFallback) {
      fallback.heading = frame.heading;
      fallback.intro = frame.intro;
    }
  } else {
    const placement = getPlacement(inferredProgram);
    if (session === 1) {
      bullets = dedupe([
        faculty?.top_institutions?.length ? `👨‍🏫 *Faculty:* ${safeJoin(faculty.top_institutions, 3)}` : "",
        institute?.global_presence?.length ? `🌍 *Global exposure:* ${safeJoin(institute.global_presence, 4)}` : "",
        inferredProgram?.fees?.emi_start ? `💳 *EMI from:* ${inferredProgram.fees.emi_start}` : "",
        inferredProgram?.duration ? `⏳ *Duration:* ${inferredProgram.duration}` : ""
      ]).slice(0, 4);
    } else if (session === 2) {
      bullets = dedupe([
        placement.average_ctc ? `💼 *Average CTC:* ${placement.average_ctc}` : "",
        placement.salary_range ? `💰 *Salary range:* ${placement.salary_range}` : "",
        placement.placement_rate ? `📈 *Placement rate:* ${placement.placement_rate}` : "",
        inferredProgram?.start_date ? `📅 *Next batch:* ${inferredProgram.start_date}` : ""
      ]).slice(0, 4);
    } else {
      bullets = dedupe([
        inferredProgram?.start_date ? `📅 *Upcoming batch:* ${inferredProgram.start_date}` : "",
        inferredProgram?.fees?.scholarship ? `🎓 *Scholarship:* ${inferredProgram.fees.scholarship}` : "",
        inferredProgram?.fees?.seat_booking ? `🔒 *Seat booking:* ${inferredProgram.fees.seat_booking}` : "",
        viewerLevel === "HOT"
          ? "✅ *Next step:* review the program page and apply when ready"
          : "💬 *Next step:* reply with any question and I'll help you decide"
      ]).slice(0, 4);
    }
  }

  return {
    tag: normalizedQuestion ? "FOLLOWUP_QUESTION" : "FOLLOWUP",
    intent: resolvedQuestion.intent,
    heading: ai.heading,
    intro: normalizedQuestion && resolvedQuestion.usedFallback ? fallback.intro : ai.intro,
    stats: resolvedQuestion.usedFallback ? [] : getProgramStats(inferredProgram),
    program: resolvedQuestion.usedFallback ? null : summarizeProgram(inferredProgram),
    bullets,
    cta: customCta
  };
}

// ─── REPLY CONTENT BUILDER ────────────────────────────────────────────────

async function getReplyContent(userMessage, intent = "OTHER", options = {}) {
  const normalizedIntent = safeText(intent || "OTHER").toUpperCase() || "OTHER";
  const question = cleanQuestion(userMessage);
  const program = findProgram(question) || findProgram(options.course);
  const resolvedQuestion = resolveQuestionInsight(normalizedIntent, program);
  const insight = resolvedQuestion.insight;
  const firstName = titleCase(options.name || "there").split(" ")[0];

  const fallback = {
    heading: resolvedQuestion.usedFallback ? "How I Can Help" : insight.heading,
    intro: resolvedQuestion.usedFallback
      ? `${firstName}, I couldn't find that exact detail. Here's what I can help with from Charters Union of Business:`
      : `${firstName}, here are the most relevant details from Charters Union of Business.`
  };

  const prompt = `
You are Priya Sharma from Charters Union of Business.

Return JSON only:
{
  "heading": "short heading under 6 words",
  "intro": "exactly two short sentences, under 30 words total, factual and natural"
}

Context:
- Intent: ${normalizedIntent}
- Question: ${question}
- Do not invent any statistics or claims.
`;

  const ai = await tryAiVariation(prompt, fallback, 30);

  return {
    tag: `REPLY_${resolvedQuestion.intent}`,
    heading: ai.heading,
    intro: resolvedQuestion.usedFallback ? fallback.intro : ai.intro,
    stats: resolvedQuestion.usedFallback ? [] : getProgramStats(program),
    program: resolvedQuestion.usedFallback ? null : summarizeProgram(program),
    bullets: insight.bullets.slice(0, 4)
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────

/**
 * generateIntroContent
 * Used by campaign.js — sends intro based on viewerScore from Google Sheet.
 * viewerLevel drives tone: HOT → urgent/direct, WARM → helpful, COLD → soft, NO_ACTIVITY → friendly
 *
 * Message format: original WhatsApp style — emoji + *bold headings* + • bullets
 * Image (poster.jpeg) is sent separately in campaign.js as caption — no change needed there.
 */
async function generateIntroContent(name = "there", course = "", phone = "", viewerLevel = "NO_ACTIVITY") {
  // 1. Messages-tab template takes priority — edit the sheet, not the code
  const template = await templateContent(
    { name, course, score: 0, session: 1 },
    { session: 1 }
  );
  if (template) return template;

  const firstName = titleCase(name || "there").split(" ")[0];
  const greetingName = firstName.toLowerCase() === "there" ? "Student" : firstName;

  // 1. Fetch dynamic data dynamically using getIntroContent
  const content = await getIntroContent(name, viewerLevel, phone);

  // 2. Build bullet list for programs
  const programLines = (content.programs || []).map(p => `• *${p.name}* - ${p.duration}`);
  const programsSection = programLines.length
    ? `*Programs Available:*\n${programLines.join("\n")}`
    : "";

  // 3. Build bullet list for key highlights
  const bulletLines = (content.bullets || [])
    .map(b => b.replace(/^[\s•\-]+/, "")) // Clean simple dash/dot prefixes
    .map(b => `• ${b}`);

  const highlightsSection = bulletLines.length
    ? `*${content.heading || "Key Highlights"}:*\n${bulletLines.join("\n")}`
    : "";

  // Combine directly following the target layout format structure
  const messageChunks = [
    `Dear ${greetingName},`,
    content.intro,
    programsSection,
    highlightsSection,
    `Please reply *YES* if you'd like to learn more.`,
    `For any queries, contact at ugadmissions@mastersunion.org or +91 89293 61012.`
  ].filter(Boolean);

  return messageChunks.join("\n\n");
}

/**
 * generateFollowupContent
 * Used by scheduler.js
 *
 * LOGIC:
 * - question = null/empty → user did NOT reply → content driven by viewerScore/viewerLevel
 * - question = string    → user DID reply     → content answers their last question
 *
 * Message format: original WhatsApp style — emoji + *bold headings* + • bullets
 * Image (poster.jpeg) is sent separately in scheduler.js as caption — no change needed there.
 */
async function generateFollowupContent(context, course, phone, viewerLevel = "NO_ACTIVITY", name = "there", session = 1, question = null) {
  // 1. Messages-tab template takes priority (per course + session)
  const template = await templateContent(
    { name, course, score: 0, session },
    { session }
  );
  if (template) return template;

  const normalizedQuestion = cleanQuestion(question);
  const content = await getFollowupContent(name, course, viewerLevel, session, normalizedQuestion || null, phone);

  // IRRELEVANT question — return static fallback directly, no AI, no heading
  if (normalizedQuestion && content.tag === "FOLLOWUP_QUESTION" && !content.stats?.length) {
    const fallbackMsg = `I can help you with:\n\n• 🎓 *Programs:* MBA, PGDM, and Executive MBA\n• 💰 *Fees & EMI:* payment support and scholarship details\n• 📝 *Admissions:* eligibility, process, and next-step guidance\n• 📈 *Placements:* career outcomes and recruiter information\n\nJust type your question and I'll guide you.`;
    return fallbackMsg + "\n" + getFooter(phone);
  }
  const includeFooter = normalizedQuestion && ["ASK_FEE", "ASK_ADMISSION"].includes(content.intent);
  return renderFollowupMessage(course, content, phone, includeFooter);
}

/**
 * generateProgramContent
 * Used by replyEngine.js for inbound user messages.
 * Returns plain WhatsApp-style message (no footer — replyEngine handles that).
 */
async function generateProgramContent(userMessage, options = {}) {
  const intent = safeText(options.intent || "OTHER").toUpperCase();

  // IRRELEVANT intent — use last valid question/course from tracker instead of generic fallback
  if (intent === "IRRELEVANT") {
    const lastQuestion = options.lastQuestion || null;
    const lastCourse = options.lastCourse || null;

    // If we have a prior valid topic, send a followup on that
    if (lastQuestion || lastCourse) {
      const program = findProgram(lastQuestion) || findProgram(lastCourse);
      const data = buildRichData(program);
      const prompt = `
You are a WhatsApp admissions counselor for Charters Union of Business.

The user just sent a short/unclear message. Their last real question was about: "${lastQuestion || lastCourse}"
Continue the conversation naturally — give a brief helpful follow-up on that topic.

Use ONLY the information below — do not invent anything:
${data}

Format rules:
- Start with a short natural line (no heading)
- 2-3 bullet points: emoji + short fact relevant to their last topic
- End with a soft CTA or question
- NO bold headings at top
- Clean WhatsApp spacing
- Do NOT include footer or links
`;
      const fallback = `Still on ${lastCourse || "the program"}? Happy to help with any questions 😊`;
      return aiWhatsAppMessage(prompt, fallback);
    }

    // No prior topic — return static bullets, no heading
    return `I can help you with:

• 🎓 *Programs:* MBA, PGDM, and Executive MBA
• 💰 *Fees & EMI:* payment support and scholarship details
• 📝 *Admissions:* eligibility, process, and next-step guidance
• 📈 *Placements:* career outcomes and recruiter information

Just type your question and I'll guide you.`;
  }
  const content = await getReplyContent(userMessage, intent, options);
  return renderReplyMessage(content);
}

module.exports = {
  generateIntroContent,
  generateFollowupContent,
  generateProgramContent,
  getIntroContent,
  getFollowupContent,
  getReplyContent
};
