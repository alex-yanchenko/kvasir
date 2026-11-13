import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const iconsDir = path.resolve(import.meta.dirname, "../packages/extension/icons");
const ICON_SIZES = [16, 32, 48, 128] as const;

async function rasterizeAppIcon(): Promise<Map<number, Buffer>> {
  const svg = await readFile(path.join(iconsDir, "kvasir-icon.svg"), "utf8");
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const browser = await chromium.launch({ channel: "chromium", args: ["--headless=new"] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 400, height: 400 } });
    const rendered = new Map<number, Buffer>();
    for (const size of ICON_SIZES) {
      await page.setContent(
        `<html><body style="margin:0;background:transparent">` +
          `<img alt="" src="${source}" width="${size}" height="${size}" style="display:block"></body></html>`,
        { waitUntil: "load" },
      );
      rendered.set(size, await page.locator("img").screenshot({ omitBackground: true }));
    }
    return rendered;
  } finally {
    await browser.close();
  }
}

const rendered = await rasterizeAppIcon();
for (const [size, png] of rendered) {
  await writeFile(path.join(iconsDir, `icon-${size}.png`), png);
}
console.log(`wrote ${rendered.size} icons to ${path.relative(process.cwd(), iconsDir)}`);
