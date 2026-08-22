require("dotenv").config();
const axios = require("axios");

/* =========================================================
   GEMINI AI CLIENT
   Uses primary model: gemini-3.1-flash-lite (or env override)
   Fallback model: gemini-2.5-flash-lite
   Key sources: GEMINI_API_KEY (preferred) or GEMINI_API.
========================================================= */

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API || "";
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

let reqCount = 0;
let windowStart = Date.now();
const MAX_REQ_PER_MIN = Number(process.env.AI_MAX_REQ_PER_MIN || 25);

function isRateLimited() {
  const now = Date.now();
  if (now - windowStart > 60000) {
    reqCount = 0;
    windowStart = now;
  }
  if (reqCount >= MAX_REQ_PER_MIN) {
    console.warn(
      `⚠️  Gemini rate limit guard: ${reqCount} req this minute — skipping AI call`
    );
    return true;
  }
  reqCount++;
  return false;
}

async function callGemini(model, systemInstruction, promptText, maxTokens = 600) {
  const contents = [];
  if (promptText) {
    contents.push({
      role: "user",
      parts: [{ text: promptText }],
    });
  }

  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`,
    payload,
    {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  const text =
    res.data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("") || "";

  return text.trim();
}

async function askAI(prompt, maxTokens = 600, systemInstruction = "") {
  if (!GEMINI_KEY) {
    console.warn("⚠️  GEMINI_API_KEY is not configured");
    return null;
  }

  if (isRateLimited()) return null;

  // Try primary model
  try {
    const text = await callGemini(PRIMARY_MODEL, systemInstruction, prompt, maxTokens);
    if (text) return text;
  } catch (err) {
    console.warn(`⚠️  Primary model (${PRIMARY_MODEL}) failed:`, err?.response?.data?.error?.message || err.message);
  }

  // Fallback model if primary model fails
  if (PRIMARY_MODEL !== FALLBACK_MODEL) {
    try {
      console.log(`🔄 Attempting fallback model (${FALLBACK_MODEL})...`);
      const text = await callGemini(FALLBACK_MODEL, systemInstruction, prompt, maxTokens);
      if (text) return text;
    } catch (err) {
      console.warn(`⚠️  Fallback model (${FALLBACK_MODEL}) error:`, err?.response?.data?.error?.message || err.message);
    }
  }

  return null;
}

module.exports = askAI;
