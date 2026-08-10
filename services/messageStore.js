const fs = require("fs");
const FILE = "./messageStore.json";

function normalizeUserId(id) {
  const raw = String(id || "").trim();
  if (!raw) return raw;

  if (raw.endsWith("@c.us")) {
    const digits = raw.split("@")[0].replace(/\D/g, "");
    return digits ? `${digits}@c.us` : raw;
  }

  // Do not coerce @lid IDs into fake phone-based @c.us IDs.
  if (raw.endsWith("@lid")) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@c.us` : raw;
}

function load() {
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "{}");
    return {};
  }
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
    const normalizedKey = normalizeUserId(key);
    if (normalizedKey !== key) changed = true;
    normalized[normalizedKey] = { ...(normalized[normalizedKey] || {}), ...value };
  }

  if (changed) save(normalized);
  return normalized;
}

function getStore() {
  return loadNormalized();
}

function setUser(phone, data) {
  const key = normalizeUserId(phone);
  const store = loadNormalized();
  store[key] = data;
  save(store);
}

function updateUser(phone, data) {
  const key = normalizeUserId(phone);
  const store = loadNormalized();
  store[key] = { ...store[key], ...data };
  save(store);
}

function deleteUser(phone) {
  const key = normalizeUserId(phone);
  const store = loadNormalized();
  delete store[key];
  save(store);
}

//  FIXED: addUser was missing — tracker.js calls this, without it nothing gets tracked
function addUser(phone) {
  const key = normalizeUserId(phone);
  const store = loadNormalized();
  if (!store[key]) {
    store[key] = {
      session: 1,
      lastSent: Date.now(),
      optOut: false
    };
    save(store);
  }
}

function findUserByChatId(chatId) {
  const target = String(chatId || "");
  if (!target) return null;

  const store = loadNormalized();
  for (const [user, data] of Object.entries(store)) {
    if (String(data?.chatId || "") === target) return user;
  }
  return null;
}

module.exports = {
  getStore,
  setUser,
  updateUser,
  deleteUser,
  addUser,  //  exported
  normalizeUserId,
  findUserByChatId
};
