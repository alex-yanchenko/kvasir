import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { CAPTURE_VIEWPORT, type Captures } from "./capture";

interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProductView {
  capture: keyof Captures;
  crop: Crop;
  width: number;
}

interface Stage {
  width: number;
  height: number;
  pad: number;
  gap: number;
  pitch: number;
}

const ADDRESS_BAR = "github.com/alex-yanchenko/reviewer-groups/pull/8/files";
const REPO_ADDRESS = "github.com/alex-yanchenko/kvasir";
const PITCH = "Guided walkthroughs of GitHub pull requests, written by your Claude Code session.";

const WHOLE_TAB: Crop = { x: 0, y: 0, ...CAPTURE_VIEWPORT };

const STORE_STAGE: Stage = { width: 1280, height: 800, pad: 56, gap: 44, pitch: 300 };

const STORE_SHOTS: { file: string; headline: string; caption: string; view: ProductView }[] = [
  {
    file: "store-walkthrough.png",
    headline: "A guided tour of the diff",
    caption: "Each step marks the lines it explains, right on the Files tab.",
    view: { capture: "step", crop: WHOLE_TAB, width: 824 },
  },
  {
    file: "store-outline.png",
    headline: "The whole change, in order",
    caption: "Steps grouped by phase. Jump to any of them from the outline.",
    view: { capture: "outline", crop: WHOLE_TAB, width: 824 },
  },
  {
    file: "store-ask.png",
    headline: "Select code. Ask.",
    caption: "Your Claude Code session answers in place and links the lines it cites.",
    view: { capture: "ask", crop: WHOLE_TAB, width: 824 },
  },
];

const HERO_STAGE: Stage = { width: 1600, height: 900, pad: 80, gap: 64, pitch: 430 };
const HERO_VIEW: ProductView = { capture: "step", crop: WHOLE_TAB, width: 946 };

const SOCIAL_STAGE: Stage = { width: 1280, height: 640, pad: 80, gap: 80, pitch: 460 };
const SOCIAL_VIEW: ProductView = {
  capture: "ask",
  crop: { x: 512, y: 160, width: 688, height: 620 },
  width: 580,
};

const PROMO_SIZE = { width: 440, height: 280 };

type Images = Record<keyof Captures, string>;

const dataUrl = async (file: string): Promise<string> =>
  `data:image/png;base64,${(await readFile(file)).toString("base64")}`;

async function loadImages(captures: Captures): Promise<Images> {
  return {
    step: await dataUrl(captures.step),
    outline: await dataUrl(captures.outline),
    ask: await dataUrl(captures.ask),
  };
}

async function whiteMark(): Promise<string> {
  const svg = await readFile(
    path.resolve(import.meta.dirname, "../packages/extension/icons/kvasir.svg"),
    "utf8",
  );
  return svg.replace(/<!--[\s\S]*?-->/, "").replace(/fill="#[0-9a-f]{6}"/i, 'fill="#ffffff"');
}

const htmlPage = (css: string, size: { width: number; height: number }, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
  `<body style="--width:${size.width}px;--height:${size.height}px">${body}</body></html>`;

const stageStyle = (stage: Stage): string =>
  `--pad:${stage.pad}px;--gap:${stage.gap}px;--pitch:${stage.pitch}px`;

function productWindow(view: ProductView, images: Images): string {
  const scale = view.width / view.crop.width;
  const height = Math.round(view.crop.height * scale);
  const image =
    `<img alt="" src="${images[view.capture]}" style="width:${CAPTURE_VIEWPORT.width * scale}px;` +
    `left:${-view.crop.x * scale}px;top:${-view.crop.y * scale}px">`;
  return (
    `<div class="window"><div class="chrome"><i></i><i></i><i></i><span>${ADDRESS_BAR}</span></div>` +
    `<div class="view" style="width:${view.width}px;height:${height}px">${image}</div></div>`
  );
}

async function render(page: Page, html: string, size: { width: number; height: number }, file: string) {
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file });
}

export async function composeImages(captures: Captures, outDir: string): Promise<string[]> {
  const css = await readFile(path.resolve(import.meta.dirname, "frame.css"), "utf8");
  const mark = `<span class="mark">${await whiteMark()}</span>`;
  const images = await loadImages(captures);
  const browser = await chromium.launch({ channel: "chromium", args: ["--headless=new"] });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const written: string[] = [];
  const save = async (name: string, size: { width: number; height: number }, body: string) => {
    const file = path.join(outDir, name);
    await render(page, htmlPage(css, size, body), size, file);
    written.push(file);
  };
  try {
    for (const shot of STORE_SHOTS) {
      await save(
        shot.file,
        STORE_STAGE,
        `<main class="stage" style="${stageStyle(STORE_STAGE)}"><div class="pitch">${mark}` +
          `<h1>${shot.headline}</h1><p>${shot.caption}</p></div>${productWindow(shot.view, images)}</main>`,
      );
    }
    await save(
      "hero.png",
      HERO_STAGE,
      `<main class="stage title" style="${stageStyle(HERO_STAGE)}"><div class="pitch">${mark}` +
        `<h1>Kvasir</h1><p>${PITCH}</p></div>${productWindow(HERO_VIEW, images)}</main>`,
    );
    await save(
      "social.png",
      SOCIAL_STAGE,
      `<main class="stage title" style="${stageStyle(SOCIAL_STAGE)}"><div class="pitch">${mark}` +
        `<h1>Kvasir</h1><p>${PITCH}</p><div class="repo">${REPO_ADDRESS}</div></div>` +
        `${productWindow(SOCIAL_VIEW, images)}</main>`,
    );
    await save(
      "promo-small.png",
      PROMO_SIZE,
      `<main class="promo">${mark}<div><h1>Kvasir</h1><p>Guided tours of GitHub pull requests, from Claude Code.</p></div></main>`,
    );
  } finally {
    await browser.close();
  }
  return written;
}
