import { anchorFor } from "../packages/runes/src/anchor";
import type { WalkthroughSpec, WalkthroughStep } from "../packages/runes/src/spec";

export const PR_FILES_URL = "https://github.com/alex-yanchenko/reviewer-groups/pull/8/files";
export const PR_HEAD_SHA = "c7ef70c64723686ca29294644fda21a53e47abb7";

const REVIEWERS_FILE = "src/content/githubReviewers.ts";
const PICKER_FILE = "src/popup/PeoplePicker.tsx";

type StepInput = Omit<WalkthroughStep, "anchor" | "lines"> & { start: number; end: number };

const onAddedLines = ({ start, end, ...step }: StepInput): WalkthroughStep => ({
  ...step,
  anchor: anchorFor(step.file),
  lines: { side: "R", start, end },
});

const steps: WalkthroughStep[] = [
  {
    id: "tooltip-states",
    group: "Reading the review",
    title: "The tooltip names the review",
    file: REVIEWERS_FILE,
    start: 123,
    end: 132,
    body: "<p>Each row in GitHub's Reviewers box carries tooltips. <code>reviewStateOf</code> tests their text against three patterns and returns the first state that matches: <em>approved</em>, <em>changes requested</em> or <em>commented</em>.</p>",
    detail:
      "<p>The tooltip text is the signal, not the row's icons: a Copilot row also carries check icons from its review-effort menu.</p>",
    suggestions: ["What if GitHub rewords a tooltip?", "Why not read the row's icons?"],
  },
  {
    id: "read-states",
    group: "Reading the review",
    title: "One lookup per page",
    file: REVIEWERS_FILE,
    start: 134,
    end: 145,
    body: "<p><code>readReviewStates</code> finds the Reviewers box through the review-request form, reads every reviewer row, and keys each state by the lower-cased login. Off the Conversation tab there is no box, so the map is empty.</p>",
    suggestions: ["Which login wins if a row has two links?"],
  },
  {
    id: "merge-candidates",
    group: "Reading the review",
    title: "Candidates carry the state",
    file: REVIEWERS_FILE,
    start: 163,
    end: 167,
    body: "<p><code>searchReviewerCandidates</code> reads the page once per search and hands the map to <code>describeEntry</code>, which sets <code>reviewState</code> on each candidate, or <code>null</code> when the person has not reviewed.</p>",
  },
  {
    id: "badges",
    group: "Showing it",
    title: "A badge for each review",
    file: PICKER_FILE,
    start: 4,
    end: 8,
    body: "<p><code>REVIEW_BADGES</code> gives each state its label and badge style. <em>approved</em> reuses the done style and <em>changes requested</em> the warning style.</p>",
  },
  {
    id: "pending-first",
    group: "Showing it",
    title: "A pending request wins",
    file: PICKER_FILE,
    start: 67,
    end: 71,
    body: "<p>A person with a pending request still shows <em>requested</em>. Only when no request is pending does the row show the review they already left.</p>",
    suggestions: ["Does re-requesting clear the badge?"],
  },
  {
    id: "css-modules",
    group: "Toolchain",
    title: "Stylesheet imports under TypeScript 6",
    file: "src/css.d.ts",
    start: 1,
    end: 1,
    body: "<p>TypeScript 6 checks side-effect imports, so one declaration lets the popup and the screenshot scenes import <code>.css</code> files.</p>",
  },
  {
    id: "dependabot-groups",
    group: "Toolchain",
    title: "One weekly update per ecosystem",
    file: ".github/dependabot.yml",
    start: 8,
    end: 9,
    body: "<p>Dependabot now batches every npm update, majors included, into one weekly pull request. GitHub Actions get the same treatment.</p>",
  },
].map((step) => onAddedLines(step));

export const reviewerGroupsSpec = (generatedAt: string): WalkthroughSpec => ({
  version: 1,
  pr: {
    url: "https://github.com/alex-yanchenko/reviewer-groups/pull/8",
    owner: "alex-yanchenko",
    repo: "reviewer-groups",
    number: 8,
    title: "fix: show the review each person already left; upgrade to TypeScript 6 and eslint 10",
    headSha: PR_HEAD_SHA,
  },
  generatedAt,
  depth: "heavy",
  overview:
    "<p>Shows the review each person already left next to their name in the reviewer popup. GitHub's reviewer search answers a fulfilled request the same way as no request, so the state is read from the tooltips in the page's Reviewers box. The toolchain moves to TypeScript 6 and eslint 10.</p>",
  steps,
  coverage: {
    significant: [REVIEWERS_FILE, PICKER_FILE, "src/messages.ts", "src/css.d.ts", ".github/dependabot.yml"],
    uncovered: ["src/messages.ts"],
  },
});

export const ASK = {
  file: REVIEWERS_FILE,
  fromLine: 123,
  toLine: 127,
  question: "What if a row has two of these tooltips?",
  answer:
    "The first pattern in `REVIEW_STATE_TOOLTIPS` that any tooltip matches wins, because `find` walks the list in order: approved, then changes requested, then commented.\n\n" +
    "A row with `mona approved these changes` and `Re-request review` reads as **approved**: `Re-request review` matches none of the three patterns (src/content/githubReviewers.ts:131).",
  suggestions: ["What if GitHub rewords a tooltip?", "Is the login match case-sensitive?"],
};
