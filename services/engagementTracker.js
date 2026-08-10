const fs = require("fs");
const FILE = "./engagement.json";
const { updateScore } = require("./sheetService");
const { programs } = require("./dataLoader");

function normalizeUserId(id) {
  const raw = String(id || "").trim();
  if (!raw) return raw;
  if (raw.endsWith("@c.us")) {
    const digits = raw.split("@")[0].replace(/\D/g, "");
    return digits ? digits + "@c.us" : raw;
  }
  if (raw.endsWith("@lid")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? digits + "@c.us" : raw;
}

function toPhoneKey(id) {
  return normalizeUserId(id).split("@")[0];
}

function load() {
  if (!fs.existsSync(FILE)) { fs.writeFileSync(FILE, "{}"); return {}; }
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function loadNormalized() {
  const raw = load();
  const normalized = {};
  let changed = false;
  for (const [key, value] of Object.entries(raw)) {
    const nk = normalizeUserId(key);
    if (nk !== key) changed = true;
    normalized[nk] = { ...(normalized[nk] || {}), ...value };
  }
  if (changed) save(normalized);
  return normalized;
}

function init(phone) {
  const key = normalizeUserId(phone);
  const data = loadNormalized();
  if (!data[key]) {
    data[key] = { session: 1, read: false, replied: false, clicked: false, score: 0, finalScore: 0, level: "COLD" };
    save(data);
  }
  return { data, key };
}

function trackRead(phone) {
  const { data, key } = init(phone);
  if (!data[key].read) {
    data[key].read = true;
    save(data);
    console.log("👀 READ:", key);
  }
}

function trackReply(phone) {
  const { data, key } = init(phone);
  if (!data[key].replied) {
    data[key].replied = true;
    save(data);
    console.log("💬 REPLY:", key);
  }
}

function trackClick(phone) {
  const { data, key } = init(phone);
  if (!data[key].clicked) {
    data[key].clicked = true;
    save(data);
    console.log("🌐 CLICK:", key);
  }
}

function trackCourseView(phone, course) {
  const { data, key } = init(phone);
  data[key].courseViewed = true;
  data[key].courseName = course;
  save(data);
}

function saveLastQuestion(phone, text) {
  const { data, key } = init(phone);
  data[key].lastQuestion = text;
  save(data);
}

function saveProgramInterest(phone, program) {
  const { data, key } = init(phone);
  const resolved = typeof program === "string"
    ? (programs?.programs || []).find(item => item.id === program || item.name === program)
    : program;
  if (!resolved?.name) return;

  data[key].courseViewed = true;
  data[key].courseName = resolved.name;
  data[key].activeProgramId = resolved.id || "";
  data[key].activeProgramName = resolved.name;
  delete data[key].pendingProgramChoice;
  save(data);
}

function savePendingProgramChoice(phone, payload = {}) {
  const { data, key } = init(phone);
  data[key].pendingProgramChoice = {
    intent: payload.intent || "OTHER",
    question: payload.question || "",
    askedAt: Date.now()
  };
  save(data);
}

function clearPendingProgramChoice(phone) {
  const { data, key } = init(phone);
  if (!data[key].pendingProgramChoice) return;
  delete data[key].pendingProgramChoice;
  save(data);
}

async function completeSession(phone) {
  const key = normalizeUserId(phone);
  const data = loadNormalized();
  const u = data[key];
  if (!u) { console.log("No record, skipping ->", key); return; }

  let sessionScore = 0;
  if (u.read)    sessionScore += 11;
  if (u.replied) sessionScore += 11;
  if (u.clicked) sessionScore += 11;

  u.score += sessionScore;
  u.finalScore = Math.round(u.score / 10);
  u.level = u.finalScore >= 8 ? "HOT" : u.finalScore >= 5 ? "WARM" : "COLD";

  if (sessionScore > 0) {
    try {
      const phoneKey = toPhoneKey(key);
      if (!phoneKey) throw new Error("Invalid phone key");
      await updateScore(phoneKey, u.finalScore, u.level);
    } catch (err) {
      console.log("Sheet update failed:", err.message);
    }
  } else {
    console.log("No engagement this session ->", key);
  }

  console.log(`
📊 ENGAGEMENT ${key}
   session  : ${u.session}
   read     : ${u.read}
   replied  : ${u.replied}
   clicked  : ${u.clicked}
   pts      : ${sessionScore}
   total    : ${u.score}
   score    : ${u.finalScore}/10
   level    : ${u.level}
`);

  u.read    = false;
  u.replied = false;
  u.clicked = false;
  // lastQuestion intentionally NOT reset — next followup session stays on same topic
  // It gets overwritten when user asks a new question (via saveLastQuestion in server.js)
  if (u.session < 3) u.session++;
  save(data);
}

function scoreOutof10(phone) {
  const data = loadNormalized();
  return data[normalizeUserId(phone)]?.finalScore || 0;
}

function getStatus(phone) {
  return loadNormalized()[normalizeUserId(phone)] || null;
}

module.exports = {
  trackRead,
  trackReply,
  trackClick,
  trackCourseView,
  saveLastQuestion,
  saveProgramInterest,
  savePendingProgramChoice,
  clearPendingProgramChoice,
  completeSession,
  getStatus,
  scoreOutof10
};
