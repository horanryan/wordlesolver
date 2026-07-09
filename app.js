const form = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess");
const guessBoxes = document.querySelector(".guess-boxes");
const guessTiles = Array.from(document.querySelectorAll(".guess-tile"));
const undoButton = document.querySelector("#undo-button");
const statusOutput = document.querySelector("#status");
const bestGuessOutput = document.querySelector("#best-guess");
const candidateCountOutput = document.querySelector("#candidate-count");
const historyOutput = document.querySelector("#history");
const feedbackOrder = ["absent", "present", "correct"];
const appState = {
  answerCount: 0,
  guessCount: 0,
  answersLoaded: false,
  guessesLoaded: false,
  offlineReady: false
};
let answerWords = [];
let guessWords = [];
let guessWordSet = new Set();
let possibleAnswers = [];
let feedbackStates = Array(5).fill("absent");
const submittedClues = [];

function renderStatus(message) {
  if (message) {
    statusOutput.textContent = message;
    return;
  }

  if (appState.answersLoaded && appState.guessesLoaded && appState.offlineReady) {
    statusOutput.textContent = `Loaded ${appState.answerCount.toLocaleString()} answers and ${appState.guessCount.toLocaleString()} valid guesses. Offline support is installed.`;
    return;
  }

  if (appState.answersLoaded && appState.guessesLoaded) {
    statusOutput.textContent = `Loaded ${appState.answerCount.toLocaleString()} answers and ${appState.guessCount.toLocaleString()} valid guesses.`;
    return;
  }

  statusOutput.textContent = "Loading dictionaries.";
}

function parseWordList(text) {
  return text
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]{5}$/.test(word));
}

async function loadWordList(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }

  return parseWordList(await response.text());
}

async function loadDictionaries() {
  try {
    const [loadedAnswers, loadedGuesses] = await Promise.all([
      loadWordList("answers.txt"),
      loadWordList("valid-guesses.txt")
    ]);

    answerWords = loadedAnswers;
    guessWords = loadedGuesses;
    guessWordSet = new Set(guessWords);
    possibleAnswers = answerWords;
    appState.answerCount = answerWords.length;
    appState.guessCount = guessWords.length;
    appState.answersLoaded = true;
    appState.guessesLoaded = true;
    updateSuggestion();
    renderStatus();
  } catch {
    renderStatus("Dictionaries could not be loaded.");
  }
}

function syncGuessTiles() {
  const letters = guessInput.value.toUpperCase().split("");

  guessTiles.forEach((tile, index) => {
    tile.textContent = letters[index] || "";
    tile.classList.toggle("filled", Boolean(letters[index]));
    tile.classList.remove("absent", "present", "correct");

    if (letters[index]) {
      tile.classList.add(feedbackStates[index]);
    }
  });
}

function updateGuess(value) {
  const nextGuess = value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);
  const previousLength = guessInput.value.length;
  guessInput.value = nextGuess;

  if (nextGuess.length > previousLength) {
    for (let index = previousLength; index < nextGuess.length; index += 1) {
      feedbackStates[index] = "absent";
    }
  }

  syncGuessTiles();
}

function cycleFeedback(index) {
  if (!guessInput.value[index]) {
    return;
  }

  const currentIndex = feedbackOrder.indexOf(feedbackStates[index]);
  feedbackStates[index] = feedbackOrder[(currentIndex + 1) % feedbackOrder.length];
  syncGuessTiles();
}

function getWordleFeedback(answer, guess) {
  const result = Array(5).fill("absent");
  const remaining = {};

  for (let index = 0; index < 5; index += 1) {
    if (answer[index] === guess[index]) {
      result[index] = "correct";
    } else {
      remaining[answer[index]] = (remaining[answer[index]] || 0) + 1;
    }
  }

  for (let index = 0; index < 5; index += 1) {
    const letter = guess[index];

    if (result[index] === "correct") {
      continue;
    }

    if (remaining[letter]) {
      result[index] = "present";
      remaining[letter] -= 1;
    }
  }

  return result;
}

function clueMatches(answer, clue) {
  return getWordleFeedback(answer, clue.guess).every((state, index) => {
    return state === clue.feedback[index];
  });
}

function scoreGuessByPartitions(guess, candidates) {
  const buckets = new Map();

  candidates.forEach((answer) => {
    const pattern = getWordleFeedback(answer, guess).join("");
    buckets.set(pattern, (buckets.get(pattern) || 0) + 1);
  });

  let expectedRemainingScore = 0;
  let worstBucketSize = 0;

  buckets.forEach((bucketSize) => {
    expectedRemainingScore += bucketSize * bucketSize;
    worstBucketSize = Math.max(worstBucketSize, bucketSize);
  });

  return {
    expectedRemainingScore,
    worstBucketSize
  };
}

function isBetterGuess(candidate, best) {
  if (!best) {
    return true;
  }

  if (candidate.expectedRemainingScore !== best.expectedRemainingScore) {
    return candidate.expectedRemainingScore < best.expectedRemainingScore;
  }

  if (candidate.worstBucketSize !== best.worstBucketSize) {
    return candidate.worstBucketSize < best.worstBucketSize;
  }

  if (candidate.isPossibleAnswer !== best.isPossibleAnswer) {
    return candidate.isPossibleAnswer;
  }

  return candidate.word < best.word;
}

function getBestGuess(candidates) {
  if (!candidates.length) {
    return "";
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const candidateSet = new Set(candidates);
  const guessesToScore = candidates.length <= 2 ? candidates : guessWords;

  return guessesToScore.reduce((best, word) => {
    const score = scoreGuessByPartitions(word, candidates);
    const candidate = {
      word,
      isPossibleAnswer: candidateSet.has(word),
      ...score
    };

    if (isBetterGuess(candidate, best)) {
      return candidate;
    }

    return best;
  }, null).word;
}

function renderHistory() {
  historyOutput.innerHTML = "";
  undoButton.disabled = submittedClues.length === 0;

  submittedClues.forEach((clue) => {
    const row = document.createElement("div");
    row.className = "history-row";

    clue.guess.split("").forEach((letter, index) => {
      const tile = document.createElement("span");
      tile.className = `tile ${clue.feedback[index]}`;
      tile.textContent = letter;
      row.append(tile);
    });

    historyOutput.append(row);
  });
}

function updateSuggestion() {
  if (!answerWords.length) {
    return;
  }

  possibleAnswers = answerWords.filter((answer) => {
    return submittedClues.every((clue) => clueMatches(answer, clue));
  });

  const bestGuess = getBestGuess(possibleAnswers);
  bestGuessOutput.textContent = bestGuess || "-----";
  candidateCountOutput.textContent = `${possibleAnswers.length.toLocaleString()} possible answer${possibleAnswers.length === 1 ? "" : "s"} remaining.`;
}

function resetCurrentGuess() {
  guessInput.value = "";
  feedbackStates = Array(5).fill("absent");
  syncGuessTiles();
}

guessBoxes.addEventListener("click", () => {
  guessInput.focus();
});

guessTiles.forEach((tile, index) => {
  tile.addEventListener("click", (event) => {
    event.stopPropagation();
    cycleFeedback(index);
    guessInput.focus();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    updateGuess(guessInput.value.slice(0, -1));
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
    return;
  }

  if (/^[a-z]$/i.test(event.key)) {
    event.preventDefault();
    updateGuess(guessInput.value + event.key);
  }
});

guessInput.addEventListener("input", () => {
  updateGuess(guessInput.value);
});

undoButton.addEventListener("click", () => {
  if (!submittedClues.length) {
    return;
  }

  const removedClue = submittedClues.pop();
  renderHistory();
  updateSuggestion();
  renderStatus(`${removedClue.guess.toUpperCase()} removed.`);
  guessInput.focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const guess = guessInput.value.trim().toLowerCase();

  if (!/^[a-z]{5}$/.test(guess)) {
    renderStatus("Enter five letters before submitting.");
    return;
  }

  if (appState.guessesLoaded && !guessWordSet.has(guess)) {
    renderStatus(`${guess.toUpperCase()} is not in the valid guesses list.`);
    return;
  }

  submittedClues.push({
    guess,
    feedback: [...feedbackStates]
  });
  updateSuggestion();
  renderHistory();
  renderStatus(`${guess.toUpperCase()} added as a clue.`);
  resetCurrentGuess();
});

loadDictionaries();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then(() => {
        appState.offlineReady = true;
        renderStatus();
      })
      .catch(() => {
        renderStatus("Offline support could not be installed.");
      });
  });
}
