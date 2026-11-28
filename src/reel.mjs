// Reels automatiques : une histoire qui s'écrit à l'écran, avec une musique douce.
//   node src/reel.mjs render [--id=F001] [--out=dir]   -> fabrique la vidéo (docs/reels/<date>-<id>/reel.mp4 + cover.jpg)
//   node src/reel.mjs publish                          -> attend la mise en ligne puis publie le Reel (Reel d'essai par défaut)
// Variables : IG_ACCESS_TOKEN, IG_USER_ID, PAGES_BASE_URL, [FORCE=1] (ignore l'interrupteur reels/config.json)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { buildCaption } from "./caption.mjs";
import { hueFor, hueCss, parisDate } from "./theme.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = "/tmp/bhj-reel.json";
const FPS = 30;
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const json = async (f, d) => JSON.parse(await readFile(path.join(ROOT, f), "utf8").catch(() => JSON.stringify(d)));

/** Choisit l'histoire : jamais deux fois la même en reel ; choix varié mais reproductible selon la date. */
async function pick(date) {
  const all = await json("stories/fictions-v2.json", []);
  const log = await json("reels/log.json", []);
  const used = new Set(log.map((x) => x.id));
  if (args.id) return all.find((s) => s.id === args.id);
  const pool = all.filter((s) => !used.has(s.id));
  const list = pool.length ? pool : all;
  return list[hash(date) % list.length];
}

export async function renderReel(story, outDir, { hue = 0, music } = {}) {
  await mkdir(outDir, { recursive: true });
  const exe = process.env.CHROME_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(ROOT, "templates/reel.html")).href);
  if (hue) await page.addStyleTag({ content: hueCss(hue) });
  const info = await page.evaluate((s) => window.reelSetup(s), story);
  if (!info.ok) { await browser.close(); throw new Error(`${story.id} : ${info.error}`); }
  const frames = Math.ceil(info.duration * FPS);
  const silent = path.join(outDir, "video.mp4");
  // Images envoyées une à une à ffmpeg (aucun fichier intermédiaire).
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), silent], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c ? rej(new Error("ffmpeg vidéo " + c)) : res())));
  const reel = await page.$("#reel");
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.reelFrame(t), i / FPS);
    const buf = await reel.screenshot({ type: "jpeg", quality: 88 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i === Math.round((info.duration - 5.0) * FPS)) await writeFile(path.join(outDir, "cover.jpg"), buf); // texte complet + « Fin. »
  }
  ff.stdin.end(); await done; await browser.close();
  // Musique : fondu d'entrée/sortie, volume doux.
  const out = path.join(outDir, "reel.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", music, "-filter_complex",
    `[1:a]atrim=0:${info.duration.toFixed(2)},afade=t=in:d=1.2,afade=t=out:st=${(info.duration - 2.5).toFixed(2)}:d=2.5,volume=0.8[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-shortest", "-movflags", "+faststart", out]);
  await rm(silent);
  return { duration: info.duration, fontSize: info.fontSize, file: out };
}
const run = (cmd, a) => new Promise((res, rej) => spawn(cmd, a, { stdio: "inherit" }).on("close", (c) => (c ? rej(new Error(cmd + " " + c)) : res())));

async function render() {
  const cfg = await json("reels/config.json", { active: false });
  if (!cfg.active && process.env.FORCE !== "1" && !args.out) { console.log("Reels désactivés (reels/config.json → active: false)."); await writeFile(STATE, "{}"); return; }
  const date = parisDate();
  const story = await pick(date);
  const tracks = (await readdir(path.join(ROOT, "music"))).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  const music = path.join(ROOT, "music", tracks[hash(date + story.id) % tracks.length]);
  const rel = args.out || `docs/reels/${date}-${story.id}`;
  const r = await renderReel({ ...story, origin: "fiction" }, path.join(ROOT, rel), { hue: hueFor(date), music });
  const caption = buildCaption({ ...story, origin: "fiction" }, { slides: 1 });
  await writeFile(path.join(ROOT, rel, "caption.txt"), caption);
  await writeFile(STATE, JSON.stringify({ date, id: story.id, dir: rel.replace(/^docs\//, ""), caption, music: path.basename(music) }));
  console.log(`Reel ${story.id} : ${r.duration.toFixed(1)} s, texte ${r.fontSize}px, musique ${path.basename(music)}, teinte ${hueFor(date)}°`);
}

async function graph(p, params, method = "POST") {
  const qs = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  const r = await fetch(`https://graph.facebook.com/${process.env.GRAPH_VERSION || "v27.0"}/${p}?${qs}`, { method });
  const j = await r.json();
  if (j.error) throw new Error(`Instagram API : ${j.error.message} (code ${j.error.code}${j.error.error_subcode ? "/" + j.error.error_subcode : ""})`);
  return j;
}

async function publish() {
  const st = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
  if (!st.id) return;
  const cfg = await json("reels/config.json", {});
  const { IG_USER_ID, PAGES_BASE_URL } = process.env;
  const base = `${PAGES_BASE_URL.replace(/\/$/, "")}/${st.dir}`;
  const video = `${base}/reel.mp4`, cover = `${base}/cover.jpg`;
  for (let i = 0; ; i++) {
    const ok = await fetch(video, { method: "HEAD" }).then((r) => r.ok && /video\/mp4/.test(r.headers.get("content-type") || "")).catch(() => false);
    if (ok) break;
    if (i > 40) throw new Error("Vidéo toujours inaccessible après 10 minutes : " + video);
    await new Promise((r) => setTimeout(r, 15000));
  }
  const params = { media_type: "REELS", video_url: video, cover_url: cover, caption: st.caption };
  let trial = cfg.trial !== false, container;
  try {
    container = await graph(`${IG_USER_ID}/media`, trial ? { ...params, trial_params: JSON.stringify({ graduation_strategy: cfg.graduation || "SS_PERFORMANCE" }) } : params);
  } catch (e) {
    if (!trial || !cfg.fallbackNormal) throw e;
    console.log("Reel d'essai refusé par Instagram (" + e.message + ") → publication en Reel classique.");
    trial = false; container = await graph(`${IG_USER_ID}/media`, params);
  }
  for (let i = 0; i < 60; i++) { // traitement vidéo : jusqu'à 10 minutes
    const s = await graph(container.id, { fields: "status_code,status" }, "GET");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("Traitement vidéo : " + (s.status || s.status_code));
    await new Promise((r) => setTimeout(r, 10000));
  }
  const p = await graph(`${IG_USER_ID}/media_publish`, { creation_id: container.id });
  const log = await json("reels/log.json", []);
  log.push({ date: st.date, id: st.id, mediaId: p.id, trial, music: st.music });
  await writeFile(path.join(ROOT, "reels/log.json"), JSON.stringify(log, null, 1));
  console.log(`Reel ${trial ? "d'essai " : ""}publié : ${st.id} → ${p.id}`);
}

/** Supprime les vidéos de plus de 30 jours (Instagram garde sa copie). */
async function cleanup() {
  const base = path.join(ROOT, "docs/reels"); const limit = Date.now() - 30 * 864e5;
  for (const d of await readdir(base).catch(() => [])) { const t = Date.parse(d.slice(0, 10)); if (t && t < limit) await rm(path.join(base, d), { recursive: true }); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  try {
    if (cmd === "render") { await cleanup(); await render(); }
    else if (cmd === "publish") await publish();
    else throw new Error("Commande inconnue (render | publish)");
  } catch (e) { console.error(e.message); process.exit(1); }
}
