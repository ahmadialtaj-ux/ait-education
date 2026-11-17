// js/storage.js — Progress storage v2 with child profiles, v1 migration, and in-memory fallback (ENGAGEMENT_SPEC §9.3 & PLAYER_SPEC)

const PROFILES_KEY = "ait-edu-profiles";
const ACTIVE_PROFILE_KEY = "ait-edu-active-profile";
const PIN_KEY = "ait-edu-parent-pin";
const V1_PROGRESS_KEY = "ait-edu-progress";
const V2_PREFIX = "ait-edu-progress:";

const memoryStore = new Map();

function rawGet(key) {
  try {
    const val = window.localStorage.getItem(key);
    if (val !== null) return val;
  } catch (_) {
    // localStorage unavailable or blocked
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

function rawSet(key, val) {
  memoryStore.set(key, val);
  try {
    window.localStorage.setItem(key, val);
  } catch (_) {
    // Fallback to in-memory store
  }
}

function rawRemove(key) {
  memoryStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch (_) {
    // Ignore
  }
}

export function createDefaultProgress(nickname = "Explorer", themeId = "explorer") {
  return {
    schemaVersion: 2,
    profile: {
      nickname: nickname || "",
      themeId: themeId || "explorer",
      avatar: {
        outfit: "o1",
        skin: 3,
        hair: "h2",
        headwear: "none"
      },
      onboarded: Boolean(nickname && nickname !== "Explorer")
    },
    xpEvents: {},
    badges: {},
    weekly: {
      target: 3,
      paused: [],
      days: {},
      onTargetWeeks: 0,
      lastPromptWeek: null,
      childAdjustedSettings: false
    },
    missions: {},
    tries: {},
    questions: {},
    units: {},
    srs: {},
    dailyReviewLog: {},
    realWorldOpened: {},
    mock: {},
    rewards: {
      menu: [],
      picked: [],
      pendingMilestones: []
    },
    settings: {
      breakMin: 25,
      missionCapMin: 8,
      ttsRate: 0.95,
      onlineVoices: false,
      mockUnlocked: {},
      mockTimer: false,
      mockTimerMinutes: {},
      testDate: null,
      hideTestBanner: false,
      calmMode: false,
      easierStartReview: false
    }
  };
}

export function normalizeProgressBlob(blob) {
  const def = createDefaultProgress();
  if (!blob || typeof blob !== "object") return def;
  return {
    schemaVersion: 2,
    profile: {
      ...def.profile,
      ...(blob.profile || {}),
      avatar: { ...def.profile.avatar, ...(blob.profile?.avatar || {}) }
    },
    xpEvents: { ...(blob.xpEvents || {}) },
    badges: { ...(blob.badges || {}) },
    weekly: {
      ...def.weekly,
      ...(blob.weekly || {}),
      paused: Array.isArray(blob.weekly?.paused) ? [...blob.weekly.paused] : [],
      days: { ...(blob.weekly?.days || {}) }
    },
    missions: { ...(blob.missions || {}) },
    tries: { ...(blob.tries || {}) },
    questions: { ...(blob.questions || {}) },
    units: { ...(blob.units || {}) },
    srs: { ...(blob.srs || {}) },
    dailyReviewLog: { ...(blob.dailyReviewLog || {}) },
    realWorldOpened: { ...(blob.realWorldOpened || {}) },
    mock: { ...(blob.mock || {}) },
    rewards: {
      menu: Array.isArray(blob.rewards?.menu) ? [...blob.rewards.menu] : def.rewards.menu,
      picked: Array.isArray(blob.rewards?.picked) ? [...blob.rewards.picked] : [],
      pendingMilestones: Array.isArray(blob.rewards?.pendingMilestones) ? [...blob.rewards.pendingMilestones] : []
    },
    settings: {
      ...def.settings,
      ...(blob.settings || {}),
      mockUnlocked: { ...(blob.settings?.mockUnlocked || {}) },
      mockTimerMinutes: { ...(blob.settings?.mockTimerMinutes || {}) }
    }
  };
}

export function migrate() {
  let profiles = getProfiles();
  const v1Raw = rawGet(V1_PROGRESS_KEY);

  if (v1Raw) {
    try {
      const v1Data = JSON.parse(v1Raw);
      if (v1Data && typeof v1Data === "object") {
        const p1Id = profiles.length > 0 ? profiles[0].id : "p1";
        const nickname = v1Data.profile?.nickname || v1Data.nickname || "Learner 1";
        const migrated = normalizeProgressBlob({
          ...v1Data,
          schemaVersion: 2,
          profile: {
            nickname,
            themeId: v1Data.profile?.themeId || v1Data.themeId || "explorer",
            avatar: v1Data.profile?.avatar || { outfit: "o1", skin: 3, hair: "h2", headwear: "none" },
            onboarded: true
          },
          questions: v1Data.questions || {},
          units: v1Data.units || {}
        });
        if (profiles.length === 0) {
          profiles = [{ id: p1Id, nickname }];
          saveProfiles(profiles);
        }
        saveProgress(p1Id, migrated);
        rawSet(ACTIVE_PROFILE_KEY, p1Id);
        rawRemove(V1_PROGRESS_KEY);
      }
    } catch (_) {
      // Ignore corrupt v1 blob
    }
  }

  if (profiles.length === 0) {
    const initialProfile = { id: "p1", nickname: "Explorer" };
    profiles = [initialProfile];
    saveProfiles(profiles);
    saveProgress("p1", createDefaultProgress("Explorer", "explorer"));
    rawSet(ACTIVE_PROFILE_KEY, "p1");
  }

  const activeId = rawGet(ACTIVE_PROFILE_KEY);
  if (!activeId || !profiles.some((p) => p.id === activeId)) {
    rawSet(ACTIVE_PROFILE_KEY, profiles[0].id);
  }
}

export function getProfiles() {
  const raw = rawGet(PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveProfiles(profiles) {
  rawSet(PROFILES_KEY, JSON.stringify(profiles));
}

export function getActiveProfileId() {
  const id = rawGet(ACTIVE_PROFILE_KEY);
  const profiles = getProfiles();
  if (id && profiles.some((p) => p.id === id)) return id;
  if (profiles.length > 0) {
    rawSet(ACTIVE_PROFILE_KEY, profiles[0].id);
    return profiles[0].id;
  }
  migrate();
  return rawGet(ACTIVE_PROFILE_KEY) || "p1";
}

export function setActiveProfileId(profileId) {
  const profiles = getProfiles();
  if (profiles.some((p) => p.id === profileId)) {
    rawSet(ACTIVE_PROFILE_KEY, profileId);
    return true;
  }
  return false;
}

export function addProfile(nickname = "New Learner", themeId = "explorer") {
  const profiles = getProfiles();
  const nextNum = profiles.length + 1;
  let id = `p${nextNum}`;
  while (profiles.some((p) => p.id === id)) {
    id = `p${Date.now().toString(36)}`;
  }
  const cleanName = (nickname || `Learner ${nextNum}`).trim();
  profiles.push({ id, nickname: cleanName });
  saveProfiles(profiles);
  const prog = createDefaultProgress(cleanName, themeId);
  saveProgress(id, prog);
  rawSet(ACTIVE_PROFILE_KEY, id);
  return id;
}

export function getProgress(profileId = getActiveProfileId()) {
  const raw = rawGet(`${V2_PREFIX}${profileId}`);
  if (!raw) {
    const fresh = createDefaultProgress();
    saveProgress(profileId, fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeProgressBlob(parsed);
  } catch (_) {
    return createDefaultProgress();
  }
}

export function saveProgress(profileId, progressBlob) {
  const normalized = normalizeProgressBlob(progressBlob);
  rawSet(`${V2_PREFIX}${profileId}`, JSON.stringify(normalized));
  const profiles = getProfiles();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx !== -1 && normalized.profile?.nickname && profiles[idx].nickname !== normalized.profile.nickname) {
    profiles[idx].nickname = normalized.profile.nickname;
    saveProfiles(profiles);
  }
  return normalized;
}

export function updateProgress(mutatorFn, profileId = getActiveProfileId()) {
  const current = getProgress(profileId);
  mutatorFn(current);
  return saveProgress(profileId, current);
}

// Pure mutator on the passed progress object (C1 fix)
export function applyQuestionAttempt(progress, unitId, question, attemptInfo = {}) {
  if (!progress || !question) return progress;
  if (!progress.questions) progress.questions = {};
  const globalQid = `${unitId}#${question.id}`;

  const existing = progress.questions[globalQid] || {
    globalQid,
    unitId,
    questionId: question.id,
    type: question.type,
    marks: question.marks,
    topic: question.topic,
    attempts: 0,
    firstAttemptScore: null,
    suggestedFirstScore: null,
    selfFirstScore: null,
    parentScore: null,
    toDiscuss: false,
    lastScore: null,
    lastAnswer: null,
    firstAttemptAt: null,
    updatedAt: null,
    version: attemptInfo.version || "0.2"
  };

  existing.attempts += 1;
  existing.updatedAt = new Date().toISOString();
  existing.lastScore = attemptInfo.score;
  if (attemptInfo.answer !== undefined) {
    existing.lastAnswer = attemptInfo.answer;
  }

  if (existing.firstAttemptScore === null) {
    existing.firstAttemptAt = existing.updatedAt;
    existing.firstAttemptScore = attemptInfo.score;
    if (question.type === "written") {
      existing.suggestedFirstScore = attemptInfo.suggestedScore ?? attemptInfo.score;
      existing.selfFirstScore = attemptInfo.selfScore ?? attemptInfo.score;
    }
  }

  if (question.type === "written") {
    existing.lastSuggestedScore = attemptInfo.suggestedScore;
    existing.lastSelfScore = attemptInfo.selfScore;
    existing.lastTicks = attemptInfo.ticks || [];
    if (attemptInfo.toDiscuss) {
      existing.toDiscuss = true;
    }
  }

  progress.questions[globalQid] = existing;
  return progress;
}

export function recordQuestionAttempt(unitId, question, attemptInfo, profileId = getActiveProfileId()) {
  return updateProgress((prog) => {
    applyQuestionAttempt(prog, unitId, question, attemptInfo);
  }, profileId);
}

export function setParentWrittenScore(globalQid, parentScore, profileId = getActiveProfileId()) {
  return updateProgress((prog) => {
    if (prog.questions[globalQid]) {
      prog.questions[globalQid].parentScore = Number(parentScore);
      prog.questions[globalQid].toDiscuss = false;
    }
  }, profileId);
}

export function addUnitActiveSeconds(unitId, seconds, profileId = getActiveProfileId()) {
  if (!unitId || seconds <= 0) return;
  updateProgress((prog) => {
    if (!prog.units[unitId]) {
      prog.units[unitId] = { timeSpentSec: 0, diveDone: false, cleared: false, attempts: 0 };
    }
    prog.units[unitId].timeSpentSec = (prog.units[unitId].timeSpentSec || 0) + seconds;
  }, profileId);
}

export function getParentPin() {
  return rawGet(PIN_KEY);
}

export function setParentPin(pin) {
  if (/^\d{4}$/.test(String(pin))) {
    rawSet(PIN_KEY, String(pin));
    return true;
  }
  return false;
}

export function clearParentPin() {
  rawRemove(PIN_KEY);
}

export function seedV1ProgressForTest(v1Blob) {
  rawSet(V1_PROGRESS_KEY, JSON.stringify(v1Blob));
}
