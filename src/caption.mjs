// Générateur de légendes Instagram — déterministe (aucune IA, aucun coût).
// La même histoire produit toujours la même légende ; les formulations varient d'une histoire à l'autre.

const INTROS = [
  "Une petite histoire pour éclairer ta journée ☀️",
  "Ce soir, une histoire qui fait du bien ☀️",
  "La belle histoire du jour ☀️",
  "Prends deux minutes : cette histoire vaut le détour ☀️",
  "Un petit rayon de soleil pour ta journée ☀️",
];
const OUTROS = [
  "Et toi, quelle est ta belle histoire du jour ? Raconte-la nous en message privé ou en commentaire 💌",
  "Quelqu'un t'a fait sourire récemment ? Raconte-le nous en DM 💌",
  "Toi aussi, tu as vécu un petit moment comme celui-ci ? Écris-nous en message privé 💌",
  "Ton histoire pourrait donner le sourire à quelqu'un. Envoie-la nous en DM 💌",
];
const BASE_TAGS = ["#labellehistoiredujour", "#bellehistoire", "#bonnesnouvelles"];
const THEME_TAGS = {
  solidarite: ["#solidarite", "#entraide"], entraide: ["#entraide"], nature: ["#nature"], ecole: ["#ecole", "#education"],
  education: ["#education"], famille: ["#famille"], voisinage: ["#voisinage", "#viedequartier"], animaux: ["#animaux"],
  travail: ["#travail", "#bienveillance"], sport: ["#sport", "#espritdequipe"], musique: ["#musique"], cuisine: ["#cuisine", "#partage"],
  generations: ["#generations", "#transmission"], amitie: ["#amitie"], deuil: ["#memoire", "#douceur"], handicap: ["#inclusion"],
  accessibilite: ["#inclusion"], ecologie: ["#ecologie"], mer: ["#mer"], montagne: ["#montagne"], art: ["#art", "#creativite"],
  lecture: ["#lecture", "#livres"], bibliotheque: ["#lecture", "#bibliotheque"], rugby: ["#rugby", "#espritdequipe"], velo: ["#velo"],
  voyage: ["#voyage"], amour: ["#amour", "#couple"], gentillesse: ["#gentillesse", "#bienveillance"], science: ["#science"], medecine: ["#soignants"], commerce: ["#commercedeproximite"], benevolat: ["#benevolat"],
};
const strip = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function firstSentence(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const m = t.match(/^.*?[.!?…](?:\s?»)?(?=\s|$)/u);
  return (m ? m[0] : t).trim();
}

/**
 * @param {{id:string,title:string,theme?:string,angle?:string,text:string,origin:'fiction'|'reel',author?:string,mentionAuthor?:boolean,authorHandle?:string}} story
 * @param {{slides:number}} render
 */
export function buildCaption(story, render = { slides: 1 }) {
  const h = hash(story.id || story.title);
  const intro = INTROS[h % INTROS.length];
  const outro = OUTROS[(h >>> 3) % OUTROS.length];
  const hook = firstSentence(story.text);
  const swipe = render.slides > 1 ? `\n\n👉 Glisse pour lire l'histoire en entier (${render.slides} images).` : "";

  let origin;
  if (story.origin === "fiction") {
    origin = "";
  } else if (story.mentionAuthor && (story.authorHandle || story.author)) {
    origin = `💛 Histoire vraie, partagée par ${story.authorHandle ? story.authorHandle : story.author} avec son accord. Merci !`;
  } else {
    origin = "💛 Histoire vraie, partagée par une personne de notre communauté avec son accord. Merci !";
  }

  const themeKeys = [strip(story.theme), strip(story.angle)].filter(Boolean);
  const tags = [...BASE_TAGS];
  for (const k of themeKeys) for (const t of THEME_TAGS[k] || []) if (!tags.includes(t)) tags.push(t);
  if (story.origin !== "fiction") tags.push("#histoirevraie");

  const caption = `${intro}\n\n« ${story.title} »\n\n${hook}${swipe}${origin ? `\n\n${origin}` : ""}\n\n${outro}\n\n${tags.slice(0, 8).join(" ")}`;
  if ([...caption].length > 2200) throw new Error("CAPTION_TOO_LONG");
  return caption;
}
