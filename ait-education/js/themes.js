// js/themes.js — Theme loader, Explorer fallback, token filler, and layered SVG avatar builder (ENGAGEMENT_SPEC §8, §9.2)

import { validateThemes } from "./validate.js";

const DEFAULT_EXPLORER_THEME = {
  id: "explorer",
  label: "Explorer",
  pickerLine: "Not sure yet? Explore everything.",
  addressAs: "{name}",
  whyTitle: "Where will you see this?",
  ranks: ["Scout", "Pathfinder", "Navigator", "Trailblazer", "Expedition Leader", "Legend Explorer"],
  breakName: "Camp break",
  correct: ["Correct!", "That's right.", "Yes, that's it."],
  notYet: ["Not yet. Check the clue.", "Close. Have another look.", "Not quite. Here's a clue."],
  debrief: ["Zone cleared, {name}. Here's how it went.", "Good expedition, {name}. Let's look at what you found."],
  chapters: {}
};

let loadedThemesData = {
  schemaVersion: "0.3.1",
  xpLevels: [0, 100, 250, 500, 900, 1400],
  themes: [DEFAULT_EXPLORER_THEME],
  validationError: null
};

export function initThemes(rawThemesJson) {
  const check = validateThemes(rawThemesJson);
  if (!check.valid) {
    loadedThemesData = {
      schemaVersion: "0.3.1",
      xpLevels: [0, 100, 250, 500, 900, 1400],
      themes: [DEFAULT_EXPLORER_THEME],
      validationError: check.errors.join("; ")
    };
    return loadedThemesData;
  }
  loadedThemesData = {
    ...rawThemesJson,
    validationError: null
  };
  return loadedThemesData;
}

export function getThemesValidationError() {
  return loadedThemesData.validationError;
}

export function getXpLevels() {
  return loadedThemesData.xpLevels || [0, 100, 250, 500, 900, 1400];
}

// Sorted alphabetically by label, Explorer last (§8.1)
export function getSortedThemes() {
  const list = [...(loadedThemesData.themes || [DEFAULT_EXPLORER_THEME])];
  return list.sort((a, b) => {
    if (a.id === "explorer") return 1;
    if (b.id === "explorer") return -1;
    return String(a.label).localeCompare(String(b.label));
  });
}

export function getThemeById(themeId) {
  const list = loadedThemesData.themes || [];
  return (
    list.find((t) => t.id === themeId) ||
    list.find((t) => t.id === "explorer") ||
    DEFAULT_EXPLORER_THEME
  );
}

export function getExplorerTheme() {
  const list = loadedThemesData.themes || [];
  return list.find((t) => t.id === "explorer") || DEFAULT_EXPLORER_THEME;
}

export function computeUnitTotalMarks(unit) {
  if (!unit) return 0;
  const checkMarks = (unit.check || []).reduce((acc, q) => acc + (q.marks || 0), 0);
  const practiceMarks = (unit.practice || []).reduce((acc, q) => acc + (q.marks || 0), 0);
  return unit.meta?.mode === "mock" ? practiceMarks : checkMarks + practiceMarks;
}

export function fillThemeTokens(str, { nickname = "Explorer", unit = null } = {}) {
  if (!str || typeof str !== "string") return "";
  const cleanName = (nickname || "Explorer").trim() || "Explorer";
  const marks = unit ? computeUnitTotalMarks(unit) : "";
  const minutes = unit?.meta?.estMinutes ?? "";
  return str
    .replace(/\{name\}/g, cleanName)
    .replace(/\{marks\}/g, String(marks))
    .replace(/\{minutes\}/g, String(minutes));
}

// Fallback chain: chosen theme -> explorer -> plain unit/chapter fallback (§8.2)
export function getChapterThemeText(themeId, chapterKey, chapterTitle, nickname = "Explorer") {
  const theme = getThemeById(themeId);
  const explorer = getExplorerTheme();
  const chTheme = theme?.chapters?.[chapterKey];
  const chExplorer = explorer?.chapters?.[chapterKey];

  const rawWorld = chTheme?.worldName || chExplorer?.worldName || chapterTitle || chapterKey;
  const rawStory = chTheme?.story || chExplorer?.story || "";

  return {
    worldName: fillThemeTokens(rawWorld, { nickname }),
    story: fillThemeTokens(rawStory, { nickname })
  };
}

export function getUnitThemeText(themeId, chapterKey, unit, nickname = "Explorer") {
  const theme = getThemeById(themeId);
  const explorer = getExplorerTheme();
  const unitId = unit?.id || "";
  const uTheme = theme?.chapters?.[chapterKey]?.units?.[unitId];
  const uExplorer = explorer?.chapters?.[chapterKey]?.units?.[unitId];

  const rawZone = uTheme?.zone || uExplorer?.zone || unit?.meta?.title || unitId;
  const rawIntro = uTheme?.intro || uExplorer?.intro || "";
  const rawWhy = uTheme?.why !== undefined ? uTheme.why : uExplorer?.why || null;
  const rawWhyTitle = theme?.whyTitle || explorer?.whyTitle || "Where will you see this?";

  return {
    zone: fillThemeTokens(rawZone, { nickname, unit }),
    intro: fillThemeTokens(rawIntro, { nickname, unit }),
    why: rawWhy ? fillThemeTokens(rawWhy, { nickname, unit }) : null,
    whyTitle: fillThemeTokens(rawWhyTitle, { nickname, unit })
  };
}

export function pickThemeLine(themeId, category, nickname = "Explorer", seedIndex = 0) {
  const theme = getThemeById(themeId);
  const explorer = getExplorerTheme();
  const arr = Array.isArray(theme?.[category]) && theme[category].length > 0
    ? theme[category]
    : explorer?.[category] || [""];
  const chosen = arr[Math.abs(seedIndex) % arr.length] || arr[0] || "";
  return fillThemeTokens(chosen, { nickname });
}

export const SKIN_TONES = [
  { id: 1, hex: "#F7DFC6", label: "Tone 1" },
  { id: 2, hex: "#E8C39E", label: "Tone 2" },
  { id: 3, hex: "#D4A373", label: "Tone 3" },
  { id: 4, hex: "#B57C4E", label: "Tone 4" },
  { id: 5, hex: "#8D5524", label: "Tone 5" },
  { id: 6, hex: "#5C3818", label: "Tone 6" }
];

export const HAIR_STYLES = [
  { id: "h1", label: "Short crop" },
  { id: "h2", label: "Wavy medium" },
  { id: "h3", label: "Curly crown" },
  { id: "h4", label: "Side part" },
  { id: "h5", label: "Long tied" },
  { id: "h6", label: "Buzz cut" }
];

export const HEADWEAR_OPTIONS = [
  { id: "none", label: "None" },
  { id: "hijab", label: "Hijab" },
  { id: "headscarf", label: "Headscarf / wrap" },
  { id: "ghutra", label: "Ghutra / shemagh" },
  { id: "kufi", label: "Kufi / cap" },
  { id: "helmet", label: "Theme helmet / gear" }
];

export const OUTFIT_OPTIONS = [
  { id: "o1", label: "Full-coverage theme suit" },
  { id: "o2", label: "Theme activewear (modest)" }
];

const THEME_OUTFIT_COLORS = {
  explorer: { primary: "#0f766e", secondary: "#d97706" },
  doctor: { primary: "#0284c7", secondary: "#e0f2fe" },
  engineer: { primary: "#d97706", secondary: "#1e293b" },
  astronaut: { primary: "#4f46e5", secondary: "#e2e8f0" },
  "ocean-explorer": { primary: "#0369a1", secondary: "#22d3ee" },
  footballer: { primary: "#15803d", secondary: "#facc15" }
};

// Layered SVG silhouette builder per ENGAGEMENT_SPEC §8.4 (body/clothing + skin tone CSS var + hair + headwear)
export function renderAvatarSvg(avatarConfig = {}, themeId = "explorer", size = 84) {
  const skinObj = SKIN_TONES.find((s) => s.id === Number(avatarConfig?.skin)) || SKIN_TONES[2];
  const outfit = avatarConfig?.outfit || "o1";
  const hair = avatarConfig?.hair || "h2";
  const headwear = avatarConfig?.headwear || "none";
  const colors = THEME_OUTFIT_COLORS[themeId] || THEME_OUTFIT_COLORS.explorer;

  const collarPath = outfit === "o2"
    ? `<path d="M22,68 C22,54 34,50 50,50 C66,50 78,54 78,68 L82,96 L18,96 Z" fill="${colors.primary}" />
       <path d="M36,50 L50,64 L64,50" fill="none" stroke="${colors.secondary}" stroke-width="4" />`
    : `<path d="M18,70 C18,53 32,48 50,48 C68,48 82,53 82,70 L84,96 L16,96 Z" fill="${colors.primary}" />
       <rect x="44" y="48" width="12" height="48" fill="${colors.secondary}" opacity="0.85" />`;

  const hairMap = {
    h1: `<path d="M32,26 C32,14 68,14 68,26 C64,20 36,20 32,26 Z" fill="#27272a" />`,
    h2: `<path d="M29,30 C28,13 72,13 71,30 C67,21 33,21 29,30 Z" fill="#3f2e21" />`,
    h3: `<circle cx="35" cy="20" r="7" fill="#1f2937"/><circle cx="50" cy="17" r="8" fill="#1f2937"/><circle cx="65" cy="20" r="7" fill="#1f2937"/>`,
    h4: `<path d="M30,28 C30,14 70,14 70,28 C58,18 35,22 30,28 Z" fill="#451a03" />`,
    h5: `<path d="M29,30 C29,14 71,14 71,30 L74,44 L66,44 L66,26 L34,26 L34,44 L26,44 Z" fill="#1e1b4b" />`,
    h6: `<path d="M34,24 C36,16 64,16 66,24 Z" fill="#334155" />`
  };

  const headwearMap = {
    none: "",
    hijab: `<path d="M24,32 C24,11 76,11 76,32 C76,48 70,58 50,58 C30,58 24,48 24,32 Z" fill="${colors.primary}" />
            <ellipse cx="50" cy="34" rx="16" ry="17" fill="var(--avatar-skin, ${skinObj.hex})" />`,
    headscarf: `<path d="M27,28 C27,13 73,13 73,28 L76,46 L66,42 L66,27 L34,27 L34,42 L24,46 Z" fill="${colors.secondary}" stroke="${colors.primary}" stroke-width="2" />`,
    ghutra: `<path d="M25,26 C26,12 74,12 75,26 L80,62 L68,62 L66,26 L34,26 L32,62 L20,62 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" />
             <rect x="33" y="16" width="34" height="5" rx="2.5" fill="#0f172a" />`,
    kufi: `<path d="M31,24 C32,13 68,13 69,24 Z" fill="#f1f5f9" stroke="${colors.primary}" stroke-width="2" />`,
    helmet: `<path d="M24,33 C24,11 76,11 76,33 L73,42 L27,42 Z" fill="${colors.secondary}" stroke="${colors.primary}" stroke-width="2.5" />
             <rect x="33" y="25" width="34" height="10" rx="4" fill="#38bdf8" opacity="0.65" />`
  };

  const showHair = headwear === "none";
  const showBaseHead = headwear !== "hijab";

  return `<svg class="avatar-svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Learner avatar silhouette" style="--avatar-skin: ${skinObj.hex};">
    <circle cx="50" cy="50" r="47" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2" />
    <g class="avatar-layer-body">${collarPath}</g>
    <rect x="44" y="42" width="12" height="10" rx="3" fill="var(--avatar-skin, ${skinObj.hex})" />
    ${showBaseHead ? `<circle class="avatar-layer-head" cx="50" cy="33" r="17" fill="var(--avatar-skin, ${skinObj.hex})" />` : ""}
    ${showHair ? `<g class="avatar-layer-hair">${hairMap[hair] || hairMap.h2}</g>` : ""}
    <g class="avatar-layer-headwear">${headwearMap[headwear] || ""}</g>
    <circle cx="44" cy="33" r="2" fill="#0f172a" />
    <circle cx="56" cy="33" r="2" fill="#0f172a" />
    <path d="M45,40 Q50,44 55,40" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" />
  </svg>`;
}
