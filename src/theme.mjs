// Variation de teinte : chaque jour, les fonds (posts, stories, reels) changent légèrement de couleur.
// Même identité, jamais exactement la même teinte deux jours de suite. Déterministe : une date = une teinte.
export function hueFor(dateStr) {
  const day = Math.floor(Date.parse(String(dateStr).slice(0, 10) + "T12:00:00Z") / 864e5);
  if (!Number.isFinite(day)) return 0;
  return ((day * 11) % 27) - 16; // de -16° à +10° (reste dans les tons chauds), décalage de 11° d'un jour à l'autre
}

/** CSS à injecter dans la page avant la capture. */
export function hueCss(deg) {
  return deg ? `html { filter: hue-rotate(${deg}deg); }` : "";
}

export const parisDate = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
