const chartersKnowledge = require("../data/chartersKnowledge.json");

function findProgram(text) {
  const q = String(text || "").toLowerCase().trim();
  if (!q) return null;

  const programs = chartersKnowledge.programs || [];

  // 1. Executive / TBM
  if (
    q.includes("executive") ||
    q.includes("tbm") ||
    q.includes("product growth") ||
    q.includes("technology & business") ||
    q.includes("technology and business") ||
    q.includes("working professional") ||
    q.includes("executive mba") ||
    q.includes("emba")
  ) {
    return programs.find(p => p.id === "tbm") || programs[2];
  }

  // 2. DGM / PGDM / Digital Growth
  if (
    q.includes("dgm") ||
    q.includes("digital growth") ||
    q.includes("growth marketing") ||
    q.includes("pgdm") ||
    q.includes("post graduate diploma") ||
    q.includes("postgraduate diploma")
  ) {
    return programs.find(p => p.id === "dgm") || programs[1];
  }

  // 3. CBA / MBA / Certified Business Accountant
  if (
    q.includes("cba") ||
    q.includes("certified business accountant") ||
    q.includes("business accounting") ||
    q.includes("accountant") ||
    q.includes("mba") ||
    q.includes("master of business") ||
    q.includes("masters in business") ||
    q.includes("business administration")
  ) {
    return programs.find(p => p.id === "cba") || programs[0];
  }

  return null;
}

module.exports = findProgram;