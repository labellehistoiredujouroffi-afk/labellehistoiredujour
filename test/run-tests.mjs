// Tests du moteur graphique (Tests 2, 3, 4 et 6 du cahier des charges).
import { renderStory, launch } from "../src/render.mjs";
import { readFile, readdir } from "node:fs/promises";
const b = await launch(); let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
for (const f of (await readdir("test")).filter((x) => x.endsWith(".json"))) {
  const s = JSON.parse(await readFile("test/" + f, "utf8"));
  const m = await renderStory(s, "out/" + s.id, {}, b);
  ok(m.ok, `${s.id} : rendu ${m.mode}, ${m.files.length} slide(s), ${m.fontSize}px, débordement=${m.overflow ?? "-"}`);
  if (m.ok) {
    ok(!/imaginée/i.test(m.caption), `${s.id} : aucune mention « Histoire imaginée »`);
    ok([...m.caption].length <= 2200, `${s.id} : légende ≤ 2200 caractères`);
  }
}
// Histoire géante : doit être refusée (TOO_LONG) et jamais coupée.
const huge = { id: "HUGE", title: "Test", origin: "reel", text: Array(400).fill("Une phrase de test assez longue pour remplir.").join(" ") };
const h = await renderStory(huge, "out/HUGE", {}, b);
ok(!h.ok && h.error === "TOO_LONG", "Récit trop long → TOO_LONG (aucune coupe automatique)");
await b.close();
process.exit(fails ? 1 : 0);
