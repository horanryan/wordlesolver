const form = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess");
const guessBoxes = document.querySelector(".guess-boxes");
const guessTiles = Array.from(document.querySelectorAll(".guess-tile"));
const undoButton = document.querySelector("#undo-button");
const statusOutput = document.querySelector("#status");
const bestGuessOutput = document.querySelector("#best-guess");
const candidateCountOutput = document.querySelector("#candidate-count");
const recommendationsOutput = document.querySelector("#guess-recommendations");
const possibleAnswersOutput = document.querySelector("#possible-answers");
const historyOutput = document.querySelector("#history");
const keyboardKeys = Array.from(document.querySelectorAll(".keyboard-key"));
const hardModeToggle = document.querySelector("#hard-mode-toggle");
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
let solverWorker = null;
let workerReady = false;
let suggestionRequestId = 0;
let suggestionTimer = null;

function cacheSuggestion(signature, suggestion) {
  if (suggestionCache.size >= MAX_SUGGESTION_CACHE_SIZE) {
    suggestionCache.delete(suggestionCache.keys().next().value);
  }

  suggestionCache.set(signature, suggestion);
}

function renderSuggestion(bestGuess, possibleCount, suggestions = [], answerPreview = []) {
  const modeLabel = hardModeToggle.checked ? " · Hard Mode" : "";
  const message = `${possibleCount.toLocaleString()} possible answer${possibleCount === 1 ? "" : "s"} remaining${modeLabel}.`;
  bestGuessOutput.textContent = bestGuess || "-----";
  candidateCountOutput.textContent = message;
  recommendationsOutput.replaceChildren();
  suggestions.forEach(({ word, information, worstCase }, index) => {
    const button = document.createElement("button");
    button.className = "guess-recommendation";
    button.type = "button";
    button.dataset.guess = word;
    button.setAttribute("aria-label", `Use ${word.toUpperCase()} as your next guess`);
    const rank = document.createElement("span");
    rank.className = "recommendation-rank";
    rank.textContent = String(index + 1);
    const recommendationWord = document.createElement("span");
    recommendationWord.className = "recommendation-word";
    recommendationWord.textContent = word;
    const detail = document.createElement("span");
    detail.className = "recommendation-detail";
    detail.textContent = Number.isFinite(information) && Number.isFinite(worstCase)
      ? `${information.toFixed(2)} bits · ${worstCase} max`
      : "Fast rank";
    button.append(rank, recommendationWord, detail);
    recommendationsOutput.append(button);
  });

  possibleAnswersOutput.replaceChildren();
  if (!submittedClues.length) {
    possibleAnswersOutput.textContent = "Add a clue to narrow down the answer list.";
  } else if (!possibleCount) {
    possibleAnswersOutput.textContent = "No matching answers. Check the tile colors in your clues.";
  } else {
    answerPreview.forEach((word) => {
      const answer = document.createElement("span");
      answer.className = "possible-answer";
      answer.textContent = word;
      possibleAnswersOutput.append(answer);
    });

    if (possibleCount > answerPreview.length) {
      const remaining = document.createElement("span");
      remaining.className = "answers-overflow";
      remaining.textContent = `+${(possibleCount - answerPreview.length).toLocaleString()} more`;
      possibleAnswersOutput.append(remaining);
    }
  }

  return message;
}

function prepareSynchronousSolver() {
  if (!guessMetas.length) {
    guessMetas = guessWords.map(createWordMeta);
  }
}

function useSynchronousFallback(message) {
  clearTimeout(suggestionTimer);
  suggestionTimer = null;

  if (solverWorker) {
    solverWorker.onerror = null;
    solverWorker.terminate();
  }

  solverWorker = null;
  workerReady = false;
  prepareSynchronousSolver();
  renderStatus(message);
  updateSuggestion();
}

function startSolverWorker() {
  if (!("Worker" in window)) {
    return false;
  }

  try {
    solverWorker = new Worker("solver-worker.js");
    solverWorker.addEventListener("message", (event) => {
      if (event.data.type === "ready") {
        workerReady = true;
        updateSuggestion();
        return;
      }

      if (event.data.type !== "suggestion" || event.data.requestId !== suggestionRequestId) {
        return;
      }

      const message = renderSuggestion(
        event.data.bestGuess,
        event.data.possibleCount,
        event.data.suggestions,
        event.data.answerPreview
      );
      cacheSuggestion(getClueSignature(), {
        bestGuess: event.data.bestGuess,
        possibleCount: event.data.possibleCount,
        suggestions: event.data.suggestions,
        answerPreview: event.data.answerPreview,
        message
      });
    });
    solverWorker.addEventListener("error", () => {
      useSynchronousFallback("Fast solver unavailable; using compatibility mode.");
    }, { once: true });
    solverWorker.postMessage({
      type: "initialize",
      answers: answerWords,
      guesses: guessWords
    });
    return true;
  } catch {
    solverWorker = null;
    return false;
  }
}

function renderStatus(message) {
  if (message) {
    statusOutput.textContent = message;
    return;
  }

  if (appState.answersLoaded && appState.guessesLoaded && appState.offlineReady) {
    statusOutput.textContent = `Loaded ${appState.answerCount.toLocaleString()} possible answers and ${appState.guessCount.toLocaleString()} valid guesses from the expanded English lists. Not the official NYT answer pool. Offline support is installed.`;
    return;
  }

  if (appState.answersLoaded && appState.guessesLoaded) {
    statusOutput.textContent = `Loaded ${appState.answerCount.toLocaleString()} possible answers and ${appState.guessCount.toLocaleString()} valid guesses from the expanded English lists. Not the official NYT answer pool.`;
    return;
  }

  statusOutput.textContent = "Loading dictionaries.";
}

function parseWordList(text) {
  return [...new Set(text
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]{5}$/.test(word)))];
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
    guessWords = [...new Set([...loadedGuesses, ...loadedAnswers])];
    guessWordSet = new Set(guessWords);
    possibleAnswers = answerWords;
    appState.answerCount = answerWords.length;
    appState.guessCount = guessWords.length;
    appState.answersLoaded = true;
    appState.guessesLoaded = true;
    if (startSolverWorker()) {
      bestGuessOutput.textContent = "-----";
      candidateCountOutput.textContent = "Preparing the fast solver…";
    } else {
      prepareSynchronousSolver();
      updateSuggestion();
    }
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
  const clues = submittedClues
    .map((clue) => `${clue.guess}:${encodeFeedback(clue.feedback)}`)
    .join("|");

  return `${hardModeToggle.checked ? "hard" : "normal"}|${clues}`;
}

function getHardModeConstraints() {
  const requiredPositions = Array.from({ length: 5 }, () => new Set());
  const forbiddenPositions = Array.from({ length: 5 }, () => new Set());
  const minimumCounts = {};

  submittedClues.forEach((clue) => {
    const clueCounts = {};

    clue.feedback.forEach((state, index) => {
      const letter = clue.guess[index];

      if (state === "correct") {
        requiredPositions[index].add(letter);
      } else if (state === "present") {
        forbiddenPositions[index].add(letter);
      }

      if (state === "correct" || state === "present") {
        clueCounts[letter] = (clueCounts[letter] || 0) + 1;
      }
    });

    Object.entries(clueCounts).forEach(([letter, count]) => {
      minimumCounts[letter] = Math.max(minimumCounts[letter] || 0, count);
    });
  });

  return { requiredPositions, forbiddenPositions, minimumCounts };
}

function isValidHardModeGuess(word, constraints) {
  for (let index = 0; index < 5; index += 1) {
    const requiredLetters = constraints.requiredPositions[index];

    if (requiredLetters.size > 1 || (requiredLetters.size === 1 && !requiredLetters.has(word[index]))) {
      return false;
    }

    if (constraints.forbiddenPositions[index].has(word[index])) {
      return false;
    }
  }

  const wordCounts = {};
  word.split("").forEach((letter) => {
    wordCounts[letter] = (wordCounts[letter] || 0) + 1;
  });

  return Object.entries(constraints.minimumCounts).every(([letter, count]) => {
    return (wordCounts[letter] || 0) >= count;
  });
}

function getEligibleGuesses() {
  if (!hardModeToggle.checked || !submittedClues.length) {
    return guessMetas;
  }

  const constraints = getHardModeConstraints();
  return guessMetas.filter((guess) => isValidHardModeGuess(guess.word, constraints));
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

function getFastGuess(candidates, eligibleGuesses) {
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

  const bestGuess = eligibleGuesses.reduce((best, guess) => {
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
  }, null);

  return bestGuess ? bestGuess.word : "";
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

  const eligibleGuesses = getEligibleGuesses();

  if (!eligibleGuesses.length) {
    return "";
  }

  if (candidates.length === 1 && eligibleGuesses.some((guess) => guess.word === candidates[0])) {
    return candidates[0];
  }

  if (candidates.length > EXACT_SCORING_LIMIT) {
    return getFastGuess(candidates, eligibleGuesses);
  }

  const candidateSet = new Set(candidates);
  const eligibleWords = eligibleGuesses.map((guess) => guess.word);
  const eligibleWordSet = new Set(eligibleWords);
  const eligibleCandidates = candidates.filter((word) => eligibleWordSet.has(word));
  const guessesToScore = candidates.length <= 2 && eligibleCandidates.length
    ? eligibleCandidates
    : eligibleWords;
  const bestGuess = guessesToScore.reduce((best, word) => {
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
  }, null);

  return bestGuess ? bestGuess.word : "";
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

  const requestId = ++suggestionRequestId;
  clearTimeout(suggestionTimer);
  suggestionTimer = null;
  const signature = getClueSignature();
  const cachedSuggestion = suggestionCache.get(signature);

  if (cachedSuggestion) {
    renderSuggestion(
      cachedSuggestion.bestGuess,
      cachedSuggestion.possibleCount ?? possibleAnswers.length,
      cachedSuggestion.suggestions || [],
      cachedSuggestion.answerPreview || possibleAnswers.slice(0, 50)
    );
    return;
  }

  if (solverWorker) {
    if (!workerReady) {
      bestGuessOutput.textContent = "-----";
      candidateCountOutput.textContent = "Preparing the fast solver…";
      return;
    }

    candidateCountOutput.textContent = "Finding the best next guess…";
    suggestionTimer = setTimeout(() => {
      if (requestId !== suggestionRequestId || !solverWorker || !workerReady) {
        return;
      }

      solverWorker.postMessage({
        type: "suggest",
        requestId,
        clues: submittedClues.map((clue) => ({
          guess: clue.guess,
          feedback: [...clue.feedback]
        })),
        hardMode: hardModeToggle.checked
      });
      suggestionTimer = null;
    }, 40);
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
  const suggestions = bestGuess
    ? [{ word: bestGuess, information: null, worstCase: null }]
    : [];
  const answerPreview = possibleAnswers.slice(0, 50);
  const message = renderSuggestion(bestGuess, possibleAnswers.length, suggestions, answerPreview);
  cacheSuggestion(signature, {
    bestGuess,
    possibleAnswers,
    possibleCount: possibleAnswers.length,
    suggestions,
    answerPreview,
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

recommendationsOutput.addEventListener("click", (event) => {
  const button = event.target.closest("[data-guess]");

  if (!button) {
    return;
  }

  updateGuess(button.dataset.guess);
  guessBoxes.focus();
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

hardModeToggle.addEventListener("change", () => {
  try {
    localStorage.setItem("wordle-solver-hard-mode", hardModeToggle.checked ? "true" : "false");
  } catch {
    // The toggle still works when browser storage is unavailable.
  }

  updateSuggestion();
  renderStatus(`Hard Mode ${hardModeToggle.checked ? "enabled" : "disabled"}.`);
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

try {
  hardModeToggle.checked = localStorage.getItem("wordle-solver-hard-mode") === "true";
} catch {
  hardModeToggle.checked = false;
}

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
