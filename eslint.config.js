import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importX from "eslint-plugin-import-x";
import * as regexp from "eslint-plugin-regexp";
import nounsanitized from "eslint-plugin-no-unsanitized";
import jsxA11y from "eslint-plugin-jsx-a11y";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
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

  // Govern eslint-disable usage everywhere: every disable must name its rule(s) and
  // carry a "-- why" description; stale/unused/unbounded disables are errors.
  {
    files: ["packages/**/*.{ts,tsx,js}"],
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    rules: {
      "@eslint-community/eslint-comments/disable-enable-pair": ["error", { allowWholeFile: false }],
      "@eslint-community/eslint-comments/no-aggregating-enable": "error",
      "@eslint-community/eslint-comments/no-duplicate-disable": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@eslint-community/eslint-comments/no-unused-enable": "error",
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: ["eslint-enable"] }],
    },
  },

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
    plugins: { "react-hooks": reactHooks, "import-x": importX, "no-unsanitized": nounsanitized },
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" },
      parserOptions,
    },
    settings: importSettings,
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Flag raw HTML sinks (innerHTML, insertAdjacentHTML, dangerouslySetInnerHTML):
      // every one must be provably-safe (sanitized markup or a static literal).
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      ...importRules,
      ...typeAwareRules,
    },
  },

  // Accessibility for the React panel (roles, aria, labels, keyboard handlers).
  // Tests are fixtures, not shipped UI — excluded.
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["packages/extension/**/*.tsx"],
    ignores: ["packages/**/*.test.tsx"],
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
