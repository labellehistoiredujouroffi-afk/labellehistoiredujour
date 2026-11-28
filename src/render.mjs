// Rendu des carrousels : story JSON -> JPEG 1080x1350 + caption.txt + manifest.json
// Usage : node src/render.mjs <story.json | -> <outDir> [--maxSlides=10] [--singleMaxWords=40]
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { buildCaption } from "./caption.mjs";
import { hueCss } from "./theme.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function renderStory(story, outDir, opts = {}, browser) {
  const own = !browser;
  browser ??= await launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(ROOT, "templates/post.html")).href);
  if (opts.hue) await page.addStyleTag({ content: hueCss(opts.hue) }); // teinte du jour
  const res = await page.evaluate(([s, o]) => window.BHJ.build(s, o), [story, opts]);
  await mkdir(outDir, { recursive: true });
  const files = [];
  if (res.ok) {
    const slides = await page.$$("#stage > .slide");
    for (let i = 0; i < slides.length; i++) {
      const f = `slide-${String(i + 1).padStart(2, "0")}.jpg`;
      await slides[i].screenshot({ path: path.join(outDir, f), type: "jpeg", quality: 92 });
      files.push(f);
    }
    // Contrôle qualité : aucune zone de texte ne doit déborder (texte coupé).
    res.overflow = await page.evaluate(() => { document.getElementById("stage").classList.add("measuring"); return [
      ...[...document.querySelectorAll(".slide .text, .slide .body")].filter((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1),
      ...[...document.querySelectorAll(".slide h1, .slide h2")].filter((h) => h.scrollWidth > h.clientWidth + 1),
    ].length; });
    if (res.overflow) { res.ok = false; res.error = "OVERFLOW"; }
  }
  await page.close();
  if (own) await browser.close();
  const manifest = { id: story.id, origin: story.origin, ...res, hue: opts.hue || 0, files, generatedAt: new Date().toISOString() };
  if (res.ok) {
    manifest.caption = buildCaption(story, { slides: files.length });
    await writeFile(path.join(outDir, "caption.txt"), manifest.caption);
  }
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function launch() {
  const exe = process.env.CHROME_PATH; // en local : chrome système ; en CI : chromium Playwright
  return chromium.launch(exe ? { executablePath: exe } : {});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, out] = process.argv.slice(2);
  const flags = Object.fromEntries(process.argv.slice(4).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, Number(v)]));
  const raw = src === "-" ? await new Promise((r) => { let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => r(d)); }) : await readFile(src, "utf8");
  const m = await renderStory(JSON.parse(raw), out, flags);
  console.log(JSON.stringify({ ok: m.ok, mode: m.mode, slides: m.files.length, fontSize: m.fontSize, error: m.error }));
  process.exit(m.ok ? 0 : 2);
}
