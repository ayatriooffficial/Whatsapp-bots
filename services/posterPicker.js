/**
 * Shared poster helper — picks a random image from the posters/ folder.
 * Used by both the WhatsApp bot (attached media) and the email-bot
 * (hero image), so both channels share the same image set.
 *
 * Image spec (from plan): 1600x900 JPG (16:9), each <= 150KB, so it
 * renders as a ~600px banner in email and a short wide card in WhatsApp.
 */
const fs = require("fs");
const path = require("path");

const POSTERS_DIR = path.join(__dirname, "..", "posters");
const LEGACY_FALLBACK = path.join(__dirname, "..", "poster.jpeg");

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Returns the absolute path of a random poster image, or null if none exist.
 */
function pickPoster() {
  let files = [];
  try {
    files = fs
      .readdirSync(POSTERS_DIR)
      .filter((f) => IMAGE_EXT.test(f))
      .map((f) => path.join(POSTERS_DIR, f));
  } catch (_) {}

  if (files.length === 0 && fs.existsSync(LEGACY_FALLBACK)) {
    return LEGACY_FALLBACK;
  }
  if (files.length === 0) return null;

  return files[Math.floor(Math.random() * files.length)];
}

/**
 * Returns a list of all poster image paths (for tests / debugging).
 */
function listPosters() {
  try {
    return fs
      .readdirSync(POSTERS_DIR)
      .filter((f) => IMAGE_EXT.test(f))
      .map((f) => path.join(POSTERS_DIR, f));
  } catch (_) {
    return [];
  }
}

module.exports = { pickPoster, listPosters, POSTERS_DIR };
