// Pipeline quotidien exécuté par GitHub Actions.
//   node src/daily.mjs prepare  -> réserve l'histoire (Apps Script), génère les visuels dans docs/posts/<date>-<id>/
//   node src/daily.mjs notify   -> vérifie que les images sont en ligne puis les déclare « Visuels prêts »
// Variables : APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, PAGES_BASE_URL, [DATE], [TEST=1]
import { writeFile, readFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { renderStory } from "./render.mjs";

const { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, PAGES_BASE_URL } = process.env;
const STATE = "/tmp/bhj-state.json";
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());

async function api(action, payload = {}) {
  const r = await fetch(APPS_SCRIPT_URL, { method: "POST", redirect: "follow", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: APPS_SCRIPT_TOKEN, action, test: process.env.TEST === "1", ...payload }) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error(`Réponse Apps Script illisible (${r.status}) : ${txt.slice(0, 200)}`); }
  if (!j.ok) throw new Error(`Apps Script ${action} : ${j.error} ${j.message || ""}`);
  return j;
}

async function prepare() {
  const date = process.env.DATE || today();
  const s = await api("prepare", { date });
  if (s.skip) { console.log("Rien à préparer :", s.reason); await writeFile(STATE, JSON.stringify({ skip: true })); return; }
  const dir = `posts/${date}-${s.id}`;
  const m = await renderStory(s, path.join("docs", dir), { maxSlides: 10, singleMaxWords: Number(process.env.SINGLE_MAX_WORDS || 40) });
  if (!m.ok) {
    await api("renderFailed", { date, id: s.id, error: m.error, detail: m.detail || "" });
    throw new Error(`Génération impossible pour ${s.id} : ${m.error}`);
  }
  const urls = m.files.map((f) => `${PAGES_BASE_URL.replace(/\/$/, "")}/${dir}/${f}`);
  await writeFile(STATE, JSON.stringify({ date, id: s.id, urls, caption: m.caption }));
  console.log(`${s.id} (${s.origin}) → ${m.files.length} image(s), police ${m.fontSize}px`);
}

async function notify() {
  const st = JSON.parse(await readFile(STATE, "utf8"));
  if (st.skip) return;
  // Attendre la mise en ligne GitHub Pages (Instagram exige des URL publiques accessibles).
  for (let i = 0; i < 40; i++) {
    const ok = (await Promise.all(st.urls.map((u) => fetch(u, { method: "HEAD" }).then((r) => r.ok && /image\/jpeg/.test(r.headers.get("content-type") || "")).catch(() => false)))).every(Boolean);
    if (ok) { await api("rendered", st); console.log("Visuels en ligne et déclarés prêts."); return; }
    await new Promise((r) => setTimeout(r, 15000));
  }
  await api("renderFailed", { date: st.date, id: st.id, error: "IMAGE_UNREACHABLE", detail: st.urls[0] });
  throw new Error("Images toujours inaccessibles après 10 minutes");
}

/** Supprime les visuels de plus de 45 jours (Instagram conserve sa propre copie). */
async function cleanup() {
  const base = "docs/posts"; const limit = Date.now() - 45 * 864e5;
  for (const d of await readdir(base).catch(() => [])) {
    const t = Date.parse(d.slice(0, 10)); if (t && t < limit) await rm(path.join(base, d), { recursive: true });
  }
}

const cmd = process.argv[2];
try {
  if (cmd === "prepare") { await cleanup(); await prepare(); }
  else if (cmd === "notify") await notify();
  else throw new Error("Commande inconnue");
} catch (e) { console.error(e.message); process.exit(1); }
