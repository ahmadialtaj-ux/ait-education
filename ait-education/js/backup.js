// js/backup.js — Backup and Restore progress as JSON (ENGAGEMENT_SPEC §8.5, §9.3)

import {
  getProfiles,
  saveProfiles,
  getActiveProfileId,
  setActiveProfileId,
  getProgress,
  saveProgress,
  normalizeProgressBlob
} from "./storage.js";

export function createBackupObject() {
  const profiles = getProfiles();
  const activeProfileId = getActiveProfileId();
  const progressByProfile = {};

  for (const p of profiles) {
    progressByProfile[p.id] = getProgress(p.id);
  }

  return {
    backupFormat: "ait-education-backup-v2",
    exportedAt: new Date().toISOString(),
    activeProfileId,
    profiles,
    progressByProfile
  };
}

export function exportBackupJsonString() {
  return JSON.stringify(createBackupObject(), null, 2);
}

export function triggerBackupDownload() {
  const json = exportBackupJsonString();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ait-education-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function restoreFromBackupJson(jsonString) {
  let data;
  try {
    data = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
  } catch (_) {
    return { ok: false, error: "Invalid JSON file." };
  }

  if (!data || typeof data !== "object") {
    return { ok: false, error: "Backup file is empty or invalid." };
  }

  // Support both multi-profile backup and single-profile v2 progress blob
  if (data.backupFormat === "ait-education-backup-v2" && Array.isArray(data.profiles) && data.progressByProfile) {
    if (data.profiles.length === 0) {
      return { ok: false, error: "Backup file contains no profiles." };
    }
    saveProfiles(data.profiles);
    for (const p of data.profiles) {
      const blob = data.progressByProfile[p.id];
      if (blob) {
        saveProgress(p.id, normalizeProgressBlob(blob));
      }
    }
    const targetActive = data.activeProfileId && data.profiles.some((p) => p.id === data.activeProfileId)
      ? data.activeProfileId
      : data.profiles[0].id;
    setActiveProfileId(targetActive);
    return { ok: true, profilesRestored: data.profiles.length };
  }

  if (data.schemaVersion === 2 && data.profile) {
    const activeId = getActiveProfileId();
    const normalized = normalizeProgressBlob(data);
    saveProgress(activeId, normalized);
    return { ok: true, profilesRestored: 1 };
  }

  return { ok: false, error: "Unrecognised backup format (expected schemaVersion 2)." };
}
