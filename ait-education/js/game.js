// js/game.js — XP event ledger, ranks, badges, weekly target, Reward Menu & session/break timer (ENGAGEMENT_SPEC §3.6, §5)

import { getXpLevels, getThemeById } from "./themes.js";
import { getLocalTodayStr } from "./srs.js";

export const BADGE_CATALOG = [
  { id: "first-dive", title: "First Dive", desc: "Completed your first mission." },
  { id: "comeback", title: "Comeback", desc: "Got 5 challenges right on the second try." },
  { id: "examiners-eye", title: "Examiner's Eye", desc: "Completed 10 self-mark checklists." },
  { id: "zone-cleared", title: "Zone Cleared", desc: "Cleared a learning zone." },
  { id: "memory-bank", title: "Memory Bank", desc: "Cleared Daily Review on 7 days in total." },
  { id: "curious-mind", title: "Curious Mind", desc: "Opened 5 'In real life…' boxes." },
  { id: "week-target", title: "Week Target", desc: "Reached your weekly study target." },
  { id: "boss-attempted", title: "Boss Attempted", desc: "Submitted your first Boss paper." },
  { id: "boss-bronze", title: "Boss Bronze", desc: "Scored 50% or more on your first Boss paper." },
  { id: "boss-silver", title: "Boss Silver", desc: "Scored 70% or more on your first Boss paper." },
  { id: "boss-gold", title: "Boss Gold", desc: "Scored 85% or more on your first Boss paper." },
  { id: "personal-best", title: "Personal Best", desc: "Beat your first Boss score on a retake." },
  { id: "topic-master", title: "Topic Master", desc: "All challenges in a topic right on the first try (min 3 marks).", hiddenUntilEarned: true }
];

export function getIsoWeekStr(dateStr = getLocalTodayStr()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function getPreviousIsoWeekStr(dateStr = getLocalTodayStr()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 7);
  const prevYmd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return getIsoWeekStr(prevYmd);
}

export function getTotalXp(progress) {
  const events = progress?.xpEvents || {};
  let sum = 0;
  for (const ev of Object.values(events)) {
    sum += Number(ev?.xp) || 0;
  }
  return sum;
}

export function getRankInfo(progress) {
  const xp = getTotalXp(progress);
  const levels = getXpLevels();
  const theme = getThemeById(progress?.profile?.themeId || "explorer");
  const ranks = theme.ranks || ["Scout", "Pathfinder", "Navigator", "Trailblazer", "Expedition Leader", "Legend Explorer"];

  let levelIndex = 0;
  for (let i = 0; i < levels.length; i++) {
    if (xp >= levels[i]) {
      levelIndex = i;
    } else {
      break;
    }
  }
  const rankTitle = ranks[Math.min(levelIndex, ranks.length - 1)];
  const nextThreshold = levelIndex + 1 < levels.length ? levels[levelIndex + 1] : null;
  const currentFloor = levels[levelIndex] || 0;
  const progressPct = nextThreshold
    ? Math.min(100, Math.round(((xp - currentFloor) / (nextThreshold - currentFloor)) * 100))
    : 100;

  return {
    xp,
    levelIndex,
    rankTitle,
    currentFloor,
    nextThreshold,
    progressPct
  };
}

export function awardXpEvent(progress, eventId, xpAmount, nowIso = new Date().toISOString()) {
  if (!progress.xpEvents) progress.xpEvents = {};
  if (progress.xpEvents[eventId]) {
    return { awarded: false, xpAdded: 0, leveledUp: false, newRank: null };
  }
  const beforeRank = getRankInfo(progress);
  progress.xpEvents[eventId] = {
    xp: Number(xpAmount),
    at: nowIso
  };
  const afterRank = getRankInfo(progress);
  const leveledUp = afterRank.levelIndex > beforeRank.levelIndex;
  return {
    awarded: true,
    xpAdded: Number(xpAmount),
    leveledUp,
    newRank: leveledUp ? afterRank.rankTitle : null
  };
}

export function unlockBadge(progress, badgeId, nowIso = new Date().toISOString()) {
  if (!progress.badges) progress.badges = {};
  if (progress.badges[badgeId]) return false;
  progress.badges[badgeId] = nowIso;
  return true;
}

export function recordActiveStudyDay(progress, todayStr = getLocalTodayStr()) {
  if (!progress.weekly) {
    progress.weekly = { target: 3, paused: [], days: {}, onTargetWeeks: 0, lastPromptWeek: null };
  }
  const weekKey = getIsoWeekStr(todayStr);
  if (Array.isArray(progress.weekly.paused) && progress.weekly.paused.includes(weekKey)) {
    return { targetJustHit: false };
  }
  if (!progress.weekly.days) progress.weekly.days = {};
  const list = Array.isArray(progress.weekly.days[weekKey]) ? progress.weekly.days[weekKey] : [];
  const target = Number(progress.weekly.target) || 3;
  const wasBelowTarget = list.length < target;

  if (!list.includes(todayStr)) {
    list.push(todayStr);
    progress.weekly.days[weekKey] = list;
  }

  let targetJustHit = false;
  if (wasBelowTarget && list.length >= target) {
    targetJustHit = true;
    progress.weekly.onTargetWeeks = (Number(progress.weekly.onTargetWeeks) || 0) + 1;
    unlockBadge(progress, "week-target");
    queueRewardMilestone(progress, "Weekly target reached");
  }

  return { targetJustHit };
}

export function getWeeklyStatus(progress, todayStr = getLocalTodayStr()) {
  const weekKey = getIsoWeekStr(todayStr);
  const target = Number(progress?.weekly?.target) || 3;
  const paused = Array.isArray(progress?.weekly?.paused) && progress.weekly.paused.includes(weekKey);
  const activeDays = progress?.weekly?.days?.[weekKey] || [];

  const prevWeek = getPreviousIsoWeekStr(todayStr);
  const prevDays = progress?.weekly?.days?.[prevWeek];
  const prevPaused = Array.isArray(progress?.weekly?.paused) && progress.weekly.paused.includes(prevWeek);
  const hasHistory = Object.keys(progress?.weekly?.days || {}).some((k) => k < weekKey);
  const missedPrevWeek =
    hasHistory &&
    !prevPaused &&
    (!Array.isArray(prevDays) || prevDays.length < target) &&
    progress?.weekly?.lastPromptWeek !== prevWeek;

  return {
    weekKey,
    prevWeek,
    target,
    doneDays: activeDays.length,
    paused,
    onTargetThisWeek: !paused && activeDays.length >= target,
    onTargetWeeks: Number(progress?.weekly?.onTargetWeeks) || 0,
    showBlockerPrompt: Boolean(missedPrevWeek)
  };
}

export function queueRewardMilestone(progress, reason) {
  if (!progress.rewards) {
    progress.rewards = { menu: [], picked: [], pendingMilestones: [] };
  }
  if (!Array.isArray(progress.rewards.pendingMilestones)) {
    progress.rewards.pendingMilestones = [];
  }
  if ((progress.rewards.menu || []).length > 0) {
    progress.rewards.pendingMilestones.push({
      id: `ms-${Date.now()}`,
      reason,
      at: new Date().toISOString()
    });
  }
}

export function evaluateBadges(progress, unit = null) {
  const newlyUnlocked = [];
  const nowIso = new Date().toISOString();

  function tryAward(id) {
    if (unlockBadge(progress, id, nowIso)) {
      newlyUnlocked.push(id);
    }
  }

  // 1. First Dive: first mission completed
  const hasAnyMission = Object.values(progress.missions || {}).some(
    (m) => Array.isArray(m?.done) && m.done.length > 0
  );
  if (hasAnyMission) tryAward("first-dive");

  // 2. Comeback: 5 challenges correct on the second try
  const ch2Count = Object.keys(progress.xpEvents || {}).filter((k) => k.startsWith("ch2:")).length;
  if (ch2Count >= 5) tryAward("comeback");

  // 3. Examiner's Eye: 10 self-mark checklists completed
  const selfCount = Object.keys(progress.xpEvents || {}).filter((k) => k.startsWith("self:")).length;
  if (selfCount >= 10) tryAward("examiners-eye");

  // 4. Zone Cleared: each lesson unit cleared (L1: skip mock units)
  for (const [uid, uRec] of Object.entries(progress.units || {})) {
    const isMockUnit =
      uRec?.mode === "mock" ||
      Boolean(progress.mock?.[uid]) ||
      (unit && unit.id === uid && unit.meta?.mode === "mock");
    if (uRec?.cleared && !isMockUnit) {
      tryAward("zone-cleared");
      tryAward(`zone-cleared:${uid}`);
    }
  }

  // 5. Memory Bank: 7 days in total (not in a row) with Daily Review cleared
  const reviewDaysCount = Object.keys(progress.xpEvents || {}).filter((k) => k.startsWith("review:")).length;
  if (reviewDaysCount >= 7) tryAward("memory-bank");

  // 6. Curious Mind: opened 5 "In real life..." boxes
  const rwCount = Object.keys(progress.realWorldOpened || {}).length;
  if (rwCount >= 5) tryAward("curious-mind");

  // 7. Topic Master (hidden until earned): all challenges in one topic right on try 1 (min 3 marks)
  if (unit && unit.meta?.mode === "lesson") {
    const allUnitQs = [...(unit.check || []), ...(unit.practice || [])];
    const byTopic = {};
    for (const q of allUnitQs) {
      if (!byTopic[q.topic]) byTopic[q.topic] = [];
      byTopic[q.topic].push(q);
    }
    for (const [, qs] of Object.entries(byTopic)) {
      const totalMarks = qs.reduce((acc, q) => acc + (q.marks || 0), 0);
      if (totalMarks < 3) continue;
      const allRightTry1 = qs.every((q) => {
        const gId = `${unit.id}#${q.id}`;
        const qRec = progress.questions?.[gId];
        return qRec && qRec.firstAttemptScore === q.marks;
      });
      if (allRightTry1) {
        tryAward("topic-master");
        break;
      }
    }
  }

  return newlyUnlocked;
}

export class SessionTimerManager {
  constructor({ onUnitSecond, onBreakDue }) {
    this.onUnitSecond = onUnitSecond;
    this.onBreakDue = onBreakDue;
    this.activeSessionSeconds = 0;
    this.lastInputAt = Date.now();
    this.isReadingScreen = false;
    this.inChallengeOrBoss = false;
    this.currentUnitId = null;
    this.breakPromptShownAtSec = 0;
    this.breakMinSetting = 25;
    this.intervalId = null;
  }

  start() {
    if (this.intervalId) clearInterval(this.intervalId);
    const updateInput = () => {
      this.lastInputAt = Date.now();
    };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, updateInput, { passive: true });
    });

    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  setContext({ unitId = null, isReadingScreen = false, inChallengeOrBoss = false, breakMin = 25 }) {
    this.currentUnitId = unitId;
    this.isReadingScreen = Boolean(isReadingScreen);
    this.inChallengeOrBoss = Boolean(inChallengeOrBoss);
    this.breakMinSetting = Number(breakMin) || 0;
  }

  isIdle() {
    if (document.hidden) return true;
    const idleSec = (Date.now() - this.lastInputAt) / 1000;
    const threshold = this.isReadingScreen ? 180 : 60;
    return idleSec >= threshold;
  }

  tick() {
    if (this.isIdle()) return;
    this.activeSessionSeconds += 1;
    if (this.currentUnitId && typeof this.onUnitSecond === "function") {
      this.onUnitSecond(this.currentUnitId, 1);
    }
  }

  checkBreakBoundary() {
    if (!this.breakMinSetting || this.breakMinSetting <= 0) return false;
    if (this.inChallengeOrBoss) return false;
    const thresholdSec = this.breakMinSetting * 60;
    if (this.activeSessionSeconds - this.breakPromptShownAtSec >= thresholdSec) {
      this.breakPromptShownAtSec = this.activeSessionSeconds;
      if (typeof this.onBreakDue === "function") {
        this.onBreakDue();
      }
      return true;
    }
    return false;
  }

  resetBreakCounter() {
    this.breakPromptShownAtSec = this.activeSessionSeconds;
  }
}
