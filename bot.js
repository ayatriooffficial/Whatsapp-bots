const path = require("path");

const {
  Client,
  LocalAuth,
} = require("whatsapp-web.js");

/* =========================================================
   CHROME PATH
========================================================= */

function resolveExecutablePath() {

  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  try {

    return require("puppeteer")
      .executablePath();

  } catch (_) {

    try {

      return require("chromium").path;

    } catch (_) {

      return undefined;
    }
  }
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({

  authStrategy: new LocalAuth({

    clientId: "main",

    dataPath: path.join(
      __dirname,
      ".wwebjs_auth"
    ),
  }),

  takeoverOnConflict: true,

  takeoverTimeoutMs: 0,

  webVersionCache: {
    type: "none",
  },

  puppeteer: {

    headless:
      process.env.HEADLESS !== "false",

    executablePath:
      resolveExecutablePath(),

    timeout: 120000,

    userAgent:
      process.env.CUSTOM_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",

    args: [

      "--no-sandbox",

      "--disable-setuid-sandbox",

      "--disable-dev-shm-usage",

      "--disable-extensions",

      "--disable-gpu",

      "--disable-crash-reporter",

      "--disable-crashpad",

      "--no-first-run",

      "--no-default-browser-check",

      "--disable-accelerated-2d-canvas",

      // ── Stealth / anti-detection flags (added) ──
      "--disable-backgrounding-occluded-windows",

      "--disable-renderer-backgrounding",

      "--disable-background-timer-throttling",

      "--disable-background-media-suspend",

      "--disable-background-networking",

      "--disable-component-update",

      "--disable-default-apps",

      "--disable-domain-reliability",

      "--disable-sync",

      "--metrics-recording-only",

      "--no-pings",

      "--safebrowsing-disable-auto-update",

      "--window-size=1280,900",

      "--lang=en-US",

    ],

    defaultViewport: {

      width: 1280,

      height: 900,

    },

  },
});

/* =========================================================
   EVENTS
========================================================= */

client.on("qr", () => {
  console.log("📱 Scan QR");
});

client.on("authenticated", () => {
  console.log("🔐 Authenticated");
});

client.on("ready", () => {
  console.log("✅ BOT READY");
});

client.on("auth_failure", (msg) => {
  console.log(
    "❌ Auth failure:",
    msg
  );
});

client.on("disconnected", (reason) => {
  console.log(
    "⚠ Disconnected:",
    reason
  );
});

client.on("change_state", (state) => {
  console.log(
    "WhatsApp state:",
    state
  );
});

client.on(
  "loading_screen",
  (percent, message) => {

    console.log(
      `Loading WhatsApp: ${percent}% ${message || ""}`.trim()
    );
  }
);

module.exports = client;