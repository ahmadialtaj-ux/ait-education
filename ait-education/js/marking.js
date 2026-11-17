// js/marking.js — Auto-marking (mcq, tick, fill, match), two-try state machine, written hint matcher & 3-score rules (PLAYER_SPEC v0.3 & ENGAGEMENT_SPEC §3.3)

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normaliseText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B`']/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F"]/g, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function splitSentences(normalisedText) {
  if (!normalisedText) return [];
  return normalisedText
    .split(/[.!?;]+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function phraseMatchesAtWordStart(sentence, phrase) {
  if (!sentence || !phrase) return false;
  const normPhrase = normaliseText(phrase);
  if (!normPhrase) return false;
  const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(normPhrase)}`, "i");
  return regex.test(sentence);
}

// Evaluate which markPoints match via the hint matcher
export function matchWrittenHints(question, studentText) {
  const norm = normaliseText(studentText || "");
  const sentences = splitSentences(norm);
  const matchedIds = [];

  for (const mp of question.markPoints || []) {
    let mpMatched = false;
    for (const sentence of sentences) {
      let acceptHit = false;
      for (const acc of mp.accept || []) {
        if (phraseMatchesAtWordStart(sentence, acc)) {
          acceptHit = true;
          break;
        }
      }
      if (!acceptHit) continue;

      let rejectHit = false;
      for (const rej of mp.reject || []) {
        if (phraseMatchesAtWordStart(sentence, rej)) {
          rejectHit = true;
          break;
        }
      }
      if (!rejectHit) {
        mpMatched = true;
        break;
      }
    }
    if (mpMatched) {
      matchedIds.push(mp.id);
    }
  }
  return matchedIds;
}

// Compute final score from awarded markPoint IDs applying requires, maxPerGroup, then requireGroup, capped at question.marks
export function scoreWrittenMarkPoints(question, tickedPointIds) {
  const tickedSet = new Set(Array.isArray(tickedPointIds) ? tickedPointIds : []);
  const markPoints = question.markPoints || [];

  // 1. Filter by requires: a point with requires only counts if the required point is also ticked
  const validPoints = [];
  for (const mp of markPoints) {
    if (!tickedSet.has(mp.id)) continue;
    if (mp.requires) {
      // Check chain of requires
      let reqId = mp.requires;
      let chainOk = true;
      const visited = new Set([mp.id]);
      while (reqId) {
        if (visited.has(reqId) || !tickedSet.has(reqId)) {
          chainOk = false;
          break;
        }
        visited.add(reqId);
        const reqObj = markPoints.find((p) => p.id === reqId);
        reqId = reqObj ? reqObj.requires : null;
      }
      if (!chainOk) continue;
    }
    validPoints.push(mp);
  }

  // 2. Apply rules in order: maxPerGroup, then requireGroup
  const rules = Array.isArray(question.rules) ? question.rules : [];
  const maxPerGroupRules = rules.filter((r) => r.type === "maxPerGroup");
  const requireGroupRules = rules.filter((r) => r.type === "requireGroup");

  // Group counts
  const groupCounts = {};
  let ungroupedCount = 0;
  for (const mp of validPoints) {
    if (mp.group) {
      groupCounts[mp.group] = (groupCounts[mp.group] || 0) + 1;
    } else {
      ungroupedCount += 1;
    }
  }

  // Apply maxPerGroup
  for (const rule of maxPerGroupRules) {
    if (rule.group && groupCounts[rule.group] !== undefined) {
      groupCounts[rule.group] = Math.min(groupCounts[rule.group], rule.max);
    }
  }

  let rawScore = ungroupedCount + Object.values(groupCounts).reduce((a, b) => a + b, 0);

  // Apply requireGroup
  for (const rule of requireGroupRules) {
    const countInGroup = groupCounts[rule.group] || 0;
    if (countInGroup === 0) {
      rawScore = Math.min(rawScore, rule.capWithout);
    }
  }

  const finalScore = Math.max(0, Math.min(question.marks, Math.floor(rawScore)));
  return {
    score: finalScore,
    validPointIds: validPoints.map((p) => p.id)
  };
}

export function evaluateWrittenSuggested(question, studentText) {
  const matchedIds = matchWrittenHints(question, studentText);
  const { score, validPointIds } = scoreWrittenMarkPoints(question, matchedIds);
  return {
    suggestedScore: score,
    matchedIds,
    validPointIds
  };
}

export function evaluateWrittenSelf(question, tickedIds, suggestedScore) {
  const { score, validPointIds } = scoreWrittenMarkPoints(question, tickedIds);
  const toDiscuss = score > (suggestedScore ?? 0) + 1;
  return {
    selfScore: score,
    validPointIds,
    toDiscuss
  };
}

// Auto-marked question evaluators
export function markMcq(question, selectedIndices) {
  const selected = Array.isArray(selectedIndices)
    ? Array.from(new Set(selectedIndices.map(Number)))
    : [];
  const correctSet = new Set((question.answers || []).map(Number));
  let rightChosen = 0;
  let extraWrongChosen = 0;

  for (const idx of selected) {
    if (correctSet.has(idx)) {
      rightChosen += 1;
    } else {
      extraWrongChosen += 1;
    }
  }

  // LESSON_FORMAT: 1 mark per correct option chosen, wrong extra choices cancel marks, min 0, capped at marks
  const rawMarks = Math.max(0, rightChosen - extraWrongChosen);
  const score = Math.min(question.marks, rawMarks);
  const isFullMarks =
    score === question.marks &&
    rightChosen === correctSet.size &&
    extraWrongChosen === 0;

  return {
    score,
    maxMarks: question.marks,
    correctCount: rightChosen,
    totalItems: correctSet.size,
    isFullMarks,
    itemResults: (question.options || []).map((_, idx) => ({
      index: idx,
      chosen: selected.includes(idx),
      isAnswer: correctSet.has(idx)
    }))
  };
}

export function markTick(question, rowSelections = {}) {
  const rows = question.rows || [];
  const rowsPerMark = question.rowsPerMark || 1;
  let correctRows = 0;
  const itemResults = [];

  for (const row of rows) {
    const chosenCol = rowSelections[row.id];
    const isRight = chosenCol !== undefined && chosenCol !== null && Number(chosenCol) === Number(row.answer);
    if (isRight) correctRows += 1;
    itemResults.push({
      id: row.id,
      chosen: chosenCol,
      answer: row.answer,
      correct: isRight,
      explanation: row.explanation || ""
    });
  }

  const score = Math.min(question.marks, Math.floor(correctRows / rowsPerMark));
  const isFullMarks = correctRows === rows.length && score === question.marks;

  return {
    score,
    maxMarks: question.marks,
    correctCount: correctRows,
    totalItems: rows.length,
    isFullMarks,
    itemResults
  };
}

export function markFill(question, slotAnswers = {}) {
  const items = question.items || [];
  let correctItems = 0;
  const itemResults = [];

  for (const item of items) {
    const chosen = slotAnswers[item.id] || "";
    const isRight = chosen === item.answer;
    if (isRight) correctItems += 1;
    itemResults.push({
      id: item.id,
      chosen,
      answer: item.answer,
      correct: isRight
    });
  }

  const score = Math.min(question.marks, correctItems);
  const isFullMarks = correctItems === items.length && score === question.marks;

  return {
    score,
    maxMarks: question.marks,
    correctCount: correctItems,
    totalItems: items.length,
    isFullMarks,
    itemResults
  };
}

export function markMatch(question, userPairs = {}) {
  const expectedPairs = new Map((question.pairs || []).map(([l, r]) => [l, r]));
  let correctPairs = 0;
  const itemResults = [];

  for (const leftItem of question.left || []) {
    const chosenRight = userPairs[leftItem.id] || null;
    const expectedRight = expectedPairs.get(leftItem.id);
    const isRight = Boolean(chosenRight && chosenRight === expectedRight);
    if (isRight) correctPairs += 1;
    itemResults.push({
      leftId: leftItem.id,
      chosenRightId: chosenRight,
      answerRightId: expectedRight,
      correct: isRight
    });
  }

  const score = Math.min(question.marks, correctPairs);
  const isFullMarks = correctPairs === expectedPairs.size && score === question.marks;

  return {
    score,
    maxMarks: question.marks,
    correctCount: correctPairs,
    totalItems: expectedPairs.size,
    isFullMarks,
    itemResults
  };
}

export function markAutoQuestion(question, answerPayload) {
  switch (question.type) {
    case "mcq":
      return markMcq(question, answerPayload);
    case "tick":
      return markTick(question, answerPayload);
    case "fill":
      return markFill(question, answerPayload);
    case "match":
      return markMatch(question, answerPayload);
    default:
      return { score: 0, maxMarks: question.marks || 1, correctCount: 0, totalItems: 1, isFullMarks: false, itemResults: [] };
  }
}

// Two-try state machine transition (ENGAGEMENT_SPEC §3.3)
// States: "unanswered" -> "try1" -> ("correct" | "try2") -> ("correct2" | "revealed")
export function stepTryStateMachine(currentTryRecord, question, answerPayload) {
  const result = markAutoQuestion(question, answerPayload);
  const prevState = currentTryRecord?.state || "unanswered";

  if (prevState === "unanswered" || prevState === "try1") {
    if (result.isFullMarks) {
      return {
        nextRecord: {
          state: "correct",
          try1: answerPayload,
          try1Score: result.score,
          try1CorrectCount: result.correctCount,
          totalItems: result.totalItems,
          hintShown: false,
          completedAt: new Date().toISOString()
        },
        evaluation: result,
        transition: "try1_correct"
      };
    }
    return {
      nextRecord: {
        state: "try2",
        try1: answerPayload,
        try1Score: result.score,
        try1CorrectCount: result.correctCount,
        totalItems: result.totalItems,
        hintShown: true
      },
      evaluation: result,
      transition: "try1_not_yet"
    };
  }

  if (prevState === "try2") {
    const firstScore = currentTryRecord.try1Score ?? result.score;
    if (result.isFullMarks) {
      return {
        nextRecord: {
          ...currentTryRecord,
          state: "correct2",
          try1Score: firstScore,
          try2: answerPayload,
          try2Score: result.score,
          completedAt: new Date().toISOString()
        },
        evaluation: result,
        transition: "try2_correct"
      };
    }
    return {
      nextRecord: {
        ...currentTryRecord,
        state: "revealed",
        try1Score: firstScore,
        try2: answerPayload,
        try2Score: result.score,
        revealedAt: Date.now()
      },
      evaluation: result,
      transition: "try2_revealed"
    };
  }

  return {
    nextRecord: currentTryRecord,
    evaluation: result,
    transition: "already_done"
  };
}
