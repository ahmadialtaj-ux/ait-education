// js/tts.js — Read-aloud (ENGAGEMENT_SPEC §7) — v0.3.2
// - Reads the text that is actually on screen, one sentence per utterance.
// - Moving highlight: the current sentence (and the current word, when the voice reports word boundaries)
//   is painted with the CSS Custom Highlight API, so the page HTML is never changed. Falls back to the
//   old whole-block highlight when that API or the DOM text is not available.
// - Pause / Resume continue from the sentence where reading stopped.
// - While reading or paused, clicking any sentence in the block jumps there.
// - A floating bar gives Pause/Resume, Stop and Slow / Normal / Fast.
// - Local voices by default; when the parent allows online voices, natural-sounding voices are preferred.

import { STRINGS } from "./strings.js";

const RATE_STEPS = { slow: 0.8, normal: 0.95, fast: 1.1 };
const SKIP_SELECTOR =
  "button, select, input, textarea, script, style, [aria-hidden='true'], [data-no-read], .sr-only, .btn-tts";
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, td, th, label, figcaption, summary, dd, dt, blockquote, div";

let voicesReady = false;
let onRateChangeCb = null;

const state = {
  status: "idle", // "idle" | "playing" | "paused"
  elId: null,
  el: null,
  text: "",
  segs: [],
  sentences: [], // { start, end } offsets into state.text (DOM mode) or { say } (plain mode)
  domMode: false,
  idx: 0,
  rate: 0.95,
  voice: null,
  token: 0
};

// ---------- helpers kept from v0.3 (also used by tests) ----------
export function stripMarkdownForSpeech(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\*\*/g, "")
    .replace(/___+/g, " blank ")
    .replace(/\[(\d+)\s*marks?\]/gi, "$1 marks")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoSpeechSentences(text) {
  const cleaned = stripMarkdownForSpeech(text);
  if (!cleaned) return [];
  const matches = cleaned.match(/[^.!?;]+[.!?;]?/g) || [cleaned];
  return matches.map((s) => s.trim()).filter(Boolean);
}

// ---------- voices ----------
const NICE_VOICE_HINTS = [/libby/i, /sonia/i, /jenny/i, /aria/i, /natural/i, /google uk english/i, /online/i];

export function selectBestVoice(allowOnlineVoices = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  const isEnglish = (v) => /^en(-|_|$)/i.test(v.lang || "");
  const isGb = (v) => /^en[-_]gb/i.test(v.lang || "");

  if (allowOnlineVoices) {
    // Parent allowed online voices: prefer the natural-sounding ones (Edge "Natural", Google voices)
    for (const hint of NICE_VOICE_HINTS) {
      const gb = voices.find((v) => isGb(v) && hint.test(v.name || ""));
      if (gb) return gb;
      const en = voices.find((v) => isEnglish(v) && hint.test(v.name || ""));
      if (en) return en;
    }
  }

  const localGb = voices.find((v) => isGb(v) && v.localService === true);
  if (localGb) return localGb;
  const localEn = voices.find((v) => isEnglish(v) && v.localService === true);
  if (localEn) return localEn;

  if (allowOnlineVoices) {
    const remoteGb = voices.find((v) => isGb(v));
    if (remoteGb) return remoteGb;
    const remoteEn = voices.find((v) => isEnglish(v));
    if (remoteEn) return remoteEn;
  }
  return null;
}

export function initTts(onVoiceAvailabilityChange, { onRateChange = null } = {}) {
  onRateChangeCb = onRateChange;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const updateVoices = () => {
    voicesReady = true;
    if (typeof onVoiceAvailabilityChange === "function") onVoiceAvailabilityChange();
  };
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
  }
  document.addEventListener("click", onDocumentClickForJump, true);
}

export function isTtsAvailable(allowOnlineVoices = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  return Boolean(selectBestVoice(allowOnlineVoices));
}

// ---------- reading the on-screen text ----------
function collectReadable(el) {
  const segs = [];
  let text = "";
  let lastBlock = null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      const det = p.closest("details");
      if (det && !det.open && !p.closest("summary")) return NodeFilter.FILTER_REJECT;
      if (p.getClientRects().length === 0) return NodeFilter.FILTER_REJECT; // hidden
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let n;
  while ((n = walker.nextNode())) {
    const blk = n.parentElement.closest(BLOCK_SELECTOR);
    if (lastBlock && blk !== lastBlock) text += "\n";
    lastBlock = blk;
    segs.push({ node: n, start: text.length, end: text.length + n.nodeValue.length });
    text += n.nodeValue;
  }
  return { text, segs };
}

function splitDomSentences(text) {
  const out = [];
  let s = 0;
  const push = (a, b) => {
    while (a < b && /\s/.test(text[a])) a += 1;
    while (b > a && /\s/.test(text[b - 1])) b -= 1;
    if (b > a && /[\p{L}\p{N}]/u.test(text.slice(a, b))) out.push({ start: a, end: b });
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      push(s, i);
      s = i + 1;
    } else if (/[.!?]/.test(ch) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      push(s, i + 1);
      s = i + 1;
    }
  }
  push(s, text.length);
  return out;
}

function pointAt(off, preferEnd = false) {
  for (const sg of state.segs) {
    if (preferEnd ? off > sg.start && off <= sg.end : off >= sg.start && off < sg.end) {
      return { node: sg.node, offset: off - sg.start };
    }
  }
  return null;
}

function makeRange(a, b) {
  const p1 = pointAt(a, false);
  const p2 = pointAt(b, true);
  if (!p1 || !p2) return null;
  try {
    const r = document.createRange();
    r.setStart(p1.node, p1.offset);
    r.setEnd(p2.node, p2.offset);
    return r;
  } catch (_) {
    return null;
  }
}

function highlightApiOk() {
  return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
}

function paintSentence() {
  clearPaint(false);
  if (!state.el) return;
  if (state.domMode && highlightApiOk()) {
    const sen = state.sentences[state.idx];
    const r = sen ? makeRange(sen.start, sen.end) : null;
    if (r) {
      CSS.highlights.set("tts-sentence", new Highlight(r));
      const rect = r.getBoundingClientRect();
      // v0.3.3: never jump away from a picture (its caption sits under it), and when the sentence is
      // off-screen move only as far as needed, so the child keeps their place instead of being thrown down the page
      const isPicture = state.el && state.el.matches && state.el.matches("figure, .block-image");
      if (rect && !isPicture) {
        if (rect.bottom > window.innerHeight - 40) {
          window.scrollBy({ top: rect.bottom - window.innerHeight + 80, behavior: "smooth" });
        } else if (rect.top < 70) {
          window.scrollBy({ top: rect.top - 90, behavior: "smooth" });
        }
      }
      return;
    }
  }
  state.el.classList.add("tts-reading-active");
}

function paintWord(sentenceStart, charIndex, charLength) {
  if (!state.domMode || !highlightApiOk()) return;
  const a = sentenceStart + charIndex;
  let len = charLength;
  if (!len) {
    const m = state.text.slice(a).match(/^\S+/);
    len = m ? m[0].length : 0;
  }
  if (len <= 0) return;
  const r = makeRange(a, a + len);
  if (r) CSS.highlights.set("tts-word", new Highlight(r));
}

function clearPaint(includeBlockClass = true) {
  if (highlightApiOk()) {
    CSS.highlights.delete("tts-sentence");
    CSS.highlights.delete("tts-word");
  }
  if (includeBlockClass && state.el) state.el.classList.remove("tts-reading-active");
  document.querySelectorAll(".tts-reading-active").forEach((x) => x.classList.remove("tts-reading-active"));
}

// ---------- speaking ----------
// v0.3.3: voices read emoji aloud ("electric light bulb", "cat face"). Blank them out with spaces of the
// same length (so word-highlight positions still line up) and turn arrows into a pause.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u20E3\u200D]/gu;
function speakable(text) {
  return String(text || "")
    .replace(EMOJI_RE, (m) => " ".repeat(m.length))
    .replace(/[\u2190-\u21FF]/g, ",")
    // v0.3.3: "100 000" (book-style space between thousands) is read as "100, zero zero zero" -> make it "100,000"
    .replace(/(\d) (?=\d{3}(?!\d))/g, "$1,")
    // v0.3.3: "100,000-tonne" -> "100,000 ton": voices skip the hyphenated word and garble the British "tonne"
    .replace(/(\d)-(?=[A-Za-z])/g, "$1 ")
    .replace(/\btonnes\b/gi, "tons  ")
    .replace(/\btonne\b/gi, "ton  ");
}
function speakCurrent() {
  const myToken = state.token;
  if (state.idx >= state.sentences.length) {
    finish();
    return;
  }
  const sen = state.sentences[state.idx];
  const say = speakable(state.domMode ? state.text.slice(sen.start, sen.end).replace(/\n/g, " ") : sen.say);
  paintSentence();
  updateBar();
  if (!/[\p{L}\p{N}]/u.test(say)) {
    // v0.3.3: nothing readable left (e.g. a sentence that was only emoji) -> skip it
    state.idx += 1;
    speakCurrent();
    return;
  }

  const u = new SpeechSynthesisUtterance(say);
  u.voice = state.voice;
  u.lang = state.voice?.lang || "en-GB";
  u.rate = Math.max(0.7, Math.min(1.3, Number(state.rate) || 0.95));
  u.onboundary = (e) => {
    if (myToken !== state.token || e.name !== "word" || !state.domMode) return;
    paintWord(sen.start, e.charIndex, e.charLength);
  };
  u.onend = () => {
    if (myToken !== state.token) return;
    state.idx += 1;
    speakCurrent();
  };
  u.onerror = (e) => {
    if (myToken !== state.token) return;
    if (e && (e.error === "interrupted" || e.error === "canceled")) return;
    stopSpeech();
  };
  try {
    window.speechSynthesis.speak(u);
  } catch (_) {
    stopSpeech();
  }
}

function cancelSynth() {
  state.token += 1;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {
    /* ignore */
  }
}

function finish() {
  state.status = "idle";
  clearPaint(true);
  updateBar();
  syncButtons();
}

export function stopSpeech() {
  cancelSynth();
  state.status = "idle";
  clearPaint(true);
  state.el = null;
  state.elId = null;
  updateBar();
  syncButtons();
}

function startReading(el, text, { rate, allowOnlineVoices, fromIdx = 0 }) {
  cancelSynth();
  clearPaint(true);
  const voice = selectBestVoice(allowOnlineVoices);
  if (!voice) return false;
  state.voice = voice;
  state.rate = Number(rate) || 0.95;
  state.el = el;
  state.elId = el?.id || null;

  state.domMode = false;
  if (el) {
    const { text: domText, segs } = collectReadable(el);
    const sens = splitDomSentences(domText);
    if (sens.length > 0) {
      state.text = domText;
      state.segs = segs;
      state.sentences = sens;
      state.domMode = true;
    }
  }
  if (!state.domMode) {
    state.text = "";
    state.segs = [];
    state.sentences = splitIntoSpeechSentences(text).map((say) => ({ say }));
  }
  if (state.sentences.length === 0) return false;

  state.idx = Math.max(0, Math.min(fromIdx, state.sentences.length - 1));
  state.status = "playing";
  syncButtons();
  speakCurrent();
  return true;
}

// Legacy entry point (kept for compatibility)
export function speakBlockText(text, highlightEl = null, { rate = 0.95, allowOnlineVoices = false } = {}) {
  return startReading(highlightEl, text, { rate, allowOnlineVoices });
}

// Read button behaviour: start → pause → resume
export function toggleRead(el, text, opts) {
  const sameBlock = el && state.elId && el.id === state.elId;
  if (sameBlock && state.status === "playing") return pauseReading();
  if (sameBlock && state.status === "paused") return resumeReading();
  return startReading(el, text, opts);
}

export function pauseReading() {
  if (state.status !== "playing") return false;
  cancelSynth();
  state.status = "paused";
  if (highlightApiOk()) CSS.highlights.delete("tts-word");
  updateBar();
  syncButtons();
  return true;
}

export function resumeReading() {
  if (state.status !== "paused") return false;
  cancelSynth();
  state.status = "playing";
  syncButtons();
  speakCurrent();
  return true;
}

export function setReadingRate(rate) {
  state.rate = Number(rate) || 0.95;
  if (typeof onRateChangeCb === "function") onRateChangeCb(state.rate);
  if (state.status === "playing") {
    cancelSynth();
    speakCurrent(); // restart the current sentence at the new speed
  } else {
    updateBar();
  }
}

export function jumpToSentence(i) {
  if (state.status === "idle" || i < 0 || i >= state.sentences.length) return;
  cancelSynth();
  state.idx = i;
  state.status = "playing";
  syncButtons();
  speakCurrent();
}

export function isCurrentlySpeaking() {
  return state.status === "playing";
}

export function getReadingStatus() {
  return { status: state.status, elId: state.elId, idx: state.idx, total: state.sentences.length, voice: state.voice?.name || null };
}

// Called after the app re-renders its HTML: re-attach to the new copy of the block, keep the position.
export function ttsAfterRender() {
  if (state.status === "idle" || !state.elId) {
    syncButtons();
    return;
  }
  const el = document.getElementById(state.elId);
  if (!el) {
    stopSpeech();
    return;
  }
  state.el = el;
  if (state.domMode) {
    const { text, segs } = collectReadable(el);
    if (text === state.text) {
      state.segs = segs; // same words, new nodes
    } else {
      const sens = splitDomSentences(text);
      state.text = text;
      state.segs = segs;
      state.sentences = sens;
      state.idx = Math.min(state.idx, Math.max(0, sens.length - 1));
    }
  }
  paintSentence();
  syncButtons();
  updateBar();
}

// ---------- click a sentence to read from there ----------
function caretOffsetFromPoint(x, y) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node) return null;
  const sg = state.segs.find((g) => g.node === node);
  return sg ? sg.start + offset : null;
}

function onDocumentClickForJump(e) {
  if (state.status === "idle" || !state.domMode || !state.el) return;
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("#tts-bar")) return;
  if (!state.el.contains(t)) return;
  if (t.closest("button, input, select, textarea, a, label, summary")) return;
  const off = caretOffsetFromPoint(e.clientX, e.clientY);
  if (off === null) return;
  const i = state.sentences.findIndex((s) => off >= s.start && off <= s.end);
  if (i >= 0) jumpToSentence(i);
}

// ---------- floating reading bar ----------
function currentSpeedKey() {
  const r = Number(state.rate);
  if (r <= 0.85) return "slow";
  if (r >= 1.05) return "fast";
  return "normal";
}

function ensureBar() {
  let bar = document.getElementById("tts-bar");
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "tts-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Read-aloud controls");
  bar.hidden = true;
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tts]");
    if (!b) return;
    const cmd = b.getAttribute("data-tts");
    if (cmd === "toggle") {
      if (state.status === "playing") pauseReading();
      else if (state.status === "paused") resumeReading();
    } else if (cmd === "stop") {
      stopSpeech();
    } else if (cmd.startsWith("speed-")) {
      setReadingRate(RATE_STEPS[cmd.slice(6)] || 0.95);
    }
  });
  document.body.appendChild(bar);
  return bar;
}

function updateBar() {
  if (typeof document === "undefined") return;
  const bar = ensureBar();
  if (state.status === "idle") {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  const sp = currentSpeedKey();
  const speedBtn = (key, label) =>
    `<button type="button" class="tts-speed ${sp === key ? "on" : ""}" aria-pressed="${sp === key}" data-tts="speed-${key}">${label}</button>`;
  bar.hidden = false;
  bar.innerHTML = `
    <button type="button" class="tts-main" data-tts="toggle">${state.status === "playing" ? STRINGS.ttsBarPause : STRINGS.ttsBarResume}</button>
    <button type="button" class="tts-stop" data-tts="stop">${STRINGS.ttsBarStop}</button>
    <span class="tts-speeds" role="group" aria-label="Reading speed">
      ${speedBtn("slow", STRINGS.ttsSpeedSlow)}${speedBtn("normal", STRINGS.ttsSpeedNormal)}${speedBtn("fast", STRINGS.ttsSpeedFast)}
    </span>
    ${state.domMode ? `<span class="tts-tip">${STRINGS.ttsBarTip}</span>` : ""}`;
}

// Show the state on the block's own button too (Pause / Resume)
function syncButtons() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("button[data-action='tts-speak']").forEach((b) => {
    const isMine = state.elId && b.getAttribute("data-target-id") === state.elId && state.status !== "idle";
    const label = !isMine ? STRINGS.readAloudBtn : state.status === "playing" ? STRINGS.ttsBarPause : STRINGS.ttsBarResume;
    if (b.textContent !== label) b.textContent = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", isMine && state.status === "playing" ? "true" : "false");
    b.classList.toggle("tts-active", Boolean(isMine));
  });
}
