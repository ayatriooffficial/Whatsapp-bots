require("dotenv").config();

/**
 * websiteContext.js (whatsapp-bot-master)
 * Fetches the Charters Union website's LIVE data (programs, fees, placements,
 * faculty, curriculum, real student stories) from the /api/website-data endpoint
 * and builds a clean dynamic context block for WhatsApp campaign generation and inbound replies.
 */

const WEBSITE_DATA_URL = (
  process.env.WEBSITE_DATA_URL || "https://chartersunion.com/api/website-data"
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

function truncate(v, max = 800) {
  const s = safeStr(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildWebsiteContext(data, courseCode = "") {
  if (!data) return null;

  const sections = [];
  const normalizedCourse = String(courseCode || "").toUpperCase();

  if (data.courses?.length) {
    sections.push(`COURSES OFFERED:\n${data.courses.join(", ")}`);
  }

  // Programs summary
  if (Array.isArray(data.programs) && data.programs.length) {
    let selectedPrograms = data.programs;
    if (normalizedCourse) {
      const filtered = data.programs.filter((p) => {
        const id = String(p.id || "").toUpperCase();
        const name = String(p.name || "").toUpperCase();
        if (normalizedCourse === "CBA") return id.includes("CBA") || id.includes("MBA") || name.includes("ACCOUNT") || name.includes("CERTIFIED BUSINESS") || name.includes("MBA");
        if (normalizedCourse === "DGM") return id.includes("DGM") || id.includes("PGDM") || name.includes("MARKETING") || name.includes("GROWTH");
        if (normalizedCourse === "TBM") return id.includes("TBM") || id.includes("EXEC") || name.includes("TECHNOLOGY") || name.includes("MANAGEMENT");
        return true;
      });
      if (filtered.length) selectedPrograms = filtered;
    }

    const summary = selectedPrograms
      .map((p) => {
        const pl = p.placement || p.career_growth || {};
        const lines = [`- ${p.name || p.id} (${p.id}):`];
        const meta = [];
        if (p.duration) meta.push(`Duration: ${p.duration}`);
        if (p.format) meta.push(`Format: ${p.format}`);
        if (p.eligibility) meta.push(`Eligibility: ${p.eligibility}`);
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
          lines.push(`  Top Recruiters: ${pl.top_recruiters.join(", ")}`);
        }
        if (Array.isArray(p.career_roles) && p.career_roles.length) {
          lines.push(`  Career Roles: ${p.career_roles.slice(0, 5).join(", ")}`);
        }

        return lines.join("\n");
      })
      .join("\n");
    sections.push(`PROGRAMS & VERIFIED OUTCOMES:\n${summary}`);
  }

  // Real curriculum & skills data
  if (Array.isArray(data.programmes) && data.programmes.length) {
    const selectedProgrammes = data.programmes.filter((pr) => {
      const slug = String(pr.slug || "").toUpperCase();
      const title = String(pr.dropdown?.title || "").toUpperCase();
      if (normalizedCourse === "CBA") return slug.includes("CERTIFIED") || title.includes("CBA") || title.includes("CERTIFIED");
      if (normalizedCourse === "DGM") return slug.includes("DIGITAL") || title.includes("DGM") || title.includes("DIGITAL GROWTH");
      if (normalizedCourse === "TBM") return slug.includes("TECHNOLOGY") || title.includes("TBM") || title.includes("TECHNOLOGY");
      return true;
    });

    const progBlocks = selectedProgrammes.slice(0, 1).map((pr) => {
      const lines = [`- ${pr.dropdown?.title || pr.slug} (page: https://chartersunion.com/${pr.slug})`];
      if (pr.dropdown?.duration) lines.push(`  Duration: ${pr.dropdown.duration}`);
      if (pr.card?.format?.type) lines.push(`  Format: ${pr.card.format.type}`);
      if (pr.card?.description) lines.push(`  Overview: ${truncate(pr.card.description, 250)}`);
      if (pr.card?.careerOutcomes?.length) lines.push(`  Career Outcomes: ${pr.card.careerOutcomes.slice(0, 5).join(" | ")}`);

      const courseData = pr.curriculum?.courseData;
      if (courseData && typeof courseData === "object") {
        const allTerms = Object.values(courseData)
          .filter(Array.isArray)
          .flat()
          .filter((t) => t && Array.isArray(t.courses));
        if (allTerms.length) {
          const terms = allTerms.slice(0, 4).map((t) => {
            const courses = t.courses.map((c) => `${c.title}${c.code ? ` (${c.code})` : ""}`).slice(0, 6).join("; ");
            return `    ${t.term || ""}${t.location ? ` (${t.location})` : ""}: ${courses}`;
          });
          lines.push(`  CURRICULUM (real terms/courses):\n${terms.join("\n")}`);
        }
      }

      if (pr.curriculumSection?.skillsData) {
        const skills = pr.curriculumSection.skillsData.previewSkills || [];
        const tools = pr.curriculumSection.skillsData.modalToolsLearn?.tools || [];
        if (skills.length) lines.push(`  Skills you'll learn: ${skills.slice(0, 12).join(", ")}`);
        if (tools.length) lines.push(`  Tools you'll learn: ${tools.slice(0, 8).join(", ")}`);
      }
      return lines.join("\n");
    });

    if (progBlocks.length) sections.push(`PROGRAMME PAGE DATA (REAL CURRICULUM & OUTCOMES):\n${progBlocks.join("\n")}`);
  }

  // Real student stories
  const studentData = data.students || {};
  const studentGroups = [
    ...(Array.isArray(studentData.cba) ? studentData.cba.map((s) => ({ ...s, _course: "CBA" })) : []),
    ...(Array.isArray(studentData.dgm) ? studentData.dgm.map((s) => ({ ...s, _course: "DGM" })) : []),
    ...(Array.isArray(studentData.tbm) ? studentData.tbm.map((s) => ({ ...s, _course: "TBM" })) : []),
    ...(Array.isArray(studentData.home) ? studentData.home.map((s) => ({ ...s, _course: s._course || "CBA" })) : [])
  ].filter((s) => s && s.name);

  if (studentGroups.length) {
    const courseFiltered = normalizedCourse
      ? studentGroups.filter((s) => s._course === normalizedCourse)
      : studentGroups;
    const picked = (courseFiltered.length ? courseFiltered : studentGroups).slice(0, 5);
    const stories = picked.map((s) => {
      const parts = [s.name];
      if (s.role) parts.push(`${s.role}`);
      if (s.company) parts.push(`at ${s.company}`);
      if (s.background) parts.push(`(${s.background})`);
      if (s.timeToPlace) parts.push(`placed ${s.timeToPlace}`);
      if (s.internship) parts.push(`internship: ${s.internship}`);
      if (s.caseStudies) parts.push(`case: ${s.caseStudies}`);
      return `- ${parts.join(" | ")}`;
    });
    sections.push(`REAL STUDENT STORIES (from chartersunion.com — use ONLY these verified alumni; NEVER invent a student):\n${stories.join("\n")}`);
  }

  // Faculty
  const facultyList = Array.isArray(data.faculty) ? data.faculty : (data.faculty?.facultyMembers || []);
  if (facultyList.length) {
    const f = facultyList.slice(0, 5).map((x) => `- ${x.name || ""}${x.title ? ` — ${x.title}` : ""}${x.company ? ` (${x.company})` : ""}`).join("\n");
    sections.push(`REAL FACULTY (from chartersunion.com):\n${f}`);
  }

  if (data.institute) sections.push(`INSTITUTE & USPs:\n${truncate(data.institute, 500)}`);
  if (data.home) sections.push(`PLACEMENT HIGHLIGHTS:\n${truncate(data.home, 500)}`);

  const full = sections.join("\n\n");
  return full.length > 6000 ? full.slice(0, 6000) + "…" : full;
}

async function getWebsiteContext(courseCode = "") {
  const data = await fetchWebsiteData();
  const context = buildWebsiteContext(data, courseCode);
  return context ? { context, source: "website" } : { context: null, source: "fallback" };
}

module.exports = { getWebsiteContext, fetchWebsiteData, buildWebsiteContext };
