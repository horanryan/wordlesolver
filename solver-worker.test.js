const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

function parseWords(path) {
  return fs.readFileSync(path, "utf8").trim().toLowerCase().split(/\s+/);
}

function getFeedback(answer, guess) {
  const feedback = Array(5).fill("absent");
  const remaining = {};

  for (let index = 0; index < 5; index += 1) {
    if (answer[index] === guess[index]) {
      feedback[index] = "correct";
    } else {
      remaining[answer[index]] = (remaining[answer[index]] || 0) + 1;
    }
  }

  for (let index = 0; index < 5; index += 1) {
    const letter = guess[index];

    if (feedback[index] !== "correct" && remaining[letter]) {
      feedback[index] = "present";
      remaining[letter] -= 1;
    }
  }

  return feedback;
}

function encodeFeedback(feedback) {
  return feedback.reduce((code, state) => {
    const value = state === "correct" ? 2 : state === "present" ? 1 : 0;
    return code * 3 + value;
  }, 0);
}

const listeners = {};
const messages = [];
const context = {
  console,
  Map,
  Set,
  Math,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  performance,
  self: {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    postMessage(message) {
      messages.push(message);
    }
  }
};

vm.runInNewContext(fs.readFileSync("solver-worker.js", "utf8"), context);

const answers = parseWords("answers.txt");
const guesses = parseWords("valid-guesses.txt");
listeners.message({ data: { type: "initialize", answers, guesses } });
assert.equal(messages.shift().type, "ready");

for (let answerIndex = 0; answerIndex < 100; answerIndex += 7) {
  for (let guessIndex = 0; guessIndex < 500; guessIndex += 31) {
    const answer = answers[answerIndex];
    const guess = guesses[guessIndex];
    const actual = context.getFeedbackCode(
      context.encodeWord(answer),
      0,
      context.encodeWord(guess),
      0
    );
    assert.equal(actual, encodeFeedback(getFeedback(answer, guess)));
  }
}

listeners.message({
  data: {
    type: "suggest",
    requestId: 1,
    clues: [],
    hardMode: false
  }
});
const opening = messages.shift();
assert.equal(opening.type, "suggestion");
assert.equal(opening.possibleCount, answers.length);
assert.match(opening.bestGuess, /^[a-z]{5}$/);

const target = "cigar";
const guess = "raise";
const feedback = getFeedback(target, guess);
listeners.message({
  data: {
    type: "suggest",
    requestId: 2,
    clues: [{ guess, feedback }],
    hardMode: true
  }
});
const constrained = messages.shift();
assert.equal(constrained.type, "suggestion");
assert.ok(constrained.possibleCount > 0);
assert.match(constrained.bestGuess, /^[a-z]{5}$/);

feedback.forEach((state, index) => {
  if (state === "correct") {
    assert.equal(constrained.bestGuess[index], guess[index]);
  } else if (state === "present") {
    assert.notEqual(constrained.bestGuess[index], guess[index]);
    assert.ok(constrained.bestGuess.includes(guess[index]));
  }
});

assert.ok(opening.durationMs < 1500, `Opening suggestion took ${opening.durationMs.toFixed(1)} ms`);
assert.ok(constrained.durationMs < 1500, `Constrained suggestion took ${constrained.durationMs.toFixed(1)} ms`);

const partitions = new Map();
answers.forEach((answer) => {
  const answerFeedback = getFeedback(answer, guess);
  const key = answerFeedback.join(",");
  const partition = partitions.get(key) || { feedback: answerFeedback, count: 0 };
  partition.count += 1;
  partitions.set(key, partition);
});
const stressPartition = Array.from(partitions.values())
  .filter((partition) => partition.count <= 350)
  .sort((left, right) => right.count - left.count)[0];

listeners.message({
  data: {
    type: "suggest",
    requestId: 3,
    clues: [{ guess, feedback: stressPartition.feedback }],
    hardMode: false
  }
});
const stressResult = messages.shift();
assert.equal(stressResult.possibleCount, stressPartition.count);
assert.match(stressResult.bestGuess, /^[a-z]{5}$/);
assert.ok(stressResult.durationMs < 1500, `Stress suggestion took ${stressResult.durationMs.toFixed(1)} ms`);

console.log(
  `Worker performance passed: opening ${opening.durationMs.toFixed(1)} ms, constrained ${constrained.durationMs.toFixed(1)} ms, ${stressResult.possibleCount}-word stress ${stressResult.durationMs.toFixed(1)} ms.`
);
