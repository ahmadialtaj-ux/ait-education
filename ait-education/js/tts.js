// js/tts.js — Browser speechSynthesis read-aloud with local voice preference, sentence queueing & whole-block highlight (ENGAGEMENT_SPEC §7)

let chosenVoice = null;
let voicesReady = false;
let activeElement = null;
let speakingState = false;
let cancelToken = 0;

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

export function selectBestVoice(allowOnlineVoices = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  const isEnglish = (v) => /^en(-|_|$)/i.test(v.lang || "");
  const isGb = (v) => /^en[-_]gb/i.test(v.lang || "");

  // 1. Prefer en-GB + localService === true
  const localGb = voices.find((v) => isGb(v) && v.localService === true);
  if (localGb) return localGb;

  // 2. Any local English voice
  const localEn = voices.find((v) => isEnglish(v) && v.localService === true);
  if (localEn) return localEn;

  // 3. Only if parent turns on "Allow online voices", allow remote English voices
  if (allowOnlineVoices) {
    const remoteGb = voices.find((v) => isGb(v));
    if (remoteGb) return remoteGb;
    const remoteEn = voices.find((v) => isEnglish(v));
    if (remoteEn) return remoteEn;
  }

  return null;
}

export function initTts(onVoiceAvailabilityChange) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  const updateVoices = () => {
    voicesReady = true;
    if (typeof onVoiceAvailabilityChange === "function") {
      onVoiceAvailabilityChange();
    }
  };
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
  }
}

export function isTtsAvailable(allowOnlineVoices = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }
  const voice = selectBestVoice(allowOnlineVoices);
  return Boolean(voice);
}

export function stopSpeech() {
  cancelToken += 1;
  speakingState = false;
  if (activeElement) {
    activeElement.classList.remove("tts-reading-active");
    activeElement = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {
      // Ignore browser speechSynthesis errors
    }
  }
}

export function speakBlockText(text, highlightEl = null, { rate = 0.95, allowOnlineVoices = false, onEnd = null } = {}) {
  stopSpeech();
  const voice = selectBestVoice(allowOnlineVoices);
  if (!voice) return false;

  const sentences = splitIntoSpeechSentences(text);
  if (sentences.length === 0) return false;

  const myToken = cancelToken;
  speakingState = true;
  chosenVoice = voice;

  if (highlightEl) {
    activeElement = highlightEl;
    activeElement.classList.add("tts-reading-active");
  }

  const clampedRate = Math.max(0.8, Math.min(1.2, Number(rate) || 0.95));
  let idx = 0;

  function speakNext() {
    if (myToken !== cancelToken) return;
    if (idx >= sentences.length) {
      speakingState = false;
      if (activeElement) {
        activeElement.classList.remove("tts-reading-active");
        activeElement = null;
      }
      if (typeof onEnd === "function") onEnd();
      return;
    }

    const u = new SpeechSynthesisUtterance(sentences[idx]);
    u.voice = chosenVoice;
    u.rate = clampedRate;
    u.lang = chosenVoice.lang || "en-GB";

    u.onend = () => {
      idx += 1;
      speakNext();
    };
    u.onerror = () => {
      stopSpeech();
      if (typeof onEnd === "function") onEnd();
    };

    try {
      window.speechSynthesis.speak(u);
    } catch (_) {
      stopSpeech();
    }
  }

  speakNext();
  return true;
}

export function isCurrentlySpeaking() {
  return speakingState;
}
