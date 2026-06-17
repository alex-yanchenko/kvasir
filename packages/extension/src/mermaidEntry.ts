// Separate ESM entry so mermaid (~3 MB) builds to its own dist/mermaid.mjs and
// is lazy-loaded at runtime via import(chrome.runtime.getURL(...)) — keeping it
// out of the always-injected content script. See build.mjs (the esm context) and
// the web_accessible_resources entry in manifest.json.
export { default } from "mermaid";
