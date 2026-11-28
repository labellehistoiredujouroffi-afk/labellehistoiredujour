// Publication automatique des stories via l'API officielle Instagram (Graph API, content publishing).
// Variables : APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID, [GRAPH_VERSION], [TEST=1]
// Le Google Sheet décide du jour et du visuel (onglet Paramètres + Stories) ; ce script ne fait qu'exécuter.
// Le visuel est régénéré le jour même avec la teinte du jour (fond jamais exactement de la même couleur).
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { hueFor, hueCss, parisDate } from "./theme.mjs";
const { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID } = process.env;
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v27.0"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(action, payload = {}) {
  const r = await fetch(APPS_SCRIPT_URL, { method: "POST", redirect: "follow", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: APPS_SCRIPT_TOKEN, action, test: process.env.TEST === "1", ...payload }) });
  const j = JSON.parse(await r.text());
  if (!j.ok) throw new Error(`Apps Script ${action} : ${j.error} ${j.message || ""}`);
  return j;
}
async function graph(path, params, method = "POST") {
  const qs = new URLSearchParams({ ...params, access_token: IG_ACCESS_TOKEN });
  const r = await fetch(`${GRAPH}/${path}?${qs}`, { method });
  const j = await r.json();
  if (j.error) throw new Error(`Instagram API : ${j.error.message} (code ${j.error.code})`);
  return j;
}

/** Régénère le visuel de la story avec la teinte du jour, le met en ligne (GitHub Pages) et renvoie son URL. */
async function dailyVisual(id) {
  const { launch } = await import("./render.mjs");
  const date = parisDate(), hue = hueFor(date);
  const index = JSON.parse(await readFile("docs/stories/index.json", "utf8"));
  const d = index.find((x) => x.id === id); if (!d) throw new Error("story absente de index.json");
  const file = `stories/daily/${date}.jpg`;
  await mkdir("docs/stories/daily", { recursive: true });
  const b = await launch(); const page = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(new URL("../templates/story.html", import.meta.url).href);
  if (hue) await page.addStyleTag({ content: hueCss(hue) });
  const r = await page.evaluate((x) => window.renderStory(x), d);
  if (!r.ok) { await b.close(); throw new Error(r.error); }
  await (await page.$(".story")).screenshot({ path: "docs/" + file, type: "jpeg", quality: 92 });
  await b.close();
  const git = (...a) => execFileSync("git", a, { stdio: "inherit" });
  git("config", "user.name", "belle-histoire-bot"); git("config", "user.email", "bot@users.noreply.github.com");
  git("add", "docs/stories/daily"); git("commit", "-m", `Story du ${date}`); git("pull", "--rebase", "-q"); git("push");
  const url = `${process.env.PAGES_BASE_URL.replace(/\/$/, "")}/${file}`;
  for (let i = 0; i < 40; i++) {
    if (await fetch(url, { method: "HEAD" }).then((x) => x.ok && /image\/jpeg/.test(x.headers.get("content-type") || "")).catch(() => false)) return url;
    await sleep(15000);
  }
  throw new Error("visuel du jour pas encore en ligne");
}

if (!IG_ACCESS_TOKEN) { console.log("Secret IG_ACCESS_TOKEN absent : aucune story publiée (rien n'est modifié dans le Sheet)."); process.exit(0); }
// Contrôle du jeton (lecture seule) : on vérifie qu'il ouvre bien le bon compte Instagram.
try { const me = await graph(IG_USER_ID, { fields: "username" }, "GET"); console.log(`Jeton valide : connecté à @${me.username}`); }
catch (e) { console.error("Jeton Instagram invalide ou expiré :", e.message); process.exit(1); }
const s = await api("story");
if (s.skip) { console.log("Pas de story aujourd'hui :", s.reason); process.exit(0); }
let image = s.image;
try { image = await dailyVisual(s.id); } catch (e) { console.log("Visuel du jour non régénéré, visuel standard utilisé :", e.message); }
console.log(`Story ${s.id} → ${image}`);
let stage = "création du conteneur";
try {
  const c = await graph(`${IG_USER_ID}/media`, { media_type: "STORIES", image_url: image });
  stage = "traitement du média";
  for (let i = 0; i < 20; i++) {
    const st = await graph(c.id, { fields: "status_code" }, "GET");
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error("Statut du média : " + st.status_code);
    await sleep(5000);
  }
  stage = "publication";
  const p = await graph(`${IG_USER_ID}/media_publish`, { creation_id: c.id });
  await api("storyPublished", { id: s.id, mediaId: p.id });
  console.log("Story publiée :", p.id);
} catch (e) {
  // Aucune relance automatique : la story passe « Erreur – à vérifier ».
  await api("storyFailed", { id: s.id, error: `[${stage}] ${e.message}` }).catch(() => {});
  console.error(e.message);
  process.exit(1);
}
