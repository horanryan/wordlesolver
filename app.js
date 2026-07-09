const form = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess");
const guessBoxes = document.querySelector(".guess-boxes");
const guessTiles = Array.from(document.querySelectorAll(".guess-tile"));
const undoButton = document.querySelector("#undo-button");
const statusOutput = document.querySelector("#status");
const bestGuessOutput = document.querySelector("#best-guess");
const candidateCountOutput = document.querySelector("#candidate-count");
const historyOutput = document.querySelector("#history");
const keyboardKeys = Array.from(document.querySelectorAll(".keyboard-key"));
const feedbackOrder = ["absent", "present", "correct"];
const feedbackValues = {
  absent: 0,
  present: 1,
  correct: 2
};
const feedbackRank = {
  absent: 1,
  present: 2,
  correct: 3
};
const EXACT_SCORING_LIMIT = 350;
const PARTITION_COUNT = 243;
const MAX_SUGGESTION_CACHE_SIZE = 60;
const appState = {
  answerCount: 0,
  guessCount: 0,
  answersLoaded: false,
  guessesLoaded: false,
  offlineReady: false
};
let answerWords = [];
let guessWords = [];
let guessMetas = [];
let guessWordSet = new Set();
let possibleAnswers = [];
let feedbackStates = Array(5).fill("absent");
const submittedClues = [];
const suggestionCache = new Map();

function cacheSuggestion(signature, suggestion) {
  if (suggestionCache.size >= MAX_SUGGESTION_CACHE_SIZE) {
    suggestionCache.delete(suggestionCache.keys().next().value);
  }

  suggestionCache.set(signature, suggestion);
}

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

function getUniqueLetters(word) {
  const letters = [];

  for (let index = 0; index < word.length; index += 1) {
    const letter = word[index];

    if (!letters.includes(letter)) {
      letters.push(letter);
    }
  }

  return letters;
}

function createWordMeta(word) {
  return {
    word,
    letters: word.split(""),
    uniqueLetters: getUniqueLetters(word)
  };
}

async function loadDictionaries() {
  try {
    const [loadedAnswers, loadedGuesses] = await Promise.all([
      loadWordList("answers.txt"),
      loadWordList("valid-guesses.txt")
    ]);

    answerWords = loadedAnswers;
    guessWords = loadedGuesses;
    guessMetas = guessWords.map(createWordMeta);
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

function encodeFeedback(feedback) {
  return feedback.reduce((code, state) => {
    return code * 3 + feedbackValues[state];
  }, 0);
}

function getClueSignature() {
  return submittedClues
    .map((clue) => `${clue.guess}:${encodeFeedback(clue.feedback)}`)
    .join("|");
}

function getWordleFeedbackCode(answer, guess) {
  let code = 0;
  const result = [0, 0, 0, 0, 0];
  const remaining = {};

  for (let index = 0; index < 5; index += 1) {
    if (answer[index] === guess[index]) {
      result[index] = feedbackValues.correct;
    } else {
      remaining[answer[index]] = (remaining[answer[index]] || 0) + 1;
    }
  }

  for (let index = 0; index < 5; index += 1) {
    const letter = guess[index];

    if (result[index] === feedbackValues.correct) {
      continue;
    }

    if (remaining[letter]) {
      result[index] = feedbackValues.present;
      remaining[letter] -= 1;
    }
  }

  for (let index = 0; index < 5; index += 1) {
    code = code * 3 + result[index];
  }

  return code;
}

function scoreGuessByPartitions(guess, candidates) {
  const buckets = new Uint16Array(PARTITION_COUNT);

  candidates.forEach((answer) => {
    buckets[getWordleFeedbackCode(answer, guess)] += 1;
  });

  let expectedRemainingScore = 0;
  let worstBucketSize = 0;

  buckets.forEach((bucketSize) => {
    if (!bucketSize) {
      return;
    }

    expectedRemainingScore += bucketSize * bucketSize;
    worstBucketSize = Math.max(worstBucketSize, bucketSize);
  });

  return {
    expectedRemainingScore,
    worstBucketSize
  };
}

function getFastGuess(candidates) {
  const positionCounts = Array.from({ length: 5 }, () => ({}));
  const letterCounts = {};
  const candidateSet = new Set(candidates);

  candidates.forEach((answer) => {
    getUniqueLetters(answer).forEach((letter) => {
      letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    });

    for (let index = 0; index < 5; index += 1) {
      const letter = answer[index];
      positionCounts[index][letter] = (positionCounts[index][letter] || 0) + 1;
    }
  });

  return guessMetas.reduce((best, guess) => {
    let score = candidateSet.has(guess.word) ? 0.5 : 0;

    guess.letters.forEach((letter, index) => {
      score += (positionCounts[index][letter] || 0) * 1.4;
    });

    guess.uniqueLetters.forEach((letter) => {
      score += letterCounts[letter] || 0;
    });

    if (!best || score > best.score || (score === best.score && guess.word < best.word)) {
      return {
        word: guess.word,
        score
      };
    }

    return best;
  }, null).word;
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

  if (candidates.length > EXACT_SCORING_LIMIT) {
    return getFastGuess(candidates);
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

  submittedClues.forEach((clue, clueIndex) => {
    const row = document.createElement("div");
    row.className = "history-row";

    clue.guess.split("").forEach((letter, index) => {
      const tile = document.createElement("span");
      tile.className = `tile ${clue.feedback[index]}`;
      tile.textContent = letter;
      tile.tabIndex = 0;
      tile.dataset.clueIndex = clueIndex;
      tile.dataset.tileIndex = index;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", `${letter.toUpperCase()} is ${clue.feedback[index]}. Tap to change.`);
      row.append(tile);
    });

    historyOutput.append(row);
  });

  renderKeyboardFeedback();
}

function cycleSubmittedFeedback(clueIndex, tileIndex) {
  const clue = submittedClues[clueIndex];
  const currentIndex = feedbackOrder.indexOf(clue.feedback[tileIndex]);
  clue.feedback[tileIndex] = feedbackOrder[(currentIndex + 1) % feedbackOrder.length];
  updateSuggestion();
  renderHistory();
  renderStatus(`${clue.guess.toUpperCase()} clue updated.`);
}

function renderKeyboardFeedback() {
  const letterFeedback = {};

  submittedClues.forEach((clue) => {
    clue.guess.split("").forEach((letter, index) => {
      const state = clue.feedback[index];

      if (!letterFeedback[letter] || feedbackRank[state] > feedbackRank[letterFeedback[letter]]) {
        letterFeedback[letter] = state;
      }
    });
  });

  keyboardKeys.forEach((key) => {
    const letter = key.dataset.key;
    key.classList.remove("absent", "present", "correct");

    if (letterFeedback[letter]) {
      key.classList.add(letterFeedback[letter]);
    }
  });
}

function updateSuggestion() {
  if (!answerWords.length) {
    return;
  }

  const signature = getClueSignature();
  const cachedSuggestion = suggestionCache.get(signature);

  if (cachedSuggestion) {
    possibleAnswers = cachedSuggestion.possibleAnswers;
    bestGuessOutput.textContent = cachedSuggestion.bestGuess || "-----";
    candidateCountOutput.textContent = cachedSuggestion.message;
    return;
  }

  const clueCodes = submittedClues.map((clue) => ({
    guess: clue.guess,
    feedbackCode: encodeFeedback(clue.feedback)
  }));

  possibleAnswers = clueCodes.length
    ? answerWords.filter((answer) => {
        return clueCodes.every((clue) => getWordleFeedbackCode(answer, clue.guess) === clue.feedbackCode);
      })
    : answerWords;

  const bestGuess = getBestGuess(possibleAnswers);
  const message = `${possibleAnswers.length.toLocaleString()} possible answer${possibleAnswers.length === 1 ? "" : "s"} remaining.`;
  bestGuessOutput.textContent = bestGuess || "-----";
  candidateCountOutput.textContent = message;
  cacheSuggestion(signature, {
    bestGuess,
    possibleAnswers,
    message
  });
}

function resetCurrentGuess() {
  guessInput.value = "";
  feedbackStates = Array(5).fill("absent");
  syncGuessTiles();
}

guessBoxes.addEventListener("click", () => {
  guessBoxes.focus();
});

guessTiles.forEach((tile, index) => {
  tile.addEventListener("click", (event) => {
    event.stopPropagation();
    cycleFeedback(index);
    guessBoxes.focus();
  });
});

historyOutput.addEventListener("click", (event) => {
  const tile = event.target.closest(".history-row .tile");

  if (!tile) {
    return;
  }

  cycleSubmittedFeedback(Number(tile.dataset.clueIndex), Number(tile.dataset.tileIndex));
});

historyOutput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const tile = event.target.closest(".history-row .tile");

  if (!tile) {
    return;
  }

  event.preventDefault();
  cycleSubmittedFeedback(Number(tile.dataset.clueIndex), Number(tile.dataset.tileIndex));
});

keyboardKeys.forEach((key) => {
  key.addEventListener("click", () => {
    const keyValue = key.dataset.key;

    if (keyValue === "backspace") {
      updateGuess(guessInput.value.slice(0, -1));
      return;
    }

    if (keyValue === "enter") {
      form.requestSubmit();
      return;
    }

    updateGuess(guessInput.value + keyValue);
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
  guessBoxes.focus();
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
