require("dotenv").config();

/**
 * websiteContext.js (whatsapp-bot-master)
 * Fetches the Charters Union website's LIVE data (programs, fees, placements,
 * faculty, internships) from the website's /api/website-data endpoint
 * and builds a clean dynamic context block for WhatsApp inbound AI replies.
 */

const WEBSITE_DATA_URL = (
  process.env.WEBSITE_DATA_URL || "http://localhost:3000/api/website-data"
).replace(/\/+$/, "");

let cache = { at: 0, data: null };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min cache

async function fetchWebsiteData() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;

  try {
    const res = await fetch(`${WEBSITE_DATA_URL}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    cache = { at: now, data: json?.data || null };
    return cache.data;
  } catch (err) {
    return null;
  }
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function truncate(v, max = 600) {
  const s = safeStr(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildWebsiteContext(data) {
  if (!data) return null;

  const sections = [];

  // Programs summary
  if (Array.isArray(data.programs) && data.programs.length) {
    const summary = data.programs
      .map((p) => {
        const pl = p.placement || p.career_growth || {};
        const lines = [`- ${p.name || p.id} (${p.id}):`];
        const meta = [];
        if (p.duration) meta.push(`Duration: ${p.duration}`);
        if (p.format) meta.push(`Format: ${p.format}`);
        if (p.start_date) meta.push(`Start: ${p.start_date}`);
        if (meta.length) lines.push(`  ${meta.join(" | ")}`);

        const feeParts = [];
        if (p.fees?.emi_start) feeParts.push(`EMI from ${p.fees.emi_start}`);
        if (p.fees?.scholarship) feeParts.push(`Scholarship: ${p.fees.scholarship}`);
        if (p.fees?.seat_booking) feeParts.push(`Booking: ${p.fees.seat_booking}`);
        if (p.fees?.success_fee) feeParts.push(`Success Fee: ${p.fees.success_fee}`);
        if (feeParts.length) lines.push(`  Fees & Financing: ${feeParts.join(" | ")}`);

        const plParts = [];
        if (pl.placement_rate || pl.promotion_rate) plParts.push(`Placement: ${pl.placement_rate || pl.promotion_rate}`);
        if (pl.average_ctc) plParts.push(`Avg CTC: ${pl.average_ctc}`);
        if (pl.salary_growth) plParts.push(`Jump: ${pl.salary_growth}`);
        if (plParts.length) lines.push(`  Placement Outcome: ${plParts.join(" | ")}`);

        if (Array.isArray(pl.top_recruiters) && pl.top_recruiters.length) {
          lines.push(`  Recruiters: ${pl.top_recruiters.join(", ")}`);
        }

        return lines.join("\n");
      })
      .join("\n");
    sections.push(`PROGRAMS & VERIFIED OUTCOMES:\n${summary}`);
  }

  // Institute USPs (AI Career Engine, 7-Country Internships)
  if (data.institute) {
    sections.push(`INSTITUTE & KEY USPs:\n${truncate(data.institute, 500)}`);
  }

  // Faculty & 1:1 Mentorship
  if (data.faculty) {
    sections.push(`FACULTY & 1:1 MENTORS:\n${truncate(data.faculty, 500)}`);
  }

  // Global Internships
  if (data.internships?.length) {
    sections.push(`100% IN-CLASS PAID INTERNSHIPS (7 Countries: USA, Canada, Dubai, Singapore, Saudi Arabia, Qatar, India):\n${truncate(data.internships.slice(0, 5), 400)}`);
  }

  // Admissions & Financial options
  if (data.admissions) {
    sections.push(`ADMISSION STEPS & FINANCING:\n${truncate(data.admissions, 400)}`);
  }

  const full = sections.join("\n\n");
  return full.length > 3500 ? full.slice(0, 3500) + "…" : full;
}

async function getWebsiteContext() {
  const data = await fetchWebsiteData();
  const context = buildWebsiteContext(data);
  if (context) return { context, source: "website" };
  return { context: null, source: "fallback" };
}

module.exports = { getWebsiteContext, fetchWebsiteData, buildWebsiteContext };
