const { programs } = require("./dataLoader");

function findProgram(text) {
  const q = (text || "").toLowerCase();

  // Check Executive MBA first — it also contains "mba"
  if (
    q.includes("executive") ||
    q.includes("product growth") ||
    q.includes("working professional") ||
    q.includes("executive mba") ||
    q.includes("emba")
  ) return programs.programs.find(p => p.id === "executive");

  // PGDM
  if (
    q.includes("pgdm") ||
    q.includes("post graduate diploma") ||
    q.includes("postgraduate diploma")
  ) return programs.programs.find(p => p.id === "pgdm");

  // MBA
  if (
    q.includes("mba") ||
    q.includes("master of business") ||
    q.includes("masters in business") ||
    q.includes("business administration")
  ) return programs.programs.find(p => p.id === "mba");

  return null;
}

module.exports = findProgram;