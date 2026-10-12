const ANSWER_GUESS_INCLUSION_LIMIT = 350;
const EXACT_SHORTLIST_SIZE = 800;
const PARTITION_COUNT = 243;

let answerWords = [];
let guessWords = [];
let answerLetters = new Uint8Array();
let guessLetters = new Uint8Array();
let guessLetterMasks = new Uint32Array();
let guessIndexByWord = new Map();

function encodeWords(words) {
  const encoded = new Uint8Array(words.length * 5);

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex];
    const offset = wordIndex * 5;

    for (let letterIndex = 0; letterIndex < 5; letterIndex += 1) {
      encoded[offset + letterIndex] = word.charCodeAt(letterIndex) - 97;
    }
  }

  return encoded;
}

function encodeWord(word) {
  const encoded = new Uint8Array(5);

  for (let index = 0; index < 5; index += 1) {
    encoded[index] = word.charCodeAt(index) - 97;
  }

  return encoded;
}

function buildGuessLetterMasks() {
  guessLetterMasks = new Uint32Array(guessWords.length);

  for (let guessIndex = 0; guessIndex < guessWords.length; guessIndex += 1) {
    const offset = guessIndex * 5;
    let mask = 0;

    for (let index = 0; index < 5; index += 1) {
      mask |= 1 << guessLetters[offset + index];
    }

    guessLetterMasks[guessIndex] = mask;
  }
}

function getFeedbackCode(answerSource, answerOffset, guessSource, guessOffset) {
  let correctMask = 0;

  for (let index = 0; index < 5; index += 1) {
    if (answerSource[answerOffset + index] === guessSource[guessOffset + index]) {
      correctMask |= 1 << index;
    }
  }

  let matchedMask = correctMask;
  let code = 0;

  for (let guessPosition = 0; guessPosition < 5; guessPosition += 1) {
    let state = 0;

    if (correctMask & (1 << guessPosition)) {
      state = 2;
    } else {
      const guessLetter = guessSource[guessOffset + guessPosition];

      for (let answerPosition = 0; answerPosition < 5; answerPosition += 1) {
        const positionMask = 1 << answerPosition;

        if (
          !(matchedMask & positionMask) &&
          answerSource[answerOffset + answerPosition] === guessLetter
        ) {
          matchedMask |= positionMask;
          state = 1;
          break;
        }
      }
    }

    code = code * 3 + state;
  }

  return code;
}

function encodeFeedback(feedback) {
  let code = 0;

  for (let index = 0; index < 5; index += 1) {
    const value = feedback[index] === "correct" ? 2 : feedback[index] === "present" ? 1 : 0;
    code = code * 3 + value;
  }

  return code;
}

function getPossibleAnswerIndices(clues) {
  if (!clues.length) {
    return Array.from({ length: answerWords.length }, (_, index) => index);
  }

  const encodedClues = clues.map((clue) => ({
    letters: encodeWord(clue.guess),
    feedbackCode: encodeFeedback(clue.feedback)
  }));
  const possible = [];

  for (let answerIndex = 0; answerIndex < answerWords.length; answerIndex += 1) {
    const answerOffset = answerIndex * 5;
    let matches = true;

    for (let clueIndex = 0; clueIndex < encodedClues.length; clueIndex += 1) {
      const clue = encodedClues[clueIndex];

      if (getFeedbackCode(answerLetters, answerOffset, clue.letters, 0) !== clue.feedbackCode) {
        matches = false;
        break;
      }
    }

    if (matches) {
      possible.push(answerIndex);
    }
  }

  return possible;
}

function getHardModeConstraints(clues) {
  const requiredPositions = new Int8Array(5);
  const forbiddenPositions = new Uint32Array(5);
  const minimumCounts = new Uint8Array(26);
  requiredPositions.fill(-1);

  for (let clueIndex = 0; clueIndex < clues.length; clueIndex += 1) {
    const clue = clues[clueIndex];
    const clueCounts = new Uint8Array(26);

    for (let index = 0; index < 5; index += 1) {
      const letter = clue.guess.charCodeAt(index) - 97;
      const state = clue.feedback[index];

      if (state === "correct") {
        if (requiredPositions[index] !== -1 && requiredPositions[index] !== letter) {
          requiredPositions[index] = -2;
        } else {
          requiredPositions[index] = letter;
        }
        clueCounts[letter] += 1;
      } else if (state === "present") {
        forbiddenPositions[index] |= 1 << letter;
        clueCounts[letter] += 1;
      }
    }

    for (let letter = 0; letter < 26; letter += 1) {
      minimumCounts[letter] = Math.max(minimumCounts[letter], clueCounts[letter]);
    }
  }

  return { requiredPositions, forbiddenPositions, minimumCounts };
}

function isValidHardModeGuess(guessIndex, constraints) {
  const offset = guessIndex * 5;

  for (let index = 0; index < 5; index += 1) {
    const letter = guessLetters[offset + index];
    const requiredLetter = constraints.requiredPositions[index];

    if (requiredLetter === -2 || (requiredLetter >= 0 && letter !== requiredLetter)) {
      return false;
    }

    if (constraints.forbiddenPositions[index] & (1 << letter)) {
      return false;
    }

  }

  for (let letter = 0; letter < 26; letter += 1) {
    const minimumCount = constraints.minimumCounts[letter];

    if (!minimumCount) {
      continue;
    }

    let actualCount = 0;

    for (let index = 0; index < 5; index += 1) {
      if (guessLetters[offset + index] === letter) {
        actualCount += 1;
      }
    }

    if (actualCount < minimumCount) {
      return false;
    }
  }

  return true;
}

function getEligibleGuessIndices(clues, hardMode) {
  if (!hardMode || !clues.length) {
    return Array.from({ length: guessWords.length }, (_, index) => index);
  }

  const constraints = getHardModeConstraints(clues);
  const eligible = [];

  for (let guessIndex = 0; guessIndex < guessWords.length; guessIndex += 1) {
    if (isValidHardModeGuess(guessIndex, constraints)) {
      eligible.push(guessIndex);
    }
  }

  return eligible;
}

function rankGuessesByHeuristic(eligibleGuesses, candidates) {
  const positionCounts = new Uint16Array(5 * 26);
  const letterCounts = new Uint16Array(26);
  const candidateWords = new Set();

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const answerIndex = candidates[candidateIndex];
    const offset = answerIndex * 5;
    let uniqueMask = 0;
    candidateWords.add(answerWords[answerIndex]);

    for (let index = 0; index < 5; index += 1) {
      const letter = answerLetters[offset + index];
      positionCounts[index * 26 + letter] += 1;
      uniqueMask |= 1 << letter;
    }

    for (let letter = 0; letter < 26; letter += 1) {
      if (uniqueMask & (1 << letter)) {
        letterCounts[letter] += 1;
      }
    }
  }

  const ranked = new Array(eligibleGuesses.length);

  for (let eligibleIndex = 0; eligibleIndex < eligibleGuesses.length; eligibleIndex += 1) {
    const guessIndex = eligibleGuesses[eligibleIndex];
    const offset = guessIndex * 5;
    let score = candidateWords.has(guessWords[guessIndex]) ? 0.5 : 0;
    let mask = guessLetterMasks[guessIndex];

    for (let index = 0; index < 5; index += 1) {
      score += positionCounts[index * 26 + guessLetters[offset + index]] * 1.4;
    }

    while (mask) {
      const lowestBit = mask & -mask;
      const letter = 31 - Math.clz32(lowestBit);
      score += letterCounts[letter];
      mask ^= lowestBit;
    }

    ranked[eligibleIndex] = { guessIndex, score };
  }

  ranked.sort((left, right) => {
    return right.score - left.score || guessWords[left.guessIndex].localeCompare(guessWords[right.guessIndex]);
  });

  return ranked;
}

function getExactShortlist(rankedGuesses, candidates) {
  const shortlist = [];
  const included = new Set();
  const limit = Math.min(EXACT_SHORTLIST_SIZE, rankedGuesses.length);

  for (let index = 0; index < limit; index += 1) {
    const guessIndex = rankedGuesses[index].guessIndex;
    shortlist.push(guessIndex);
    included.add(guessIndex);
  }

  if (candidates.length <= ANSWER_GUESS_INCLUSION_LIMIT) {
    for (let index = 0; index < candidates.length; index += 1) {
      const guessIndex = guessIndexByWord.get(answerWords[candidates[index]]);

      if (guessIndex !== undefined && !included.has(guessIndex)) {
        shortlist.push(guessIndex);
        included.add(guessIndex);
      }
    }
  }

  return shortlist;
}

function getBestExactGuess(guessesToScore, candidates) {
  const buckets = new Uint16Array(PARTITION_COUNT);
  const candidateWords = new Set(candidates.map((index) => answerWords[index]));
  const rankedGuesses = [];

  for (let poolIndex = 0; poolIndex < guessesToScore.length; poolIndex += 1) {
    const guessIndex = guessesToScore[poolIndex];
    const guessOffset = guessIndex * 5;
    buckets.fill(0);

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const answerOffset = candidates[candidateIndex] * 5;
      buckets[getFeedbackCode(answerLetters, answerOffset, guessLetters, guessOffset)] += 1;
    }

    let informationCost = 0;
    let expectedRemainingScore = 0;
    let worstBucketSize = 0;

    for (let bucketIndex = 0; bucketIndex < PARTITION_COUNT; bucketIndex += 1) {
      const bucketSize = buckets[bucketIndex];
      if (bucketSize > 1) {
        informationCost += bucketSize * Math.log2(bucketSize);
      }
      expectedRemainingScore += bucketSize * bucketSize;
      worstBucketSize = Math.max(worstBucketSize, bucketSize);
    }

    const word = guessWords[guessIndex];
    rankedGuesses.push({
      word,
      informationCost,
      expectedRemainingScore,
      worstBucketSize,
      isPossibleAnswer: candidateWords.has(word)
    });
  }

  rankedGuesses.sort((left, right) => {
    return left.informationCost - right.informationCost ||
      left.worstBucketSize - right.worstBucketSize ||
      left.expectedRemainingScore - right.expectedRemainingScore ||
      Number(right.isPossibleAnswer) - Number(left.isPossibleAnswer) ||
      left.word.localeCompare(right.word);
  });

  return rankedGuesses.slice(0, 3).map(({ word, informationCost, worstBucketSize }) => ({
    word,
    information: candidates.length
      ? Math.log2(candidates.length) - informationCost / candidates.length
      : 0,
    worstCase: worstBucketSize
  }));
}

function getBestGuess(candidates, eligibleGuesses) {
  if (!candidates.length || !eligibleGuesses.length) {
    return [];
  }

  if (candidates.length === 1) {
    const answer = answerWords[candidates[0]];
    const guessIndex = guessIndexByWord.get(answer);

    if (guessIndex !== undefined && eligibleGuesses.includes(guessIndex)) {
      return [{ word: answer, information: 0, worstCase: 1 }];
    }
  }

  const rankedGuesses = rankGuessesByHeuristic(eligibleGuesses, candidates);

  if (candidates.length <= 2) {
    const eligibleSet = new Set(eligibleGuesses);
    const candidateGuesses = candidates
      .map((answerIndex) => guessIndexByWord.get(answerWords[answerIndex]))
      .filter((guessIndex) => guessIndex !== undefined && eligibleSet.has(guessIndex));

    if (candidateGuesses.length) {
      return getBestExactGuess(candidateGuesses, candidates);
    }
  }

  return getBestExactGuess(getExactShortlist(rankedGuesses, candidates), candidates);
}

function initialize(data) {
  answerWords = data.answers;
  guessWords = data.guesses;
  answerLetters = encodeWords(answerWords);
  guessLetters = encodeWords(guessWords);
  guessIndexByWord = new Map(guessWords.map((word, index) => [word, index]));
  buildGuessLetterMasks();
  self.postMessage({ type: "ready" });
}

function suggest(data) {
  const startedAt = performance.now();
  const candidates = getPossibleAnswerIndices(data.clues);
  const eligibleGuesses = getEligibleGuessIndices(data.clues, data.hardMode);
  const suggestions = getBestGuess(candidates, eligibleGuesses);

  self.postMessage({
    type: "suggestion",
    requestId: data.requestId,
    bestGuess: suggestions.length ? suggestions[0].word : "",
    suggestions,
    possibleCount: candidates.length,
    answerPreview: candidates.slice(0, 50).map((index) => answerWords[index]),
    durationMs: performance.now() - startedAt
  });
}

self.addEventListener("message", (event) => {
  if (event.data.type === "initialize") {
    initialize(event.data);
  } else if (event.data.type === "suggest") {
    suggest(event.data);
  }
});
