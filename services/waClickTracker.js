function wrapWaUrls(text, phoneDigits) {
  const base = String(process.env.WA_CLICK_TRACKER_BASE || "").replace(/\/+$/, "");
  const path = String(process.env.WA_CLICK_TRACKER_PATH || "/wa/c");
  if (!base || !text) return text;
  const digits = String(phoneDigits || "").replace(/\D/g, "");
  if (!digits) return text;
  return String(text).replace(/https?:\/\/(?:www\.)?chartersunion\.com[^\s)"]*/gi, (url) => {
    try {
      const clean = url.replace(/[.,;!?]+$/, "");
      const trail = url.slice(clean.length);
      return `${base}${path}?phone=${encodeURIComponent(digits)}&to=${encodeURIComponent(clean)}${trail}`;
    } catch {
      return url;
    }
  });
}

module.exports = { wrapWaUrls };
