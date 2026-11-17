// Génère tout le catalogue de stories (1080x1920) + stories/index.json (lu par l'Apps Script pour la rotation).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { launch } from "./render.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || path.join(ROOT, "site/stories");
const cat = JSON.parse(await readFile(path.join(ROOT, "stories/catalog.json"), "utf8"));
await mkdir(out, { recursive: true });
const b = await launch(); const page = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(pathToFileURL(path.join(ROOT, "templates/story.html")).href);
const index = []; let k = 0;
for (const [type, t] of Object.entries(cat.types)) t.phrases.forEach((text, i) => cat.variants.forEach((variant, j) => {
  // Rotation des visuels : chaque phrase n'utilise pas toujours le même fond.
  index.push({ id: `S-${type}-${i + 1}-${variant}`, type, text, kicker: t.kicker, variant });
}));
for (const s of index) {
  const r = await page.evaluate((d) => window.renderStory(d), { ...s, cta: cat.cta });
  if (!r.ok) throw new Error(`${s.id}: ${r.error}`);
  s.file = `${s.id}.jpg`;
  await (await page.$(".story")).screenshot({ path: path.join(out, s.file), type: "jpeg", quality: 92 });
  k++;
}
await writeFile(path.join(out, "index.json"), JSON.stringify(index, null, 2));
await b.close();
console.log(`${k} stories générées dans ${out}`);
