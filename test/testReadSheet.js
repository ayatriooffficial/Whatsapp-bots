require("dotenv").config();
const { loadSheet } = require("../services/sheetService");
const { resolveSlotTemplate, invalidateCache } = require("../services/messageTemplates");

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}

async function testRead() {
  invalidateCache();
  const course = String(arg("course", "CBA")).toUpperCase();
  const day = Number(arg("day", 1));
  const slot = Number(arg("slot", 1));
  const name = String(arg("name", "Suman"));
  const template = await resolveSlotTemplate(loadSheet, {
    course,
    day,
    slot,
    name,
  });
  console.log("\n==========================================");
  console.log(`TEMPLATE RESOLVED FROM GOOGLE SHEETS (${course} Day ${day} Slot ${slot}):`);
  console.log("==========================================");
  console.log(template);
  console.log("==========================================\n");
  process.exit(0);
}

testRead();
