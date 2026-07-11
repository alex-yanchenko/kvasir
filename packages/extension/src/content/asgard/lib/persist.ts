// The panel's persistence scopes, as code instead of comments scattered per call
// site. Every write goes through one of these helpers, so "which scope does this
// key live in?" has one home and storage-unavailable (privacy modes, quota) can
// never crash a machine — reads degrade to null, writes to a no-op.
//
// The scope matrix (key builders live in ../../keys.ts):
//   LOCAL (localStorage — cross-tab preference, survives restarts):
//     kvasirTheme, kvasirHl, kvasirReviewSync, kvasirReviewMode,
//     kvasirReviewReposRoot, kvasirFirstRunDone, kvasirPreloadQuestions,
//     kvasirGenerateDiagram, kvasirRailWidth, kvasir:panelPrefs (window shape)
//   SESSION (sessionStorage — per-tab, survives refresh/same-origin nav,
//   inherited by a child tab):
//     kvasir:panel (open + tab), kvasir:session:<id> (review nav snapshot)
//   PROFILE (chrome.storage.local via ../../muninn — extension-wide, async,
//   cross-tab change events):
//     kvasir:chats:<scope>, kvasir:spec:<pr>, kvasir:tour:<pr>, kvasir:gen:<pr>,
//     kvasir:review:<id>, kvasir:token

export const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocal = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable/full — the preference just won't persist */
  }
};

export const readLocalJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null; // unavailable or garbled — callers treat both as absent
  }
};

export const writeLocalJson = (key: string, value: unknown): void => {
  writeLocal(key, JSON.stringify(value));
};

export const readSessionJson = (key: string): unknown => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

export const writeSessionJson = (key: string, value: unknown): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable/full — the per-tab state just won't persist */
  }
};
