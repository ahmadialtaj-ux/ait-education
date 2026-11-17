// js/mock.js — Boss Battle / mock test engine: unlock check, start card, exam phase with deferred marking, marking phase & results (ENGAGEMENT_SPEC §4)

import { markAutoQuestion, evaluateWrittenSuggested, evaluateWrittenSelf } from "./marking.js";
import { awardXpEvent, unlockBadge, queueRewardMilestone } from "./game.js";
import { applyQuestionAttempt } from "./storage.js";
import { computeUnitTotalMarks } from "./themes.js";

// Boss unlocks when all lesson zones of the chapter are cleared, OR by parent override (§4)
export function isBossUnlocked(progress, chapterUnits = [], mockUnitId) {
  if (progress?.settings?.mockUnlocked?.[mockUnitId]) {
    return { unlocked: true, byParent: true };
  }
  const lessonUnits = chapterUnits.filter((u) => u.id !== mockUnitId);
  if (lessonUnits.length === 0) {
    return { unlocked: true, byParent: false };
  }
  const allCleared = lessonUnits.every((u) => Boolean(progress?.units?.[u.id]?.cleared));
  return { unlocked: allCleared, byParent: false };
}

export function initOrResumeMockSession(progress, unit, { startImmediately = false } = {}) {
  if (!progress.mock) progress.mock = {};
  const existing = progress.mock[unit.id];
  const timerEnabled = Boolean(progress.settings?.mockTimer);
  const customMin = Number(progress.settings?.mockTimerMinutes?.[unit.id]) || unit.meta?.estMinutes || 35;

  if (existing && (existing.phase === "start" || existing.phase === "exam" || existing.phase === "marking")) {
    if (startImmediately && existing.phase === "start") {
      existing.phase = "exam";
      existing.timerEnabled = timerEnabled;
      existing.timerLeftSec = timerEnabled ? customMin * 60 : null;
    } else if (existing.phase === "exam" && Boolean(existing.timerEnabled) !== timerEnabled) {
      // v0.3.2: the parent changed the timer setting while a paper was open.
      // Turning it on starts the full time from now; turning it off removes the clock.
      existing.timerEnabled = timerEnabled;
      existing.timerLeftSec = timerEnabled ? customMin * 60 : null;
      existing.timerChangedNotice = timerEnabled ? "on" : "off";
    }
    return existing;
  }

  const prevHistory = existing?.history || [];
  const firstScore = existing?.firstScore ?? null;
  const bestScore = existing?.bestScore ?? null;

  const session = {
    unitId: unit.id,
    attempt: prevHistory.length + 1,
    phase: startImmediately ? "exam" : "start", // "start" | "exam" | "marking" | "results"
    currentIndex: 0,
    markingWrittenIndex: 0,
    answers: {},
    writtenEvaluations: {},
    timerEnabled,
    timerLeftSec: timerEnabled ? customMin * 60 : null,
    timeExpired: false,
    firstScore,
    bestScore,
    history: prevHistory
  };

  progress.mock[unit.id] = session;
  return session;
}

export function beginMockExam(progress, unit) {
  const session = initOrResumeMockSession(progress, unit, { startImmediately: true });
  session.phase = "exam";
  return session;
}

export function saveMockExamAnswer(progress, unitId, questionId, answerValue) {
  const session = progress.mock?.[unitId];
  if (!session || (session.phase !== "exam" && session.phase !== "start")) return;
  session.answers[questionId] = answerValue;
}

// Transition from Exam Phase -> Marking Phase (or directly to Results if no written questions)
export function submitMockPaper(progress, unit, { timeExpired = false } = {}) {
  const session = progress.mock?.[unit.id];
  if (!session) return null;

  session.timeExpired = Boolean(timeExpired);
  session.autoScores = {};
  session.writtenEvaluations = {};

  const questions = unit.practice || [];
  const writtenQuestions = [];

  for (const q of questions) {
    const ans = session.answers[q.id];
    if (q.type === "written") {
      writtenQuestions.push(q);
      // Step 1 of deferred written marking: compute suggested score immediately & lock it
      const { suggestedScore, matchedIds } = evaluateWrittenSuggested(q, ans || "");
      session.writtenEvaluations[q.id] = {
        studentText: ans || "",
        suggestedScore,
        matchedIds,
        ticks: [...matchedIds],
        selfScore: null,
        toDiscuss: false,
        confirmed: false
      };
    } else {
      const res = markAutoQuestion(q, ans);
      session.autoScores[q.id] = res.score;
    }
  }

  if (writtenQuestions.length > 0) {
    session.phase = "marking";
    session.markingWrittenIndex = 0;
  } else {
    finalizeMockResults(progress, unit);
  }

  return session;
}

export function confirmMockWrittenSelfMark(progress, unit, question, tickedIds) {
  const session = progress.mock?.[unit.id];
  if (!session) return null;
  const ev = session.writtenEvaluations?.[question.id];
  if (!ev) return null;

  const { selfScore, toDiscuss } = evaluateWrittenSelf(question, tickedIds, ev.suggestedScore);
  ev.ticks = [...tickedIds];
  ev.selfScore = selfScore;
  ev.toDiscuss = toDiscuss;
  ev.confirmed = true;

  // Award self-mark checklist XP once per globalQid (§5.1)
  awardXpEvent(progress, `self:${unit.id}#${question.id}`, 8);

  return ev;
}

export function finalizeMockResults(progress, unit) {
  const session = progress.mock?.[unit.id];
  if (!session) return null;

  const questions = unit.practice || [];
  const totalAvailable = computeUnitTotalMarks(unit);
  let totalEarned = 0;
  const topicBreakdown = {};

  for (const q of questions) {
    let qScore = 0;
    if (q.type === "written") {
      const ev = session.writtenEvaluations?.[q.id];
      qScore = ev?.selfScore ?? ev?.suggestedScore ?? 0;
      applyQuestionAttempt(progress, unit.id, q, {
        score: qScore,
        suggestedScore: ev?.suggestedScore ?? 0,
        selfScore: qScore,
        ticks: ev?.ticks || [],
        toDiscuss: Boolean(ev?.toDiscuss),
        answer: ev?.studentText || "",
        version: unit.meta?.version
      });
    } else {
      qScore = session.autoScores?.[q.id] ?? 0;
      applyQuestionAttempt(progress, unit.id, q, {
        score: qScore,
        answer: session.answers?.[q.id],
        version: unit.meta?.version
      });
    }

    totalEarned += qScore;
    if (!topicBreakdown[q.topic]) {
      topicBreakdown[q.topic] = {
        topic: q.topic,
        label: unit.topics?.[q.topic] || q.topic,
        earned: 0,
        marks: 0
      };
    }
    topicBreakdown[q.topic].earned += qScore;
    topicBreakdown[q.topic].marks += q.marks || 0;
  }

  const pct = totalAvailable > 0 ? Math.round((totalEarned / totalAvailable) * 100) : 0;
  const isFirstPaper = session.firstScore === null || session.firstScore === undefined;
  const prevBest = session.bestScore ?? session.firstScore ?? 0;
  const beatPreviousBest = !isFirstPaper && totalEarned > prevBest;

  if (isFirstPaper) {
    session.firstScore = totalEarned;
    session.bestScore = totalEarned;
    awardXpEvent(progress, `boss:${unit.id}`, 60);
    unlockBadge(progress, "boss-attempted");
    if (pct >= 50) unlockBadge(progress, "boss-bronze");
    if (pct >= 70) unlockBadge(progress, "boss-silver");
    if (pct >= 85) unlockBadge(progress, "boss-gold");
    queueRewardMilestone(progress, "First Boss paper completed");
  } else if (beatPreviousBest) {
    session.bestScore = totalEarned;
    const newBestCount = (session.history || []).filter((h) => h.wasNewBest).length + 1;
    awardXpEvent(progress, `bossbest:${unit.id}:${newBestCount}`, 30);
    unlockBadge(progress, "personal-best");
  }

  if (!progress.units[unit.id]) {
    progress.units[unit.id] = { timeSpentSec: 0, cleared: true, attempts: 0 };
  }
  progress.units[unit.id].cleared = true;
  progress.units[unit.id].mode = "mock";
  progress.units[unit.id].attempts = (progress.units[unit.id].attempts || 0) + 1;
  if (progress.units[unit.id].firstScore === undefined) {
    progress.units[unit.id].firstScore = totalEarned;
    progress.units[unit.id].maxMarks = totalAvailable;
  }

  const resultSummary = {
    attempt: session.attempt,
    totalEarned,
    totalAvailable,
    pct,
    isFirstPaper,
    beatPreviousBest,
    previousBest: prevBest,
    firstScore: session.firstScore,
    bestScore: session.bestScore,
    topicBreakdown: Object.values(topicBreakdown),
    completedAt: new Date().toISOString()
  };

  session.lastResult = resultSummary;
  session.history = [...(session.history || []), { ...resultSummary, wasNewBest: beatPreviousBest }];
  session.phase = "results";

  return resultSummary;
}
