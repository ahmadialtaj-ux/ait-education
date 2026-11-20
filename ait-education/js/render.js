// js/render.js — Safe DOM rendering helpers, learn block components, interactive question widgets, and view templates (PLAYER_SPEC v0.3 & ENGAGEMENT_SPEC v0.3)

import { STRINGS, fmt } from "./strings.js";
import { isLocalImagePath } from "./validate.js";
import { scoreWrittenMarkPoints } from "./marking.js";
import { resolveQuestionHint } from "./missions.js";
import { isTtsAvailable } from "./tts.js";

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatSafeText(str) {
  const escaped = escapeHtml(str);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// v0.3.4: a prompt that starts with its own question-type label (an emoji label such as "🔎 Find it: ")
// keeps that label instead of getting a "Command:" prefix; the label is shown in bold.
export function promptHasOwnLabel(promptText) {
  return /^\p{Extended_Pictographic}/u.test(String(promptText || "").trim());
}

export function formatPromptWithBoldCommand(promptText, commandWord) {
  const safePrompt = escapeHtml(promptText || "");
  if (promptHasOwnLabel(promptText)) {
    const m = safePrompt.match(/^([^:?]{1,40}[:?])\s*/);
    return m ? `<strong class="question-type-label">${m[1]}</strong> ${safePrompt.slice(m[0].length)}` : safePrompt;
  }
  if (!commandWord) return safePrompt;
  const escapedCmd = escapeHtml(commandWord);
  const regex = new RegExp(`\\b(${escapedCmd})\\b`, "i");
  if (regex.test(safePrompt)) {
    return safePrompt.replace(regex, "<strong>$1</strong>");
  }
  return `<strong>${escapedCmd.charAt(0).toUpperCase() + escapedCmd.slice(1)}</strong>: ${safePrompt}`;
}

export function renderReadAloudButton(speechText, targetId, allowOnlineVoices = false) {
  if (!speechText || !isTtsAvailable(allowOnlineVoices)) return "";
  const encoded = encodeURIComponent(speechText);
  return `<button type="button" class="btn-tts" data-action="tts-speak" data-speech="${encoded}" data-target-id="${escapeHtml(targetId)}" aria-label="${escapeHtml(STRINGS.readAloudBtn)}">${escapeHtml(STRINGS.readAloudBtn)}</button>`;
}

export function renderLearnBlock(block, unitId, { allowOnlineVoices = false, isOpenedRealWorld = false } = {}) {
  const domId = `block-${unitId}-${block.id}`;
  const titleHtml = block.title ? `<h3 class="block-title">${formatSafeText(block.title)}</h3>` : "";

  if (block.type === "text") {
    const speech = `${block.title ? block.title + ". " : ""}${block.body || ""}`;
    return `<article id="${domId}" class="learn-block block-text" tabindex="-1">
      <div class="block-header-row">${titleHtml}${renderReadAloudButton(speech, domId, allowOnlineVoices)}</div>
      <p class="block-body">${formatSafeText(block.body)}</p>
    </article>`;
  }

  if (block.type === "keypoints") {
    const items = block.items || [];
    const speech = `${block.title ? block.title + ". " : ""}${items.join(". ")}`;
    const listHtml = items.map((it) => `<li>${formatSafeText(it)}</li>`).join("");
    return `<article id="${domId}" class="learn-block block-keypoints" tabindex="-1">
      <div class="block-header-row">${titleHtml}${renderReadAloudButton(speech, domId, allowOnlineVoices)}</div>
      <ul class="keypoints-list">${listHtml}</ul>
    </article>`;
  }

  if (block.type === "compare") {
    const cols = block.columns || ["Column A", "Column B"];
    const rows = block.rows || [];
    const speechParts = [block.title || "Comparison table"];
    for (const r of rows) {
      speechParts.push(`${r.label}: ${cols[0]}: ${r.a}. ${cols[1]}: ${r.b}.`);
    }
    const rowsHtml = rows
      .map(
        (r) => `<div class="compare-row" role="row">
          <div class="compare-cell compare-label" role="rowheader"><strong>${formatSafeText(r.label)}</strong></div>
          <div class="compare-cell" role="cell"><span class="compare-col-mobile">${formatSafeText(cols[0])}: </span>${formatSafeText(r.a)}</div>
          <div class="compare-cell" role="cell"><span class="compare-col-mobile">${formatSafeText(cols[1])}: </span>${formatSafeText(r.b)}</div>
        </div>`
      )
      .join("");

    return `<article id="${domId}" class="learn-block block-compare" tabindex="-1">
      <div class="block-header-row">${titleHtml}${renderReadAloudButton(speechParts.join(" "), domId, allowOnlineVoices)}</div>
      <div class="compare-table" role="table" aria-label="${escapeHtml(block.title || "Comparison")}">
        <div class="compare-header" role="row">
          <div class="compare-cell compare-label" role="columnheader">Feature</div>
          <div class="compare-cell" role="columnheader">${formatSafeText(cols[0])}</div>
          <div class="compare-cell" role="columnheader">${formatSafeText(cols[1])}</div>
        </div>
        ${rowsHtml}
      </div>
    </article>`;
  }

  if (block.type === "tip" || block.type === "mistake" || block.type === "example") {
    const metaMap = {
      tip: { icon: "💡", label: STRINGS.calloutTip, cls: "callout-tip" },
      mistake: { icon: "⚠️", label: STRINGS.calloutMistake, cls: "callout-mistake" },
      example: { icon: "🔍", label: STRINGS.calloutExample, cls: "callout-example" }
    };
    const info = metaMap[block.type];
    const speech = `${info.label}. ${block.title ? block.title + ". " : ""}${block.body || ""}`;
    return `<aside id="${domId}" class="learn-block callout-box ${info.cls}" tabindex="-1">
      <div class="block-header-row">
        <div class="callout-badge"><span aria-hidden="true">${info.icon}</span> <strong>${escapeHtml(info.label)}</strong>${block.title ? ` · ${formatSafeText(block.title)}` : ""}</div>
        ${renderReadAloudButton(speech, domId, allowOnlineVoices)}
      </div>
      <p class="block-body">${formatSafeText(block.body)}</p>
    </aside>`;
  }

  if (block.type === "realWorld") {
    const speech = `${STRINGS.calloutRealWorld}. ${block.body || ""}`;
    return `<details id="${domId}" class="learn-block callout-box callout-realworld" data-action="toggle-realworld" data-unit-id="${escapeHtml(unitId)}" data-block-id="${escapeHtml(block.id)}" ${isOpenedRealWorld ? "open" : ""}>
      <summary class="realworld-summary">
        <span>🌍 <strong>${escapeHtml(STRINGS.calloutRealWorld)}</strong>${block.title ? ` — ${formatSafeText(block.title)}` : ""}</span>
      </summary>
      <div class="realworld-content">
        <div class="block-header-row">
          <span></span>
          ${renderReadAloudButton(speech, domId, allowOnlineVoices)}
        </div>
        <p class="block-body">${formatSafeText(block.body)}</p>
      </div>
    </details>`;
  }

  if (block.type === "image") {
    const validSrc = isLocalImagePath(block.src);
    const speech = `${STRINGS.imageAltPlaceholder.replace("{alt}", block.alt || "")}. ${block.caption || ""}`;
    const imgMarkup = validSrc
      ? `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" class="learn-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="image-placeholder-box" style="display:none;" role="img" aria-label="${escapeHtml(block.alt)}">
           <span class="image-placeholder-icon" aria-hidden="true">🖼️</span>
           <span class="image-placeholder-text">${escapeHtml(fmt(STRINGS.imageAltPlaceholder, { alt: block.alt }))}</span>
         </div>`
      : `<div class="image-placeholder-box" role="img" aria-label="${escapeHtml(block.alt)}">
           <span class="image-placeholder-icon" aria-hidden="true">🖼️</span>
           <span class="image-placeholder-text">${escapeHtml(fmt(STRINGS.imageAltPlaceholder, { alt: block.alt }))}</span>
         </div>`;

    return `<figure id="${domId}" class="learn-block block-image" tabindex="-1">
      <div class="block-header-row">${titleHtml}${renderReadAloudButton(speech, domId, allowOnlineVoices)}</div>
      ${imgMarkup}
      ${block.caption ? `<figcaption class="image-caption">${formatSafeText(block.caption)}</figcaption>` : ""}
    </figure>`;
  }

  return "";
}

export function renderQuestionCard({
  unit,
  question,
  mission = null,
  tryRecord = null,
  draftAnswer = null,
  writtenProgress = null,
  isBossExam = false,
  isBossMarking = false,
  themeFeedbackLine = "",
  allowOnlineVoices = false,
  contextPrefix = "q"
}) {
  const globalQid = `${unit.id}#${question.id}`;
  const cardDomId = `${contextPrefix}-${unit.id}-${question.id}`;
  const marksLabel =
    question.marks === 1
      ? STRINGS.marksBadgeOne
      : fmt(STRINGS.marksBadgeMulti, { marks: question.marks });

  const state = tryRecord?.state || "unanswered";
  const isRevealedOrDone = !isBossExam && (state === "correct" || state === "correct2" || state === "revealed");
  const isTry2 = !isBossExam && state === "try2";

  let promptSpeech = `${promptHasOwnLabel(question.prompt) ? "" : question.command + ". "}${question.prompt}. ${question.marks} ${question.marks === 1 ? "mark" : "marks"}.`;
  if (question.type === "mcq" && Array.isArray(question.options)) {
    promptSpeech += " Options: " + question.options.join(". ");
  } else if (question.type === "tick" && Array.isArray(question.rows)) {
    promptSpeech += " Statements: " + question.rows.map((r) => r.statement).join(". ");
  } else if (question.type === "fill" && Array.isArray(question.wordList)) {
    promptSpeech += " Word list: " + question.wordList.join(", ") + ".";
  }

  let bodyHtml = "";
  if (question.type === "mcq") {
    bodyHtml = renderMcqControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam);
  } else if (question.type === "tick") {
    bodyHtml = renderTickControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam);
  } else if (question.type === "fill") {
    bodyHtml = renderFillControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam);
  } else if (question.type === "match") {
    bodyHtml = renderMatchControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam);
  } else if (question.type === "written") {
    bodyHtml = renderWrittenControl(question, globalQid, draftAnswer, writtenProgress, isBossExam, isBossMarking, allowOnlineVoices);
  }

  let feedbackHtml = "";
  if (!isBossExam && question.type !== "written" && state !== "unanswered") {
    feedbackHtml = renderAutoFeedbackBox({
      unit,
      question,
      mission,
      tryRecord,
      themeFeedbackLine,
      allowOnlineVoices,
      globalQid
    });
  }

  let actionRowHtml = "";
  if (isBossExam) {
    const hasAns = hasNonEmptyAnswer(question, draftAnswer);
    actionRowHtml = `<div class="question-action-row">
      <span class="status-pill ${hasAns ? "pill-saved" : "pill-pending"}">${escapeHtml(hasAns ? STRINGS.answerSavedBadge : STRINGS.unansweredBadge)}</span>
    </div>`;
  } else if (question.type !== "written") {
    if (state === "unanswered" || state === "try1") {
      actionRowHtml = `<div class="question-action-row">
        <button type="button" class="btn btn-primary" data-action="submit-auto-q" data-global-qid="${escapeHtml(globalQid)}">${escapeHtml(STRINGS.submitAnswerBtn)}</button>
      </div>`;
    } else if (isTry2) {
      actionRowHtml = `<div class="question-action-row">
        <button type="button" class="btn btn-primary" data-action="submit-auto-q" data-global-qid="${escapeHtml(globalQid)}">${escapeHtml(STRINGS.tryAgainBtn)}</button>
      </div>`;
    } else if (state === "revealed" && !tryRecord?.gotItAck) {
      actionRowHtml = `<div class="question-action-row">
        <button type="button" class="btn btn-secondary" data-action="ack-got-it" data-global-qid="${escapeHtml(globalQid)}">${escapeHtml(STRINGS.gotItBtn)}</button>
      </div>`;
    }
  }

  return `<section id="${escapeHtml(cardDomId)}" class="question-card" data-global-qid="${escapeHtml(globalQid)}">
    <div class="question-header-row">
      <div class="question-meta-tags">
        <span class="command-badge">${escapeHtml(question.command)}</span>
        <span class="marks-badge">${escapeHtml(marksLabel)}</span>
        ${question.rowsPerMark && question.rowsPerMark > 1 ? `<span class="rows-per-mark-badge">${escapeHtml(fmt(STRINGS.rowsPerMarkNote, { rows: question.rowsPerMark }))}</span>` : ""}
      </div>
      ${renderReadAloudButton(promptSpeech, cardDomId, allowOnlineVoices)}
    </div>
    <p class="question-prompt">${formatPromptWithBoldCommand(question.prompt, question.command)}</p>
    <div class="question-interactive-area">
      ${bodyHtml}
    </div>
    ${actionRowHtml}
    ${feedbackHtml}
  </section>`;
}

function hasNonEmptyAnswer(question, ans) {
  if (ans === null || ans === undefined) return false;
  if (question.type === "mcq") return Array.isArray(ans) && ans.length > 0;
  if (question.type === "tick" || question.type === "fill" || question.type === "match") {
    return typeof ans === "object" && Object.keys(ans).length > 0;
  }
  if (question.type === "written") return typeof ans === "string" && ans.trim().length > 0;
  return false;
}

function renderMcqControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam) {
  const isMulti = (question.answers || []).length > 1;
  const selected = Array.isArray(draftAnswer)
    ? draftAnswer.map(Number)
    : Array.isArray(tryRecord?.try2)
    ? tryRecord.try2.map(Number)
    : Array.isArray(tryRecord?.try1)
    ? tryRecord.try1.map(Number)
    : [];
  const correctSet = new Set((question.answers || []).map(Number));

  const optionsHtml = (question.options || [])
    .map((opt, idx) => {
      const isChecked = selected.includes(idx);
      let revealStateCls = "";
      let revealTag = "";
      if (isRevealedOrDone && !isBossExam) {
        if (correctSet.has(idx)) {
          revealStateCls = "opt-revealed-correct";
          revealTag = `<span class="reveal-inline-tag">${escapeHtml(STRINGS.correctRowTag)}</span>`;
        } else if (isChecked) {
          revealStateCls = "opt-revealed-not-answer";
        }
      }
      return `<label class="mcq-option ${isChecked ? "mcq-selected" : ""} ${revealStateCls}">
        <input
          type="${isMulti ? "checkbox" : "radio"}"
          name="mcq-${escapeHtml(globalQid)}"
          value="${idx}"
          ${isChecked ? "checked" : ""}
          ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
          data-action="change-mcq"
          data-global-qid="${escapeHtml(globalQid)}"
          data-multi="${isMulti ? "1" : "0"}"
        />
        <span class="mcq-option-text">${formatSafeText(opt)}</span>
        ${revealTag}
      </label>`;
    })
    .join("");

  return `<div class="mcq-options-list" role="group" aria-label="Multiple choice options">${optionsHtml}</div>`;
}

function renderTickControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam) {
  const cols = question.columns || ["True", "False"];
  const currentSelections =
    draftAnswer ||
    tryRecord?.try2 ||
    tryRecord?.try1 ||
    {};

  const headerColsHtml = cols.map((c) => `<th scope="col" class="tick-col-head">${formatSafeText(c)}</th>`).join("");
  const rowsHtml = (question.rows || [])
    .map((row) => {
      const chosen = currentSelections[row.id];
      const isRight = chosen !== undefined && Number(chosen) === Number(row.answer);
      let rowRevealHtml = "";
      let rowCls = "";

      if (isRevealedOrDone && !isBossExam) {
        rowCls = isRight ? "tick-row-correct" : "tick-row-revealed";
        const ansColName = cols[row.answer] || "";
        rowRevealHtml = `<div class="tick-row-explanation">
          <strong>${isRight ? escapeHtml(STRINGS.correctRowTag) : escapeHtml(fmt(STRINGS.notAnswerRowTag, { ans: ansColName }))}</strong>
          ${row.explanation ? ` — ${formatSafeText(row.explanation)}` : ""}
        </div>`;
      }

      const cellsHtml = cols
        .map((c, cIdx) => {
          const checked = chosen !== undefined && Number(chosen) === cIdx;
          return `<td class="tick-cell">
            <label class="tick-radio-label" aria-label="${escapeHtml(row.statement)} — ${escapeHtml(c)}">
              <input
                type="radio"
                name="tick-${escapeHtml(globalQid)}-${escapeHtml(row.id)}"
                value="${cIdx}"
                ${checked ? "checked" : ""}
                ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
                data-action="change-tick"
                data-global-qid="${escapeHtml(globalQid)}"
                data-row-id="${escapeHtml(row.id)}"
              />
              <span class="tick-check-box" aria-hidden="true">${checked ? "✓" : ""}</span>
            </label>
          </td>`;
        })
        .join("");

      return `<tr class="tick-row ${rowCls}">
        <th scope="row" class="tick-statement">
          <div>${formatSafeText(row.statement)}</div>
          ${rowRevealHtml}
        </th>
        ${cellsHtml}
      </tr>`;
    })
    .join("");

  return `<div class="tick-table-wrapper">
    <table class="tick-table">
      <thead>
        <tr>
          <th scope="col" class="tick-statement-head">Statement</th>
          ${headerColsHtml}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

function renderFillControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam) {
  const currentSlots =
    draftAnswer?.slots ||
    (draftAnswer && !draftAnswer.slots ? draftAnswer : null) ||
    tryRecord?.try2 ||
    tryRecord?.try1 ||
    {};
  const selectedWord = draftAnswer?.selectedWord || null;
  const usedWords = new Set(Object.values(currentSlots).filter(Boolean));

  const bankHtml = (question.wordList || [])
    .map((word) => {
      const isUsed = usedWords.has(word);
      const isSelected = selectedWord === word;
      return `<button
        type="button"
        class="word-chip ${isSelected ? "word-chip-selected" : ""} ${isUsed ? "word-chip-used" : ""}"
        ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
        aria-pressed="${isSelected ? "true" : "false"}"
        data-action="fill-select-word"
        data-global-qid="${escapeHtml(globalQid)}"
        data-word="${escapeHtml(word)}"
      >${formatSafeText(word)}</button>`;
    })
    .join("");

  const itemsHtml = (question.items || [])
    .map((item) => {
      const parts = String(item.sentence).split("___");
      const before = parts[0] || "";
      const after = parts[1] || "";
      const filledWord = currentSlots[item.id] || "";
      const isRight = filledWord === item.answer;

      let revealHtml = "";
      let slotCls = filledWord ? "fill-slot-filled" : "fill-slot-empty";
      if (isRevealedOrDone && !isBossExam) {
        slotCls = isRight ? "fill-slot-correct" : "fill-slot-revealed";
        revealHtml = isRight
          ? `<span class="reveal-inline-tag">${escapeHtml(STRINGS.correctRowTag)}</span>`
          : `<span class="reveal-inline-tag">${escapeHtml(fmt(STRINGS.notAnswerRowTag, { ans: item.answer }))}</span>`;
      }

      return `<div class="fill-item-row">
        <p class="fill-sentence">
          <span>${formatSafeText(before)}</span>
          <button
            type="button"
            class="fill-gap-btn ${slotCls}"
            ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
            data-action="fill-place-slot"
            data-global-qid="${escapeHtml(globalQid)}"
            data-item-id="${escapeHtml(item.id)}"
            aria-label="Blank slot for ${escapeHtml(item.id)}: ${escapeHtml(filledWord || "empty")}"
          >${escapeHtml(filledWord || "___")}</button>
          ${
            filledWord && !(isRevealedOrDone && !isBossExam)
              ? `<button type="button" class="btn-inline-clear" data-action="fill-clear-slot" data-global-qid="${escapeHtml(globalQid)}" data-item-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(STRINGS.clearSlotBtn)}">✕</button>`
              : ""
          }
          <span>${formatSafeText(after)}</span>
          ${revealHtml}
        </p>
      </div>`;
    })
    .join("");

  return `<div class="fill-widget">
    <p class="helper-note">${escapeHtml(STRINGS.eachWordOnceNote)}</p>
    <div class="word-bank" role="group" aria-label="Word bank">${bankHtml}</div>
    <div class="fill-items-list">${itemsHtml}</div>
  </div>`;
}

function renderMatchControl(question, globalQid, draftAnswer, tryRecord, isRevealedOrDone, isBossExam) {
  const pairsMap =
    draftAnswer?.pairs ||
    (draftAnswer && !draftAnswer.pairs ? draftAnswer : null) ||
    tryRecord?.try2 ||
    tryRecord?.try1 ||
    {};
  const selectedLeft = draftAnswer?.selectedLeft || null;
  const expectedMap = new Map((question.pairs || []).map(([l, r]) => [l, r]));
  const rightById = new Map((question.right || []).map((r) => [r.id, r.text]));
  const usedRightIds = new Set(Object.values(pairsMap).filter(Boolean));

  const leftHtml = (question.left || [])
    .map((lItem, idx) => {
      const matchedRightId = pairsMap[lItem.id] || null;
      const matchedRightText = matchedRightId ? rightById.get(matchedRightId) : null;
      const isSelected = selectedLeft === lItem.id;
      const expectedRightId = expectedMap.get(lItem.id);
      const isRight = matchedRightId && matchedRightId === expectedRightId;

      let revealTag = "";
      if (isRevealedOrDone && !isBossExam) {
        const expectedText = rightById.get(expectedRightId) || "";
        revealTag = isRight
          ? `<div class="match-reveal-note">${escapeHtml(STRINGS.correctRowTag)}</div>`
          : `<div class="match-reveal-note">${escapeHtml(fmt(STRINGS.notAnswerRowTag, { ans: expectedText }))}</div>`;
      }

      return `<div class="match-left-card ${isSelected ? "match-card-selected" : ""}">
        <button
          type="button"
          class="match-select-left-btn"
          ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
          aria-pressed="${isSelected ? "true" : "false"}"
          data-action="match-select-left"
          data-global-qid="${escapeHtml(globalQid)}"
          data-left-id="${escapeHtml(lItem.id)}"
        >
          <span class="match-num">${idx + 1}.</span>
          <span>${formatSafeText(lItem.text)}</span>
        </button>
        <div class="match-paired-slot">
          ${
            matchedRightText
              ? `<span class="paired-pill">↔ ${formatSafeText(matchedRightText)}</span>
                 ${
                   !(isRevealedOrDone && !isBossExam)
                     ? `<button type="button" class="btn-inline-clear" data-action="match-clear-pair" data-global-qid="${escapeHtml(globalQid)}" data-left-id="${escapeHtml(lItem.id)}" aria-label="${escapeHtml(STRINGS.unmatchBtn)}">✕</button>`
                     : ""
                 }`
              : `<span class="unpaired-hint">Select, then tap a match →</span>`
          }
        </div>
        ${revealTag}
      </div>`;
    })
    .join("");

  const rightHtml = (question.right || [])
    .map((rItem) => {
      const isUsed = usedRightIds.has(rItem.id);
      return `<button
        type="button"
        class="match-right-btn ${isUsed ? "match-right-used" : ""}"
        ${isRevealedOrDone && !isBossExam ? "disabled" : ""}
        data-action="match-select-right"
        data-global-qid="${escapeHtml(globalQid)}"
        data-right-id="${escapeHtml(rItem.id)}"
      >${formatSafeText(rItem.text)}</button>`;
    })
    .join("");

  return `<div class="match-widget">
    <p class="helper-note">${escapeHtml(STRINGS.matchInstructionNote)}</p>
    <div class="match-columns">
      <div class="match-col-left" role="group" aria-label="Items to match">${leftHtml}</div>
      <div class="match-col-right" role="group" aria-label="Choices">${rightHtml}</div>
    </div>
  </div>`;
}

// H2: Feedback boxes have tabindex="-1" so focus can move directly to the feedback line after "Check answer"
function renderAutoFeedbackBox({
  unit,
  question,
  mission,
  tryRecord,
  themeFeedbackLine,
  allowOnlineVoices
}) {
  const state = tryRecord?.state;
  const feedbackDomId = `fb-${unit.id}-${question.id}`;

  if (state === "correct") {
    const speech = `${themeFeedbackLine || "Correct!"} ${question.explanation || ""}`;
    return `<div id="${escapeHtml(feedbackDomId)}" class="feedback-box feedback-success" role="status" tabindex="-1">
      <div class="block-header-row">
        <strong>✨ ${escapeHtml(themeFeedbackLine || "Correct!")}</strong>
        ${renderReadAloudButton(speech, feedbackDomId, allowOnlineVoices)}
      </div>
      <p>${formatSafeText(question.explanation)}</p>
    </div>`;
  }

  if (state === "try2") {
    const right = tryRecord.try1CorrectCount ?? 0;
    const total = tryRecord.totalItems ?? question.marks;
    const scoreLine =
      question.type === "tick"
        ? fmt(STRINGS.try1ScoreRows, { right, total })
        : question.type === "match"
        ? fmt(STRINGS.try1ScorePairs, { right, total })
        : fmt(STRINGS.try1ScoreItems, { right, total });

    const hintObj = resolveQuestionHint(question, unit, mission);
    const speech = `${themeFeedbackLine || "Not yet."} ${scoreLine}. ${STRINGS.hintPrefix}${hintObj.text}`;

    return `<div id="${escapeHtml(feedbackDomId)}" class="feedback-box feedback-try2" role="status" tabindex="-1">
      <div class="block-header-row">
        <strong>${escapeHtml(themeFeedbackLine || "Not yet.")} · ${escapeHtml(scoreLine)}</strong>
        ${renderReadAloudButton(speech, feedbackDomId, allowOnlineVoices)}
      </div>
      <p class="feedback-hint">
        <strong>${escapeHtml(STRINGS.hintPrefix)}</strong>${escapeHtml(hintObj.text)}
        ${
          hintObj.targetBlockId
            ? ` <button type="button" class="btn-link-inline" data-action="scroll-to-block" data-block-dom-id="block-${escapeHtml(unit.id)}-${escapeHtml(hintObj.targetBlockId)}">↑ Jump to block</button>`
            : ""
        }
      </p>
    </div>`;
  }

  if (state === "correct2") {
    const speech = `${STRINGS.try2FullLine} ${question.explanation || ""}`;
    return `<div id="${escapeHtml(feedbackDomId)}" class="feedback-box feedback-success" role="status" tabindex="-1">
      <div class="block-header-row">
        <strong>✓ ${escapeHtml(STRINGS.try2FullLine)}</strong>
        ${renderReadAloudButton(speech, feedbackDomId, allowOnlineVoices)}
      </div>
      <p>${formatSafeText(question.explanation)}</p>
    </div>`;
  }

  if (state === "revealed") {
    const speech = `${STRINGS.try2RevealLine} ${question.explanation || ""}`;
    return `<div id="${escapeHtml(feedbackDomId)}" class="feedback-box feedback-revealed" role="status" tabindex="-1">
      <div class="block-header-row">
        <strong>${escapeHtml(STRINGS.try2RevealLine)}</strong>
        ${renderReadAloudButton(speech, feedbackDomId, allowOnlineVoices)}
      </div>
      <p>${formatSafeText(question.explanation)}</p>
    </div>`;
  }

  return "";
}

function renderWrittenControl(
  question,
  globalQid,
  draftAnswer,
  writtenProgress,
  isBossExam,
  isBossMarking,
  allowOnlineVoices
) {
  const textValue =
    typeof draftAnswer === "string"
      ? draftAnswer
      : writtenProgress?.studentText ?? writtenProgress?.lastAnswer ?? "";

  if (isBossExam) {
    return `<div class="written-widget">
      <textarea
        class="written-textarea"
        rows="4"
        placeholder="${escapeHtml(STRINGS.writtenPlaceholder)}"
        data-action="input-written"
        data-global-qid="${escapeHtml(globalQid)}"
        aria-label="Written answer"
      >${escapeHtml(textValue)}</textarea>
    </div>`;
  }

  const stage = writtenProgress?.stage || "writing";

  if (stage === "writing" && !isBossMarking) {
    return `<div class="written-widget">
      <textarea
        class="written-textarea"
        rows="4"
        placeholder="${escapeHtml(STRINGS.writtenPlaceholder)}"
        data-action="input-written"
        data-global-qid="${escapeHtml(globalQid)}"
        aria-label="Written answer"
      >${escapeHtml(textValue)}</textarea>
      <div class="question-action-row">
        <button type="button" class="btn btn-primary" data-action="submit-written-text" data-global-qid="${escapeHtml(globalQid)}">${escapeHtml(STRINGS.writtenSubmitBtn)}</button>
      </div>
    </div>`;
  }

  const suggestedScore = writtenProgress?.suggestedScore ?? 0;
  const matchedSet = new Set(writtenProgress?.matchedIds || []);
  const currentTicks = Array.isArray(writtenProgress?.ticks)
    ? writtenProgress.ticks
    : [...matchedSet];
  const tickedSet = new Set(currentTicks);
  const { score: liveSelfScore } = scoreWrittenMarkPoints(question, currentTicks);

  const rulesNotes = (question.rules || []).map((r) => {
    if (r.type === "requireGroup") {
      return r.source === "app"
        ? fmt(STRINGS.ruleAppRequireGroup, { group: r.group, cap: r.capWithout })
        : fmt(STRINGS.ruleQuestionRequireGroup, { group: r.group, cap: r.capWithout });
    }
    if (r.type === "maxPerGroup") {
      return fmt(STRINGS.ruleMaxPerGroup, { max: r.max, group: r.group });
    }
    return "";
  }).filter(Boolean);

  const checklistHtml = (question.markPoints || [])
    .map((mp) => {
      const isChecked = tickedSet.has(mp.id);
      const wasHintMatched = matchedSet.has(mp.id);
      const toggleHintLabel = wasHintMatched ? STRINGS.removeFalseMark : STRINGS.iMadeThisPoint;
      const reqNote = mp.requires ? ` <em class="mp-requires-tag">(${escapeHtml(fmt(STRINGS.requiresNote, { req: mp.requires }))})</em>` : "";

      return `<label class="checklist-item ${isChecked ? "checklist-checked" : ""}">
        <input
          type="checkbox"
          value="${escapeHtml(mp.id)}"
          ${isChecked ? "checked" : ""}
          ${stage === "completed" ? "disabled" : ""}
          data-action="toggle-written-mp"
          data-global-qid="${escapeHtml(globalQid)}"
          data-mp-id="${escapeHtml(mp.id)}"
        />
        <span class="checklist-point-body">
          <span class="mp-point-text">${formatSafeText(mp.point)}</span>
          ${reqNote}
          <span class="mp-action-sub">${escapeHtml(toggleHintLabel)}</span>
        </span>
      </label>`;
    })
    .join("");

  let completedRevealHtml = "";
  if (stage === "completed") {
    const selfScore = writtenProgress?.selfScore ?? liveSelfScore;
    const parentScore = writtenProgress?.parentScore;
    const toDiscuss = Boolean(writtenProgress?.toDiscuss);
    const modelDomId = `model-${globalQid.replace("#", "-")}`;
    const modelSpeech = `${STRINGS.modelAnswerHeading}: ${question.modelAnswer}. ${STRINGS.explanationHeading}: ${question.explanation}`;

    const scoreSummaryLine =
      parentScore !== null && parentScore !== undefined
        ? fmt(STRINGS.parentReviewedLabel, {
            parent: parentScore,
            self: selfScore,
            suggested: suggestedScore,
            marks: question.marks
          })
        : fmt(STRINGS.selfScoreSavedLabel, {
            self: selfScore,
            suggested: suggestedScore,
            marks: question.marks
          });

    completedRevealHtml = `<div id="${escapeHtml(modelDomId)}" class="written-reveal-box" role="status" tabindex="-1">
      <div class="block-header-row">
        <strong>${escapeHtml(scoreSummaryLine)}</strong>
        ${renderReadAloudButton(modelSpeech, modelDomId, allowOnlineVoices)}
      </div>
      ${toDiscuss ? `<p class="to-discuss-banner">💬 ${escapeHtml(STRINGS.toDiscussNotice)}</p>` : ""}
      <div class="model-answer-block">
        <h4>${escapeHtml(STRINGS.modelAnswerHeading)}</h4>
        <p>${formatSafeText(question.modelAnswer)}</p>
      </div>
      <div class="explanation-block">
        <h4>${escapeHtml(STRINGS.explanationHeading)}</h4>
        <p>${formatSafeText(question.explanation)}</p>
      </div>
    </div>`;
  }

  return `<div class="written-widget">
    <div class="student-submitted-answer">
      <strong>Your answer:</strong>
      <p>${escapeHtml(textValue || "(No text entered)")}</p>
    </div>
    <div class="examiner-checklist-box" tabindex="-1">
      <p class="examiner-banner">🧐 <strong>${escapeHtml(STRINGS.examinerPrompt)}</strong></p>
      <p class="suggested-score-line">${escapeHtml(fmt(STRINGS.suggestedScoreLabel, { score: suggestedScore, marks: question.marks }))}</p>
      ${rulesNotes.length > 0 ? `<ul class="marking-rules-list">${rulesNotes.map((rn) => `<li>${escapeHtml(rn)}</li>`).join("")}</ul>` : ""}
      <h4 class="checklist-heading">${escapeHtml(STRINGS.selfChecklistHeading)}</h4>
      <div class="checklist-items">${checklistHtml}</div>
      ${
        stage !== "completed"
          ? `<div class="question-action-row">
               <button type="button" class="btn btn-primary" data-action="confirm-written-self" data-global-qid="${escapeHtml(globalQid)}">
                 ${escapeHtml(fmt(STRINGS.confirmSelfScoreBtn, { score: liveSelfScore, marks: question.marks }))}
               </button>
             </div>`
          : ""
      }
    </div>
    ${completedRevealHtml}
  </div>`;
}
