// js/validate.js — Unit JSON (v0.2 & v0.3) and themes.json validator (PLAYER_SPEC v0.3 & ENGAGEMENT_SPEC §9.1)

const VALID_BLOCK_TYPES = new Set([
  "text", "keypoints", "compare", "example", "tip", "mistake", "realWorld", "image"
]);
const VALID_QUESTION_TYPES = new Set(["mcq", "tick", "fill", "match", "written"]);
const AUTO_HINT_QUESTION_TYPES = new Set(["mcq", "tick", "fill", "match"]);
const VALID_COMMANDS = new Set([
  "state", "give", "identify", "name", "describe", "explain",
  "compare", "complete", "match", "define", "outline", "discuss", "evaluate", "calculate"
]);
const LOCAL_IMAGE_REGEX = /^images\/[a-z0-9/_-]+\.(png|jpg|jpeg|webp|svg)$/i;

export function isLocalImagePath(src) {
  if (typeof src !== "string") return false;
  if (src.includes("..") || src.startsWith("/") || /^[a-z]+:/i.test(src)) return false;
  return LOCAL_IMAGE_REGEX.test(src.trim());
}

export function validateUnit(unit) {
  const errors = [];
  const warnings = [];

  if (!unit || typeof unit !== "object") {
    return { valid: false, errors: ["Unit file is not a valid JSON object."], warnings };
  }

  if (unit.schemaVersion !== "0.2" && unit.schemaVersion !== "0.3") {
    errors.push(`Unsupported schemaVersion "${unit.schemaVersion}" (expected "0.2" or "0.3").`);
  }

  if (typeof unit.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(unit.id)) {
    errors.push(`Invalid or missing unit id "${unit.id}".`);
  }

  // Validate meta
  const m = unit.meta;
  if (!m || typeof m !== "object") {
    errors.push("Missing unit meta object.");
  } else {
    const reqMeta = [
      "mode", "qualification", "qualificationCode", "subject", "subjectId",
      "syllabusYears", "syllabusPoints", "chapterNumber", "chapterTitle",
      "unit", "title", "schoolYear", "lang", "dir", "sourceRefs", "estMinutes", "version", "status"
    ];
    for (const key of reqMeta) {
      if (m[key] === undefined || m[key] === null || m[key] === "") {
        errors.push(`Missing meta.${key}.`);
      }
    }
    if (m.mode !== "lesson" && m.mode !== "mock") {
      errors.push(`Invalid meta.mode "${m.mode}" (must be "lesson" or "mock").`);
    }
    if (m.dir !== "ltr" && m.dir !== "rtl") {
      errors.push(`Invalid meta.dir "${m.dir}" (must be "ltr" or "rtl").`);
    }
    if (typeof m.estMinutes !== "number" || m.estMinutes < 1) {
      errors.push("meta.estMinutes must be a positive number.");
    }
  }

  const isLessonUnit = m?.mode === "lesson";

  // Validate topics
  const topics = unit.topics;
  if (!topics || typeof topics !== "object" || Object.keys(topics).length === 0) {
    errors.push("Unit must define a non-empty topics map.");
  }

  if (!Array.isArray(unit.objectives)) {
    errors.push("Missing objectives array.");
  }
  if (!Array.isArray(unit.learn)) {
    errors.push("Missing learn array.");
  }
  if (!Array.isArray(unit.check)) {
    errors.push("Missing check array.");
  }
  if (!Array.isArray(unit.practice) || unit.practice.length === 0) {
    errors.push("Unit practice array must have at least 1 question.");
  }

  const seenIds = new Set();
  const blockIds = new Set();

  function checkUniqueId(id, context) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9]*$/i.test(id)) {
      errors.push(`${context}: invalid local id "${id}".`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`${context}: duplicate id "${id}" in unit.`);
    }
    seenIds.add(id);
  }

  // Validate learn blocks
  if (Array.isArray(unit.learn)) {
    for (const block of unit.learn) {
      if (!block || typeof block !== "object") {
        errors.push("Invalid block in learn[].");
        continue;
      }
      checkUniqueId(block.id, `learn block`);
      blockIds.add(block.id);

      if (!VALID_BLOCK_TYPES.has(block.type)) {
        errors.push(`Block "${block.id}": unknown type "${block.type}".`);
      }
      if (block.topic !== undefined && topics && !topics[block.topic]) {
        errors.push(`Block "${block.id}": unknown topic "${block.topic}".`);
      }
      if (["text", "example", "tip", "mistake", "realWorld"].includes(block.type)) {
        if (typeof block.body !== "string" || !block.body.trim()) {
          errors.push(`Block "${block.id}" (${block.type}): missing body text.`);
        }
      } else if (block.type === "keypoints") {
        if (!Array.isArray(block.items) || block.items.length === 0) {
          errors.push(`Block "${block.id}" (keypoints): missing items[].`);
        }
      } else if (block.type === "compare") {
        if (!Array.isArray(block.columns) || block.columns.length !== 2) {
          errors.push(`Block "${block.id}" (compare): columns must have 2 items.`);
        }
        if (!Array.isArray(block.rows) || block.rows.length === 0) {
          errors.push(`Block "${block.id}" (compare): rows must be a non-empty array.`);
        }
      } else if (block.type === "image") {
        if (!isLocalImagePath(block.src)) {
          errors.push(`Block "${block.id}" (image): src "${block.src}" must be a relative local images/... path.`);
        }
        if (typeof block.alt !== "string" || !block.alt.trim()) {
          errors.push(`Block "${block.id}" (image): missing alt text.`);
        }
      }
    }
  }

  function validateQuestionList(list, listName) {
    if (!Array.isArray(list)) return;
    for (const q of list) {
      if (!q || typeof q !== "object") {
        errors.push(`Invalid question object in ${listName}.`);
        continue;
      }
      const ctx = `Question "${q.id || "?"}" (${listName})`;
      checkUniqueId(q.id, ctx);

      if (!VALID_QUESTION_TYPES.has(q.type)) {
        errors.push(`${ctx}: invalid type "${q.type}".`);
      }
      if (!VALID_COMMANDS.has(q.command)) {
        errors.push(`${ctx}: invalid command word "${q.command}".`);
      }
      if (typeof q.marks !== "number" || !Number.isInteger(q.marks) || q.marks < 1) {
        errors.push(`${ctx}: marks must be a positive integer.`);
      }
      if (typeof q.prompt !== "string" || !q.prompt.trim()) {
        errors.push(`${ctx}: missing prompt.`);
      }
      if (!topics || !topics[q.topic]) {
        errors.push(`${ctx}: topic "${q.topic}" does not exist in unit.topics.`);
      }
      if (![1, 2, 3].includes(q.difficulty)) {
        errors.push(`${ctx}: difficulty must be 1, 2, or 3.`);
      }
      if (typeof q.sourceRef !== "string" || !q.sourceRef.trim()) {
        errors.push(`${ctx}: missing sourceRef.`);
      }
      if (typeof q.explanation !== "string" || !q.explanation.trim()) {
        errors.push(`${ctx}: missing explanation.`);
      }

      if (q.afterBlock !== undefined && q.afterBlock !== null) {
        if (!blockIds.has(q.afterBlock)) {
          errors.push(`${ctx}: afterBlock "${q.afterBlock}" does not match any learn block id.`);
        }
      }

      // M4: Only warn about missing hint for mcq/tick/fill/match in lesson units (never written or mock)
      if (isLessonUnit && AUTO_HINT_QUESTION_TYPES.has(q.type)) {
        if (!q.hint || typeof q.hint !== "string" || !q.hint.trim()) {
          warnings.push(`${ctx}: optional v0.3 "hint" field is missing (will use fallback clue).`);
        } else {
          const wordCount = q.hint.trim().split(/\s+/).length;
          if (wordCount > 25) {
            warnings.push(`${ctx}: hint exceeds 25 words (${wordCount} words).`);
          }
          const hintLower = q.hint.toLowerCase();
          const answerStrings = [];
          if (q.type === "mcq" && Array.isArray(q.options) && Array.isArray(q.answers)) {
            for (const idx of q.answers) {
              if (typeof q.options[idx] === "string") answerStrings.push(q.options[idx]);
            }
          } else if (q.type === "fill" && Array.isArray(q.items)) {
            for (const it of q.items) {
              if (typeof it.answer === "string") answerStrings.push(it.answer);
            }
          }
          for (const ans of answerStrings) {
            if (ans && ans.length >= 4 && hintLower.includes(ans.toLowerCase())) {
              warnings.push(`${ctx}: hint may contain answer phrase "${ans}".`);
            }
          }
        }
      }

      if (q.type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push(`${ctx}: mcq needs at least 2 options.`);
        } else if (!Array.isArray(q.answers) || q.answers.length < 1) {
          errors.push(`${ctx}: mcq needs at least 1 answer index.`);
        } else {
          for (const ansIdx of q.answers) {
            if (!Number.isInteger(ansIdx) || ansIdx < 0 || ansIdx >= q.options.length) {
              errors.push(`${ctx}: mcq answer index ${ansIdx} out of range.`);
            }
          }
        }
      } else if (q.type === "tick") {
        if (!Array.isArray(q.columns) || q.columns.length < 2) {
          errors.push(`${ctx}: tick needs at least 2 columns.`);
        }
        if (!Array.isArray(q.rows) || q.rows.length < 1) {
          errors.push(`${ctx}: tick needs at least 1 row.`);
        } else {
          const rowIds = new Set();
          for (const r of q.rows) {
            if (!r.id || rowIds.has(r.id)) {
              errors.push(`${ctx}: duplicate or missing tick row id "${r.id}".`);
            }
            rowIds.add(r.id);
            if (
              !Number.isInteger(r.answer) ||
              r.answer < 0 ||
              (Array.isArray(q.columns) && r.answer >= q.columns.length)
            ) {
              errors.push(`${ctx}: tick row "${r.id}" answer index ${r.answer} out of range.`);
            }
          }
        }
      } else if (q.type === "fill") {
        if (!Array.isArray(q.wordList) || q.wordList.length < 2) {
          errors.push(`${ctx}: fill needs wordList with at least 2 words.`);
        }
        if (!Array.isArray(q.items) || q.items.length < 1) {
          errors.push(`${ctx}: fill needs at least 1 item.`);
        } else {
          const itemIds = new Set();
          for (const item of q.items) {
            if (!item.id || itemIds.has(item.id)) {
              errors.push(`${ctx}: duplicate or missing fill item id "${item.id}".`);
            }
            itemIds.add(item.id);
            if (typeof item.sentence !== "string" || item.sentence.split("___").length !== 2) {
              errors.push(`${ctx}: fill item "${item.id}" sentence must contain exactly one "___".`);
            }
            if (Array.isArray(q.wordList) && !q.wordList.includes(item.answer)) {
              errors.push(`${ctx}: fill item "${item.id}" answer "${item.answer}" not in wordList.`);
            }
          }
        }
      } else if (q.type === "match") {
        if (!Array.isArray(q.left) || !Array.isArray(q.right) || !Array.isArray(q.pairs)) {
          errors.push(`${ctx}: match question requires left, right, and pairs arrays.`);
        } else {
          const leftIds = new Set(q.left.map((l) => l.id));
          const rightIds = new Set(q.right.map((r) => r.id));
          for (const pair of q.pairs) {
            if (!Array.isArray(pair) || pair.length !== 2) {
              errors.push(`${ctx}: match pair must have 2 ids.`);
            } else {
              if (!leftIds.has(pair[0])) errors.push(`${ctx}: match pair left id "${pair[0]}" not found.`);
              if (!rightIds.has(pair[1])) errors.push(`${ctx}: match pair right id "${pair[1]}" not found.`);
            }
          }
        }
      } else if (q.type === "written") {
        if (!Array.isArray(q.markPoints) || q.markPoints.length < 1) {
          errors.push(`${ctx}: written question requires markPoints[].`);
        } else {
          const mpIds = new Set(q.markPoints.map((mp) => mp.id));
          const seenMp = new Set();
          for (const mp of q.markPoints) {
            if (!mp.id || seenMp.has(mp.id)) {
              errors.push(`${ctx}: duplicate or missing markPoint id "${mp.id}".`);
            }
            seenMp.add(mp.id);
            if (!Array.isArray(mp.accept) || mp.accept.length < 1) {
              errors.push(`${ctx}: markPoint "${mp.id}" requires non-empty accept[].`);
            }
            if (mp.requires !== undefined && mp.requires !== null && !mpIds.has(mp.requires)) {
              errors.push(`${ctx}: markPoint "${mp.id}" requires unknown markPoint "${mp.requires}".`);
            }
          }
        }
        if (typeof q.modelAnswer !== "string" || !q.modelAnswer.trim()) {
          errors.push(`${ctx}: written question missing modelAnswer.`);
        }
      }
    }
  }

  validateQuestionList(unit.check, "check");
  validateQuestionList(unit.practice, "practice");

  if (!unit.recap || typeof unit.recap !== "object") {
    errors.push("Missing recap object.");
  } else {
    if (!Array.isArray(unit.recap.summary)) {
      errors.push("Missing recap.summary array.");
    }
    if (!Array.isArray(unit.recap.flashcards)) {
      errors.push("Missing recap.flashcards array.");
    } else {
      for (const fc of unit.recap.flashcards) {
        checkUniqueId(fc.id, "flashcard");
        if (typeof fc.front !== "string" || typeof fc.back !== "string") {
          errors.push(`Flashcard "${fc.id}": missing front or back string.`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateThemes(themesData) {
  const errors = [];
  if (!themesData || typeof themesData !== "object") {
    return { valid: false, errors: ["themes.json is not a valid object."] };
  }
  if (!Array.isArray(themesData.xpLevels) || themesData.xpLevels.length < 2) {
    errors.push("themes.json: xpLevels must be an array of at least 2 thresholds.");
  }
  if (!Array.isArray(themesData.themes) || themesData.themes.length === 0) {
    errors.push("themes.json: themes array is missing or empty.");
  } else {
    const hasExplorer = themesData.themes.some((t) => t && t.id === "explorer");
    if (!hasExplorer) {
      errors.push("themes.json: required fallback theme 'explorer' is missing.");
    }
    for (const t of themesData.themes) {
      if (!t.id || !t.label || !Array.isArray(t.ranks) || !Array.isArray(t.correct) || !Array.isArray(t.notYet) || !Array.isArray(t.debrief)) {
        errors.push(`themes.json: theme "${t?.id || "?"}" is missing required fields.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
