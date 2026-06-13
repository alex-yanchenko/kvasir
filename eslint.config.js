import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importX from "eslint-plugin-import-x";
import * as regexp from "eslint-plugin-regexp";
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

// Curated TYPE-AWARE rules — the correctness-focused subset of typescript-eslint's
// type-checked presets (which also bundle opinionated style rules like
// no-unnecessary-condition / prefer-nullish that fight defensive code). These catch
// real bugs: unawaited promises, `any` leaking through, stringifying objects,
// deprecated APIs. They need the project service (parserOptions below).
const typeAwareRules = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/restrict-plus-operands": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/unbound-method": "error",
  "@typescript-eslint/require-await": "error",
  "@typescript-eslint/no-deprecated": "error",
};
const parserOptions = { projectService: true, tsconfigRootDir: import.meta.dirname };

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.min.js", "packages/mimir/bun.lock"],
  },

  // Regex correctness/safety on every source surface (PR-URL/loopback/skip-coverage
  // patterns). Syntactic — no type info needed, so it covers tests and plain JS too.
  { ...regexp.configs["flat/recommended"], files: ["packages/**/*.{ts,tsx,js}"] },

  // Mimir (server) + Runes (shared contract): TypeScript (Node/Bun).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/{mimir,runes}/**/*.ts"] })),
  {
    files: ["packages/{mimir,runes}/**/*.ts"],
    plugins: { "import-x": importX },
    languageOptions: { globals: { ...globals.node, Bun: "readonly" }, parserOptions },
    settings: importSettings,
    rules: { ...importRules, ...typeAwareRules },
  },

  // Extension TypeScript modules.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["packages/extension/**/*.{ts,tsx}"] })),
  {
    files: ["packages/extension/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "import-x": importX },
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" },
      parserOptions,
    },
    settings: importSettings,
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      ...importRules,
      ...typeAwareRules,
    },
  },

  // Test files: syntactic rules only. Type-aware rules need the source tsconfig's
  // program (tests are excluded from it); tests are still type-CHECKED by tsc via
  // each package's tsconfig.test.json.
  {
    files: ["packages/**/*.test.{ts,tsx}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false, project: false } },
  },

  // Extension: browser content scripts still in plain JS until their Phase 4 split.
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
