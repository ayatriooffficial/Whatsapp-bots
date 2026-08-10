require("dotenv").config();
const axios = require("axios");

/* =========================================================
   GEMINI AI CLIENT (replaces Groq)
   Uses the same model as the website backend blog generator:
   gemini-2.5-flash-lite via the REST generateContent endpoint.
   Key sources: GEMINI_API_KEY (preferred) or GEMINI_API.
========================================================= */

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API || "";
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

/* =========================================================
   RATE LIMIT GUARD
   Keeps us safely under common Gemini free-tier limits.
   When hit, askAI returns null and callers fall back to
   static/template content (same behavior as before).
========================================================= */
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

async function askAI(prompt, maxTokens = 500) {
  if (!GEMINI_KEY) return null;

  // Rate limit guard — return null so fallback static/template content is used
  if (isRateLimited()) return null;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`,
      {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000, // 15s — don't hang
      }
    );

    const text =
      res.data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    if (!text.trim()) return null;
    return text.trim();
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Gemini 429 rate limit — using fallback");
    } else if (err.response?.status === 403) {
      console.warn(
        "⚠️  Gemini 403 (key invalid/quota) — using fallback:",
        err.response?.data?.error?.message || ""
      );
    } else {
      console.warn("⚠️  Gemini error — using fallback:", err.message);
    }
    return null;
  }
}

module.exports = askAI;
