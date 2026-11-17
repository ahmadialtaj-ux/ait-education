// js/app.js — Main application controller & state router for AIT Education v0.3

import { STRINGS, fmt } from "./strings.js";
import { validateUnit } from "./validate.js";
import {
  migrate,
  getProfiles,
  getActiveProfileId,
  setActiveProfileId,
  addProfile,
  getProgress,
  updateProgress,
  recordQuestionAttempt,
  setParentWrittenScore,
  addUnitActiveSeconds,
  getParentPin,
  setParentPin,
  clearParentPin
} from "./storage.js";
import { triggerBackupDownload, restoreFromBackupJson } from "./backup.js";
import {
  stepTryStateMachine,
  evaluateWrittenSuggested,
  evaluateWrittenSelf
} from "./marking.js";
import { buildMissions } from "./missions.js";
import {
  initThemes,
  getThemesValidationError,
  getSortedThemes,
  getThemeById,
  getChapterThemeText,
  getUnitThemeText,
  pickThemeLine,
  renderAvatarSvg,
  SKIN_TONES,
  HAIR_STYLES,
  HEADWEAR_OPTIONS,
  OUTFIT_OPTIONS
} from "./themes.js";
import {
  getLocalTodayStr,
  daysBetween,
  enrollUnitFlashcards,
  reviewFlashcard,
  getDueFlashcards,
  getCramFlashcards,
  getTopicsNeedingPractice,
  getDailyPracticeQuestions
} from "./srs.js";
import {
  BADGE_CATALOG,
  getRankInfo,
  awardXpEvent,
  recordActiveStudyDay,
  getWeeklyStatus,
  queueRewardMilestone,
  evaluateBadges,
  SessionTimerManager
} from "./game.js";
import {
  isBossUnlocked,
  initOrResumeMockSession,
  beginMockExam,
  saveMockExamAnswer,
  submitMockPaper,
  confirmMockWrittenSelfMark,
  finalizeMockResults
} from "./mock.js";
import {
  initTts,
  stopSpeech,
  toggleRead,
  ttsAfterRender
} from "./tts.js";
import {
  escapeHtml,
  formatSafeText,
  renderLearnBlock,
  renderQuestionCard,
  renderReadAloudButton
} from "./render.js";

const appState = {
  manifest: null,
  unitsById: {},
  unitErrorsById: {},
  unitWarningsById: {},
  view: "map", // "subjects" | "chapters" | "map" | "unit" | "boss" | "review" | "theme" | "parent"
  activeSubjectId: "ict",
  activeChapterKey: "igcse-ict-c1",
  activeUnitId: null,
  unitStep: { type: "mission", missionIndex: 0, phase: "brief" }, // phase: "brief" | "dive" | "debrief", or type: "training" | "unit-debrief"
  lastMissionEarnedXp: 0,
  lastMissionNewBadges: [],
  draftAnswers: {}, // globalQid -> draft value
  writtenState: {}, // globalQid -> { stage, studentText, suggestedScore, matchedIds, ticks, selfScore, toDiscuss, parentScore }
  feedbackSeed: 0,
  reviewSession: null,
  bossConfirmSubmitOpen: false,
  bossTickInterval: null,
  bossLiveSecondsLeft: null,
  breakModalOpen: false,
  breakCountdownSec: null,
  breakCountdownInterval: null,
  levelUpBannerRank: null,
  parentUnlocked: false,
  parentResetMode: false,
  parentStatusMsg: "",
  pendingFocusTargetId: null,
  tour: null // v0.3.2: { kind: "kid" | "parent", step: 0 }
};

// v0.3.2: "How it works" tours (kid and parent). {name} = child's nickname, {theme} = dream label.
const TOURS = {
  kid: [
    { icon: "🗺️", title: "Welcome, {name}!", body: "This is your base. Each learning zone is one part of your chapter. Do them in order, or jump to the one you need." },
    { icon: "🚀", title: "Missions", body: "Every zone has short missions of about 5 to 8 minutes: a quick brief, some reading, then challenges. Finish them all to clear the zone." },
    { icon: "💡", title: "Two tries on every challenge", body: "Got one wrong? You get a clue and a second try. Mistakes are part of the mission, not a problem." },
    { icon: "🎤", title: "Let me read it to you", body: "Press \"Read it to me\" on any card. Pick Slow, Normal or Fast, pause any time, and click a sentence to jump there." },
    { icon: "👾", title: "The Boss and Daily Review", body: "Clear the zones to unlock the Boss: a practice exam. Daily Review is 5 minutes of quick cards that help you remember everything. Good luck, {theme} {name}!" }
  ],
  parent: [
    { icon: "👋", title: "Welcome to the parent area", body: "AIT Education teaches your child's textbook pages in short, game-like missions. You set the plan here; your child does the learning." },
    { icon: "👥", title: "Your children", body: "Add each child once. Each one gets their own dream, avatar, progress and XP on this device. Press \"Use\" or pick a name in the menu at the top to switch." },
    { icon: "📅", title: "Test and study plan", body: "Set the test date for a countdown, choose how many days a week to study, and open the mock test early if the test is close. Turn on the timer to practise exam timing." },
    { icon: "✍️", title: "Checking written answers", body: "Children mark their own written answers by ticking the points they made. If a mark looks too generous, it appears under \"Written answers to check\" so you can look at it together." },
    { icon: "💾", title: "Progress lives on this device", body: "Progress is saved in this browser. Use \"Save progress to a file\" under More settings to keep it safe or move it to another laptop or tablet." }
  ]
};
const PARENT_TOUR_KEY = "ait-edu-parent-tour-seen";

let sessionTimer = null;

export function announceLive(message) {
  const el = document.getElementById("aria-live-region");
  if (el) {
    el.textContent = "";
    setTimeout(() => {
      el.textContent = message;
    }, 30);
  }
}

async function fetchJsonResource(path) {
  if (window.__INLINE_JSON_DATA__ && window.__INLINE_JSON_DATA__[path]) {
    return structuredClone(window.__INLINE_JSON_DATA__[path]);
  }
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Could not load ${path} (${resp.status})`);
  return resp.json();
}

function getDefaultHomeView() {
  const subjects = appState.manifest?.subjects || [];
  if (subjects.length > 1) return "subjects";
  if (subjects.length === 1) {
    appState.activeSubjectId = subjects[0].subjectId;
    const chapters = subjects[0].chapters || [];
    if (chapters.length > 1) return "chapters";
    if (chapters.length === 1) {
      appState.activeChapterKey = chapters[0].chapterKey;
      return "map";
    }
  }
  return "map";
}

export async function bootApp() {
  migrate();
  initTts(() => renderApp(), {
    onRateChange: (rate) =>
      updateProgress((p) => {
        p.settings.ttsRate = rate;
      })
  });

  try {
    const [manifest, themesJson] = await Promise.all([
      fetchJsonResource("content/manifest.json"),
      fetchJsonResource("content/themes.json")
    ]);
    appState.manifest = manifest;
    initThemes(themesJson);

    for (const subj of manifest.subjects || []) {
      for (const ch of subj.chapters || []) {
        for (const uEntry of ch.units || []) {
          try {
            const rawUnit = await fetchJsonResource(`content/${uEntry.file}`);
            const check = validateUnit(rawUnit);
            appState.unitWarningsById[uEntry.id] = check.warnings || [];
            if (check.valid) {
              appState.unitsById[uEntry.id] = rawUnit;
            } else {
              appState.unitErrorsById[uEntry.id] = check.errors;
            }
          } catch (err) {
            appState.unitErrorsById[uEntry.id] = [err.message];
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to load manifest/themes:", err);
  }

  // M1: First launch onboarding check — if !profile.onboarded, show theme picker -> nickname -> avatar
  const prog = getProgress();
  if (!prog.profile?.onboarded) {
    appState.view = "theme";
  } else {
    appState.view = getDefaultHomeView();
  }

  sessionTimer = new SessionTimerManager({
    onUnitSecond: (unitId, sec) => {
      addUnitActiveSeconds(unitId, sec);
    },
    onBreakDue: () => {
      const currentProg = getProgress();
      if (!currentProg.settings?.calmMode) {
        appState.breakModalOpen = true;
        renderApp();
      }
    }
  });
  sessionTimer.start();

  bindGlobalEvents();
  renderApp();
}

function getActiveChapterObj() {
  const subj = (appState.manifest?.subjects || []).find((s) => s.subjectId === appState.activeSubjectId) || appState.manifest?.subjects?.[0];
  if (!subj) return null;
  return (subj.chapters || []).find((c) => c.chapterKey === appState.activeChapterKey) || subj.chapters?.[0] || null;
}

function syncDocumentMeta(unit = null) {
  const prog = getProgress();
  const lang = unit?.meta?.lang || "en";
  const dir = unit?.meta?.dir || "ltr";
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;

  if (prog.settings?.calmMode) {
    document.body.classList.add("calm-mode");
  } else {
    document.body.classList.remove("calm-mode");
  }

  if (sessionTimer) {
    const isReading =
      appState.view === "unit" &&
      appState.unitStep.type === "mission" &&
      (appState.unitStep.phase === "brief" || appState.unitStep.phase === "dive");
    const inChallengeOrBoss =
      appState.view === "boss" ||
      (appState.view === "unit" && appState.unitStep.type === "training");
    sessionTimer.setContext({
      unitId: appState.activeUnitId,
      isReadingScreen: isReading,
      inChallengeOrBoss,
      breakMin: prog.settings?.breakMin ?? 25
    });
  }
}

// H2: Snapshot active focus & caret before replacing root.innerHTML, then restore after
function captureFocusSnapshot(root) {
  const active = document.activeElement;
  if (!active || active === document.body || !root.contains(active)) {
    return null;
  }
  const snap = {
    id: active.id || null,
    action: active.getAttribute("data-action") || null,
    globalQid: active.getAttribute("data-global-qid") || null,
    rowId: active.getAttribute("data-row-id") || null,
    itemId: active.getAttribute("data-item-id") || null,
    leftId: active.getAttribute("data-left-id") || null,
    rightId: active.getAttribute("data-right-id") || null,
    word: active.getAttribute("data-word") || null,
    mpId: active.getAttribute("data-mp-id") || null,
    themeId: active.getAttribute("data-theme-id") || null,
    value: active.getAttribute("value") || null,
    selectionStart: null,
    selectionEnd: null
  };
  try {
    if (typeof active.selectionStart === "number") {
      snap.selectionStart = active.selectionStart;
      snap.selectionEnd = active.selectionEnd;
    }
  } catch (_) {
    // Ignore input types that do not support selectionStart
  }
  return snap;
}

function restoreFocusSnapshot(root, snap) {
  if (appState.pendingFocusTargetId) {
    const targetId = appState.pendingFocusTargetId;
    appState.pendingFocusTargetId = null;
    const explicitTarget = document.getElementById(targetId);
    if (explicitTarget) {
      explicitTarget.focus();
      return;
    }
  }

  if (!snap) return;

  let candidate = null;
  if (snap.id) {
    candidate = document.getElementById(snap.id);
  }
  if (!candidate && snap.action) {
    const parts = [`[data-action="${CSS.escape(snap.action)}"]`];
    if (snap.globalQid) parts.push(`[data-global-qid="${CSS.escape(snap.globalQid)}"]`);
    if (snap.rowId) parts.push(`[data-row-id="${CSS.escape(snap.rowId)}"]`);
    if (snap.itemId) parts.push(`[data-item-id="${CSS.escape(snap.itemId)}"]`);
    if (snap.leftId) parts.push(`[data-left-id="${CSS.escape(snap.leftId)}"]`);
    if (snap.rightId) parts.push(`[data-right-id="${CSS.escape(snap.rightId)}"]`);
    if (snap.word) parts.push(`[data-word="${CSS.escape(snap.word)}"]`);
    if (snap.mpId) parts.push(`[data-mp-id="${CSS.escape(snap.mpId)}"]`);
    if (snap.themeId) parts.push(`[data-theme-id="${CSS.escape(snap.themeId)}"]`);
    if (snap.value !== null && (snap.action === "change-mcq" || snap.action === "change-tick")) {
      parts.push(`[value="${CSS.escape(snap.value)}"]`);
    }
    candidate = root.querySelector(parts.join(""));
  }

  if (candidate && !candidate.disabled) {
    candidate.focus();
    if (snap.selectionStart !== null && typeof candidate.setSelectionRange === "function") {
      try {
        candidate.setSelectionRange(snap.selectionStart, snap.selectionEnd ?? snap.selectionStart);
      } catch (_) {
        // Ignore
      }
    }
  }
}

export function renderApp() {
  const root = document.getElementById("app-root");
  if (!root) return;

  const focusSnap = captureFocusSnapshot(root);

  const prog = getProgress();
  const activeUnit = appState.activeUnitId ? appState.unitsById[appState.activeUnitId] : null;
  syncDocumentMeta(activeUnit);

  const headerHtml = renderHeader(prog);
  let mainHtml = "";

  if (appState.view === "subjects") {
    mainHtml = renderSubjectsView();
  } else if (appState.view === "chapters") {
    mainHtml = renderChaptersView();
  } else if (appState.view === "map") {
    mainHtml = renderChapterMapView(prog);
  } else if (appState.view === "unit") {
    mainHtml = renderLessonUnitView(prog);
  } else if (appState.view === "boss") {
    mainHtml = renderBossView(prog);
  } else if (appState.view === "review") {
    mainHtml = renderDailyReviewView(prog);
  } else if (appState.view === "theme") {
    mainHtml = renderThemeAndAvatarView(prog);
  } else if (appState.view === "parent") {
    mainHtml = renderParentView(prog);
  }

  const modalsHtml = renderActiveModals(prog);

  root.innerHTML = `${headerHtml}<main id="main-content" class="app-main" tabindex="-1">${mainHtml}</main>${modalsHtml}`;

  restoreFocusSnapshot(root, focusSnap);
  ttsAfterRender();
}

// M5: Header with Map, Daily Review, Profile & Dream + a "More" menu holding Calm mode and Parent view on screens under 600px
function renderHeader(prog) {
  const rankInfo = getRankInfo(prog);
  const profiles = getProfiles();
  const activeProfileId = getActiveProfileId();
  const calmOn = Boolean(prog.settings?.calmMode);

  const profileOptions = profiles
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${p.id === activeProfileId ? "selected" : ""}>${escapeHtml(p.nickname || p.id)}</option>`
    )
    .join("");

  return `<header class="app-header">
    <div class="header-inner">
      <div class="brand-group">
        <h1 class="brand-title">${escapeHtml(STRINGS.appTitle)}</h1>
        <span class="header-rank-pill">${escapeHtml(rankInfo.rankTitle)} · ${rankInfo.xp} XP</span>
      </div>
      <nav class="nav-actions" aria-label="Main navigation">
        <label class="sr-only" for="profile-select">${escapeHtml(STRINGS.profileSwitchLabel)}</label>
        <select id="profile-select" class="btn" data-action="switch-profile" aria-label="${escapeHtml(STRINGS.profileSwitchLabel)}">
          ${profileOptions}
        </select>
        <button type="button" class="nav-btn ${appState.view === "map" ? "active" : ""}" data-action="nav-map">${escapeHtml(STRINGS.navHome)}</button>
        <button type="button" class="nav-btn ${appState.view === "review" ? "active" : ""}" data-action="nav-review">${escapeHtml(STRINGS.navReview)}</button>
        <button type="button" class="nav-btn ${appState.view === "theme" ? "active" : ""}" data-action="nav-theme">${escapeHtml(STRINGS.navTheme)}</button>
        <button type="button" class="nav-btn nav-desktop-only" data-action="toggle-calm-mode" aria-pressed="${calmOn ? "true" : "false"}">${escapeHtml(calmOn ? STRINGS.navCalmOn : STRINGS.navCalmOff)}</button>
        <button type="button" class="nav-btn nav-desktop-only ${appState.view === "parent" ? "active" : ""}" data-action="nav-parent">${escapeHtml(STRINGS.navParent)}</button>
        <button type="button" class="nav-btn nav-desktop-only" data-action="open-tour" data-tour="${appState.view === "parent" && appState.parentUnlocked ? "parent" : "kid"}">${escapeHtml(STRINGS.helpBtn)}</button>
        <details class="nav-more-menu">
          <summary class="nav-btn nav-more-summary">More ▾</summary>
          <div class="nav-more-dropdown">
            <button type="button" class="nav-btn" data-action="toggle-calm-mode" aria-pressed="${calmOn ? "true" : "false"}">${escapeHtml(calmOn ? STRINGS.navCalmOn : STRINGS.navCalmOff)}</button>
            <button type="button" class="nav-btn ${appState.view === "parent" ? "active" : ""}" data-action="nav-parent">${escapeHtml(STRINGS.navParent)}</button>
            <button type="button" class="nav-btn" data-action="open-tour" data-tour="${appState.view === "parent" && appState.parentUnlocked ? "parent" : "kid"}">${escapeHtml(STRINGS.helpBtn)}</button>
          </div>
        </details>
      </nav>
    </div>
  </header>`;
}

function renderSubjectsView() {
  const subjects = appState.manifest?.subjects || [];
  const cards = subjects
    .map(
      (s) => `<div class="card">
        <h2>${escapeHtml(s.title)}</h2>
        <button type="button" class="btn btn-primary" data-action="select-subject" data-subject-id="${escapeHtml(s.subjectId)}">Open subject →</button>
      </div>`
    )
    .join("");
  return `<section><h2>${escapeHtml(STRINGS.subjectsHeading)}</h2>${cards}</section>`;
}

function renderChaptersView() {
  const subj = (appState.manifest?.subjects || []).find((s) => s.subjectId === appState.activeSubjectId);
  const chapters = subj?.chapters || [];
  const cards = chapters
    .map(
      (c) => `<div class="card">
        <h2>${escapeHtml(STRINGS.chapterPrefix)} ${c.chapterNumber}: ${escapeHtml(c.title)}</h2>
        <button type="button" class="btn btn-primary" data-action="select-chapter" data-chapter-key="${escapeHtml(c.chapterKey)}">Open chapter map →</button>
      </div>`
    )
    .join("");
  return `<section><h2>${escapeHtml(STRINGS.chaptersHeading)}</h2>${cards}</section>`;
}

function renderProgressRingSvg(pct) {
  const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (safePct / 100) * circ;
  return `<svg class="progress-ring-svg" viewBox="0 0 50 50" role="img" aria-label="Progress ${safePct}%">
    <circle cx="25" cy="25" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="5" />
    <circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--primary)" stroke-width="5" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 25 25)" stroke-linecap="round" />
    <text x="25" y="29" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text-main)">${safePct}%</text>
  </svg>`;
}

function getUnitFirstAttemptPct(prog, unit) {
  if (!unit) return null;
  const allQs = unit.meta?.mode === "mock" ? unit.practice || [] : [...(unit.check || []), ...(unit.practice || [])];
  let earned = 0;
  let total = 0;
  let anyAnswered = false;
  for (const q of allQs) {
    const rec = prog.questions?.[`${unit.id}#${q.id}`];
    if (rec && rec.firstAttemptScore !== null && rec.firstAttemptScore !== undefined) {
      anyAnswered = true;
      earned += Number(rec.firstAttemptScore) || 0;
      total += Number(q.marks) || 0;
    }
  }
  if (!anyAnswered || total === 0) return null;
  return Math.round((earned / total) * 100);
}

function renderChapterMapView(prog) {
  const ch = getActiveChapterObj();
  if (!ch) return `<div class="card">No chapter found.</div>`;

  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";
  const chTheme = getChapterThemeText(themeId, ch.chapterKey, ch.title, nickname);
  const avatarSvg = renderAvatarSvg(prog.profile?.avatar, themeId, 72);

  let testBannerHtml = "";
  const testDate = prog.settings?.testDate;
  if (testDate && !prog.settings?.calmMode) {
    if (prog.settings?.hideTestBanner) {
      testBannerHtml = `<div style="margin-block-end: 12px;">
        <button type="button" class="btn btn-secondary" data-action="toggle-test-banner" data-hide="0">${escapeHtml(STRINGS.showBannerBtn)}</button>
      </div>`;
    } else {
      const daysLeft = daysBetween(getLocalTodayStr(), testDate);
      if (daysLeft >= 0) {
        const headline = daysLeft === 0 ? STRINGS.testDateToday : fmt(STRINGS.testDateBanner, { days: daysLeft });
        testBannerHtml = `<div class="test-date-banner" role="region" aria-label="Study plan">
          <div>
            <strong>📅 ${escapeHtml(headline)}</strong>
            <div style="font-size:0.92rem;">${escapeHtml(STRINGS.testDateOrderSuggestion)}</div>
          </div>
          <button type="button" class="btn btn-secondary" data-action="toggle-test-banner" data-hide="1">${escapeHtml(STRINGS.hideBannerBtn)}</button>
        </div>`;
      }
    }
  }

  const weeklyStatus = getWeeklyStatus(prog);
  let blockerHtml = "";
  if (weeklyStatus.showBlockerPrompt) {
    blockerHtml = `<div class="card" role="region" aria-label="Weekly check-in">
      <h3>${escapeHtml(STRINGS.blockerCardTitle)}</h3>
      <div class="nav-actions">
        <button type="button" class="btn btn-primary" data-action="blocker-choice" data-choice="shorter">${escapeHtml(STRINGS.blockerShorterMissions)}</button>
        <button type="button" class="btn btn-secondary" data-action="blocker-choice" data-choice="easier">${escapeHtml(STRINGS.blockerEasierStart)}</button>
        <button type="button" class="btn btn-secondary" data-action="blocker-choice" data-choice="zone">${escapeHtml(STRINGS.blockerAnotherZone)}</button>
        <button type="button" class="btn btn-secondary" data-action="blocker-choice" data-choice="keep">${escapeHtml(STRINGS.blockerKeepSame)}</button>
        <button type="button" class="btn" data-action="blocker-choice" data-choice="skip">${escapeHtml(STRINGS.blockerSkip)}</button>
      </div>
    </div>`;
  }

  const dueCards = getDueFlashcards(prog, appState.unitsById);
  const practiceQs = getDailyPracticeQuestions(prog, appState.unitsById);
  const cramCards = getCramFlashcards(prog, appState.unitsById);

  const unitEntries = [...(ch.units || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const lessonEntries = unitEntries.filter((u) => {
    const uObj = appState.unitsById[u.id];
    return !uObj || uObj.meta?.mode !== "mock";
  });
  const recommendedEntry = lessonEntries.find((u) => !prog.units?.[u.id]?.cleared) || null;

  const tilesHtml = unitEntries
    .map((uEntry) => {
      const unitErr = appState.unitErrorsById[uEntry.id];
      if (unitErr) {
        return `<div class="zone-tile">
          <h3>${escapeHtml(uEntry.id)}</h3>
          <p>${escapeHtml(STRINGS.validationErrorTitle)}</p>
          <ul>${unitErr.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
        </div>`;
      }

      const unit = appState.unitsById[uEntry.id];
      if (!unit) return "";
      const uTheme = getUnitThemeText(themeId, ch.chapterKey, unit, nickname);
      const firstPct = getUnitFirstAttemptPct(prog, unit);

      if (unit.meta?.mode === "mock") {
        const bossUnlock = isBossUnlocked(prog, unitEntries, unit.id);
        return `<article class="zone-tile zone-boss">
          <div class="zone-top-row">
            <div>
              <span class="badge-pill badge-boss">${escapeHtml(STRINGS.bossTileBadge)}</span>
              <h3 style="margin-block: 8px 4px;">${escapeHtml(uTheme.zone)}</h3>
              <p style="margin-block:0;font-size:0.92rem;">${escapeHtml(unit.meta.title)}</p>
            </div>
            ${renderProgressRingSvg(firstPct ?? (prog.units?.[unit.id]?.cleared ? 100 : 0))}
          </div>
          <p style="margin-block: 6px; font-size: 0.94rem;">${escapeHtml(uTheme.intro)}</p>
          ${firstPct !== null ? `<p style="margin-block:0;font-weight:700;">${escapeHtml(fmt(STRINGS.firstAttemptBest, { pct: firstPct }))}</p>` : ""}
          <div>
            ${
              bossUnlock.unlocked
                ? `<button type="button" class="btn btn-accent" data-action="open-boss" data-unit-id="${escapeHtml(unit.id)}">${escapeHtml(prog.units?.[unit.id]?.cleared ? STRINGS.retakeBossBtn : STRINGS.openBossBtn)}</button>`
                : `<p style="margin-block:0;font-size:0.9rem;color:var(--text-muted);">🔒 ${escapeHtml(STRINGS.bossLockedNote)}</p>`
            }
          </div>
        </article>`;
      }

      const missions = buildMissions(unit, prog.settings?.missionCapMin || 8);
      const doneKeys = new Set(prog.missions?.[unit.id]?.done || []);
      const doneCount = missions.filter((m) => doneKeys.has(m.key)).length;
      const isCleared = Boolean(prog.units?.[unit.id]?.cleared);
      const progressPct = isCleared
        ? 100
        : missions.length > 0
        ? Math.round((doneCount / (missions.length + 1)) * 100)
        : 0;
      const isRecommended = recommendedEntry && recommendedEntry.id === unit.id;

      return `<article class="zone-tile ${isRecommended ? "zone-recommended" : ""}">
        <div class="zone-top-row">
          <div>
            ${
              isRecommended
                ? `<span class="badge-pill badge-recommended">${escapeHtml(STRINGS.recommendedNext)}</span>`
                : `<span class="badge-pill">${escapeHtml(isCleared ? STRINGS.zoneClearedBadge : doneCount > 0 ? STRINGS.zoneInProgressBadge : STRINGS.zoneOpenBadge)}</span>`
            }
            <h3 style="margin-block: 8px 4px;">${escapeHtml(uTheme.zone)}</h3>
            <p style="margin-block:0;font-size:0.92rem;color:var(--text-muted);">Unit ${unit.meta.unit}: ${escapeHtml(unit.meta.title)}</p>
          </div>
          ${renderProgressRingSvg(progressPct)}
        </div>
        <p style="margin-block: 4px; font-size:0.92rem;">${escapeHtml(fmt(STRINGS.missionsDoneCount, { done: doneCount, total: missions.length }))}</p>
        ${firstPct !== null ? `<p style="margin-block:0;font-weight:700;">${escapeHtml(fmt(STRINGS.firstAttemptBest, { pct: firstPct }))}</p>` : ""}
        <div>
          <button type="button" class="btn btn-primary" data-action="open-unit" data-unit-id="${escapeHtml(unit.id)}">
            ${escapeHtml(isCleared ? STRINGS.replayZoneBtn : doneCount > 0 ? STRINGS.continueZoneBtn : STRINGS.startZoneBtn)}
          </button>
        </div>
      </article>`;
    })
    .join("");

  return `<section>
    ${testBannerHtml}
    ${blockerHtml}
    <div class="card world-hero-card">
      <div class="world-hero-header">
        ${avatarSvg}
        <div>
          <div style="font-size:0.9rem;font-weight:700;color:var(--primary);">${escapeHtml(STRINGS.chapterPrefix)} ${ch.chapterNumber} · ${escapeHtml(ch.title)}</div>
          <h2 class="world-title">${escapeHtml(chTheme.worldName)}</h2>
          <p class="world-story">${escapeHtml(chTheme.story)}</p>
        </div>
      </div>
    </div>

    <div class="map-meta-grid">
      <div class="card">
        <h3 style="margin-block-start:0;">🎯 ${escapeHtml(STRINGS.weeklyTargetTitle)}</h3>
        <p style="margin-block: 6px; font-weight:700;">
          ${
            weeklyStatus.paused
              ? escapeHtml(STRINGS.weeklyTargetPaused)
              : escapeHtml(fmt(STRINGS.weeklyTargetProgress, { done: weeklyStatus.doneDays, target: weeklyStatus.target }))
          }
        </p>
        <p style="margin-block: 4px; font-size:0.9rem; color:var(--text-muted);">
          ${escapeHtml(fmt(STRINGS.weeklyWeeksTotal, { weeks: weeklyStatus.onTargetWeeks }))}
        </p>
        <div class="nav-actions" style="margin-block-start:10px;">
          <button type="button" class="btn btn-secondary" data-action="toggle-pause-week">
            ${escapeHtml(weeklyStatus.paused ? STRINGS.resumeWeekBtn : STRINGS.pauseWeekBtn)}
          </button>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-block-start:0;">🗂️ ${escapeHtml(STRINGS.dailyReviewTitle)}</h3>
        <p style="margin-block: 6px;">
          ${
            dueCards.length + practiceQs.length > 0
              ? escapeHtml(fmt(STRINGS.dailyReviewDueCount, { due: dueCards.length, practice: practiceQs.length }))
              : escapeHtml(STRINGS.dailyReviewAllClear)
          }
        </p>
        <div class="nav-actions" style="margin-block-start:10px;">
          <button type="button" class="btn btn-primary" data-action="nav-review">${escapeHtml(STRINGS.startDailyReviewBtn)}</button>
          ${
            cramCards.length > 0
              ? `<button type="button" class="btn btn-secondary" data-action="start-cram-review">${escapeHtml(STRINGS.cramReviewBtn)}</button>`
              : ""
          }
        </div>
      </div>
    </div>

    <h2>${escapeHtml(STRINGS.mapZonesHeading)}</h2>
    <div class="zones-grid">${tilesHtml}</div>
  </section>`;
}

function renderLessonUnitView(prog) {
  const unit = appState.unitsById[appState.activeUnitId];
  if (!unit) return `<div class="card">Unit not found.</div>`;

  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";
  const uTheme = getUnitThemeText(themeId, appState.activeChapterKey, unit, nickname);
  const missions = buildMissions(unit, prog.settings?.missionCapMin || 8);
  const doneKeys = new Set(prog.missions?.[unit.id]?.done || []);
  const allMissionsDone = missions.every((m) => doneKeys.has(m.key));
  const diveDone = Boolean(prog.units?.[unit.id]?.diveDone);

  const missionPillsHtml = missions
    .map((m, idx) => {
      const isDone = doneKeys.has(m.key);
      const prevAllDone = missions.slice(0, idx).every((pm) => doneKeys.has(pm.key));
      const unlocked = idx === 0 || isDone || prevAllDone;
      const isActive = appState.unitStep.type === "mission" && appState.unitStep.missionIndex === idx;
      return `<button
        type="button"
        class="step-pill ${isActive ? "step-active" : ""} ${isDone ? "step-done" : ""}"
        ${unlocked ? "" : "disabled"}
        data-action="select-unit-mission"
        data-mission-index="${idx}"
      >${isDone ? "✓ " : ""}${escapeHtml(fmt(STRINGS.missionStepLabel, { index: idx + 1, total: missions.length }))}</button>`;
    })
    .join("");

  const stepperHtml = `<nav class="unit-stepper" aria-label="${escapeHtml(STRINGS.unitStepsHeading)}">
    <button type="button" class="btn btn-secondary" data-action="nav-map">${escapeHtml(STRINGS.backToMapBtn)}</button>
    ${missionPillsHtml}
    <button
      type="button"
      class="step-pill ${appState.unitStep.type === "training" ? "step-active" : ""} ${diveDone ? "step-done" : ""}"
      ${allMissionsDone ? "" : "disabled"}
      data-action="select-training-dive"
    >${diveDone ? "✓ " : ""}${escapeHtml(STRINGS.trainingDiveLabel)}</button>
    <button
      type="button"
      class="step-pill ${appState.unitStep.type === "unit-debrief" ? "step-active" : ""} ${prog.units?.[unit.id]?.cleared ? "step-done" : ""}"
      ${diveDone ? "" : "disabled"}
      data-action="select-unit-debrief"
    >${prog.units?.[unit.id]?.cleared ? "✓ " : ""}${escapeHtml(STRINGS.unitDebriefLabel)}</button>
  </nav>`;

  if (appState.unitStep.type === "mission") {
    const mIdx = Math.min(appState.unitStep.missionIndex, Math.max(0, missions.length - 1));
    const mission = missions[mIdx];
    if (!mission) return `${stepperHtml}<div class="card">No missions in unit.</div>`;

    if (appState.unitStep.phase === "brief") {
      return `${stepperHtml}${renderMissionBriefCard(unit, mission, uTheme, prog)}`;
    }
    if (appState.unitStep.phase === "dive") {
      return `${stepperHtml}${renderMissionDiveSection(unit, mission, prog)}`;
    }
    if (appState.unitStep.phase === "debrief") {
      return `${stepperHtml}${renderMissionDebriefCard(unit, mission, missions, prog)}`;
    }
  }

  if (appState.unitStep.type === "training") {
    return `${stepperHtml}${renderTrainingDiveSection(unit, prog)}`;
  }

  if (appState.unitStep.type === "unit-debrief") {
    return `${stepperHtml}${renderUnitDebriefCard(unit, uTheme, prog)}`;
  }

  return stepperHtml;
}

function renderMissionBriefCard(unit, mission, uTheme, prog) {
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);
  const briefDomId = `brief-${unit.id}-${mission.key}`;
  const isFirstMission = mission.index === 1;
  const subLabel = fmt(STRINGS.missionAboutMin, {
    index: mission.index,
    total: mission.total,
    min: mission.estMinutes
  });

  const speechParts = [
    `${uTheme.zone}. ${mission.title}. ${subLabel}.`,
    isFirstMission ? uTheme.intro : "",
    isFirstMission && uTheme.why ? `${uTheme.whyTitle} ${uTheme.why}` : ""
  ].filter(Boolean);

  return `<article id="${escapeHtml(briefDomId)}" class="card">
    <div class="block-header-row">
      <div>
        <div style="font-size:0.9rem;font-weight:700;color:var(--primary);">${escapeHtml(uTheme.zone)} · ${escapeHtml(subLabel)}</div>
        <h2 style="margin-block: 4px 0;">${escapeHtml(mission.title)}</h2>
      </div>
      ${renderReadAloudButton(speechParts.join(" "), briefDomId, allowOnlineVoices)}
    </div>
    ${isFirstMission && uTheme.intro ? `<p>${escapeHtml(uTheme.intro)}</p>` : ""}
    ${
      isFirstMission && uTheme.why
        ? `<div class="why-role-box">
             <strong>💡 ${escapeHtml(uTheme.whyTitle)}</strong>
             <p style="margin-block: 6px 0;">${escapeHtml(uTheme.why)}</p>
           </div>`
        : ""
    }
    <div class="question-action-row">
      <button type="button" class="btn btn-primary" data-action="start-mission-dive">${escapeHtml(STRINGS.startMissionDiveBtn)}</button>
    </div>
  </article>`;
}

function renderMissionDiveSection(unit, mission, prog) {
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);
  const blocksHtml = mission.blocks
    .map((b) =>
      renderLearnBlock(b, unit.id, {
        allowOnlineVoices,
        isOpenedRealWorld: Boolean(prog.realWorldOpened?.[`${unit.id}#${b.id}`])
      })
    )
    .join("");

  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";

  const challengesHtml =
    mission.questions.length === 0
      ? `<p class="helper-note">${escapeHtml(STRINGS.noChallengesInMission)}</p>`
      : mission.questions
          .map((q, qIdx) => {
            const globalQid = `${unit.id}#${q.id}`;
            const tryRecord = prog.tries?.[globalQid] || null;
            const state = tryRecord?.state || "unanswered";
            const fbCategory = state === "correct" ? "correct" : state === "try2" ? "notYet" : "";
            const fbLine = fbCategory ? pickThemeLine(themeId, fbCategory, nickname, appState.feedbackSeed + qIdx) : "";
            return renderQuestionCard({
              unit,
              question: q,
              mission,
              tryRecord,
              draftAnswer: appState.draftAnswers[globalQid],
              writtenProgress: appState.writtenState[globalQid],
              allowOnlineVoices,
              themeFeedbackLine: fbLine,
              contextPrefix: "mission-q"
            });
          })
          .join("");

  const allChallengesResolved = mission.questions.every((q) => {
    const globalQid = `${unit.id}#${q.id}`;
    if (q.type === "written") {
      return appState.writtenState[globalQid]?.stage === "completed";
    }
    const st = prog.tries?.[globalQid]?.state;
    return st === "correct" || st === "correct2" || st === "revealed";
  });

  return `<section>
    <div class="mission-reading-part">
      ${blocksHtml}
      <div class="card" style="text-align:center;">
        <button type="button" class="btn btn-primary" data-action="done-reading-scroll">${escapeHtml(STRINGS.doneReadingBtn)}</button>
      </div>
    </div>
    <div id="mission-challenges-anchor" class="mission-challenges-part" tabindex="-1">
      <h2>🎯 ${escapeHtml(STRINGS.challengesHeading)}</h2>
      ${challengesHtml}
      <div class="card" style="text-align:center;">
        <button
          type="button"
          class="btn btn-primary"
          ${allChallengesResolved ? "" : "disabled"}
          data-action="complete-mission"
          data-mission-key="${escapeHtml(mission.key)}"
        >${escapeHtml(STRINGS.finishMissionBtn)}</button>
      </div>
    </div>
  </section>`;
}

function renderMissionDebriefCard(unit, mission, allMissions, prog) {
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);
  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";
  const debriefLine = pickThemeLine(themeId, "debrief", nickname, mission.index);
  const rankInfo = getRankInfo(prog);

  const totalChallenges = mission.questions.length;
  let rightFirstTry = 0;
  let lookAgainItem = null;

  for (const q of mission.questions) {
    const globalQid = `${unit.id}#${q.id}`;
    const qRec = prog.questions?.[globalQid];
    const tryRec = prog.tries?.[globalQid];
    const score = tryRec?.try1Score ?? qRec?.firstAttemptScore ?? 0;
    if (score === q.marks) {
      rightFirstTry += 1;
    } else if (!lookAgainItem) {
      const topicLabel = unit.topics?.[q.topic] || q.topic;
      const targetBlock = mission.blocks.find((b) => b.topic === q.topic) || mission.blocks[0];
      lookAgainItem = {
        topicLabel,
        blockId: targetBlock?.id,
        blockTitle: targetBlock?.title || topicLabel
      };
    }
  }

  const winsText =
    totalChallenges > 0
      ? fmt(STRINGS.missionWinsLine, { right: rightFirstTry, total: totalChallenges })
      : STRINGS.missionNoChallengesWin;

  const badgeLabels = (appState.lastMissionNewBadges || [])
    .map((bid) => BADGE_CATALOG.find((b) => b.id === bid)?.title || bid);

  const hasNextMission = mission.index < allMissions.length;
  const debriefDomId = `debrief-${unit.id}-${mission.key}`;
  const speech = `${STRINGS.missionDebriefHeading}. ${debriefLine} ${winsText}`;

  return `<article id="${escapeHtml(debriefDomId)}" class="card">
    <div class="block-header-row">
      <h2>🎉 ${escapeHtml(STRINGS.missionDebriefHeading)}</h2>
      ${renderReadAloudButton(speech, debriefDomId, allowOnlineVoices)}
    </div>
    <p style="font-size:1.1rem;font-weight:700;">${escapeHtml(debriefLine)}</p>
    <p>✅ <strong>${escapeHtml(winsText)}</strong></p>
    ${
      lookAgainItem
        ? `<div class="why-role-box">
             <p style="margin-block:0;">🔍 <strong>${escapeHtml(fmt(STRINGS.missionLookAgain, { topic: lookAgainItem.topicLabel }))}</strong></p>
             <button type="button" class="btn btn-secondary" style="margin-block-start:8px;" data-action="review-mission-block" data-mission-index="${mission.index - 1}" data-block-dom-id="block-${escapeHtml(unit.id)}-${escapeHtml(lookAgainItem.blockId)}">
               ${escapeHtml(fmt(STRINGS.missionJumpToBlock, { title: lookAgainItem.blockTitle }))}
             </button>
           </div>`
        : ""
    }
    <div class="card" style="background-color:var(--bg-subtle);margin-block-top:14px;">
      <p style="margin-block:0 6px;"><strong>${escapeHtml(fmt(STRINGS.xpGainedLabel, { xp: appState.lastMissionEarnedXp }))}</strong> · ${escapeHtml(fmt(STRINGS.totalXpLabel, { xp: rankInfo.xp }))}</p>
      <p style="margin-block:0 6px;"><strong>${escapeHtml(fmt(STRINGS.rankLabel, { rank: rankInfo.rankTitle }))}</strong> (${rankInfo.nextThreshold ? escapeHtml(fmt(STRINGS.rankNextProgress, { current: rankInfo.xp, next: rankInfo.nextThreshold })) : escapeHtml(STRINGS.rankMaxReached)})</p>
      <div style="background:#cbd5e1;block-size:10px;border-radius:999px;overflow:hidden;">
        <div style="background:var(--primary);block-size:100%;inline-size:${rankInfo.progressPct}%;"></div>
      </div>
      ${
        badgeLabels.length > 0
          ? `<p style="margin-block:10px 0;">🏅 <strong>${escapeHtml(STRINGS.newBadgesHeading)}</strong> ${escapeHtml(badgeLabels.join(", "))}</p>`
          : ""
      }
    </div>
    <div class="question-action-row">
      ${
        hasNextMission
          ? `<button type="button" class="btn btn-primary" data-action="select-unit-mission" data-mission-index="${mission.index}">${escapeHtml(STRINGS.nextMissionBtn)} →</button>`
          : `<button type="button" class="btn btn-primary" data-action="select-training-dive">${escapeHtml(STRINGS.goTrainingDiveBtn)} →</button>`
      }
      <button type="button" class="btn btn-secondary" data-action="nav-map">${escapeHtml(STRINGS.chooseAnotherZoneBtn)}</button>
      <button type="button" class="btn btn-secondary" data-action="open-break-modal">${escapeHtml(STRINGS.takeBreakBtn)}</button>
    </div>
  </article>`;
}

function renderTrainingDiveSection(unit, prog) {
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);
  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";
  const questions = unit.practice || [];
  const isReplay = Boolean(prog.units?.[unit.id]?.diveDone);

  const qsHtml = questions
    .map((q, idx) => {
      const globalQid = `${unit.id}#${q.id}`;
      const tryRecord = prog.tries?.[globalQid] || null;
      const state = tryRecord?.state || "unanswered";
      const fbCategory = state === "correct" ? "correct" : state === "try2" ? "notYet" : "";
      const fbLine = fbCategory ? pickThemeLine(themeId, fbCategory, nickname, appState.feedbackSeed + idx) : "";

      return renderQuestionCard({
        unit,
        question: q,
        tryRecord,
        draftAnswer: appState.draftAnswers[globalQid],
        writtenProgress: appState.writtenState[globalQid],
        allowOnlineVoices,
        themeFeedbackLine: fbLine,
        contextPrefix: "dive-q"
      });
    })
    .join("");

  const allResolved = questions.every((q) => {
    const globalQid = `${unit.id}#${q.id}`;
    if (q.type === "written") {
      return appState.writtenState[globalQid]?.stage === "completed";
    }
    const st = prog.tries?.[globalQid]?.state;
    return st === "correct" || st === "correct2" || st === "revealed";
  });

  return `<section>
    <div class="card">
      <h2>🤿 ${escapeHtml(STRINGS.trainingDiveLabel)}</h2>
      <p>${escapeHtml(STRINGS.trainingDiveIntro)}</p>
      ${isReplay ? `<p class="badge-pill">${escapeHtml(STRINGS.trainingDiveReplayNotice)}</p>` : ""}
    </div>
    ${qsHtml}
    <div class="card" style="text-align:center;">
      <button
        type="button"
        class="btn btn-primary"
        ${allResolved ? "" : "disabled"}
        data-action="complete-training-dive"
      >${escapeHtml(STRINGS.finishTrainingDiveBtn)}</button>
    </div>
  </section>`;
}

function renderUnitDebriefCard(unit, uTheme, prog) {
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);
  const summaryPoints = unit.recap?.summary || [];
  const flashcardsCount = (unit.recap?.flashcards || []).length;
  const domId = `unit-debrief-${unit.id}`;
  const speech = `${STRINGS.unitDebriefHeading}. ${summaryPoints.join(" ")}`;

  return `<article id="${escapeHtml(domId)}" class="card">
    <div class="block-header-row">
      <h2>🏆 ${escapeHtml(STRINGS.unitDebriefHeading)} — ${escapeHtml(uTheme.zone)}</h2>
      ${renderReadAloudButton(speech, domId, allowOnlineVoices)}
    </div>
    <p><strong>${escapeHtml(STRINGS.unitZoneClearedTitle)}</strong></p>
    <h3>${escapeHtml(STRINGS.unitSummaryHeading)}</h3>
    <ul class="keypoints-list">
      ${summaryPoints.map((s) => `<li>${formatSafeText(s)}</li>`).join("")}
    </ul>
    <p style="margin-block-top:14px;">🗂️ <strong>${escapeHtml(fmt(STRINGS.unitFlashcardsAdded, { count: flashcardsCount }))}</strong></p>
    <div class="question-action-row">
      <button type="button" class="btn btn-primary" data-action="nav-map">${escapeHtml(STRINGS.backToMapBtn)}</button>
      <button type="button" class="btn btn-secondary" data-action="nav-review">${escapeHtml(STRINGS.startDailyReviewBtn)}</button>
    </div>
  </article>`;
}

// Render Boss Battle / Mock Test view (§4 & M3 start card)
function renderBossView(prog) {
  const unit = appState.unitsById[appState.activeUnitId];
  if (!unit) return `<div class="card">Boss unit not found.</div>`;

  const themeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname || "Explorer";
  const uTheme = getUnitThemeText(themeId, appState.activeChapterKey, unit, nickname);
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);

  const session = prog.mock?.[unit.id];
  const timerEnabled = Boolean(prog.settings?.mockTimer);
  const customMin = Number(prog.settings?.mockTimerMinutes?.[unit.id]) || unit.meta?.estMinutes || 35;

  // M3: Start card before Q1 with theme intro ({marks}/{minutes} filled), timer info and "Begin paper"
  if (!session || session.phase === "start") {
    const timerInfoLine = timerEnabled
      ? fmt(STRINGS.bossTimerActiveNote, { min: customMin })
      : STRINGS.bossTimerOffNote;
    return `<section>
      <div class="card">
        <span class="badge-pill badge-boss">${escapeHtml(STRINGS.bossTileBadge)}</span>
        <h2 style="margin-block: 8px 4px;">${escapeHtml(uTheme.zone)}</h2>
        <p style="font-size:1.08rem;font-weight:700;">${escapeHtml(uTheme.intro)}</p>
        <p>${escapeHtml(STRINGS.bossRulesNote)}</p>
        ${
          session && session.firstScore !== null && session.firstScore !== undefined
            ? `<p class="why-role-box" style="margin-block:8px;"><strong>📜 ${escapeHtml(fmt(STRINGS.bossPreviousScores, { first: session.firstScore, best: session.bestScore ?? session.firstScore, marks: unit.meta?.totalMarks || (unit.practice || []).reduce((t, q) => t + (q.marks || 0), 0) }))}</strong></p>`
            : ""
        }
        <p class="badge-pill">${escapeHtml(timerInfoLine)}</p>
        <div class="question-action-row">
          <button type="button" class="btn btn-accent" data-action="begin-boss-session" data-unit-id="${escapeHtml(unit.id)}">${escapeHtml(STRINGS.bossStartLabels[prog.profile?.themeId || "explorer"] || STRINGS.startBossBtn)}</button>
          <button type="button" class="btn btn-secondary" data-action="nav-map">${escapeHtml(STRINGS.backToMapBtn)}</button>
        </div>
      </div>
    </section>`;
  }

  const questions = unit.practice || [];

  // Phase 1: Exam Phase (no hints, no tries, no theme lines, no explanations, no checklists)
  if (session.phase === "exam") {
    const qIdx = Math.max(0, Math.min(session.currentIndex || 0, questions.length - 1));
    const currentQ = questions[qIdx];
    const globalQid = `${unit.id}#${currentQ.id}`;
    const draft = appState.draftAnswers[globalQid] !== undefined ? appState.draftAnswers[globalQid] : session.answers?.[currentQ.id];

    const navPillsHtml = questions
      .map((q, idx) => {
        const ans = appState.draftAnswers[`${unit.id}#${q.id}`] ?? session.answers?.[q.id];
        const answered = ans !== undefined && ans !== null && ans !== "" && (!Array.isArray(ans) || ans.length > 0) && (typeof ans !== "object" || Object.keys(ans).length > 0);
        return `<button
          type="button"
          class="step-pill ${idx === qIdx ? "step-active" : ""} ${answered ? "step-done" : ""}"
          data-action="boss-jump-q"
          data-q-index="${idx}"
        >Q${idx + 1}</button>`;
      })
      .join("");

    let timerHtml = `<span id="boss-timer-display" class="badge-pill">${escapeHtml(STRINGS.bossTimerOffNote)}</span>`;
    const activeSec = appState.bossLiveSecondsLeft ?? session.timerLeftSec;
    if (session.timerEnabled && activeSec !== null && activeSec !== undefined && !prog.settings?.calmMode) {
      const mm = String(Math.floor(activeSec / 60)).padStart(2, "0");
      const ss = String(activeSec % 60).padStart(2, "0");
      timerHtml = `<span id="boss-timer-display" class="badge-pill badge-boss" aria-live="off">⏱️ ${mm}:${ss}</span>`;
    }

    return `<section>
      <div class="card">
        <div class="block-header-row">
          <div>
            <strong>${escapeHtml(uTheme.zone)}</strong> · ${escapeHtml(fmt(STRINGS.bossQuestionNav, { current: qIdx + 1, total: questions.length }))}
          </div>
          ${timerHtml}
        </div>
        <div class="unit-stepper" style="margin-block-end:0;">${navPillsHtml}</div>
        ${session.timerChangedNotice === "on" && session.timerEnabled ? `<p class="helper-note" role="status" style="margin-block:8px 0;font-weight:700;">⏱️ ${escapeHtml(STRINGS.bossTimerChangedOn)}</p>` : ""}
      </div>

      ${renderQuestionCard({
        unit,
        question: currentQ,
        draftAnswer: draft,
        isBossExam: true,
        allowOnlineVoices,
        contextPrefix: "boss-exam-q"
      })}

      <div class="card">
        <div class="header-inner">
          <div class="nav-actions">
            <button type="button" class="btn btn-secondary" ${qIdx === 0 ? "disabled" : ""} data-action="boss-jump-q" data-q-index="${qIdx - 1}">${escapeHtml(STRINGS.prevQuestionBtn)}</button>
            <button type="button" class="btn btn-secondary" ${qIdx >= questions.length - 1 ? "disabled" : ""} data-action="boss-jump-q" data-q-index="${qIdx + 1}">${escapeHtml(STRINGS.nextQuestionBtn)}</button>
          </div>
          <button type="button" class="btn btn-accent" data-action="boss-ask-submit">${escapeHtml(STRINGS.submitPaperBtn)}</button>
        </div>
      </div>
    </section>`;
  }

  // Phase 2: Deferred Written Marking Phase (§4)
  if (session.phase === "marking") {
    const writtenQs = questions.filter((q) => q.type === "written");
    const wIdx = Math.max(0, Math.min(session.markingWrittenIndex || 0, writtenQs.length - 1));
    const currentW = writtenQs[wIdx];
    const ev = session.writtenEvaluations?.[currentW.id];

    const writtenProgress = {
      stage: ev?.confirmed ? "completed" : "checklist",
      studentText: ev?.studentText || "",
      suggestedScore: ev?.suggestedScore ?? 0,
      matchedIds: ev?.matchedIds || [],
      ticks: ev?.ticks || [],
      selfScore: ev?.selfScore,
      toDiscuss: ev?.toDiscuss
    };

    const allConfirmed = writtenQs.every((wq) => session.writtenEvaluations?.[wq.id]?.confirmed);
    const confirmedCount = writtenQs.filter((wq) => session.writtenEvaluations?.[wq.id]?.confirmed).length;
    const markPillsHtml = writtenQs
      .map((wq, idx) => {
        const done = Boolean(session.writtenEvaluations?.[wq.id]?.confirmed);
        const qNum = questions.findIndex((q) => q.id === wq.id) + 1;
        return `<button type="button" class="step-pill ${idx === wIdx ? "step-active" : ""} ${done ? "step-done" : ""}" data-action="boss-mark-nav" data-w-index="${idx}" aria-label="Question ${qNum}${done ? ", marked" : ", not marked yet"}">${done ? "✓ " : ""}Q${qNum}</button>`;
      })
      .join("");

    return `<section>
      ${session.timeExpired ? `<div class="test-date-banner"><strong>⏰ ${escapeHtml(STRINGS.bossTimeUpBanner)}</strong></div>` : ""}
      <div class="card">
        <h2>${escapeHtml(STRINGS.bossMarkingHeading)}</h2>
        <p>${escapeHtml(STRINGS.bossMarkingIntro)}</p>
        <p><strong>${escapeHtml(fmt(STRINGS.bossMarkingProgress, { current: wIdx + 1, total: writtenQs.length }))}</strong> · ${escapeHtml(fmt(STRINGS.bossMarkedCount, { done: confirmedCount, total: writtenQs.length }))}</p>
        <div class="unit-stepper" style="margin-block-end:0;">${markPillsHtml}</div>
      </div>

      ${renderQuestionCard({
        unit,
        question: currentW,
        writtenProgress,
        isBossMarking: true,
        allowOnlineVoices,
        contextPrefix: "boss-mark-q"
      })}

      <div class="card">
        <div class="header-inner">
          <div class="nav-actions">
            <button type="button" class="btn btn-secondary" ${wIdx === 0 ? "disabled" : ""} data-action="boss-mark-nav" data-w-index="${wIdx - 1}">${escapeHtml(STRINGS.prevQuestionBtn)}</button>
            <button type="button" class="btn btn-secondary" ${wIdx >= writtenQs.length - 1 ? "disabled" : ""} data-action="boss-mark-nav" data-w-index="${wIdx + 1}">${escapeHtml(STRINGS.nextQuestionBtn)}</button>
          </div>
          <button type="button" class="btn btn-primary" ${allConfirmed ? "" : "disabled aria-describedby=\"finish-lock-reason\""} data-action="boss-finish-marking">${escapeHtml(STRINGS.bossFinishMarkingBtn)}</button>
        </div>
        ${allConfirmed ? "" : `<p id="finish-lock-reason" class="helper-note" style="margin-block:8px 0;text-align:end;">${escapeHtml(fmt(STRINGS.bossFinishLockedReason, { done: confirmedCount, total: writtenQs.length }))}</p>`}
      </div>
    </section>`;
  }

  // Phase 3: Results Phase (§4)
  const res = session.lastResult;
  if (!res) return `<div class="card">No results found.</div>`;

  const topicBarsHtml = (res.topicBreakdown || [])
    .map((tb) => {
      const pct = tb.marks > 0 ? Math.round((tb.earned / tb.marks) * 100) : 0;
      return `<div style="margin-block-end:10px;">
        <div style="display:flex;justify-content:space-between;font-size:0.95rem;">
          <span><strong>${escapeHtml(tb.label)}</strong></span>
          <span>${tb.earned} / ${tb.marks} (${pct}%)</span>
        </div>
        <div style="background:#cbd5e1;block-size:10px;border-radius:999px;overflow:hidden;">
          <div style="background:var(--primary);block-size:100%;inline-size:${pct}%;"></div>
        </div>
      </div>`;
    })
    .join("");

  const practiseNextHtml = renderPractiseNext(res, unit);
  const headline = fmt(STRINGS.bossResultsHeadlines[themeId] || STRINGS.bossResultsHeadlines.explorer, { pct: res.pct });

  return `<section>
    <div class="card">
      <h2>🏁 ${escapeHtml(headline)}</h2>
      <p style="margin-block:0;color:var(--text-muted);">${escapeHtml(STRINGS.bossResultsHeading)} · ${escapeHtml(uTheme.zone)}</p>
      <p style="font-size:1.3rem;font-weight:800;">
        ${escapeHtml(fmt(STRINGS.bossTotalScore, { score: res.totalEarned, marks: res.totalAvailable, pct: res.pct }))}
      </p>
      <p>
        ${
          res.isFirstPaper
            ? escapeHtml(STRINGS.bossFirstRecordNote)
            : res.beatPreviousBest
            ? escapeHtml(fmt(STRINGS.bossVsBestBetter, { prev: res.previousBest, marks: res.totalAvailable }))
            : escapeHtml(fmt(STRINGS.bossVsBestSameOrLower, { best: res.bestScore, first: res.firstScore, marks: res.totalAvailable }))
        }
      </p>
      ${practiseNextHtml}
      <h3>${escapeHtml(STRINGS.bossTopicBreakdownHeading)}</h3>
      <div>${topicBarsHtml}</div>
      <div class="question-action-row">
        <button type="button" class="btn btn-primary" data-action="nav-map">${escapeHtml(STRINGS.backToMapBtn)}</button>
        <button type="button" class="btn btn-secondary" data-action="retake-boss" data-unit-id="${escapeHtml(unit.id)}">${escapeHtml(STRINGS.retakeBossBtn)}</button>
      </div>
    </div>
  </section>`;
}


// v0.3.2: turn a page string like "p14-16, p18" or "13-14" into a list of page numbers
function pagesFromRef(ref) {
  const pages = [];
  String(ref || "")
    .split(",")
    .forEach((part) => {
      const m = part.replace(/p/gi, "").trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!m) return;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= b; n += 1) pages.push(n);
    });
  return pages;
}

// v0.3.2: find the lesson unit (same chapter) whose book pages overlap most with a mock question's sourceRef
function findLessonUnitForMockQuestion(mockUnit, question) {
  const qPages = pagesFromRef(question?.sourceRef);
  if (qPages.length === 0) return null;
  let best = null;
  let bestOverlap = 0;
  Object.values(appState.unitsById).forEach((u) => {
    if (u.meta?.mode === "mock") return;
    if (u.meta?.chapterNumber !== mockUnit.meta?.chapterNumber || u.meta?.subjectId !== mockUnit.meta?.subjectId) return;
    const uPages = new Set((u.meta?.sourceRefs || []).flatMap((r) => pagesFromRef(r.pages)));
    const overlap = qPages.filter((pg) => uPages.has(pg)).length;
    const better = overlap > bestOverlap || (overlap === bestOverlap && overlap > 0 && best && (u.meta?.unit ?? 99) < (best.meta?.unit ?? 99));
    if (overlap > 0 && better) {
      best = u;
      bestOverlap = overlap;
    }
  });
  return best;
}

// v0.3.2: "What to practise next" box on the Boss results screen (weakest topics under 70%, max 3)
function renderPractiseNext(res, mockUnit) {
  const weak = (res.topicBreakdown || [])
    .filter((tb) => tb.marks > 0 && tb.earned / tb.marks < 0.7)
    .sort((a, b) => a.earned / a.marks - b.earned / b.marks)
    .slice(0, 3);
  if (weak.length === 0) {
    return `<div class="why-role-box"><strong>💪 ${escapeHtml(STRINGS.bossPractiseNextHeading)}</strong><p style="margin-block:6px 0;">${escapeHtml(STRINGS.bossAllStrong)}</p></div>`;
  }
  const shownUnits = new Set();
  const rows = weak
    .map((tb) => {
      const q = (mockUnit.practice || []).find((pq) => pq.topic === tb.topicId || pq.topic === tb.topic || pq.topic === tb.id);
      const lessonUnit = q ? findLessonUnitForMockQuestion(mockUnit, q) : null;
      const repeat = lessonUnit && shownUnits.has(lessonUnit.id);
      if (lessonUnit) shownUnits.add(lessonUnit.id);
      const btn = repeat
        ? `<span class="helper-note">(same lesson as above)</span>`
        : lessonUnit
        ? `<button type="button" class="btn btn-secondary" data-action="open-unit" data-unit-id="${escapeHtml(lessonUnit.id)}">${escapeHtml(fmt(STRINGS.bossPractiseNextBtn, { title: lessonUnit.meta.title }))}</button>`
        : "";
      return `<li style="margin-block-end:8px;"><strong>${escapeHtml(tb.label)}</strong> (${tb.earned} / ${tb.marks}) ${btn}</li>`;
    })
    .join("");
  return `<div class="why-role-box"><strong>🎯 ${escapeHtml(STRINGS.bossPractiseNextHeading)}</strong><p style="margin-block:6px;">${escapeHtml(STRINGS.bossPractiseNextIntro)}</p><ul style="margin-block:0;padding-inline-start:20px;">${rows}</ul></div>`;
}

function renderDailyReviewView(prog) {
  if (!appState.reviewSession) {
    startDailyReviewSession(prog, false);
  }
  const rs = appState.reviewSession;
  const allowOnlineVoices = Boolean(prog.settings?.onlineVoices);

  if (rs.completed) {
    return `<div class="card">
      <h2>🎉 ${escapeHtml(STRINGS.dailyReviewCompleteTitle)}</h2>
      <p>${escapeHtml(fmt(STRINGS.dailyReviewCompleteBody, { cards: rs.cardsReviewed, questions: rs.questionsCompleted }))}</p>
      <div class="question-action-row">
        <button type="button" class="btn btn-primary" data-action="nav-map">${escapeHtml(STRINGS.backToMapBtn)}</button>
      </div>
    </div>`;
  }

  if (rs.cardIndex < rs.cards.length) {
    const card = rs.cards[rs.cardIndex];
    const boxTag =
      card.box >= 4
        ? STRINGS.flashcardMasteredLabel
        : fmt(STRINGS.flashcardBoxLabel, { box: card.box || 1 });
    const cardDomId = `srs-card-${rs.cardIndex}`;
    const speech = rs.flipped ? `${card.front}. ${card.back}` : card.front;

    return `<section>
      ${rs.isCram ? `<div class="test-date-banner"><strong>📚 ${escapeHtml(STRINGS.cramModeNotice)}</strong></div>` : ""}
      <div id="${escapeHtml(cardDomId)}" class="flashcard-stage">
        <div class="block-header-row">
          <span class="badge-pill">${escapeHtml(boxTag)} · Card ${rs.cardIndex + 1} of ${rs.cards.length}</span>
          ${renderReadAloudButton(speech, cardDomId, allowOnlineVoices)}
        </div>
        <h2 style="margin-block: 18px;">${formatSafeText(card.front)}</h2>
        ${
          rs.flipped
            ? `<div style="border-block-start:2px dashed var(--border-color);padding-block-start:16px;margin-block-start:16px;">
                 <p style="font-size:1.15rem;">${formatSafeText(card.back)}</p>
                 <div class="question-action-row" style="justify-content:center;">
                   <button type="button" class="btn btn-primary" data-action="srs-grade" data-knew="1">${escapeHtml(STRINGS.flashcardKnewBtn)}</button>
                   <button type="button" class="btn btn-secondary" data-action="srs-grade" data-knew="0">${escapeHtml(STRINGS.flashcardNotYetBtn)}</button>
                 </div>
               </div>`
            : `<div class="question-action-row" style="justify-content:center;">
                 <button type="button" class="btn btn-primary" data-action="srs-flip">${escapeHtml(STRINGS.flashcardFlipBtn)}</button>
               </div>`
        }
      </div>
    </section>`;
  }

  if (rs.qIndex < rs.practiceItems.length) {
    const item = rs.practiceItems[rs.qIndex];
    const globalQid = `review:${item.unitId}#${item.question.id}`;
    const tryRecord = rs.tryRecords[globalQid] || null;
    const st = tryRecord?.state;
    const isResolved = st === "correct" || st === "correct2" || st === "revealed";

    return `<section>
      <div class="card">
        <h2>⚡ ${escapeHtml(STRINGS.quickPracticeHeading)} (${rs.qIndex + 1} of ${rs.practiceItems.length})</h2>
      </div>
      ${renderQuestionCard({
        unit: item.unit,
        question: item.question,
        tryRecord,
        draftAnswer: appState.draftAnswers[globalQid],
        allowOnlineVoices,
        contextPrefix: "review-q"
      })}
      ${
        isResolved
          ? `<div class="card" style="text-align:center;">
               <button type="button" class="btn btn-primary" data-action="srs-next-practice">Continue →</button>
             </div>`
          : ""
      }
    </section>`;
  }

  return `<div class="card">Loading review…</div>`;
}

function startDailyReviewSession(prog, isCram = false) {
  const cards = isCram
    ? getCramFlashcards(prog, appState.unitsById)
    : getDueFlashcards(prog, appState.unitsById);
  const practiceItems = isCram ? [] : getDailyPracticeQuestions(prog, appState.unitsById);

  appState.reviewSession = {
    isCram,
    cards,
    cardIndex: 0,
    flipped: false,
    cardsReviewed: 0,
    practiceItems,
    qIndex: 0,
    questionsCompleted: 0,
    tryRecords: {},
    completed: cards.length === 0 && practiceItems.length === 0
  };
}

function renderThemeAndAvatarView(prog) {
  const sortedThemes = getSortedThemes();
  const currentThemeId = prog.profile?.themeId || "explorer";
  const nickname = prog.profile?.nickname === "Explorer" && !prog.profile?.onboarded ? "" : (prog.profile?.nickname || "");
  const avatar = prog.profile?.avatar || { outfit: "o1", skin: 3, hair: "h2", headwear: "none" };

  const themeTilesHtml = sortedThemes
    .map(
      (t) => `<button
        type="button"
        class="theme-tile ${t.id === currentThemeId ? "theme-selected" : ""}"
        aria-pressed="${t.id === currentThemeId ? "true" : "false"}"
        data-action="pick-theme"
        data-theme-id="${escapeHtml(t.id)}"
      >
        <strong style="font-size:1.1rem;">${escapeHtml(t.label)}</strong>
        <span style="font-size:0.9rem;color:var(--text-muted);">${escapeHtml(t.pickerLine || "")}</span>
      </button>`
    )
    .join("");

  const skinSwatchesHtml = SKIN_TONES.map(
    (s) => `<button
      type="button"
      class="skin-swatch-btn ${Number(avatar.skin) === s.id ? "swatch-selected" : ""}"
      style="background-color:${s.hex};"
      aria-label="${escapeHtml(s.label)}"
      aria-pressed="${Number(avatar.skin) === s.id ? "true" : "false"}"
      data-action="avatar-skin"
      data-skin="${s.id}"
    ></button>`
  ).join("");

  const outfitBtnsHtml = OUTFIT_OPTIONS.map(
    (o) => `<button type="button" class="btn ${avatar.outfit === o.id ? "btn-primary" : "btn-secondary"}" data-action="avatar-outfit" data-outfit="${o.id}">${escapeHtml(o.label)}</button>`
  ).join("");

  const hairBtnsHtml = HAIR_STYLES.map(
    (h) => `<button type="button" class="btn ${avatar.hair === h.id ? "btn-primary" : "btn-secondary"}" data-action="avatar-hair" data-hair="${h.id}">${escapeHtml(h.label)}</button>`
  ).join("");

  const headwearBtnsHtml = HEADWEAR_OPTIONS.map(
    (hw) => `<button type="button" class="btn ${avatar.headwear === hw.id ? "btn-primary" : "btn-secondary"}" data-action="avatar-headwear" data-headwear="${hw.id}">${escapeHtml(hw.label)}</button>`
  ).join("");

  return `<section>
    <div class="card">
      <h2>🌟 ${escapeHtml(STRINGS.themePickerHeading)}</h2>
      <div class="theme-picker-grid">${themeTilesHtml}</div>

      <div style="margin-block: 18px;">
        <label for="nickname-input" style="display:block;font-weight:700;margin-block-end:6px;">${escapeHtml(STRINGS.nicknameLabel)}</label>
        <input
          id="nickname-input"
          type="text"
          class="written-textarea"
          style="max-inline-size:360px;"
          value="${escapeHtml(nickname)}"
          placeholder="${escapeHtml(STRINGS.nicknamePlaceholder)}"
          data-action="input-nickname"
        />
      </div>
    </div>

    <div class="card">
      <h2>🧑 ${escapeHtml(STRINGS.avatarHeading)}</h2>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:24px;">
        <div>${renderAvatarSvg(avatar, currentThemeId, 120)}</div>
        <div style="flex:1;min-inline-size:260px;">
          <p style="margin-block: 0 6px;font-weight:700;">${escapeHtml(STRINGS.avatarSkinLabel)}</p>
          <div class="skin-swatch-row" style="margin-block-end:14px;">${skinSwatchesHtml}</div>

          <p style="margin-block: 0 6px;font-weight:700;">${escapeHtml(STRINGS.avatarOutfitLabel)}</p>
          <div class="nav-actions" style="margin-block-end:14px;">${outfitBtnsHtml}</div>

          <p style="margin-block: 0 6px;font-weight:700;">${escapeHtml(STRINGS.avatarHairLabel)}</p>
          <div class="nav-actions" style="margin-block-end:14px;">${hairBtnsHtml}</div>

          <p style="margin-block: 0 6px;font-weight:700;">${escapeHtml(STRINGS.avatarHeadwearLabel)}</p>
          <div class="nav-actions">${headwearBtnsHtml}</div>
        </div>
      </div>
      <div class="question-action-row" style="margin-block-top:20px;">
        <button type="button" class="btn btn-primary" data-action="save-profile">${escapeHtml(STRINGS.saveProfileBtn)}</button>
      </div>
    </div>
  </section>`;
}

function renderParentView(prog) {
  const savedPin = getParentPin();

  if (!appState.parentUnlocked) {
    return `<section class="card" style="max-inline-size:520px;margin-inline:auto;">
      <h2>🔒 ${escapeHtml(STRINGS.parentPinHeading)}</h2>
      <p style="font-size:0.95rem;color:var(--text-muted);">${escapeHtml(STRINGS.parentPrivacyNotice)}</p>
      ${appState.parentStatusMsg ? `<p style="color:var(--accent);font-weight:700;">${escapeHtml(appState.parentStatusMsg)}</p>` : ""}
      <div style="margin-block:14px;">
        <label for="parent-pin-input" style="display:block;font-weight:700;margin-block-end:6px;">
          ${escapeHtml(savedPin ? STRINGS.parentPinLabel : STRINGS.parentPinSetupLabel)}
        </label>
        <input id="parent-pin-input" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" class="written-textarea" style="max-inline-size:180px;" placeholder="1234" />
      </div>
      <div class="nav-actions">
        <button type="button" class="btn btn-primary" data-action="parent-pin-submit">${escapeHtml(STRINGS.parentPinUnlockBtn)}</button>
        ${savedPin ? `<button type="button" class="btn btn-secondary" data-action="parent-pin-forgot-toggle">${escapeHtml(STRINGS.parentPinForgotBtn)}</button>` : ""}
      </div>
      ${
        appState.parentResetMode
          ? `<div style="margin-block-top:16px;padding-block-top:12px;border-block-start:1px solid var(--border-color);">
               <p>${escapeHtml(STRINGS.parentPinResetInstruction)}</p>
               <input id="parent-reset-input" type="text" class="written-textarea" style="max-inline-size:200px;margin-block-end:8px;" placeholder="RESET" />
               <div><button type="button" class="btn btn-accent" data-action="parent-pin-reset-confirm">${escapeHtml(STRINGS.parentPinResetConfirmBtn)}</button></div>
             </div>`
          : ""
      }
    </section>`;
  }

  const weeklyStatus = getWeeklyStatus(prog);
  const weakTopics = getTopicsNeedingPractice(prog, appState.unitsById);
  const themesErr = getThemesValidationError();
  const activeProfileId = getActiveProfileId();
  const childName = prog.profile?.nickname || "your child";

  const unitRowsHtml = Object.values(appState.unitsById)
    .map((u) => {
      const isMock = u.meta?.mode === "mock";
      const typeLabel = isMock ? STRINGS.parentMockTerm : "lesson";
      const firstPct = getUnitFirstAttemptPct(prog, u);
      const uRec = prog.units?.[u.id] || {};
      const mins = Math.round((uRec.timeSpentSec || 0) / 60);
      const attempts = uRec.attempts || (firstPct !== null ? 1 : 0);
      return `<tr>
        <td>${escapeHtml(u.meta.title)}</td>
        <td>${escapeHtml(typeLabel)}</td>
        <td>${firstPct !== null ? `${firstPct}%` : "Not tried yet"}</td>
        <td>${attempts}</td>
        <td>${mins} min</td>
      </tr>`;
    })
    .join("");

  const writtenRecords = Object.values(prog.questions || {}).filter((q) => q.type === "written");
  const toDiscussList = writtenRecords.filter((q) => q.toDiscuss);

  const writtenReviewCardsHtml = writtenRecords
    .sort((a, b) => Number(Boolean(b.toDiscuss)) - Number(Boolean(a.toDiscuss)))
    .map((rec) => {
      const unitObj = appState.unitsById[rec.unitId];
      const qObj = [...(unitObj?.check || []), ...(unitObj?.practice || [])].find((q) => q.id === rec.questionId);
      return `<div class="card" style="background:var(--bg-subtle);">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <strong>${escapeHtml(unitObj?.meta?.title || rec.unitId)}</strong>
          ${rec.toDiscuss ? `<span class="badge-pill badge-boss">Please check together</span>` : ""}
        </div>
        <p style="margin-block:6px;"><em>${escapeHtml(qObj?.prompt || "")}</em></p>
        <p style="margin-block:6px;"><strong>${escapeHtml(childName)} wrote:</strong> ${escapeHtml(rec.lastAnswer || "(blank)")}</p>
        <p style="margin-block:6px;">${escapeHtml(childName)}'s own mark: ${rec.selfFirstScore ?? 0}/${rec.marks} · App's guess: ${rec.suggestedFirstScore ?? 0}/${rec.marks} · Your mark: ${rec.parentScore ?? "not set"}</p>
        <div class="nav-actions">
          <label>Your mark (0–${rec.marks}):
            <input type="number" min="0" max="${rec.marks}" value="${rec.parentScore ?? rec.selfFirstScore ?? 0}" id="parent-score-${escapeHtml(rec.globalQid)}" class="big-number-input" />
          </label>
          <button type="button" class="btn btn-secondary" data-action="save-parent-score" data-global-qid="${escapeHtml(rec.globalQid)}">${escapeHtml(STRINGS.parentSaveScoreBtn)}</button>
        </div>
      </div>`;
    })
    .join("");

  const profiles = getProfiles();
  const childrenRowsHtml = profiles
    .map((pr) => {
      const pProg = pr.id === activeProfileId ? prog : getProgress(pr.id);
      const pRank = getRankInfo(pProg);
      const themeLabel = getThemeById(pProg.profile?.themeId || "explorer")?.label || "Explorer";
      const isActive = pr.id === activeProfileId;
      return `<li class="child-row">
        <span><strong>${escapeHtml(pProg.profile?.nickname || pr.nickname || pr.id)}</strong> · ${escapeHtml(themeLabel)} · ${pRank.xp} XP</span>
        ${isActive ? `<span class="badge-pill">${escapeHtml(STRINGS.childActiveTag)}</span>` : `<button type="button" class="btn btn-secondary" data-action="parent-use-profile" data-profile-id="${escapeHtml(pr.id)}">${escapeHtml(STRINGS.childSwitchBtn)}</button>`}
      </li>`;
    })
    .join("");

  const mockUnits = Object.values(appState.unitsById).filter((u) => u.meta?.mode === "mock");
  const timerOn = Boolean(prog.settings?.mockTimer);
  const mockControlsHtml = mockUnits
    .map((mu) => {
      const unlocked = Boolean(prog.settings?.mockUnlocked?.[mu.id]);
      const customMin = Number(prog.settings?.mockTimerMinutes?.[mu.id]) || mu.meta?.estMinutes || 35;
      const presetsHtml = [20, 30, 35, 45]
        .map(
          (m) =>
            `<button type="button" class="btn ${customMin === m ? "btn-primary" : "btn-secondary"} timer-preset" aria-pressed="${customMin === m ? "true" : "false"}" data-action="parent-mock-min-preset" data-min="${m}" data-unit-id="${escapeHtml(mu.id)}">${m} min</button>`
        )
        .join("");
      return `<div class="parent-setting">
        <label class="big-toggle">
          <input type="checkbox" ${unlocked ? "checked" : ""} data-action="parent-toggle-mock-unlock" data-unit-id="${escapeHtml(mu.id)}" />
          <span>Let ${escapeHtml(childName)} take the <strong>${escapeHtml(mu.meta.title)}</strong> now</span>
        </label>
        <p class="setting-help">Normally the mock test (the "Boss") opens after all learning zones are finished. Tick this to open it early, for example a few days before the real test.</p>
        <label class="big-toggle">
          <input type="checkbox" ${timerOn ? "checked" : ""} data-action="parent-toggle-mock-timer" />
          <span>Use a countdown timer</span>
        </label>
        <p class="setting-help">Off by default, so your child can take their time. Turn it on to practise exam timing. If a paper is already open, the clock starts when your child goes back to it.</p>
        ${
          timerOn
            ? `<div class="timer-presets" role="group" aria-label="${escapeHtml(STRINGS.timerPresetsLabel)}">
                 <span style="font-weight:700;">${escapeHtml(STRINGS.timerPresetsLabel)}:</span>
                 ${presetsHtml}
                 <label>${escapeHtml(STRINGS.timerCustomLabel)}
                   <input type="number" min="5" max="120" value="${customMin}" class="big-number-input" data-action="parent-set-mock-min" data-unit-id="${escapeHtml(mu.id)}" />
                 </label>
               </div>`
            : ""
        }
      </div>`;
    })
    .join("");

  const earnedBadges = Object.keys(prog.badges || {}).map(
    (bid) => BADGE_CATALOG.find((b) => b.id === bid)?.title || bid
  );

  return `<section class="parent-area">
    <div class="card">
      <div class="block-header-row">
        <h2>👨‍👩‍👧 ${escapeHtml(STRINGS.parentPinHeading)}</h2>
        <div class="nav-actions">
          <button type="button" class="btn btn-secondary" data-action="open-tour" data-tour="parent">${escapeHtml(STRINGS.helpBtn)}</button>
          <button type="button" class="btn btn-primary" data-action="nav-map">${escapeHtml(STRINGS.parentExitBtn)}</button>
        </div>
      </div>
      ${themesErr ? `<p style="color:var(--accent);">Theme validation fallback active: ${escapeHtml(themesErr)}</p>` : ""}
      ${appState.parentStatusMsg ? `<p class="status-msg" role="status">${escapeHtml(appState.parentStatusMsg)}</p>` : ""}
    </div>

    <div class="card">
      <h3>👥 ${escapeHtml(STRINGS.parentProfilesHeading)}</h3>
      <p class="setting-help">${escapeHtml(STRINGS.childrenExplain)}</p>
      <ul class="child-list">${childrenRowsHtml}</ul>
      <div class="nav-actions">
        <input id="new-profile-name" type="text" placeholder="${escapeHtml(STRINGS.childNamePlaceholder)}" class="written-textarea" style="max-inline-size:240px;" />
        <button type="button" class="btn btn-primary" data-action="parent-add-profile">${escapeHtml(STRINGS.parentAddProfileBtn)}</button>
      </div>
    </div>

    <div class="card">
      <h3>📅 Test and study plan for ${escapeHtml(childName)}</h3>
      <div class="parent-setting">
        <label><strong>${escapeHtml(STRINGS.parentTestDateLabel)}</strong><br />
          <input type="date" class="btn" value="${escapeHtml(prog.settings?.testDate || "")}" data-action="parent-set-test-date" />
        </label>
        <p class="setting-help">Shows a countdown and a simple study plan before the test. Leave it empty if no test is coming.</p>
      </div>
      <div class="parent-setting">
        <label><strong>${escapeHtml(STRINGS.parentWeeklyTargetLabel)}</strong><br />
          <select class="btn" data-action="parent-set-weekly-target">
            ${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(prog.weekly?.target) === d ? "selected" : ""}>${d} days a week</option>`).join("")}
          </select>
        </label>
        <p class="setting-help">How many days a week ${escapeHtml(childName)} aims to study. A missed week never resets progress or XP.</p>
      </div>
      ${mockControlsHtml}
    </div>

    <div class="card">
      <h3>📊 How ${escapeHtml(childName)} is doing</h3>
      <p>This week: <strong>${escapeHtml(weeklyStatus.onTargetThisWeek ? STRINGS.parentWeeklyStatusOn : STRINGS.parentWeeklyStatusNot)}</strong> (${weeklyStatus.doneDays} of ${weeklyStatus.target} days)
        ${prog.weekly?.childAdjustedSettings ? ` · <em>${escapeHtml(STRINGS.parentBlockerAdjustedNote)}</em>` : ""}</p>
      <h4>Topics to practise</h4>
      ${
        weakTopics.length === 0
          ? `<p>${escapeHtml(STRINGS.parentNoTopicsNeedPractice)}</p>`
          : `<ul>${weakTopics.map((wt) => `<li><strong>${escapeHtml(wt.topicLabel)}</strong>: ${wt.earnedMarks}/${wt.availableMarks} marks (${wt.pct}%)</li>`).join("")}</ul>`
      }
      <details class="parent-details">
        <summary>Scores for each unit</summary>
        <table class="parent-table">
          <thead><tr><th>${escapeHtml(STRINGS.parentUnitCol)}</th><th>${escapeHtml(STRINGS.parentTypeCol)}</th><th>${escapeHtml(STRINGS.parentFirstScoreCol)}</th><th>${escapeHtml(STRINGS.parentAttemptsCol)}</th><th>${escapeHtml(STRINGS.parentTimeCol)}</th></tr></thead>
          <tbody>${unitRowsHtml}</tbody>
        </table>
      </details>
      <details class="parent-details" ${toDiscussList.length > 0 ? "open" : ""}>
        <summary>✍️ Written answers to check${toDiscussList.length > 0 ? ` (${toDiscussList.length} to check together)` : ""}</summary>
        <p class="setting-help">${escapeHtml(childName)} marks written answers by ticking each point they made. When their mark is much higher than the app's guess, it shows here as "Please check together". You can set your own mark.</p>
        ${writtenReviewCardsHtml || "<p>No written answers yet.</p>"}
      </details>
    </div>

    <details class="card parent-details">
      <summary><strong>⚙️ More settings</strong> (read-aloud voice, breaks, rewards, saving progress)</summary>

      <div class="parent-setting">
        <label class="big-toggle">
          <input type="checkbox" ${prog.settings?.onlineVoices ? "checked" : ""} data-action="parent-toggle-online-voices" />
          <span>Use nicer, more natural voices for read-aloud</span>
        </label>
        <p class="setting-help">These voices sound much more human, but the lesson text is sent to the browser's speech service (Microsoft in Edge, Google in Chrome). No names or answers are sent. Off by default.</p>
      </div>
      <div class="parent-setting">
        <label><strong>${escapeHtml(STRINGS.parentTtsRateLabel)}</strong><br />
          <select class="btn" data-action="parent-set-tts-rate">
            ${[[0.8, "Slow"], [0.95, "Normal"], [1.1, "Fast"]].map(([r, l]) => `<option value="${r}" ${Number(prog.settings?.ttsRate) === r ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <p class="setting-help">${escapeHtml(childName)} can also change this while listening.</p>
      </div>
      <div class="parent-setting">
        <label><strong>${escapeHtml(STRINGS.parentBreakIntervalLabel)}</strong><br />
          <select class="btn" data-action="parent-set-break-min">
            ${[15, 20, 25, 30, 0].map((m) => `<option value="${m}" ${Number(prog.settings?.breakMin) === m ? "selected" : ""}>${m === 0 ? "Off" : `Every ${m} min`}</option>`).join("")}
          </select>
        </label>
        <p class="setting-help">Suggests a 5-minute break (water, stretch) after this much study time.</p>
      </div>
      <div class="parent-setting">
        <label><strong>${escapeHtml(STRINGS.parentMissionCapLabel)}</strong><br />
          <select class="btn" data-action="parent-set-mission-cap">
            ${[6, 7, 8, 9, 10].map((c) => `<option value="${c}" ${Number(prog.settings?.missionCapMin) === c ? "selected" : ""}>${c} min</option>`).join("")}
          </select>
        </label>
        <p class="setting-help">Lessons are split into missions of about this length. Shorter suits younger or easily tired learners.</p>
      </div>
      <div class="parent-setting">
        <label class="big-toggle">
          <input type="checkbox" ${prog.settings?.calmMode ? "checked" : ""} data-action="parent-toggle-calm" />
          <span>Calm mode</span>
        </label>
        <p class="setting-help">Turns off celebrations, sound effects and countdown banners, and softens colours. Helpful for children who get overexcited or anxious.</p>
      </div>

      <h3>🎁 ${escapeHtml(STRINGS.parentRewardsHeading)}</h3>
      <p class="setting-help">${escapeHtml(STRINGS.parentRewardsRules)}</p>
      <ul>
        ${(prog.rewards?.menu || [])
          .map(
            (r) => `<li style="margin-block-end:6px;">
              ${escapeHtml(r.label)}
              <button type="button" class="btn-inline-clear" data-action="parent-remove-reward" data-reward-id="${escapeHtml(r.id)}" aria-label="Remove ${escapeHtml(r.label)}">✕</button>
            </li>`
          )
          .join("")}
      </ul>
      ${
        (prog.rewards?.menu || []).length < 6
          ? `<div class="nav-actions">
               <input id="new-reward-input" type="text" placeholder="e.g. Pick dinner" class="written-textarea" style="max-inline-size:260px;" />
               <button type="button" class="btn btn-secondary" data-action="parent-add-reward">${escapeHtml(STRINGS.parentAddRewardBtn)}</button>
             </div>`
          : ""
      }
      <h4>${escapeHtml(STRINGS.parentPickedRewardsHeading)}</h4>
      <ul>
        ${
          (prog.rewards?.picked || []).length === 0
            ? "<li>None picked yet.</li>"
            : (prog.rewards?.picked || [])
                .map((p) => `<li>Picked: <strong>${escapeHtml(p.label || p.id)}</strong> (${escapeHtml(p.at?.slice(0, 10) || "")})</li>`)
                .join("")
        }
      </ul>
      <p>Badges earned: ${earnedBadges.length > 0 ? escapeHtml(earnedBadges.join(", ")) : "none yet"}</p>

      <h3>💾 ${escapeHtml(STRINGS.parentBackupHeading)}</h3>
      <p class="setting-help">Progress is saved in this browser on this device only. Save it to a file now and then. You can load that file on another laptop or tablet to carry on there, or to restore progress if the browser is cleared.</p>
      <div class="nav-actions">
        <button type="button" class="btn btn-primary" data-action="backup-export">${escapeHtml(STRINGS.parentExportBtn)}</button>
        <label class="btn btn-secondary">
          ${escapeHtml(STRINGS.parentImportLabel)}
          <input type="file" accept="application/json,.json" style="display:none;" data-action="backup-import" />
        </label>
      </div>
      <p class="setting-help">${escapeHtml(STRINGS.parentPrivacyNotice)}</p>
    </details>
  </section>`;
}

function renderActiveModals(prog) {
  const theme = getThemeById(prog.profile?.themeId || "explorer");

  if (appState.tour && TOURS[appState.tour.kind]) {
    const steps = TOURS[appState.tour.kind];
    const i = Math.max(0, Math.min(appState.tour.step, steps.length - 1));
    const st = steps[i];
    const vars = { name: prog.profile?.nickname || "Explorer", theme: theme?.label || "Explorer" };
    const dots = steps.map((_, k) => `<span class="tour-dot ${k === i ? "on" : ""}"></span>`).join("");
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div class="modal-card tour-card">
        <div class="tour-icon" aria-hidden="true">${st.icon}</div>
        <h3 id="tour-title" tabindex="-1">${escapeHtml(fmt(st.title, vars))}</h3>
        <p>${escapeHtml(fmt(st.body, vars))}</p>
        <div class="tour-dots" aria-label="Step ${i + 1} of ${steps.length}">${dots}</div>
        <div class="nav-actions tour-actions">
          ${i > 0 ? `<button type="button" class="btn btn-secondary" data-action="tour-back">${escapeHtml(STRINGS.tourBack)}</button>` : `<button type="button" class="btn btn-secondary" data-action="tour-close">${escapeHtml(STRINGS.tourSkip)}</button>`}
          ${i < steps.length - 1 ? `<button type="button" class="btn btn-primary" data-action="tour-next">${escapeHtml(STRINGS.tourNext)}</button>` : `<button type="button" class="btn btn-primary" data-action="tour-close">${escapeHtml(STRINGS.tourDone)}</button>`}
        </div>
      </div>
    </div>`;
  }

  if (appState.bossConfirmSubmitOpen && appState.activeUnitId) {
    const unit = appState.unitsById[appState.activeUnitId];
    const session = prog.mock?.[unit.id];
    const qs = unit?.practice || [];
    const answeredCount = qs.filter((q) => {
      const a = appState.draftAnswers[`${unit.id}#${q.id}`] ?? session?.answers?.[q.id];
      return a !== undefined && a !== null && a !== "";
    }).length;

    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm submit">
      <div class="modal-card">
        <h3>${escapeHtml(STRINGS.confirmSubmitTitle)}</h3>
        <p>${escapeHtml(fmt(STRINGS.confirmSubmitBody, { answered: answeredCount, total: qs.length }))}</p>
        <div class="nav-actions">
          <button type="button" class="btn btn-accent" data-action="boss-confirm-submit-yes">${escapeHtml(STRINGS.confirmSubmitYesBtn)}</button>
          <button type="button" class="btn btn-secondary" data-action="boss-confirm-submit-cancel">${escapeHtml(STRINGS.confirmSubmitCancelBtn)}</button>
        </div>
      </div>
    </div>`;
  }

  if (appState.breakModalOpen) {
    let timerLine = "";
    if (appState.breakCountdownSec !== null) {
      const mm = String(Math.floor(appState.breakCountdownSec / 60)).padStart(2, "0");
      const ss = String(appState.breakCountdownSec % 60).padStart(2, "0");
      timerLine = `<p style="font-size:1.3rem;font-weight:800;">⏳ ${escapeHtml(fmt(STRINGS.breakCountdownActive, { mm, ss }))}</p>`;
    }
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Break time">
      <div class="modal-card">
        <h3>☕ ${escapeHtml(theme.breakName || "Break")}</h3>
        <p>${escapeHtml(STRINGS.breakCardBody)}</p>
        ${timerLine}
        <div class="nav-actions">
          ${
            appState.breakCountdownSec === null
              ? `<button type="button" class="btn btn-primary" data-action="start-5min-break">${escapeHtml(STRINGS.startBreakBtn)}</button>
                 <button type="button" class="btn btn-secondary" data-action="close-break-modal">${escapeHtml(STRINGS.keepGoingBtn)}</button>`
              : `<button type="button" class="btn btn-primary" data-action="close-break-modal">${escapeHtml(STRINGS.endBreakEarlyBtn)}</button>`
          }
        </div>
      </div>
    </div>`;
  }

  if (appState.levelUpBannerRank && !prog.settings?.calmMode) {
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rank up">
      <div class="modal-card" style="text-align:center;">
        <h2>🌟 ${escapeHtml(STRINGS.levelUpTitle)}</h2>
        <p style="font-size:1.2rem;font-weight:700;">${escapeHtml(fmt(STRINGS.levelUpBody, { rank: appState.levelUpBannerRank }))}</p>
        <button type="button" class="btn btn-primary" data-action="dismiss-levelup">${escapeHtml(STRINGS.dismissBtn)}</button>
      </div>
    </div>`;
  }

  const pendingMs = prog.rewards?.pendingMilestones?.[0];
  if (pendingMs && (prog.rewards?.menu || []).length > 0 && appState.view !== "boss") {
    const buttonsHtml = (prog.rewards.menu || [])
      .map(
        (r) => `<button type="button" class="btn btn-primary" data-action="claim-reward" data-reward-id="${escapeHtml(r.id)}" data-ms-id="${escapeHtml(pendingMs.id)}">🎁 ${escapeHtml(r.label)}</button>`
      )
      .join("");
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reward menu">
      <div class="modal-card">
        <h3>🎉 ${escapeHtml(STRINGS.rewardMilestoneHeading)}</h3>
        <p>${escapeHtml(fmt(STRINGS.rewardMilestoneSub, { reason: pendingMs.reason }))}</p>
        <div class="nav-actions" style="margin-block:12px;">${buttonsHtml}</div>
        <button type="button" class="btn btn-secondary" data-action="skip-reward-milestone" data-ms-id="${escapeHtml(pendingMs.id)}">${escapeHtml(STRINGS.rewardSkipBtn)}</button>
      </div>
    </div>`;
  }

  return "";
}

// L2: Restore both completed written answers and in-progress checklist written answers (saved in tries[gId])
function hydrateUnitStateFromStorage(unitId) {
  const prog = getProgress();
  const unit = appState.unitsById[unitId];
  if (!unit) return;
  const allQs = [...(unit.check || []), ...(unit.practice || [])];
  for (const q of allQs) {
    const gId = `${unit.id}#${q.id}`;
    const qRec = prog.questions?.[gId];
    const tryRec = prog.tries?.[gId];
    if (q.type === "written") {
      if (qRec && qRec.firstAttemptScore !== null) {
        appState.writtenState[gId] = {
          stage: "completed",
          studentText: qRec.lastAnswer || "",
          suggestedScore: qRec.lastSuggestedScore ?? qRec.suggestedFirstScore ?? 0,
          matchedIds: tryRec?.matchedIds || qRec.lastTicks || [],
          ticks: qRec.lastTicks || [],
          selfScore: qRec.lastSelfScore ?? qRec.selfFirstScore ?? 0,
          toDiscuss: Boolean(qRec.toDiscuss),
          parentScore: qRec.parentScore
        };
      } else if (tryRec && tryRec.suggestedScore !== undefined) {
        appState.writtenState[gId] = {
          stage: "checklist",
          studentText: tryRec.text || "",
          suggestedScore: tryRec.suggestedScore,
          matchedIds: tryRec.matchedIds || [],
          ticks: Array.isArray(tryRec.ticks) ? [...tryRec.ticks] : [...(tryRec.matchedIds || [])],
          selfScore: null,
          toDiscuss: false
        };
      }
    } else if (tryRec) {
      appState.draftAnswers[gId] = tryRec.try2 ?? tryRec.try1 ?? null;
    }
  }
}

// C2: Update only #boss-timer-display text each second; save timerLeftSec every 10 s and on visibilitychange; full renderApp only when time expires
function startBossTimerLoop(unitId) {
  if (appState.bossTickInterval) {
    clearInterval(appState.bossTickInterval);
    appState.bossTickInterval = null;
  }

  const prog = getProgress();
  const session = prog.mock?.[unitId];
  if (!session || session.phase !== "exam" || !session.timerEnabled || session.timerLeftSec === null) {
    appState.bossLiveSecondsLeft = null;
    return;
  }

  appState.bossLiveSecondsLeft = Number(session.timerLeftSec);
  let ticksSinceSave = 0;

  appState.bossTickInterval = setInterval(() => {
    if (document.hidden || appState.view !== "boss" || appState.activeUnitId !== unitId) return;
    if (appState.bossLiveSecondsLeft === null || appState.bossLiveSecondsLeft === undefined) return;

    appState.bossLiveSecondsLeft = Math.max(0, appState.bossLiveSecondsLeft - 1);
    ticksSinceSave += 1;

    // Update only the timer element's text in the DOM
    const timerEl = document.getElementById("boss-timer-display");
    if (timerEl) {
      const mm = String(Math.floor(appState.bossLiveSecondsLeft / 60)).padStart(2, "0");
      const ss = String(appState.bossLiveSecondsLeft % 60).padStart(2, "0");
      timerEl.textContent = `⏱️ ${mm}:${ss}`;
    }

    if (appState.bossLiveSecondsLeft === 0) {
      clearInterval(appState.bossTickInterval);
      appState.bossTickInterval = null;
      const unit = appState.unitsById[unitId];
      updateProgress((p) => {
        if (p.mock?.[unitId]) {
          p.mock[unitId].timerLeftSec = 0;
          submitMockPaper(p, unit, { timeExpired: true });
          evaluateBadges(p, unit);
        }
      });
      renderApp();
    } else if (ticksSinceSave >= 10) {
      ticksSinceSave = 0;
      const secToSave = appState.bossLiveSecondsLeft;
      updateProgress((p) => {
        if (p.mock?.[unitId] && p.mock[unitId].phase === "exam") {
          p.mock[unitId].timerLeftSec = secToSave;
        }
      });
    }
  }, 1000);
}

function bindGlobalEvents() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    handleAction(action, btn, e);
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    handleChange(action, el, e);
  });

  document.addEventListener("input", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    handleInput(action, el, e);
  });

  // C2: Save timerLeftSec on visibilitychange
  document.addEventListener("visibilitychange", () => {
    if (
      document.hidden &&
      appState.view === "boss" &&
      appState.activeUnitId &&
      appState.bossLiveSecondsLeft !== null
    ) {
      const uid = appState.activeUnitId;
      const secToSave = appState.bossLiveSecondsLeft;
      updateProgress((p) => {
        if (p.mock?.[uid] && p.mock[uid].phase === "exam") {
          p.mock[uid].timerLeftSec = secToSave;
        }
      });
    }
  });
}

function handleAction(action, el, event) {
  const prog = getProgress();

  if (action === "open-tour") {
    appState.tour = { kind: el.getAttribute("data-tour") === "parent" ? "parent" : "kid", step: 0 };
    appState.pendingFocusTargetId = "tour-title";
    renderApp();
    return;
  }
  if (action === "tour-next" || action === "tour-back") {
    if (appState.tour) appState.tour.step += action === "tour-next" ? 1 : -1;
    appState.pendingFocusTargetId = "tour-title";
    renderApp();
    return;
  }
  if (action === "tour-close") {
    if (appState.tour?.kind === "kid") {
      updateProgress((p) => {
        p.profile.tourSeen = true;
      });
    } else if (appState.tour?.kind === "parent") {
      try {
        localStorage.setItem(PARENT_TOUR_KEY, "1");
      } catch (_) {
        /* ignore */
      }
    }
    appState.tour = null;
    renderApp();
    return;
  }

  if (action === "tts-speak") {
    event.preventDefault();
    const speech = decodeURIComponent(el.getAttribute("data-speech") || "");
    const targetId = el.getAttribute("data-target-id");
    const targetEl = targetId ? document.getElementById(targetId) : null;
    toggleRead(targetEl, speech, {
      rate: prog.settings?.ttsRate || 0.95,
      allowOnlineVoices: Boolean(prog.settings?.onlineVoices)
    });
    return;
  }

  if (action === "toggle-realworld") {
    const unitId = el.getAttribute("data-unit-id");
    const blockId = el.getAttribute("data-block-id");
    if (unitId && blockId) {
      updateProgress((p) => {
        if (!p.realWorldOpened) p.realWorldOpened = {};
        p.realWorldOpened[`${unitId}#${blockId}`] = new Date().toISOString();
        evaluateBadges(p);
      });
    }
    return;
  }

  if (action.startsWith("nav-") || action.startsWith("open-") || action.startsWith("select-") || action === "save-profile") {
    stopSpeech();
  }

  if (action === "nav-map") {
    appState.view = "map";
    renderApp();
    return;
  }

  // M1: Save profile & mark onboarded = true
  if (action === "save-profile") {
    const nickInput = document.getElementById("nickname-input");
    const typedNick = nickInput ? nickInput.value.trim() : "";
    updateProgress((p) => {
      if (typedNick) {
        p.profile.nickname = typedNick;
      } else if (!p.profile.nickname) {
        p.profile.nickname = "Explorer";
      }
      p.profile.onboarded = true;
    });
    appState.view = getDefaultHomeView();
    if (!getProgress().profile?.tourSeen) {
      appState.tour = { kind: "kid", step: 0 };
      appState.pendingFocusTargetId = "tour-title";
    }
    renderApp();
    return;
  }

  if (action === "nav-review") {
    startDailyReviewSession(getProgress(), false);
    appState.view = "review";
    renderApp();
    return;
  }
  if (action === "start-cram-review") {
    startDailyReviewSession(getProgress(), true);
    appState.view = "review";
    renderApp();
    return;
  }
  if (action === "nav-theme") {
    appState.view = "theme";
    renderApp();
    return;
  }
  if (action === "nav-parent") {
    appState.view = "parent";
    appState.parentStatusMsg = "";
    renderApp();
    return;
  }
  if (action === "toggle-calm-mode") {
    updateProgress((p) => {
      p.settings.calmMode = !p.settings.calmMode;
    });
    renderApp();
    return;
  }

  if (action === "select-subject") {
    appState.activeSubjectId = el.getAttribute("data-subject-id");
    appState.view = "chapters";
    renderApp();
    return;
  }
  if (action === "select-chapter") {
    appState.activeChapterKey = el.getAttribute("data-chapter-key");
    appState.view = "map";
    renderApp();
    return;
  }

  if (action === "toggle-test-banner") {
    const hide = el.getAttribute("data-hide") === "1";
    updateProgress((p) => {
      p.settings.hideTestBanner = hide;
    });
    renderApp();
    return;
  }

  if (action === "toggle-pause-week") {
    const wk = getWeeklyStatus(prog).weekKey;
    updateProgress((p) => {
      if (!Array.isArray(p.weekly.paused)) p.weekly.paused = [];
      if (p.weekly.paused.includes(wk)) {
        p.weekly.paused = p.weekly.paused.filter((w) => w !== wk);
      } else {
        p.weekly.paused.push(wk);
      }
    });
    renderApp();
    return;
  }

  if (action === "blocker-choice") {
    const choice = el.getAttribute("data-choice");
    const wk = getWeeklyStatus(prog).prevWeek;
    updateProgress((p) => {
      p.weekly.lastPromptWeek = wk;
      if (choice === "shorter") {
        p.settings.missionCapMin = 6;
        p.weekly.childAdjustedSettings = true;
      } else if (choice === "easier") {
        p.settings.easierStartReview = true;
        p.weekly.childAdjustedSettings = true;
      }
    });
    if (choice === "easier") {
      startDailyReviewSession(getProgress(), false);
      appState.view = "review";
    }
    renderApp();
    return;
  }

  if (action === "open-unit") {
    const unitId = el.getAttribute("data-unit-id");
    appState.activeUnitId = unitId;
    hydrateUnitStateFromStorage(unitId);
    const unit = appState.unitsById[unitId];
    const missions = buildMissions(unit, prog.settings?.missionCapMin || 8);
    const doneKeys = new Set(prog.missions?.[unitId]?.done || []);
    const firstUnfinishedIdx = missions.findIndex((m) => !doneKeys.has(m.key));
    appState.unitStep = {
      type: "mission",
      missionIndex: firstUnfinishedIdx >= 0 ? firstUnfinishedIdx : 0,
      phase: "brief"
    };
    appState.view = "unit";
    renderApp();
    return;
  }

  if (action === "select-unit-mission") {
    const idx = Number(el.getAttribute("data-mission-index")) || 0;
    appState.unitStep = { type: "mission", missionIndex: idx, phase: "brief" };
    sessionTimer?.checkBreakBoundary();
    renderApp();
    return;
  }

  if (action === "start-mission-dive") {
    appState.unitStep.phase = "dive";
    renderApp();
    return;
  }

  if (action === "done-reading-scroll") {
    sessionTimer?.checkBreakBoundary();
    const anchor = document.getElementById("mission-challenges-anchor");
    if (anchor) {
      anchor.scrollIntoView({ behavior: prog.settings?.calmMode ? "auto" : "smooth" });
      anchor.focus();
    }
    return;
  }

  if (action === "scroll-to-block") {
    const domId = el.getAttribute("data-block-dom-id");
    const blkEl = domId ? document.getElementById(domId) : null;
    if (blkEl) {
      blkEl.scrollIntoView({ behavior: prog.settings?.calmMode ? "auto" : "smooth" });
      blkEl.focus();
    }
    return;
  }

  if (action === "review-mission-block") {
    const mIdx = Number(el.getAttribute("data-mission-index")) || 0;
    const domId = el.getAttribute("data-block-dom-id");
    appState.unitStep = { type: "mission", missionIndex: mIdx, phase: "dive" };
    renderApp();
    setTimeout(() => {
      const blk = domId ? document.getElementById(domId) : null;
      if (blk) {
        blk.scrollIntoView({ behavior: "auto" });
        blk.focus();
      }
    }, 40);
    return;
  }

  if (action === "fill-select-word") {
    const gId = el.getAttribute("data-global-qid");
    const word = el.getAttribute("data-word");
    const curr = appState.draftAnswers[gId] || { slots: {}, selectedWord: null };
    const slots = curr.slots ? { ...curr.slots } : { ...curr };
    appState.draftAnswers[gId] = {
      slots,
      selectedWord: curr.selectedWord === word ? null : word
    };
    renderApp();
    return;
  }

  if (action === "fill-place-slot") {
    const gId = el.getAttribute("data-global-qid");
    const itemId = el.getAttribute("data-item-id");
    const curr = appState.draftAnswers[gId] || { slots: {}, selectedWord: null };
    const slots = curr.slots ? { ...curr.slots } : { ...curr };
    if (curr.selectedWord) {
      for (const [k, v] of Object.entries(slots)) {
        if (v === curr.selectedWord) delete slots[k];
      }
      slots[itemId] = curr.selectedWord;
      appState.draftAnswers[gId] = { slots, selectedWord: null };
      syncBossDraftIfExam(gId, slots);
      renderApp();
    }
    return;
  }

  if (action === "fill-clear-slot") {
    const gId = el.getAttribute("data-global-qid");
    const itemId = el.getAttribute("data-item-id");
    const curr = appState.draftAnswers[gId] || { slots: {}, selectedWord: null };
    const slots = curr.slots ? { ...curr.slots } : { ...curr };
    delete slots[itemId];
    appState.draftAnswers[gId] = { slots, selectedWord: curr.selectedWord || null };
    syncBossDraftIfExam(gId, slots);
    renderApp();
    return;
  }

  if (action === "match-select-left") {
    const gId = el.getAttribute("data-global-qid");
    const leftId = el.getAttribute("data-left-id");
    const curr = appState.draftAnswers[gId] || { pairs: {}, selectedLeft: null };
    const pairs = curr.pairs ? { ...curr.pairs } : { ...curr };
    appState.draftAnswers[gId] = {
      pairs,
      selectedLeft: curr.selectedLeft === leftId ? null : leftId
    };
    renderApp();
    return;
  }

  if (action === "match-select-right") {
    const gId = el.getAttribute("data-global-qid");
    const rightId = el.getAttribute("data-right-id");
    const curr = appState.draftAnswers[gId] || { pairs: {}, selectedLeft: null };
    const pairs = curr.pairs ? { ...curr.pairs } : { ...curr };
    if (curr.selectedLeft) {
      for (const [k, v] of Object.entries(pairs)) {
        if (v === rightId) delete pairs[k];
      }
      pairs[curr.selectedLeft] = rightId;
      appState.draftAnswers[gId] = { pairs, selectedLeft: null };
      syncBossDraftIfExam(gId, pairs);
      renderApp();
    }
    return;
  }

  if (action === "match-clear-pair") {
    const gId = el.getAttribute("data-global-qid");
    const leftId = el.getAttribute("data-left-id");
    const curr = appState.draftAnswers[gId] || { pairs: {}, selectedLeft: null };
    const pairs = curr.pairs ? { ...curr.pairs } : { ...curr };
    delete pairs[leftId];
    appState.draftAnswers[gId] = { pairs, selectedLeft: curr.selectedLeft || null };
    syncBossDraftIfExam(gId, pairs);
    renderApp();
    return;
  }

  if (action === "submit-auto-q") {
    const gId = el.getAttribute("data-global-qid");
    handleAutoQuestionSubmit(gId);
    return;
  }

  if (action === "ack-got-it") {
    const gId = el.getAttribute("data-global-qid");
    const cleanGid = gId.replace(/^review:/, "");
    updateProgress((p) => {
      const tr = p.tries?.[cleanGid];
      if (tr) {
        tr.gotItAck = true;
        const elapsedSec = tr.revealedAt ? (Date.now() - tr.revealedAt) / 1000 : 6;
        if (elapsedSec >= 5) {
          awardXpEvent(p, `rev:${cleanGid}`, 1);
        }
      }
    });
    renderApp();
    return;
  }

  // L2: Save lesson written answer (text, suggestedScore, matchedIds) to progress.tries[gId] on Submit so reload restores it and suggestedScore cannot be changed
  if (action === "submit-written-text") {
    const gId = el.getAttribute("data-global-qid");
    const [unitId, qId] = gId.split("#");
    const unit = appState.unitsById[unitId];
    const q = [...(unit?.check || []), ...(unit?.practice || [])].find((item) => item.id === qId);
    if (!q) return;

    const existingTry = prog.tries?.[gId];
    const studentText = existingTry?.text !== undefined ? existingTry.text : (appState.draftAnswers[gId] || "");
    const evalRes =
      existingTry && existingTry.suggestedScore !== undefined
        ? { suggestedScore: existingTry.suggestedScore, matchedIds: existingTry.matchedIds || [] }
        : evaluateWrittenSuggested(q, studentText);

    const { suggestedScore, matchedIds } = evalRes;

    updateProgress((p) => {
      if (!p.tries) p.tries = {};
      if (!p.tries[gId] || p.tries[gId].suggestedScore === undefined) {
        p.tries[gId] = {
          state: "checklist",
          text: studentText,
          suggestedScore,
          matchedIds,
          ticks: [...matchedIds],
          submittedAt: new Date().toISOString()
        };
      }
    });

    appState.writtenState[gId] = {
      stage: "checklist",
      studentText,
      suggestedScore,
      matchedIds,
      ticks: [...matchedIds],
      selfScore: null,
      toDiscuss: false
    };
    announceLive(fmt(STRINGS.suggestedScoreLabel, { score: suggestedScore, marks: q.marks }));
    renderApp();
    return;
  }

  if (action === "confirm-written-self") {
    const gId = el.getAttribute("data-global-qid");
    const [unitId, qId] = gId.split("#");
    const unit = appState.unitsById[unitId];
    const q = [...(unit?.check || []), ...(unit?.practice || [])].find((item) => item.id === qId);
    if (!q) return;

    if (appState.view === "boss") {
      updateProgress((p) => {
        const session = p.mock?.[unitId];
        const ev = session?.writtenEvaluations?.[qId];
        const ticks = ev?.ticks || [];
        confirmMockWrittenSelfMark(p, unit, q, ticks);
        evaluateBadges(p, unit);
      });
      renderApp();
      return;
    }

    const ws = appState.writtenState[gId];
    if (!ws) return;
    const { selfScore, toDiscuss } = evaluateWrittenSelf(q, ws.ticks || [], ws.suggestedScore);
    ws.selfScore = selfScore;
    ws.toDiscuss = toDiscuss;
    ws.stage = "completed";

    recordQuestionAttempt(unitId, q, {
      score: selfScore,
      suggestedScore: ws.suggestedScore,
      selfScore,
      ticks: ws.ticks || [],
      toDiscuss,
      answer: ws.studentText,
      version: unit.meta?.version
    });

    updateProgress((p) => {
      if (p.tries?.[gId]) {
        p.tries[gId].state = "completed";
        p.tries[gId].ticks = [...(ws.ticks || [])];
      }
      const res = awardXpEvent(p, `self:${gId}`, 8);
      if (res.leveledUp) appState.levelUpBannerRank = res.newRank;
      evaluateBadges(p, unit);
    });

    appState.pendingFocusTargetId = `model-${gId.replace("#", "-")}`;
    announceLive(fmt(STRINGS.selfScoreSavedLabel, { self: selfScore, suggested: ws.suggestedScore, marks: q.marks }));
    renderApp();
    return;
  }

  if (action === "complete-mission") {
    const missionKey = el.getAttribute("data-mission-key");
    const unitId = appState.activeUnitId;
    const unit = appState.unitsById[unitId];
    let xpEarnedNow = 0;
    let newBadgesNow = [];

    updateProgress((p) => {
      if (!p.missions[unitId]) p.missions[unitId] = { done: [] };
      if (!p.missions[unitId].done.includes(missionKey)) {
        p.missions[unitId].done.push(missionKey);
      }
      const ev = awardXpEvent(p, `mission:${unitId}#${missionKey}`, 20);
      if (ev.awarded) xpEarnedNow += ev.xpAdded;
      if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;

      recordActiveStudyDay(p);
      newBadgesNow = evaluateBadges(p, unit);
    });

    appState.lastMissionEarnedXp = xpEarnedNow;
    appState.lastMissionNewBadges = newBadgesNow;
    appState.unitStep.phase = "debrief";
    sessionTimer?.checkBreakBoundary();
    renderApp();
    return;
  }

  if (action === "select-training-dive") {
    appState.unitStep = { type: "training", missionIndex: 0, phase: "dive" };
    renderApp();
    return;
  }

  if (action === "complete-training-dive") {
    const unitId = appState.activeUnitId;
    const unit = appState.unitsById[unitId];
    updateProgress((p) => {
      if (!p.units[unitId]) p.units[unitId] = { timeSpentSec: 0, diveDone: false, cleared: false, attempts: 0 };
      p.units[unitId].diveDone = true;
      p.units[unitId].attempts = (p.units[unitId].attempts || 0) + 1;
      const ev = awardXpEvent(p, `dive:${unitId}`, 40);
      if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;
      recordActiveStudyDay(p);
      evaluateBadges(p, unit);
    });
    appState.unitStep = { type: "unit-debrief", missionIndex: 0, phase: "debrief" };
    completeUnitDebrief(unitId);
    renderApp();
    return;
  }

  if (action === "select-unit-debrief") {
    appState.unitStep = { type: "unit-debrief", missionIndex: 0, phase: "debrief" };
    completeUnitDebrief(appState.activeUnitId);
    renderApp();
    return;
  }

  // M3: open-boss opens the start card (or resumes an active exam/marking session); begin-boss-session transitions start -> exam and starts the timer
  if (action === "open-boss") {
    const unitId = el.getAttribute("data-unit-id");
    appState.activeUnitId = unitId;
    const unit = appState.unitsById[unitId];
    appState.draftAnswers = {};
    updateProgress((p) => {
      initOrResumeMockSession(p, unit, { startImmediately: false });
    });
    appState.view = "boss";
    const updatedProg = getProgress();
    if (updatedProg.mock?.[unitId]?.phase === "exam") {
      startBossTimerLoop(unitId);
    }
    renderApp();
    return;
  }

  if (action === "begin-boss-session") {
    const unitId = el.getAttribute("data-unit-id") || appState.activeUnitId;
    appState.activeUnitId = unitId;
    const unit = appState.unitsById[unitId];
    appState.draftAnswers = {};
    updateProgress((p) => {
      beginMockExam(p, unit);
    });
    appState.view = "boss";
    startBossTimerLoop(unitId);
    renderApp();
    return;
  }

  if (action === "retake-boss") {
    const unitId = el.getAttribute("data-unit-id");
    appState.activeUnitId = unitId;
    const unit = appState.unitsById[unitId];
    appState.draftAnswers = {};
    updateProgress((p) => {
      if (p.mock?.[unitId]) {
        p.mock[unitId].phase = "done-retake-ready";
      }
      initOrResumeMockSession(p, unit, { startImmediately: false });
    });
    appState.view = "boss";
    renderApp();
    return;
  }

  if (action === "boss-jump-q") {
    const qIndex = Number(el.getAttribute("data-q-index")) || 0;
    updateProgress((p) => {
      if (p.mock?.[appState.activeUnitId]) {
        delete p.mock[appState.activeUnitId].timerChangedNotice;
        p.mock[appState.activeUnitId].currentIndex = qIndex;
      }
    });
    renderApp();
    return;
  }

  if (action === "boss-ask-submit") {
    appState.bossConfirmSubmitOpen = true;
    renderApp();
    return;
  }

  if (action === "boss-confirm-submit-cancel") {
    appState.bossConfirmSubmitOpen = false;
    renderApp();
    return;
  }

  if (action === "boss-confirm-submit-yes") {
    appState.bossConfirmSubmitOpen = false;
    if (appState.bossTickInterval) {
      clearInterval(appState.bossTickInterval);
      appState.bossTickInterval = null;
    }
    const unit = appState.unitsById[appState.activeUnitId];
    updateProgress((p) => {
      submitMockPaper(p, unit, { timeExpired: false });
      evaluateBadges(p, unit);
    });
    renderApp();
    return;
  }

  if (action === "boss-mark-nav") {
    const wIndex = Number(el.getAttribute("data-w-index")) || 0;
    updateProgress((p) => {
      if (p.mock?.[appState.activeUnitId]) {
        p.mock[appState.activeUnitId].markingWrittenIndex = wIndex;
      }
    });
    renderApp();
    return;
  }

  if (action === "boss-finish-marking") {
    const unit = appState.unitsById[appState.activeUnitId];
    updateProgress((p) => {
      finalizeMockResults(p, unit);
      evaluateBadges(p, unit);
    });
    renderApp();
    return;
  }

  if (action === "srs-flip") {
    if (appState.reviewSession) {
      appState.reviewSession.flipped = true;
      renderApp();
    }
    return;
  }

  if (action === "srs-grade") {
    const knew = el.getAttribute("data-knew") === "1";
    const rs = appState.reviewSession;
    if (!rs) return;
    const card = rs.cards[rs.cardIndex];
    const todayStr = getLocalTodayStr();

    updateProgress((p) => {
      const updated = reviewFlashcard(p.srs[card.globalCardId], knew, {
        isCram: rs.isCram,
        todayStr
      });
      if (updated) {
        p.srs[card.globalCardId] = updated;
      }
      awardXpEvent(p, `card:${card.globalCardId}:${todayStr}`, 1);
    });

    rs.cardsReviewed += 1;
    rs.cardIndex += 1;
    rs.flipped = false;

    if (rs.cardIndex >= rs.cards.length && rs.qIndex >= rs.practiceItems.length) {
      finishDailyReviewSession();
    }
    renderApp();
    return;
  }

  if (action === "srs-next-practice") {
    const rs = appState.reviewSession;
    if (!rs) return;
    rs.questionsCompleted += 1;
    rs.qIndex += 1;
    if (rs.qIndex >= rs.practiceItems.length) {
      finishDailyReviewSession();
    }
    renderApp();
    return;
  }

  if (action === "pick-theme") {
    const themeId = el.getAttribute("data-theme-id");
    updateProgress((p) => {
      p.profile.themeId = themeId;
    });
    renderApp();
    return;
  }
  if (action === "avatar-skin") {
    const skin = Number(el.getAttribute("data-skin")) || 3;
    updateProgress((p) => {
      p.profile.avatar.skin = skin;
    });
    renderApp();
    return;
  }
  if (action === "avatar-outfit") {
    const outfit = el.getAttribute("data-outfit");
    updateProgress((p) => {
      p.profile.avatar.outfit = outfit;
    });
    renderApp();
    return;
  }
  if (action === "avatar-hair") {
    const hair = el.getAttribute("data-hair");
    updateProgress((p) => {
      p.profile.avatar.hair = hair;
    });
    renderApp();
    return;
  }
  if (action === "avatar-headwear") {
    const headwear = el.getAttribute("data-headwear");
    updateProgress((p) => {
      p.profile.avatar.headwear = headwear;
    });
    renderApp();
    return;
  }

  if (action === "open-break-modal") {
    appState.breakModalOpen = true;
    appState.breakCountdownSec = null;
    renderApp();
    return;
  }
  if (action === "start-5min-break") {
    appState.breakCountdownSec = 300;
    if (appState.breakCountdownInterval) clearInterval(appState.breakCountdownInterval);
    appState.breakCountdownInterval = setInterval(() => {
      if (appState.breakCountdownSec !== null && appState.breakCountdownSec > 0) {
        appState.breakCountdownSec -= 1;
        renderApp();
      } else {
        clearInterval(appState.breakCountdownInterval);
        appState.breakCountdownSec = null;
        appState.breakModalOpen = false;
        sessionTimer?.resetBreakCounter();
        renderApp();
      }
    }, 1000);
    renderApp();
    return;
  }
  if (action === "close-break-modal") {
    if (appState.breakCountdownInterval) clearInterval(appState.breakCountdownInterval);
    appState.breakCountdownSec = null;
    appState.breakModalOpen = false;
    sessionTimer?.resetBreakCounter();
    renderApp();
    return;
  }

  if (action === "dismiss-levelup") {
    appState.levelUpBannerRank = null;
    renderApp();
    return;
  }

  if (action === "claim-reward") {
    const rewardId = el.getAttribute("data-reward-id");
    const msId = el.getAttribute("data-ms-id");
    updateProgress((p) => {
      const rObj = (p.rewards.menu || []).find((r) => r.id === rewardId);
      if (rObj) {
        p.rewards.picked.push({ id: rObj.id, label: rObj.label, at: new Date().toISOString() });
      }
      p.rewards.pendingMilestones = (p.rewards.pendingMilestones || []).filter((m) => m.id !== msId);
    });
    renderApp();
    return;
  }
  if (action === "skip-reward-milestone") {
    const msId = el.getAttribute("data-ms-id");
    updateProgress((p) => {
      p.rewards.pendingMilestones = (p.rewards.pendingMilestones || []).filter((m) => m.id !== msId);
    });
    renderApp();
    return;
  }

  if (action === "parent-pin-submit") {
    const wasLocked = !appState.parentUnlocked;
    const input = document.getElementById("parent-pin-input");
    const val = (input?.value || "").trim();
    const saved = getParentPin();
    if (!saved) {
      if (setParentPin(val)) {
        appState.parentUnlocked = true;
        appState.parentStatusMsg = "";
      } else {
        appState.parentStatusMsg = "Please enter exactly 4 digits.";
      }
    } else if (val === saved) {
      appState.parentUnlocked = true;
      appState.parentStatusMsg = "";
    } else {
      appState.parentStatusMsg = "PIN did not match.";
    }
    if (wasLocked && appState.parentUnlocked) {
      let seen = false;
      try {
        seen = localStorage.getItem(PARENT_TOUR_KEY) === "1";
      } catch (_) {
        /* ignore */
      }
      if (!seen) {
        appState.tour = { kind: "parent", step: 0 };
        appState.pendingFocusTargetId = "tour-title";
      }
    }
    renderApp();
    return;
  }

  if (action === "parent-pin-forgot-toggle") {
    appState.parentResetMode = !appState.parentResetMode;
    renderApp();
    return;
  }

  if (action === "parent-pin-reset-confirm") {
    const inp = document.getElementById("parent-reset-input");
    if ((inp?.value || "").trim() === "RESET") {
      clearParentPin();
      appState.parentResetMode = false;
      appState.parentStatusMsg = "PIN cleared. Enter a new 4-digit PIN.";
    } else {
      appState.parentStatusMsg = "Please type RESET in capital letters to clear the PIN.";
    }
    renderApp();
    return;
  }

  if (action === "parent-add-profile") {
    const inp = document.getElementById("new-profile-name");
    const name = (inp?.value || "").trim() || "New Learner";
    // v0.3.2: add the child but stay on the current child, and say clearly what happened
    const keepId = getActiveProfileId();
    addProfile(name, "explorer");
    setActiveProfileId(keepId);
    appState.parentStatusMsg = fmt(STRINGS.childAddedMsg, { name });
    renderApp();
    return;
  }

  if (action === "parent-use-profile") {
    const pid = el.getAttribute("data-profile-id");
    if (pid) {
      setActiveProfileId(pid);
      appState.draftAnswers = {};
      appState.writtenState = {};
      const switched = getProgress();
      appState.parentStatusMsg = `Now using ${switched.profile?.nickname || "this child"}'s profile.`;
    }
    renderApp();
    return;
  }

  if (action === "parent-mock-min-preset") {
    const uid = el.getAttribute("data-unit-id");
    const mins = Number(el.getAttribute("data-min")) || 35;
    updateProgress((p) => {
      if (!p.settings.mockTimerMinutes) p.settings.mockTimerMinutes = {};
      p.settings.mockTimerMinutes[uid] = mins;
    });
    renderApp();
    return;
  }

  if (action === "save-parent-score") {
    const gId = el.getAttribute("data-global-qid");
    const inp = document.getElementById(`parent-score-${gId}`);
    if (inp) {
      setParentWrittenScore(gId, Number(inp.value) || 0);
      if (appState.writtenState[gId]) {
        appState.writtenState[gId].parentScore = Number(inp.value) || 0;
        appState.writtenState[gId].toDiscuss = false;
      }
      appState.parentStatusMsg = "Saved parent score.";
      renderApp();
    }
    return;
  }

  if (action === "parent-add-reward") {
    const inp = document.getElementById("new-reward-input");
    const label = (inp?.value || "").trim();
    if (label) {
      updateProgress((p) => {
        if ((p.rewards.menu || []).length < 6) {
          p.rewards.menu.push({ id: `r-${Date.now()}`, label });
        }
      });
      renderApp();
    }
    return;
  }

  if (action === "parent-remove-reward") {
    const rid = el.getAttribute("data-reward-id");
    updateProgress((p) => {
      p.rewards.menu = (p.rewards.menu || []).filter((r) => r.id !== rid);
    });
    renderApp();
    return;
  }

  if (action === "backup-export") {
    triggerBackupDownload();
    return;
  }
}

function handleChange(action, el) {
  if (action === "switch-profile") {
    setActiveProfileId(el.value);
    appState.draftAnswers = {};
    appState.writtenState = {};
    const switchedProg = getProgress();
    if (!switchedProg.profile?.onboarded) {
      appState.view = "theme";
    }
    renderApp();
    return;
  }

  if (action === "change-mcq") {
    const gId = el.getAttribute("data-global-qid");
    const isMulti = el.getAttribute("data-multi") === "1";
    const val = Number(el.value);
    if (!isMulti) {
      appState.draftAnswers[gId] = [val];
    } else {
      const prev = Array.isArray(appState.draftAnswers[gId]) ? [...appState.draftAnswers[gId]] : [];
      if (el.checked) {
        if (!prev.includes(val)) prev.push(val);
      } else {
        const i = prev.indexOf(val);
        if (i !== -1) prev.splice(i, 1);
      }
      appState.draftAnswers[gId] = prev;
    }
    syncBossDraftIfExam(gId, appState.draftAnswers[gId]);
    renderApp();
    return;
  }

  if (action === "change-tick") {
    const gId = el.getAttribute("data-global-qid");
    const rowId = el.getAttribute("data-row-id");
    const colIdx = Number(el.value);
    const prev = typeof appState.draftAnswers[gId] === "object" && appState.draftAnswers[gId] !== null
      ? { ...appState.draftAnswers[gId] }
      : {};
    prev[rowId] = colIdx;
    appState.draftAnswers[gId] = prev;
    syncBossDraftIfExam(gId, prev);
    renderApp();
    return;
  }

  if (action === "toggle-written-mp") {
    const gId = el.getAttribute("data-global-qid");
    const mpId = el.getAttribute("data-mp-id");
    const [unitId, qId] = gId.split("#");

    if (appState.view === "boss") {
      updateProgress((p) => {
        const ev = p.mock?.[unitId]?.writtenEvaluations?.[qId];
        if (!ev) return;
        const set = new Set(ev.ticks || []);
        if (el.checked) set.add(mpId);
        else set.delete(mpId);
        ev.ticks = Array.from(set);
      });
      renderApp();
      return;
    }

    const ws = appState.writtenState[gId];
    if (!ws) return;
    const set = new Set(ws.ticks || []);
    if (el.checked) set.add(mpId);
    else set.delete(mpId);
    ws.ticks = Array.from(set);
    updateProgress((p) => {
      if (p.tries?.[gId]) {
        p.tries[gId].ticks = [...ws.ticks];
      }
    });
    renderApp();
    return;
  }

  if (action === "parent-set-weekly-target") {
    updateProgress((p) => {
      p.weekly.target = Number(el.value) || 3;
    });
    renderApp();
    return;
  }
  if (action === "parent-set-break-min") {
    updateProgress((p) => {
      p.settings.breakMin = Number(el.value);
    });
    renderApp();
    return;
  }
  if (action === "parent-set-mission-cap") {
    updateProgress((p) => {
      p.settings.missionCapMin = Number(el.value) || 8;
    });
    renderApp();
    return;
  }
  if (action === "parent-set-tts-rate") {
    updateProgress((p) => {
      p.settings.ttsRate = Number(el.value) || 0.95;
    });
    renderApp();
    return;
  }
  if (action === "parent-set-test-date") {
    updateProgress((p) => {
      p.settings.testDate = el.value || null;
      p.settings.hideTestBanner = false;
    });
    renderApp();
    return;
  }
  if (action === "parent-toggle-online-voices") {
    updateProgress((p) => {
      p.settings.onlineVoices = Boolean(el.checked);
    });
    renderApp();
    return;
  }
  if (action === "parent-toggle-calm") {
    updateProgress((p) => {
      p.settings.calmMode = Boolean(el.checked);
    });
    renderApp();
    return;
  }
  if (action === "parent-toggle-mock-timer") {
    updateProgress((p) => {
      p.settings.mockTimer = Boolean(el.checked);
    });
    renderApp();
    return;
  }
  if (action === "parent-toggle-mock-unlock") {
    const uid = el.getAttribute("data-unit-id");
    updateProgress((p) => {
      if (!p.settings.mockUnlocked) p.settings.mockUnlocked = {};
      p.settings.mockUnlocked[uid] = Boolean(el.checked);
    });
    renderApp();
    return;
  }
  if (action === "parent-set-mock-min") {
    const uid = el.getAttribute("data-unit-id");
    updateProgress((p) => {
      if (!p.settings.mockTimerMinutes) p.settings.mockTimerMinutes = {};
      p.settings.mockTimerMinutes[uid] = Number(el.value) || 35;
    });
    renderApp();
    return;
  }

  if (action === "backup-import") {
    const file = el.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = restoreFromBackupJson(String(reader.result || ""));
      appState.parentStatusMsg = res.ok
        ? `Backup restored (${res.profilesRestored} profile(s)).`
        : `Restore error: ${res.error}`;
      renderApp();
    };
    reader.readAsText(file);
  }
}

function handleInput(action, el) {
  if (action === "input-written") {
    const gId = el.getAttribute("data-global-qid");
    appState.draftAnswers[gId] = el.value;
    syncBossDraftIfExam(gId, el.value);
    return;
  }
  if (action === "input-nickname") {
    const val = el.value;
    updateProgress((p) => {
      p.profile.nickname = val;
    });
  }
}

function syncBossDraftIfExam(globalQid, rawAnswer) {
  if (appState.view !== "boss") return;
  const [unitId, qId] = globalQid.split("#");
  updateProgress((p) => {
    saveMockExamAnswer(p, unitId, qId, rawAnswer);
  });
}

function extractCleanPayload(question, draftVal, tryRec) {
  if (question.type === "fill") {
    if (draftVal && draftVal.slots) return draftVal.slots;
    return draftVal || tryRec?.try2 || tryRec?.try1 || {};
  }
  if (question.type === "match") {
    if (draftVal && draftVal.pairs) return draftVal.pairs;
    return draftVal || tryRec?.try2 || tryRec?.try1 || {};
  }
  return draftVal ?? tryRec?.try2 ?? tryRec?.try1 ?? (question.type === "mcq" ? [] : {});
}

// H2: After "Check answer", move focus to that challenge's feedback line (#fb-{unitId}-{questionId})
function handleAutoQuestionSubmit(rawGlobalQid) {
  const isReview = rawGlobalQid.startsWith("review:");
  const cleanGid = rawGlobalQid.replace(/^review:/, "");
  const [unitId, qId] = cleanGid.split("#");
  const unit = appState.unitsById[unitId];
  const question = [...(unit?.check || []), ...(unit?.practice || [])].find((q) => q.id === qId);
  if (!question) return;

  const prog = getProgress();
  const currentTry = isReview
    ? appState.reviewSession?.tryRecords?.[rawGlobalQid]
    : prog.tries?.[cleanGid];

  const payload = extractCleanPayload(question, appState.draftAnswers[rawGlobalQid], currentTry);
  const { nextRecord, evaluation, transition } = stepTryStateMachine(currentTry, question, payload);
  appState.feedbackSeed += 1;
  appState.pendingFocusTargetId = `fb-${unitId}-${qId}`;

  if (isReview) {
    appState.reviewSession.tryRecords[rawGlobalQid] = nextRecord;
    if (evaluation.isFullMarks) {
      const todayStr = getLocalTodayStr();
      updateProgress((p) => {
        awardXpEvent(p, `practice:${cleanGid}:${todayStr}`, 2);
      });
    }
    announceLive(evaluation.isFullMarks ? "Correct!" : fmt(STRINGS.try1ScoreItems, { right: evaluation.correctCount, total: evaluation.totalItems }));
    renderApp();
    return;
  }

  if (transition === "try1_correct" || transition === "try1_not_yet") {
    recordQuestionAttempt(unitId, question, {
      score: nextRecord.try1Score,
      answer: payload,
      version: unit.meta?.version
    });
  }

  updateProgress((p) => {
    p.tries[cleanGid] = nextRecord;
    if (transition === "try1_correct") {
      const ev = awardXpEvent(p, `ch1:${cleanGid}`, 10);
      if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;
    } else if (transition === "try2_correct") {
      const ev = awardXpEvent(p, `ch2:${cleanGid}`, 6);
      if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;
    }
    evaluateBadges(p, unit);
  });

  const liveMsg =
    transition === "try1_correct"
      ? "Correct on first try!"
      : transition === "try2_correct"
      ? STRINGS.try2FullLine
      : transition === "try2_revealed"
      ? STRINGS.try2RevealLine
      : fmt(STRINGS.try1ScoreItems, { right: evaluation.correctCount, total: evaluation.totalItems });
  announceLive(liveMsg);
  renderApp();
}

function completeUnitDebrief(unitId) {
  const unit = appState.unitsById[unitId];
  if (!unit) return;
  updateProgress((p) => {
    enrollUnitFlashcards(p, unit);
    if (!p.units[unitId]) p.units[unitId] = { timeSpentSec: 0, diveDone: true, cleared: true, attempts: 1 };
    const wasCleared = Boolean(p.units[unitId].cleared);
    p.units[unitId].cleared = true;
    p.units[unitId].mode = unit.meta?.mode || "lesson";
    const ev = awardXpEvent(p, `zone:${unitId}`, 50);
    if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;
    if (!wasCleared) {
      queueRewardMilestone(p, `Zone cleared: ${unit.meta?.title || unitId}`);
    }
    recordActiveStudyDay(p);
    evaluateBadges(p, unit);
  });
}

function finishDailyReviewSession() {
  const rs = appState.reviewSession;
  if (!rs) return;
  rs.completed = true;
  if (!rs.isCram) {
    const todayStr = getLocalTodayStr();
    updateProgress((p) => {
      if (!p.dailyReviewLog) p.dailyReviewLog = {};
      p.dailyReviewLog[todayStr] = true;
      const ev = awardXpEvent(p, `review:${todayStr}`, 10);
      if (ev.leveledUp) appState.levelUpBannerRank = ev.newRank;
      recordActiveStudyDay(p, todayStr);
      evaluateBadges(p);
    });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    bootApp();
  });
}
