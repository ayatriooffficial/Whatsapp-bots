const store = require("./services/messageStore");
const tracker = require("./services/engagementTracker");
let isBound = false;

function getRealUser(id) {
  if (!id) return null;
  if (id.includes("@g.us")) return null;
  if (id.includes("@newsletter")) return null;
  if (id === "status@broadcast") return null;
  return store.normalizeUserId(id);
}

function trackStatus(client) {
  if (isBound) return;
  isBound = true;

  client.on("message_ack", (msg, ack) => {
    if (!msg.fromMe) return;
    if (ack !== 3) return;

    const directUser = getRealUser(msg.to);
    if (!directUser) return;

    const users = store.getStore();
    const user = users[directUser] ? directUser : store.findUserByChatId(msg.to);
    if (!user || !users[user]) return;

    tracker.trackRead(user);
    console.log("👀 Read →", user);

  });
}

module.exports = trackStatus;
