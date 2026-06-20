import path from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importX from "eslint-plugin-import-x";
import * as regexp from "eslint-plugin-regexp";
import nounsanitized from "eslint-plugin-no-unsanitized";
import jsxA11y from "eslint-plugin-jsx-a11y";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import unicorn from "eslint-plugin-unicorn";
import sonarjs from "eslint-plugin-sonarjs";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";

// The Nine-Realms layering, enforced as lint so it can't erode silently:
//  - Midgard (page controller, owns DOM writes) must never import Asgard (panel UI).
//  - Asgard must never reach into Midgard except its pure readers (midgard/diff) —
//    everything else crosses via the Bifrost.
//  - Runes is the shared leaf: it must not import the extension or server packages.
const pkg = (...segments) => path.join(import.meta.dirname, "packages", ...segments);
const boundaryZones = [
  {
    target: pkg("extension/src/content/midgard"),
    from: pkg("extension/src/content/asgard"),
    message: "Midgard (page controller) must not import Asgard (UI) — communicate via the Bifrost.",
  },
  {
    target: pkg("extension/src/content/asgard"),
    from: pkg("extension/src/content/midgard"),
    except: ["diff.ts"],
    message:
      "Asgard must not reach into Midgard's controller — use the Bifrost; only midgard/diff (pure readers) is allowed.",
  },
  {
    target: pkg("runes/src"),
    from: pkg("extension"),
    message: "Runes is the shared leaf — it must not depend on the extension.",
  },
  {
    target: pkg("runes/src"),
    from: pkg("mimir"),
    message: "Runes is the shared leaf — it must not depend on the server.",
  },
];

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
  "import-x/no-restricted-paths": ["error", { zones: boundaryZones }],
};
const importSettings = { "import-x/resolver": { typescript: true, node: true } };

// Curated TYPE-AWARE rules — the correctness-focused subset of typescript-eslint's
// type-checked presets (which also bundle opinionated style rules like
// no-unnecessary-condition / prefer-nullish that fight defensive code). These catch
// real bugs: unawaited promises, `any` leaking through, stringifying objects,
// deprecated APIs. They need the project service (parserOptions below).
const typeAwareRules = {
  // No type casts in source (tests may cast — see the test-files block). `as const`
  // is still allowed. Forces real type guards / proper typing at boundaries.
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
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
  // String `||` chains often intend falsy-fallthrough ("" → next); enforce ?? only
  // where the footgun is real (a falsy number/object silently taking the fallback).
  "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
};
const parserOptions = { projectService: true, tsconfigRootDir: import.meta.dirname };

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.min.js", "packages/mimir/bun.lock"],
  },

  // Playwright e2e harness — TS, but outside the package projects (Playwright runs
  // its own transpile), so syntactic rules only.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["e2e/**/*.ts", "playwright.config.ts"] })),
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.node }, parserOptions: { project: false } },
    rules: { "@typescript-eslint/no-empty-function": "off" },
  },

  // Regex correctness/safety on every source surface (PR-URL/loopback/skip-coverage
  // patterns). Syntactic — no type info needed, so it covers tests and plain JS too.
  { ...regexp.configs["flat/recommended"], files: ["packages/**/*.{ts,tsx,js}"] },

  // Unicorn: the full recommended preset is ON; only these are turned off, each
  // for a stated reason. (Tests are fixtures — excluded.)
  {
    ...unicorn.configs["flat/recommended"],
    files: ["packages/**/*.{ts,tsx,js}"],
    ignores: ["packages/**/*.test.{ts,tsx}"],
    rules: {
      ...unicorn.configs["flat/recommended"].rules,
      // null is part of the JSON wire contract (absent ≠ explicit null) and is what
      // DOM APIs / React refs return — undefined-only would change serialization.
      "unicorn/no-null": "off",
      // Our getElementById calls all take dynamic GitHub-supplied ids; querySelector
      // would force CSS.escape for no gain — getElementById is the right tool.
      "unicorn/prefer-query-selector": "off",
      // Bifrost commands carry an explicit `undefined`-typed payload (a required 2nd
      // arg), and our promises resolve `unknown` — the autofix strips needed args.
      "unicorn/no-useless-undefined": "off",
      // Expand genuine abbreviations, but allow the idioms it would wrongly mangle:
      // React props/refs and our domain `Ref` (a code reference), plus loop counters.
      "unicorn/prevent-abbreviations": [
        "error",
        {
          replacements: {
            props: false,
            ref: false,
            args: false,
            params: false,
            fn: false,
            db: false,
            env: false,
          },
          allowList: { Ref: true, Props: true },
        },
      ],
      // Components are PascalCase, everything else camelCase — allow both.
      "unicorn/filename-case": ["error", { cases: { camelCase: true, pascalCase: true } }],
    },
  },

  // SonarJS bug-catchers (duplicate branches, identical conditions, dead code, …).
  // The whole recommended suite is kept ON except these, each off for a reason:
  {
    ...sonarjs.configs.recommended,
    files: ["packages/**/*.{ts,tsx}"],
    ignores: ["packages/**/*.test.{ts,tsx}"],
    rules: {
      ...sonarjs.configs.recommended.rules,
      // Redundant with (and less precise than) regexp/no-super-linear-backtracking,
      // the rigorous ReDoS analyzer adopted earlier — this heuristic even flags
      // regexes that one proved safe (e.g. the markdown fence).
      "sonarjs/slow-regex": "off",
      // TODO/REVIEW markers are an allowed convention here (see CLAUDE.md self-flag).
      "sonarjs/todo-tag": "off",
      // SonarJS's own type/flow inference, less precise than TypeScript strict +
      // typescript-eslint, which already own null-safety and type checking here.
      // It false-flags TS-proven-safe code (e.g. a non-null string param read as
      // "might be null") — defer to the compiler, as we do for slow-regex above.
      "sonarjs/null-dereference": "off",
      "sonarjs/function-return-type": "off",
      "sonarjs/argument-type": "off",
    },
  },

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
    // Tests may cast freely (mocks, fixtures) — the no-cast rule is source-only.
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },

  // Test-quality rules: focused/skipped tests, duplicate titles, vacuous expects.
  { ...vitest.configs.recommended, files: ["packages/**/*.test.{ts,tsx}"] },

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
