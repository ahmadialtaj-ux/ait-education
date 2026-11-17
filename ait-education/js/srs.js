// js/srs.js — Leitner spaced repetition flashcards, weak-topic practice selector & test-date cram mode (ENGAGEMENT_SPEC §6 & PLAYER_SPEC)

const BOX_INTERVALS_DAYS = {
  1: 1,
  2: 3,
  3: 7,
  4: 21, // Mastered check at 21 days
  5: 365 // Fully mastered after passing 21-day check
};

let fakeTodayOverride = null;

function formatDateObjYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function setFakeToday(dateStrOrNull) {
  fakeTodayOverride = dateStrOrNull;
}

export function getLocalTodayStr(nowDate = null) {
  if (nowDate instanceof Date) {
    return formatDateObjYmd(nowDate);
  }
  if (fakeTodayOverride) return fakeTodayOverride;
  return formatDateObjYmd(new Date());
}

export function addDaysStr(yyyyMmDd, daysToAdd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + daysToAdd);
  return formatDateObjYmd(dt);
}

export function daysBetween(startYmd, endYmd) {
  if (!startYmd || !endYmd) return 0;
  const [y1, m1, d1] = startYmd.split("-").map(Number);
  const [y2, m2, d2] = endYmd.split("-").map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

// Enter flashcards into Box 1 at Unit Debrief if not already in SRS (§3.4, §6)
export function enrollUnitFlashcards(progress, unit, todayStr = getLocalTodayStr()) {
  if (!unit?.recap?.flashcards) return 0;
  if (!progress.srs) progress.srs = {};
  let added = 0;
  for (const fc of unit.recap.flashcards) {
    const globalCardId = `${unit.id}#${fc.id}`;
    if (!progress.srs[globalCardId]) {
      progress.srs[globalCardId] = {
        box: 1,
        due: todayStr,
        unitId: unit.id,
        cardId: fc.id,
        front: fc.front,
        back: fc.back
      };
      added += 1;
    } else {
      progress.srs[globalCardId].front = fc.front;
      progress.srs[globalCardId].back = fc.back;
    }
  }
  return added;
}

// Leitner box transition (§6):
// "I knew it" -> up one box, due = today + box interval.
// "Not yet" -> Box 1, due tomorrow.
// Mastered check (box 4) failed -> Box 2, due = today + 3 days.
// Cram review -> does NOT change card's box or due date.
export function reviewFlashcard(cardRecord, knewIt, { isCram = false, todayStr = getLocalTodayStr() } = {}) {
  if (!cardRecord) return null;
  if (isCram) {
    return { ...cardRecord };
  }

  const currentBox = Number(cardRecord.box) || 1;
  let nextBox = currentBox;
  let nextDue = todayStr;

  if (knewIt) {
    nextBox = Math.min(5, currentBox + 1);
    const interval = BOX_INTERVALS_DAYS[nextBox] || 21;
    nextDue = addDaysStr(todayStr, interval);
  } else {
    if (currentBox >= 4) {
      // Mastered check failed -> Box 2 (§6)
      nextBox = 2;
      nextDue = addDaysStr(todayStr, BOX_INTERVALS_DAYS[2]);
    } else {
      // "Not yet" -> Box 1, due tomorrow
      nextBox = 1;
      nextDue = addDaysStr(todayStr, 1);
    }
  }

  return {
    ...cardRecord,
    box: nextBox,
    due: nextDue,
    lastReviewed: todayStr
  };
}

// Return up to 15 due flashcards, oldest due first (§6)
export function getDueFlashcards(progress, unitsById = {}, todayStr = getLocalTodayStr(), maxCards = 15) {
  const srs = progress?.srs || {};
  const dueList = [];

  for (const [globalCardId, rec] of Object.entries(srs)) {
    if (rec.box >= 5) continue;
    if (!rec.due || rec.due <= todayStr) {
      let front = rec.front;
      let back = rec.back;
      if ((!front || !back) && rec.unitId && unitsById[rec.unitId]) {
        const fc = (unitsById[rec.unitId].recap?.flashcards || []).find((f) => f.id === rec.cardId);
        if (fc) {
          front = fc.front;
          back = fc.back;
        }
      }
      if (front && back) {
        dueList.push({
          globalCardId,
          ...rec,
          front,
          back
        });
      }
    }
  }

  dueList.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return dueList.slice(0, maxCards);
}

// Return cards not yet due (or due before/after test date) for cram review without mutating box/due (§6)
export function getCramFlashcards(progress, unitsById = {}, todayStr = getLocalTodayStr(), maxCards = 15) {
  const srs = progress?.srs || {};
  const cramList = [];

  for (const [globalCardId, rec] of Object.entries(srs)) {
    if (rec.due && rec.due > todayStr) {
      let front = rec.front;
      let back = rec.back;
      if ((!front || !back) && rec.unitId && unitsById[rec.unitId]) {
        const fc = (unitsById[rec.unitId].recap?.flashcards || []).find((f) => f.id === rec.cardId);
        if (fc) {
          front = fc.front;
          back = fc.back;
        }
      }
      if (front && back) {
        cramList.push({
          globalCardId,
          ...rec,
          front,
          back
        });
      }
    }
  }

  cramList.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return cramList.slice(0, maxCards);
}

// Compute topics needing practice (PLAYER_SPEC):
// At least 3 first-attempt marks available in that topic AND < 60% of them earned
// (self score for written, try-1 score for auto-marked).
export function getTopicsNeedingPractice(progress, unitsById = {}) {
  const qRecords = progress?.questions || {};
  const topicStats = {};

  for (const rec of Object.values(qRecords)) {
    if (rec.firstAttemptScore === null || rec.firstAttemptScore === undefined) continue;
    const topicKey = `${rec.unitId}::${rec.topic}`;
    if (!topicStats[topicKey]) {
      const unitObj = unitsById[rec.unitId];
      const topicLabel = unitObj?.topics?.[rec.topic] || rec.topic;
      topicStats[topicKey] = {
        unitId: rec.unitId,
        topic: rec.topic,
        topicLabel,
        availableMarks: 0,
        earnedMarks: 0
      };
    }
    const earned = rec.type === "written"
      ? (rec.selfFirstScore ?? rec.firstAttemptScore ?? 0)
      : (rec.firstAttemptScore ?? 0);
    topicStats[topicKey].availableMarks += Number(rec.marks) || 0;
    topicStats[topicKey].earnedMarks += Number(earned) || 0;
  }

  const needingPractice = [];
  for (const stat of Object.values(topicStats)) {
    if (stat.availableMarks >= 3) {
      const ratio = stat.earnedMarks / stat.availableMarks;
      if (ratio < 0.6) {
        needingPractice.push({
          ...stat,
          pct: Math.round(ratio * 100)
        });
      }
    }
  }

  return needingPractice;
}

// Select up to 2 quick-practice challenges from topics needing practice (§6)
export function getDailyPracticeQuestions(progress, unitsById = {}, maxQuestions = 2) {
  const weakTopics = getTopicsNeedingPractice(progress, unitsById);
  const weakSet = new Set(weakTopics.map((t) => `${t.unitId}::${t.topic}`));
  const candidates = [];

  for (const unit of Object.values(unitsById)) {
    if (!unit || unit.meta?.mode === "mock") continue;
    const allQs = [...(unit.check || []), ...(unit.practice || [])];
    for (const q of allQs) {
      if (weakSet.has(`${unit.id}::${q.topic}`) && q.type !== "written") {
        candidates.push({ unitId: unit.id, unit, question: q });
      }
    }
  }

  if (progress?.settings?.easierStartReview) {
    candidates.sort((a, b) => (a.question.difficulty || 1) - (b.question.difficulty || 1));
  }

  return candidates.slice(0, maxQuestions);
}
