const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs.readFileSync("app.js", "utf8");
const start = appSource.indexOf("function getHardModeConstraints");
const end = appSource.indexOf("function getEligibleGuesses");

assert.notEqual(start, -1, "Hard Mode constraints function was not found");
assert.notEqual(end, -1, "Hard Mode eligibility function was not found");

function loadHardModeRules(submittedClues) {
  const context = { submittedClues };
  vm.runInNewContext(
    `${appSource.slice(start, end)}\nthis.rules = { getHardModeConstraints, isValidHardModeGuess };`,
    context
  );
  return context.rules;
}

{
  const rules = loadHardModeRules([
    { guess: "crane", feedback: ["correct", "absent", "absent", "absent", "absent"] }
  ]);
  const constraints = rules.getHardModeConstraints();
  assert.equal(rules.isValidHardModeGuess("cigar", constraints), true);
  assert.equal(rules.isValidHardModeGuess("sugar", constraints), false);
}

{
  const rules = loadHardModeRules([
    { guess: "crane", feedback: ["present", "absent", "absent", "absent", "absent"] }
  ]);
  const constraints = rules.getHardModeConstraints();
  assert.equal(rules.isValidHardModeGuess("uncle", constraints), true);
  assert.equal(rules.isValidHardModeGuess("cigar", constraints), false);
  assert.equal(rules.isValidHardModeGuess("sugar", constraints), false);
}

{
  const rules = loadHardModeRules([
    { guess: "eerie", feedback: ["present", "correct", "absent", "absent", "correct"] }
  ]);
  const constraints = rules.getHardModeConstraints();
  assert.equal(rules.isValidHardModeGuess("bevee", constraints), true);
  assert.equal(rules.isValidHardModeGuess("tense", constraints), false);
}

console.log("Hard Mode constraints passed.");
