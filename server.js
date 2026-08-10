require("dotenv").config();

const express = require("express");
const app = express();
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");

const client = require("./bot");

const tracker = require("./services/engagementTracker");
const { sendBulk } = require("./campaign");
const store = require("./services/messageStore");

const replyEngine = require("./replyEngine");
const detectIntent = require("./services/detectIntent");
const findProgram = require("./services/findProgram");
const { programs } = require("./services/dataLoader");

const trackStatus = require("./tracker");
const startReminder = require("./scheduler");

const { addNewLead } = require("./services/sheetService");
const { loadLeadsIntoStore } = require("./leadLoader");
const { syncCourseTabs } = require("./services/sheetSplitter");

const SPLIT_SYNC_INTERVAL_MS =
  Number(process.env.SPLIT_SYNC_INTERVAL_MS || 15 * 60 * 1000);

let runtimeStarted = false;
let messageHandlerRegistered = false; // ← prevents double registration
let leadPollTimer = null;
let splitSyncTimer = null;
let initializingClient = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let latestStatus = "Starting";

const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const WEBSITE_BASE_URL = (process.env.WEBSITE_BASE_URL || "https://charter-temp.vercel.app").replace(/\/+$/, "");

/* ---------------- USER HELPERS ---------------- */

function getRealUser(id) {
  if (!id) return null;
  if (id.includes("@g.us")) return null;
  if (id.includes("@newsletter")) return null;
  if (id === "status@broadcast") return null;
  return store.normalizeUserId(id);
}

function toPhoneKey(id) {
  return String(id || "").split("@")[0].replace(/\D/g, "");
}

function isValidPhoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

function buildProgramChoicePrompt(intent = "OTHER") {
  const labels = {
    ASK_FEE       : "fee and payment details",
    ASK_DURATION  : "duration and schedule details",
    ASK_PLACEMENT : "placement details",
    ASK_ELIGIBILITY: "eligibility details",
    ASK_ADMISSION : "admission details",
    ASK_PROGRAM   : "program details",
    ASK_FACULTY   : "faculty details",
    ASK_GLOBAL    : "global exposure details",
    SESSION       : "class timing details",
    OTHER         : "the right details"
  };
  const topic = labels[intent] || labels.OTHER;
  const choices = (programs?.programs || []).map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  return `I can help with ${topic}.\n\nPlease choose a program:\n${choices}\n\nReply with the number and I'll continue from there.`;
}

function resolveProgramChoice(text) {
  const normalized = String(text || "").trim().toLowerCase();
  const byNumber = { "1": "mba", "2": "pgdm", "3": "executive" };
  if (byNumber[normalized]) {
    return (programs?.programs || []).find(p => p.id === byNumber[normalized]) || null;
  }
  return findProgram(normalized);
}

function isOptOutMessage(text) {
  const normalized = String(text || "").toLowerCase().trim();
  return [
    "stop", "unsubscribe", "dont message", "don't message",
    "do not message", "remove me", "not interested",
    "no messages", "stop messages", "leave me alone"
  ].some(phrase => normalized.includes(phrase));
}

/* ---------------- RESOLVE USER ---------------- */

async function resolveUserFromMessage(msg) {
  const chatId = String(msg?.from || "");
  let user = getRealUser(chatId);
  if (!user || !chatId) return { user: null, chatId };

  if (chatId.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      const phone =
        String(contact?.number || "").replace(/\D/g, "") ||
        String(contact?.id?.user || "").replace(/\D/g, "");
      if (isValidPhoneDigits(phone)) user = `${phone}@c.us`;
    } catch (_) {}
  }

  return { user, chatId };
}

/* ---------------- SAFE SEND ---------------- */

async function safeSendMessage(to, userKey, payload) {
  if (!to || String(to).includes("@newsletter")) return false;
  try {
    await client.sendMessage(to, payload);
    return true;
  } catch (err) {
    console.log("Send error:", to, err.message);
    if (err.message.includes("No LID")) store.deleteUser(userKey);
    return false;
  }
}

let latestQR = "";

function setStatus(status) {
  latestStatus = status;
  console.log("Status:", status);
}

function stopRuntimeTasks() {
  runtimeStarted = false;
  if (leadPollTimer) {
    clearInterval(leadPollTimer);
    leadPollTimer = null;
  }
  if (splitSyncTimer) {
    clearInterval(splitSyncTimer);
    splitSyncTimer = null;
  }
}

function scheduleReconnect(reason) {
  stopRuntimeTasks();
  if (reconnectTimer || initializingClient) return;

  reconnectAttempts += 1;
  const delayMs = Math.min(60000, 5000 * reconnectAttempts);
  setStatus(`Reconnecting in ${Math.round(delayMs / 1000)}s after ${reason || "disconnect"}`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      if (client.pupBrowser) await client.destroy();
    } catch (err) {
      console.log("Client destroy before reconnect failed:", err.message);
    }
    initializeClient();
  }, delayMs);
}

async function initializeClient() {
  if (initializingClient) return;
  initializingClient = true;
  try {
    setStatus("Initializing WhatsApp client");
    await client.initialize();
  } catch (err) {
    console.log("WhatsApp initialize failed:", err.message);
    initializingClient = false;
    scheduleReconnect("initialize failure");
    return;
  }
  initializingClient = false;
}

/* ---------------- QR PAGE ---------------- */

app.get("/qr", (req, res) => {
  if (latestQR) {
    res.send(`
      <html>
      <head><meta http-equiv="refresh" content="15"/></head>
      <body style="text-align:center;margin-top:50px;font-family:sans-serif">
      <h2>WhatsApp QR Code</h2>
      <img src="${latestQR}" style="width:300px"/>
      <p>Open WhatsApp on your phone → Linked devices → Link a device.</p>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
      <head><meta http-equiv="refresh" content="5"/></head>
      <body style="text-align:center;margin-top:50px;font-family:sans-serif">
      <h3>${latestStatus}</h3>
      </body>
      </html>
    `);
  }
});

/* ---------------- TRACKING LINKS ---------------- */

app.get("/w/:phone", (req, res) => {
  const phone = req.params.phone + "@c.us";
  tracker.trackClick(phone);
  res.redirect(WEBSITE_BASE_URL);
});

app.get("/a/:phone", (req, res) => {
  const phone = req.params.phone + "@c.us";
  tracker.trackClick(phone);
  res.redirect(`${WEBSITE_BASE_URL}/apply`);
});

app.get("/", (req, res) => {
  res.send(`Bot server running | tracking base: ${APP_BASE_URL}`);
});

/* ---------------- MANUAL LEAD RELOAD ---------------- */

app.get("/load-leads", async (req, res) => {
  console.log("\n🔘 Manual lead load triggered via /load-leads");
  res.json({ status: "started", message: "Loading leads — check terminal for progress" });
  loadLeadsIntoStore().catch(err => console.log("Lead load error:", err.message));
});

/* ---------------- MESSAGE HANDLER ---------------- */

function registerMessageHandler() {
  // ← Only register ONCE — prevents duplicate handlers on re-auth
  if (messageHandlerRegistered) return;
  messageHandlerRegistered = true;

  console.log("📩 Message handler registered");

  client.on("message", async (msg) => {
    try {
      if (msg.fromMe) return;

      const { user: directUser, chatId } = await resolveUserFromMessage(msg);
      if (!directUser || !chatId) return;

      const users = store.getStore();
      const mappedUser = users[directUser] ? directUser : store.findUserByChatId(chatId);
      const user = mappedUser || directUser;

      let isTrackedUser = !!users[user];

      if (!isTrackedUser && isValidPhoneDigits(toPhoneKey(user))) {
        store.setUser(user, {
          session        : 1,
          lastSent       : 0,
          lastInteraction: Date.now(),
          lastMessageDate: 0,
          messagesToday  : 0,
          sentTopics     : [],
          optOut         : false,
          chatId,
          source         : "organic",
        });
        isTrackedUser = true;

        try {
          await addNewLead(toPhoneKey(user), "");
        } catch (err) {
          console.log("Sheet add failed:", err.message);
        }
      }

      if (isTrackedUser) {
        store.updateUser(user, { lastInteraction: Date.now(), chatId });
      }

      const rawText = String(msg.body || msg.caption || "").trim();
      let text = rawText.toLowerCase().trim();
      if (!text) return;

      console.log(`💬 Message from ${user}: "${text}"`);

    /* -------- OPT OUT -------- */
      if (isOptOutMessage(text)) {
        store.updateUser(user, { optOut: true, lastInteraction: Date.now(), chatId });
        await safeSendMessage(chatId, user, "You're all set. I won't send follow-up messages anymore. If you want help again later, just send a new message.");
        return;
      }

    /* -------- PENDING PROGRAM CHOICE -------- */
      let status = tracker.getStatus(user) || {};
      const pendingChoice = status.pendingProgramChoice || null;

      if (pendingChoice) {
        const chosenProgram = resolveProgramChoice(text);
        if (chosenProgram) {
          tracker.saveProgramInterest(user, chosenProgram);
          tracker.clearPendingProgramChoice(user);
          text = `${pendingChoice.question || pendingChoice.intent} ${chosenProgram.name}`.toLowerCase().trim();
          status = tracker.getStatus(user) || {};
        } else if (/^\d+$/.test(text)) {
          await safeSendMessage(chatId, user, buildProgramChoicePrompt(pendingChoice.intent || "OTHER"));
          return;
        }
      }

    /* -------- INTENT DETECTION -------- */
      let intent = "OTHER";
      try {
        const intentRaw = await detectIntent(text);
        intent = String(intentRaw || "OTHER").toUpperCase();
      } catch (e) {
        console.log("Intent detect failed");
      }

      const CONTEXTUAL_INTENTS = new Set([
        "ASK_FEE", "ASK_DURATION", "ASK_PLACEMENT",
        "ASK_ELIGIBILITY", "ASK_ADMISSION", "ASK_FACULTY",
        "ASK_GLOBAL", "SESSION"
      ]);

      const detectedProgram  = findProgram(text);
      const rememberedProgram =
        findProgram(status.activeProgramName) ||
        findProgram(status.courseName) ||
        null;

      if (!detectedProgram && CONTEXTUAL_INTENTS.has(intent) && !rememberedProgram) {
        tracker.savePendingProgramChoice(user, { intent, question: text });
        await safeSendMessage(chatId, user, buildProgramChoicePrompt(intent));
        return;
      }

      const effectiveProgram = detectedProgram || rememberedProgram || null;
      if (effectiveProgram) {
        tracker.saveProgramInterest(user, effectiveProgram);
        if (!detectedProgram && CONTEXTUAL_INTENTS.has(intent)) {
          text = `${text} ${effectiveProgram.name}`.toLowerCase().trim();
        }
      }

      const VALID_INTENTS = ["ASK_FEE", "ASK_DURATION", "ASK_PLACEMENT", "ASK_PROGRAM",
        "ASK_ELIGIBILITY", "ASK_ADMISSION", "ASK_FACULTY", "ASK_GLOBAL", "SESSION", "OTHER"];
      if (VALID_INTENTS.includes(intent)) {
        try {
          tracker.saveLastQuestion(user, text);
          const detectedCourse = findProgram(text);
          if (detectedCourse) tracker.trackCourseView(user, detectedCourse.name);
        } catch (_) {}
      }

      /* -------- REPLY -------- */
      try {
        const reply = await Promise.race([
          replyEngine({ ...msg, body: text }, user, intent),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Reply timeout")), 7000)
          ),
        ]);
        if (reply) {
          await safeSendMessage(chatId, user, reply);
          console.log(`✅ Reply sent to ${user}`);
        }
      } catch (err) {
        console.log("Reply error:", err.message);
        if (err.message.includes("No LID")) store.deleteUser(user);
      }
    } catch (err) {
      console.log("Message handler error:", err.message);
    }
  });
}

/* ---------------- SERVER START ---------------- */

async function startServer() {

  client.on("qr", async (qr) => {
    try {
      qrcodeTerminal.generate(qr, { small: true });
      latestQR = await qrcode.toDataURL(qr);
      setStatus(`QR ready. Open ${APP_BASE_URL}/qr or scan from the terminal.`);
    } catch (err) {
      console.log("QR generation failed:", err.message);
    }
  });

  client.on("authenticated", () => {
    latestQR = "";
    setStatus("Authenticated. Waiting for WhatsApp to become ready.");
  });

  client.on("auth_failure", (msg) => {
    latestQR = "";
    console.log("Auth failure:", msg);
    scheduleReconnect("auth failure");
  });

  client.on("ready", async () => {
    initializingClient = false;
    reconnectAttempts = 0;
    latestQR = "";
    setStatus("BOT READY");
    if (runtimeStarted) {
      console.log("⚡ Re-auth detected — skipping re-init");
      return;
    }
    runtimeStarted = true;

    try {
      // Register message handler ONCE
      registerMessageHandler();

      trackStatus(client);
      startReminder();

      // Load leads from Google Sheet
      await loadLeadsIntoStore();

      // Sync CBA/DGM/Messages tabs from cookie_import (best-effort)
      syncCourseTabs(require("./services/sheetService").loadSheet).catch(
        (err) => console.log("Split sync error:", err.message)
      );
      if (splitSyncTimer) clearInterval(splitSyncTimer);
      splitSyncTimer = setInterval(() => {
        syncCourseTabs(require("./services/sheetService").loadSheet).catch(
          (err) => console.log("Split sync error:", err.message)
        );
      }, SPLIT_SYNC_INTERVAL_MS);

      console.log("Starting campaign...");
      sendBulk().catch(err => console.log("Campaign error:", err.message));

      leadPollTimer = setInterval(() => {
        console.log("Checking new leads...");
        sendBulk().catch(err => console.log("Campaign poll error:", err.message));
      }, 180000);
    } catch (err) {
      console.log("Runtime start error:", err.message);
    }
  });

  client.on("disconnected", (reason) => {
    latestQR = "";
    console.log("⚠️  WhatsApp disconnected:", reason);
    scheduleReconnect(reason);
  });

  process.on("unhandledRejection", (err) => {
    console.log("Unhandled rejection:", err?.message || err);
  });

  process.on("uncaughtException", (err) => {
    console.log("Uncaught exception:", err?.message || err);
  });

  initializeClient();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
startServer();
