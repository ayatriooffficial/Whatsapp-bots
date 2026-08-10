const askAI = require("./aiReply");

async function detectIntent(message) {
  if (!message || typeof message !== "string") return "OTHER";

  const prompt = `
Classify the user intent for an admissions chatbot of a business school.

Possible intents:
ASK_FEE         - asking about fees, cost, EMI, scholarship, payment
ASK_DURATION    - asking about program duration, schedule, full time, part time
ASK_PLACEMENT   - asking about placement, salary, CTC, jobs, career outcomes
ASK_PROGRAM     - asking about programs, courses, curriculum, subjects
ASK_ELIGIBILITY - asking about eligibility, qualification, who can apply, minimum requirement, criteria, documents
ASK_ADMISSION   - asking about how to apply, admission process, enrollment, deadline, last date
ASK_FACULTY     - asking about faculty, mentors, professors, teachers
ASK_GLOBAL      - asking about global exposure, international, countries, abroad
SESSION         - asking about class sessions, timings, batch
OTHER           - general admissions related question
IRRELEVANT      - completely unrelated to admissions or education
                  e.g. "what day is today", "tell me a joke", "what is AI",
                  "weather", "news", personal questions

User message:
${message}

Return only the intent name. If unsure, return OTHER.
`;

  try {
    const result = await askAI(prompt);
    if (!result) return "OTHER";
    return result.toUpperCase().replace(/[^A-Z_]/g, "").trim();
  } catch (err) {
    return "OTHER";
  }
}

module.exports = detectIntent;