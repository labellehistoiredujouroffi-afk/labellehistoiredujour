# La Belle Histoire du Jour — moteur de publication

Pipeline 100 % gratuit et déterministe (aucune IA payante) :

```
16:00  GitHub Actions ──prepare──▶ Apps Script (Google Sheet) : choisit + réserve l'histoire (verrou anti-doublon)
         │ rend les slides HTML/CSS → JPEG 1080×1350 (Playwright), génère la légende
         │ publie les images sur GitHub Pages (docs/posts/…)
         └──rendered──▶ Apps Script : statut « Visuels prêts »
18:30  Make ──next──▶ Apps Script : passe en « Programmée », renvoie URLs + légende
         └─▶ Instagram (photo ou carrousel) ──published / failed──▶ Apps Script
Stories : Make (12:15, jours réglés dans Paramètres) ──story──▶ Apps Script ─▶ Instagram Story
```

| Dossier | Contenu |
|---|---|
| `templates/` | Identité graphique (`brand.css`), carrousel (`post.html` + `engine.js`), stories (`story.html`) |
| `src/render.mjs` | Story JSON → JPEG + `caption.txt` + `manifest.json` |
| `src/caption.mjs` | Générateur de légendes |
| `src/render-stories.mjs` | Catalogue de 36 stories (`stories/catalog.json`) |
| `src/daily.mjs` | Étape quotidienne GitHub Actions |
| `apps-script/Code.gs` | Cerveau du Google Sheet (sélection, statuts, verrou, journal) |
| `test/run-tests.mjs` | Tests du moteur |

Règles : jamais de texte tronqué (contrôle automatique), jamais de coupe d'un témoignage réel
(statut « À revoir » si > 10 slides), fictions toujours marquées « Histoire imaginée ».

Test local : `CHROME_PATH=/usr/bin/google-chrome node src/render.mjs test/F001.json out/F001`
