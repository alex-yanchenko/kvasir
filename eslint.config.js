import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importX from "eslint-plugin-import-x";
import globals from "globals";

// Import hygiene shared by every TypeScript surface. no-cycle catches accidental
// circular deps; order/no-duplicates keep imports tidy (both autofixable).
const importRules = {
  "import-x/order": [
    "error",
    {
      groups: ["builtin", "external", "internal", "parent", "sibling", "index", "object"],
      "newlines-between": "ignore",
      alphabetize: { order: "asc", caseInsensitive: true },
    },
  ],
  "import-x/no-cycle": ["error", { maxDepth: Infinity }],
  "import-x/no-duplicates": "error",
  "import-x/no-self-import": "error",
  "import-x/no-useless-path-segments": "error",
};
const importSettings = { "import-x/resolver": { typescript: true, node: true } };

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.min.js", "packages/mimir/bun.lock"],
  },

  // Mimir (server) + Runes (shared contract): TypeScript (Node/Bun).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/{mimir,runes}/**/*.ts"] })),
  {
    files: ["packages/{mimir,runes}/**/*.ts"],
    plugins: { "import-x": importX },
    languageOptions: { globals: { ...globals.node, Bun: "readonly" } },
    settings: importSettings,
    rules: importRules,
  },

  // Extension TypeScript modules (huginn, and content/* as they migrate).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/extension/**/*.{ts,tsx}"] })),
  {
    files: ["packages/extension/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "import-x": importX },
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" } },
    settings: importSettings,
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      ...importRules,
    },
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
