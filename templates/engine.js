/* La Belle Histoire du Jour — moteur de mise en page déterministe.
   Entrée : window.BHJ.build(story, opts)
   story = { id, title, theme, text, origin: "fiction"|"reel", author?, mentionAuthor? }
   Retour : { ok, mode, slides, fontSize, error? }  — les slides sont dans #stage > .slide
   Règle d'or : aucun texte n'est jamais tronqué ni raccourci. Si l'histoire ne tient pas
   dans la limite de slides, on renvoie une erreur TOO_LONG (adaptation humaine requise). */
(function () {
  const NB = " ", NNB = " ";

  const SUN_MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M10 44 A22 22 0 0 1 54 44 Z" fill="var(--sun)"/>
    <g stroke="var(--sun-deep)" stroke-width="3.2" stroke-linecap="round">
      <line x1="32" y1="6" x2="32" y2="14"/><line x1="13" y1="14" x2="18" y2="20"/>
      <line x1="51" y1="14" x2="46" y2="20"/><line x1="4" y1="31" x2="11" y2="33"/>
      <line x1="60" y1="31" x2="53" y2="33"/></g>
    <line x1="4" y1="50" x2="60" y2="50" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="16" y1="57" x2="48" y2="57" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round" opacity=".45"/>
  </svg>`;
  const RAYS = `<svg class="rays" viewBox="0 0 200 200" aria-hidden="true"><g stroke="var(--sun)" stroke-width="5" stroke-linecap="round" fill="none">
    ${Array.from({ length: 12 }, (_, i) => { const a = (i * 30) * Math.PI / 180; const r1 = 62, r2 = i % 2 ? 84 : 96;
      return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`; }).join("")}
    <circle cx="100" cy="100" r="44" fill="var(--sun)" stroke="none"/></g></svg>`;
  const ICON_SPARK = `<svg viewBox="0 0 24 24"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" fill="currentColor"/></svg>`;
  const ICON_HEART = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.1 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.7 0 5.9 3.8 4.4 7.3C19.5 16.4 12 21 12 21z" fill="currentColor"/></svg>`;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /** Typographie française : espaces insécables avant ; : ! ? » et après «. */
  function frTypo(s) {
    return String(s ?? "")
      .replace(/\s+/g, " ").trim()
      .replace(/'/g, "’")
      .replace(/«\s*/g, "«" + NNB).replace(/\s*»/g, NNB + "»")
      .replace(/\s+([;!?])/g, NNB + "$1").replace(/\s+:/g, NB + ":")
      .replace(/(\d)\s+(%|€)/g, "$1" + NNB + "$2");
  }
  function paragraphs(text) {
    return String(text ?? "").replace(/\r/g, "").split(/\n\s*\n|\n/).map(frTypo).filter(Boolean);
  }
  function sentences(par) {
    const parts = par.split(/(?<=[.!?…](?:[   ]?»)?)\s+(?=[«"A-ZÀ-ÖØ-Þ0-9])/u);
    return parts.filter(Boolean);
  }
  const wordCount = (t) => String(t ?? "").trim().split(/\s+/).filter(Boolean).length;

  const stage = () => document.getElementById("stage");
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }

  function badge(story) {
    return story.origin === "fiction"
      ? `<span class="badge fiction">${ICON_SPARK}Histoire imaginée</span>`
      : `<span class="badge real">${ICON_HEART}Histoire vraie</span>`;
  }
  function brandbar(i, n) {
    return `<div class="brandbar">${SUN_MARK}<span class="name">La Belle Histoire du Jour</span>${n > 1 ? `<span class="count">${i}/${n}</span>` : ""}</div>`;
  }
  function dots(i, n) { return n > 1 ? `<span class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k + 1 === i ? "on" : ""}"></i>`).join("")}</span>` : ""; }
  function credit(story) {
    if (story.origin === "fiction")
      return "✦ Histoire imaginée : une fiction positive écrite par la rédaction de La Belle Histoire du Jour. Ce n’est pas un témoignage réel.";
    if (story.mentionAuthor && story.author) return `Histoire vraie partagée par ${esc(story.author)}, avec son accord.`;
    return "Histoire vraie partagée par une personne de la communauté, avec son accord.";
  }

  /* ---------- builders ---------- */
  function coverSlide(story) {
    return el(`<section class="slide cover grain">
      <div class="sun"></div>${RAYS}
      ${brandbar(1, 0)}
      <div class="body">
        ${story.theme ? `<div class="kicker">${esc(frTypo(story.theme))}</div>` : ""}
        <h1>${esc(frTypo(story.title || "Une belle histoire"))}</h1>
        <div class="rule"></div>
      </div>
      <div class="foot">${badge(story)}<span style="margin-left:auto" class="swipe">Glisse pour lire →</span></div>
    </section>`);
  }
  function narrSlide(story) {
    return el(`<section class="slide narr grain">
      ${brandbar(0, 0)}
      <div class="ttl">${esc(frTypo(story.title || ""))}</div>
      <div class="text"><div class="inner"></div></div>
      <div class="foot">${story.origin === "fiction" ? `<span>✦ Histoire imaginée</span>` : `<span>Histoire vraie</span>`}<span class="dotsHolder" style="margin-left:auto"></span></div>
    </section>`);
  }
  function endSlide(story) {
    return el(`<section class="slide end">
      <div class="halo"></div>
      ${brandbar(0, 0)}
      <div class="body">
        <div class="fin">Fin.</div>
        <h2>Et toi, quelle est ta belle histoire du jour${NNB}?</h2>
        <p class="how">Raconte-la nous en <b>message privé</b> ou en <b>commentaire</b>. Avec ton accord, elle pourrait faire sourire quelqu’un demain.</p>
      </div>
      <div class="credit">${credit(story)}</div>
    </section>`);
  }
  function singleSlide(story) {
    return el(`<section class="slide single grain">
      <div class="sun"></div>
      ${brandbar(1, 1)}
      <div class="body">
        ${story.theme ? `<div class="kicker">${esc(frTypo(story.theme))}</div>` : ""}
        <h1>${esc(frTypo(story.title || ""))}</h1>
        <div class="txt"></div>
        <div class="cta">Et toi, quelle est ta belle histoire du jour${NNB}? Raconte-la nous en message privé.</div>
      </div>
      <div class="foot">${badge(story)}</div>
    </section>`);
  }

  // Mesure fiable : pendant la mise en page, #stage porte la classe "measuring" (contenu aligné en haut),
  // sinon un contenu centré déborderait vers le haut sans être détecté.
  const overflows = (box) => box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;

  function fitCoverTitle(slide) {
    const h1 = slide.querySelector("h1"), body = slide.querySelector(".body");
    for (const fs of [124, 116, 108, 100, 92, 86, 80, 74, 68, 64]) {
      h1.style.fontSize = fs + "px";
      if (!overflows(body) && h1.scrollWidth <= h1.clientWidth + 1) return fs;
    }
    return 64;
  }

  /* Narration paginée pour une taille de police donnée. Retourne la liste des slides (non attachées). */
  function paginate(story, fs) {
    const pars = paragraphs(story.text);
    const out = [];
    let slide = narrSlide(story), first = true;
    stage().appendChild(slide);
    const box = () => slide.querySelector(".text");
    const inner = () => slide.querySelector(".inner");
    inner().style.fontSize = fs + "px";
    const fresh = () => { out.push(slide); slide = narrSlide(story); stage().appendChild(slide); inner().style.fontSize = fs + "px"; };

    for (const par of pars) {
      // Saut éditorial : si la page est déjà bien remplie et que le paragraphe entier ne tient pas, il passe à la page suivante.
      if (inner().childElementCount > 0) {
        const probe = document.createElement("p"); probe.textContent = par; inner().appendChild(probe);
        const fits = !overflows(box());
        const fill = inner().scrollHeight / box().clientHeight;
        probe.remove();
        if (!fits && fill > 0.6) fresh();
      }
      let p = document.createElement("p");
      if (first) { if (/^\p{L}/u.test(par)) p.className = "first"; first = false; }
      inner().appendChild(p);
      for (const s of sentences(par)) {
        const before = p.textContent;
        p.textContent = before ? before + " " + s : s;
        if (overflows(box())) {
          p.textContent = before;
          if (!before) p.remove();
          fresh();
          p = document.createElement("p"); inner().appendChild(p);
          p.textContent = s;
          if (overflows(box())) return null; // une phrase seule ne tient pas sur une page : taille trop grande
        }
      }
    }
    if (inner().childElementCount) out.push(slide); else slide.remove();
    return out;
  }

  function clear() { stage().innerHTML = ""; }

  function buildSingle(story) {
    for (const [tfs, fs] of [[84, 50], [78, 46], [72, 44], [66, 42], [60, 40], [56, 38]]) {
      clear();
      const s = singleSlide(story); stage().appendChild(s);
      s.querySelector("h1").style.fontSize = tfs + "px";
      const txt = s.querySelector(".txt"); txt.style.fontSize = fs + "px";
      paragraphs(story.text).forEach((par, i) => { const p = document.createElement("p"); if (!i && /^\p{L}/u.test(par)) p.className = "first"; p.textContent = par; txt.appendChild(p); });
      if (!overflows(s.querySelector(".body"))) return { ok: true, mode: "single", slides: 1, fontSize: fs };
    }
    return null;
  }

  function buildCarousel(story, maxSlides) {
    const maxNarr = maxSlides - 2;
    const sizes = [52, 48, 45, 42, 40, 38, 36, 34];
    const counts = {};
    for (const fs of sizes) { clear(); const r = paginate(story, fs); counts[fs] = r ? r.length : Infinity; }
    // Taille de référence 42px : on garde la plus grande taille qui n'ajoute pas de page.
    const base = counts[42];
    let chosen = null;
    if (base <= maxNarr) chosen = sizes.find((fs) => fs >= 42 && counts[fs] <= base) ?? 42;
    else chosen = sizes.find((fs) => fs < 42 && counts[fs] <= maxNarr) ?? null;
    if (chosen == null) { clear(); return { ok: false, error: "TOO_LONG", detail: `Le récit demande plus de ${maxNarr} slides de narration même en petite taille. Adaptation éditoriale humaine requise (aucune coupe automatique).` }; }

    clear();
    const narr = paginate(story, chosen);
    narr.forEach((n) => n.remove());
    const all = [coverSlide(story), ...narr, endSlide(story)];
    const N = all.length;
    all.forEach((s, k) => {
      stage().appendChild(s);
      const c = s.querySelector(".brandbar"); c.outerHTML = brandbar(k + 1, N);
      const holder = s.querySelector(".dotsHolder"); if (holder) holder.outerHTML = dots(k + 1, N);
      if (k > 0 && k < N - 1) {
        if (k < N - 2) { const more = document.createElement("span"); more.className = "cont"; more.textContent = "La suite →"; s.querySelector(".foot").insertBefore(more, s.querySelector(".foot .dots")); }
      }
    });
    fitCoverTitle(all[0]);
    return { ok: true, mode: "carousel", slides: N, fontSize: chosen };
  }

  async function build(story, opts = {}) {
    // Charger explicitement toutes les polices AVANT de mesurer (sinon mesure faite avec une police de secours).
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
    await document.fonts.ready;
    stage().classList.add("measuring");
    try { return await buildInner(story, opts); } finally { stage().classList.remove("measuring"); }
  }
  async function buildInner(story, opts) {
    const maxSlides = Math.min(opts.maxSlides || 10, 10);
    const singleMax = opts.singleMaxWords ?? 40;
    if (!String(story.text || "").trim()) return { ok: false, error: "EMPTY_TEXT" };
    if (wordCount(story.text) <= singleMax) { const r = buildSingle(story); if (r) return r; }
    return buildCarousel(story, maxSlides);
  }

  window.BHJ = { paginate, clear, overflows, build, frTypo, paragraphs, sentences, wordCount };
})();
