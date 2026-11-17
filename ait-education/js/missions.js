// js/missions.js — Mission builder with topic/afterBlock/even-spread placement & hint fallback (ENGAGEMENT_SPEC §3.1, §3.3)

const missionCache = new Map();

function countWords(str) {
  if (!str || typeof str !== "string") return 0;
  const trimmed = str.replace(/\*\*/g, "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateBlockMinutes(block) {
  if (!block) return 0;
  if (block.type === "realWorld") {
    // Collapsed realWorld = 0 min per ENGAGEMENT_SPEC §3.1
    return 0;
  }
  if (block.type === "image") {
    return 0.3;
  }
  let words = countWords(block.title || "");
  if (block.type === "compare") {
    words += countWords((block.columns || []).join(" "));
    for (const r of block.rows || []) {
      words += countWords(r.label) + countWords(r.a) + countWords(r.b);
    }
  } else if (block.type === "keypoints") {
    for (const item of block.items || []) {
      words += countWords(item);
    }
  } else if (block.body) {
    words += countWords(block.body);
  }
  return words / 130;
}

export function estimateQuestionMinutes(q) {
  if (!q) return 0;
  if (q.type === "written") {
    return 1.5 * (q.marks || 1);
  }
  return 1;
}

export function buildMissions(unit, missionCapMin = 8) {
  if (!unit || unit.meta?.mode === "mock") {
    return [];
  }

  const cap = Number(missionCapMin) || 8;
  const cacheKey = `${unit.id}@${unit.meta?.version || "0.2"}:${cap}`;
  if (missionCache.has(cacheKey)) {
    return missionCache.get(cacheKey);
  }

  const learnBlocks = Array.isArray(unit.learn) ? unit.learn : [];
  const checkQuestions = Array.isArray(unit.check) ? unit.check : [];

  if (learnBlocks.length === 0) {
    return [];
  }

  // Step 1: Map each check question to the learn block id it must follow (ENGAGEMENT_SPEC §3.1)
  const blockIndexById = new Map(learnBlocks.map((b, i) => [b.id, i]));
  const lastBlockIndexByTopic = new Map();
  learnBlocks.forEach((b, idx) => {
    if (b.topic) {
      lastBlockIndexByTopic.set(b.topic, idx);
    }
  });

  const questionsAfterBlockIdx = new Map();
  for (let i = 0; i < learnBlocks.length; i++) {
    questionsAfterBlockIdx.set(i, []);
  }

  const unplacedQuestions = [];
  for (const q of checkQuestions) {
    if (q.afterBlock && blockIndexById.has(q.afterBlock)) {
      const idx = blockIndexById.get(q.afterBlock);
      questionsAfterBlockIdx.get(idx).push(q);
    } else if (q.topic && lastBlockIndexByTopic.has(q.topic)) {
      const idx = lastBlockIndexByTopic.get(q.topic);
      questionsAfterBlockIdx.get(idx).push(q);
    } else {
      unplacedQuestions.push(q);
    }
  }

  // Spread remaining check questions evenly after learn blocks in order
  if (unplacedQuestions.length > 0) {
    const U = unplacedQuestions.length;
    const B = learnBlocks.length;
    unplacedQuestions.forEach((q, k) => {
      const targetIdx = Math.min(B - 1, Math.floor(((k + 1) * B) / U) - 1);
      const safeIdx = Math.max(0, targetIdx);
      questionsAfterBlockIdx.get(safeIdx).push(q);
    });
  }

  // Step 2: Group learn blocks (+ their attached check questions) into missions
  // M2: Only split at a topic change once the mission is >= 5 min;
  // never split mid-topic if it would make a mission shorter than 3 min;
  // merge a short final mission into the previous one if the result stays <= cap (max 12).
  const stepUnits = learnBlocks.map((block, idx) => {
    const attachedQs = questionsAfterBlockIdx.get(idx) || [];
    const blockMin = estimateBlockMinutes(block);
    const qsMin = attachedQs.reduce((acc, q) => acc + estimateQuestionMinutes(q), 0);
    return {
      block,
      questions: attachedQs,
      minutes: blockMin + qsMin,
      topic: block.topic || attachedQs[0]?.topic || null
    };
  });

  const rawMissions = [];
  let current = {
    steps: [],
    minutes: 0
  };

  for (let i = 0; i < stepUnits.length; i++) {
    const step = stepUnits[i];
    const prevStep = current.steps[current.steps.length - 1];
    const topicChanged = Boolean(prevStep && step.topic && prevStep.topic && step.topic !== prevStep.topic);
    const sameTopic = Boolean(prevStep && step.topic && prevStep.topic && step.topic === prevStep.topic);

    const projectedMin = current.minutes + step.minutes;

    let shouldSplit = false;
    if (current.steps.length > 0) {
      if (topicChanged && current.minutes >= 5) {
        shouldSplit = true;
      } else if (projectedMin > cap && current.minutes >= 3) {
        if (!sameTopic || projectedMin > 12) {
          shouldSplit = true;
        }
      }
    }

    if (shouldSplit) {
      rawMissions.push(current);
      current = { steps: [step], minutes: step.minutes };
    } else {
      current.steps.push(step);
      current.minutes += step.minutes;
    }
  }

  if (current.steps.length > 0) {
    const mergeLimit = Math.min(12, cap);
    if (
      rawMissions.length > 0 &&
      current.minutes < 5 &&
      rawMissions[rawMissions.length - 1].minutes + current.minutes <= mergeLimit
    ) {
      const last = rawMissions[rawMissions.length - 1];
      last.steps.push(...current.steps);
      last.minutes += current.minutes;
    } else {
      rawMissions.push(current);
    }
  }

  const missions = rawMissions.map((m, idx) => {
    const blocks = m.steps.map((s) => s.block);
    const questions = m.steps.flatMap((s) => s.questions);
    const firstBlock = blocks[0];
    const firstTitleBlock = blocks.find((b) => b.title && b.title.trim());
    const topicKeys = Array.from(
      new Set([
        ...blocks.map((b) => b.topic).filter(Boolean),
        ...questions.map((q) => q.topic).filter(Boolean)
      ])
    );
    const fallbackTopicTitle = topicKeys.map((tk) => unit.topics?.[tk] || tk).join(" & ") || unit.meta?.title || `Mission ${idx + 1}`;

    return {
      key: firstBlock.id, // Mission key = id of its first learn block (§3.1)
      index: idx + 1,
      total: rawMissions.length,
      title: firstTitleBlock ? firstTitleBlock.title : fallbackTopicTitle,
      estMinutes: Math.max(1, Math.round(m.minutes)),
      blocks,
      questions,
      topicKeys
    };
  });

  missionCache.set(cacheKey, missions);
  return missions;
}

export function resolveQuestionHint(question, unit, mission = null) {
  if (question.hint && typeof question.hint === "string" && question.hint.trim()) {
    return {
      text: question.hint.trim(),
      targetBlockId: question.afterBlock || null,
      targetBlockTitle: null
    };
  }

  const allBlocks = Array.isArray(unit?.learn) ? unit.learn : [];
  const topicBlocks = allBlocks.filter((b) => b.topic && b.topic === question.topic);
  if (topicBlocks.length > 0) {
    const lastTopicBlock = topicBlocks[topicBlocks.length - 1];
    const title = lastTopicBlock.title || unit?.topics?.[question.topic] || lastTopicBlock.id;
    return {
      text: `Look back at: ${title}`,
      targetBlockId: lastTopicBlock.id,
      targetBlockTitle: title
    };
  }

  if (question.afterBlock) {
    const blk = allBlocks.find((b) => b.id === question.afterBlock);
    if (blk && blk.title) {
      return {
        text: `Look back at: ${blk.title}`,
        targetBlockId: blk.id,
        targetBlockTitle: blk.title
      };
    }
  }

  if (mission && Array.isArray(mission.blocks)) {
    const titled = [...mission.blocks].reverse().find((b) => b.title);
    if (titled) {
      return {
        text: `Look back at: ${titled.title}`,
        targetBlockId: titled.id,
        targetBlockTitle: titled.title
      };
    }
  }

  return {
    text: "Look back over this mission.",
    targetBlockId: mission?.blocks?.[0]?.id || null,
    targetBlockTitle: null
  };
}
