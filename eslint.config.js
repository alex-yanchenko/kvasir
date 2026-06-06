import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/*.min.js", "packages/server/bun.lock"] },

  // Server + shared: TypeScript (Node/Bun).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/{server,shared}/**/*.ts"] })),
  {
    files: ["packages/{server,shared}/**/*.ts"],
    languageOptions: { globals: { ...globals.node, Bun: "readonly" } },
  },

  // Extension TypeScript modules (background, and content/* as they migrate).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/extension/**/*.ts"] })),
  {
    files: ["packages/extension/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" } },
  },

  // Extension: browser content scripts still in plain JS until their Phase 4 split.
  // Linted leniently here — they get the strict treatment when rewritten in TS.
  {
    files: ["packages/extension/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
