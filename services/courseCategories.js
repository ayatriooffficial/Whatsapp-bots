/**
 * Course categories for splitting leads into tabs.
 * Maps the signup course strings (from cookie_import column E) to tab names.
 */

const COURSE_TABS = {
  CBA: "CBA",
  DGM: "DGM",
  TBM: "TBM",
};

/**
 * Returns the tab name for a course string, or null if unmapped.
 * Matching is keyword-based and case-insensitive to tolerate
 * variations seen in real data (e.g. "Certified Management Professional (CMP)").
 */
function classifyCourse(courseStr) {
  if (!courseStr) return null;
  const c = String(courseStr).toLowerCase();

  // CBA — Certified Management Professional (CMP)
  if (
    c.includes("cmp") ||
    c.includes("management professional") ||
    c.includes("certified management")
  ) {
    return COURSE_TABS.CBA;
  }

  // DGM — Digital Growth Marketing / Digital Growth Engineer / Digital Marketing
  if (
    c.includes("digital growth") ||
    c.includes("digital marketing") ||
    c.includes("growth marketing") ||
    c.includes("dgm")
  ) {
    return COURSE_TABS.DGM;
  }

  // TBM — Technology & Business Management
  if (
    c.includes("tbm") ||
    c.includes("technology & business") ||
    c.includes("technology and business") ||
    c.includes("business management")
  ) {
    return COURSE_TABS.TBM;
  }

  return null;
}

module.exports = { COURSE_TABS, classifyCourse };
