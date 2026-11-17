// Publication automatique des stories via l'API officielle Instagram (Graph API, content publishing).
// Variables : APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID, [GRAPH_VERSION], [TEST=1]
// Le Google Sheet décide du jour et du visuel (onglet Paramètres + Stories) ; ce script ne fait qu'exécuter.
const { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID } = process.env;
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v23.0"}`;
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

const s = await api("story");
if (s.skip) { console.log("Pas de story aujourd'hui :", s.reason); process.exit(0); }
console.log(`Story ${s.id} → ${s.image}`);
let stage = "création du conteneur";
try {
  const c = await graph(`${IG_USER_ID}/media`, { media_type: "STORIES", image_url: s.image });
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
