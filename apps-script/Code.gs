/**
 * LA BELLE HISTOIRE DU JOUR — moteur de pilotage (Google Apps Script lié au Google Sheet)
 *
 * Rôle : seule « porte d'entrée » qui lit/écrit les statuts. Make et GitHub l'appellent en HTTP.
 * - LockService : une seule exécution à la fois → pas d'écriture concurrente, pas de doublon.
 * - Cycle des statuts : Disponible → Réservée → Programmée → Publiée
 *   (+ « Erreur – à vérifier » : jamais remise en circulation automatiquement).
 * - Priorité : témoignages réels « Prête » avec consentement « Oui » > fictions « Disponible ».
 *
 * Installation : menu « Belle Histoire › 1. Installer / mettre à jour les onglets », puis déployer en application Web.
 */

const TZ = 'Europe/Paris';
const SH = {
  FICTION: 'Histoires de secours',
  REAL: 'Histoires réelles',
  CAL: 'Calendrier de publication',
  PARAMS: 'Paramètres',
  LOG: 'Journal',
  STORIES: 'Stories',
  PILOT: 'Pilotage',
};
const ST = {
  DISPO: 'Disponible', READY_REAL: 'Prête', TODO_REAL: 'À traiter', RESERVED: 'Réservée', SCHEDULED: 'Programmée',
  PUBLISHED: 'Publiée', ERROR: 'Erreur – à vérifier', REVIEW: 'À revoir', ARCHIVED: 'Archivée', REFUSED: 'Refusée',
};
const CAL_ST = { RESERVED: 'Réservée', RENDERED: 'Visuels prêts', SCHEDULED: 'Programmée', PUBLISHED: 'Publiée', RENDER_FAIL: 'Échec génération', ERROR: 'Erreur – à vérifier', CANCELLED: 'Annulée' };

const REAL_HEADERS = ['ID', 'Date de réception', 'Texte original', 'Titre', 'Thème', 'Source', 'Auteur (prénom / pseudo)', '@ Instagram auteur',
  'Consentement publication', 'Autorisation mention auteur', 'Statut', 'Date publication', 'Lien publication', 'Nb slides', 'Réservée le', 'Notes'];
const CAL_HEADERS = ['Date programmée', 'Heure', 'ID histoire', 'Origine', 'Type de publication', 'Nb slides', 'Légende', 'Statut',
  'Lien publication', 'ID média Instagram', 'URLs des images', 'Erreur technique', 'Mis à jour le'];
const LOG_HEADERS = ['Horodatage', 'Niveau', 'Étape', 'ID histoire', 'Message', 'Détail'];
const STORY_HEADERS = ['ID', 'Jour', 'Texte', 'Visuel', 'URL image', 'Active', 'Statut', 'Dernière publication', 'Nb publications', 'ID média', 'Erreur'];
const FICTION_EXTRA = ['Nb slides', 'Réservée le', 'Lien publication'];

const DEFAULT_PARAMS = [
  ['Automatisation publication active', 'NON', 'OUI / NON — interrupteur général des posts (laisser NON pendant les tests)'],
  ['Automatisation stories active', 'NON', 'OUI / NON — interrupteur général des stories'],
  ['Posts par jour', 1, 'Le système publie 1 histoire par jour (valeur informative ; Make planifie 1 exécution/jour)'],
  ['Heure de publication', '18:30', 'Heure de Paris. ⚠ À reporter aussi dans la planification du scénario Make « Publication quotidienne »'],
  ['Heure de préparation des visuels', '16:00', 'Heure à laquelle GitHub prépare les images (doit précéder l’heure de publication)'],
  ['Jours des stories', 'lundi,mercredi,vendredi,dimanche', 'Jours séparés par des virgules — modifiable librement'],
  ['Heure des stories', '12:15', 'Heure de Paris. ⚠ À reporter dans la planification du scénario Make « Stories »'],
  ['Slides max par carrousel', 10, 'Limite technique de l’API Instagram : 10 images'],
  ['Mots max pour une image unique', 40, 'En dessous : 1 seule image ; au-dessus : carrousel adapté à la longueur'],
  ['Priorité', 'Réelles d’abord', 'Réelles d’abord / Fictions uniquement / Réelles uniquement'],
  ['Anti-répétition (jours)', 7, 'Évite thème ou angle déjà publiés sur cette période'],
  ['Fictions disponibles', '=COUNTIF(\'Histoires de secours\'!G:G,"Disponible")', 'Calcul automatique'],
  ['Seuil d’alerte stock', 15, 'Alerte dans le Journal quand les fictions disponibles passent sous ce seuil'],
  ['URL des images (GitHub Pages)', '', 'Rempli à l’installation de GitHub Pages'],
];

/* ============================== MENU & INSTALLATION ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Belle Histoire')
    .addItem('1. Installer / mettre à jour les onglets', 'setup')
    .addItem('2. Afficher le jeton secret', 'showToken')
    .addSeparator()
    .addItem('Simuler la sélection (sans rien modifier)', 'dryRunSelection')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  // 1) Colonnes de suivi ajoutées à la réserve de fictions (sans toucher aux 100 histoires).
  const fic = ss.getSheetByName(SH.FICTION);
  if (!fic) throw new Error('Onglet « ' + SH.FICTION + ' » introuvable');
  const fh = headers_(fic);
  FICTION_EXTRA.forEach(h => { if (fh.indexOf(h) < 0) { fic.getRange(1, fic.getLastColumn() + 1).setValue(h); } });
  applyStatusValidation_(fic, headers_(fic).indexOf('Statut') + 1,
    [ST.DISPO, ST.RESERVED, ST.SCHEDULED, ST.PUBLISHED, ST.ERROR, ST.REVIEW, ST.ARCHIVED]);

  // 2) Onglets nouveaux.
  const real = ensureSheet_(ss, SH.REAL, REAL_HEADERS, '#F2894E');
  applyStatusValidation_(real, 11, [ST.TODO_REAL, ST.READY_REAL, ST.RESERVED, ST.SCHEDULED, ST.PUBLISHED, ST.ERROR, ST.REFUSED, ST.ARCHIVED]);
  applyStatusValidation_(real, 6, ['DM', 'Commentaire', 'Autre']);
  applyStatusValidation_(real, 9, ['Oui', 'Non', 'En attente']);
  applyStatusValidation_(real, 10, ['Oui', 'Non']);
  real.getRange('B2:B').setNumberFormat('dd/MM/yyyy');
  if (!real.getRange('A2').getFormula()) {
    real.getRange('A2').setNote('L’ID est créé automatiquement (R001, R002…) quand vous collez un texte en colonne C. ' +
      'Pour publier : Consentement = Oui ET Statut = Prête.');
  }
  real.setColumnWidth(3, 520); real.getRange('C:C').setWrap(true);

  ensureSheet_(ss, SH.CAL, CAL_HEADERS, '#6B4E8C');
  ss.getSheetByName(SH.CAL).setColumnWidth(7, 360);
  ensureSheet_(ss, SH.LOG, LOG_HEADERS, '#2B2531');

  const params = ensureSheet_(ss, SH.PARAMS, ['Paramètre', 'Valeur', 'Explication'], '#D9583A');
  const existing = params.getRange(1, 1, Math.max(params.getLastRow(), 1), 1).getValues().flat();
  DEFAULT_PARAMS.forEach(row => {
    if (existing.indexOf(row[0]) < 0) params.appendRow(row);
  });
  applyStatusValidation_(params, 2, null); // pas de validation globale colonne B
  params.setColumnWidth(1, 300); params.setColumnWidth(2, 260); params.setColumnWidth(3, 620);

  const stories = ensureSheet_(ss, SH.STORIES, STORY_HEADERS, '#4E3A6E');
  applyStatusValidation_(stories, 6, ['OUI', 'NON']);

  // 3) Indicateurs de pilotage enrichis.
  const pil = ss.getSheetByName(SH.PILOT);
  if (pil && pil.getRange(1, 1, pil.getLastRow(), 1).getValues().flat().indexOf('— Automatisation —') < 0) {
    const r = pil.getLastRow() + 2;
    pil.getRange(r, 1, 6, 2).setValues([
      ['— Automatisation —', ''],
      ['Histoires réelles prêtes', '=COUNTIFS(\'Histoires réelles\'!K:K,"Prête",\'Histoires réelles\'!I:I,"Oui")'],
      ['Fictions disponibles', '=COUNTIF(\'Histoires de secours\'!G:G,"Disponible")'],
      ['Publications en erreur (à vérifier)', '=COUNTIF(\'Calendrier de publication\'!H:H,"Erreur – à vérifier")'],
      ['Posts publiés', '=COUNTIF(\'Calendrier de publication\'!H:H,"Publiée")'],
      ['Stories publiées', '=SUM(Stories!I:I)'],
    ]);
  }

  // 4) Jeton secret pour sécuriser les appels HTTP.
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  log_('INFO', 'setup', '', 'Installation / mise à jour terminée', '');
  return 'OK';
}

function showToken() {
  SpreadsheetApp.getUi().alert('Jeton secret (à coller dans Make et GitHub) :\n\n' + PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

/** Remplit l'onglet Stories à partir de l'index publié sur GitHub Pages. */
function importStoriesCatalog_(baseUrl) {
  const list = JSON.parse(UrlFetchApp.fetch(baseUrl.replace(/\/$/, '') + '/stories/index.json').getContentText());
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.STORIES);
  const have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat() : [];
  const rows = list.filter(s => have.indexOf(s.id) < 0).map(s =>
    [s.id, s.type, s.text, s.variant, baseUrl.replace(/\/$/, '') + '/stories/' + s.file, 'OUI', 'Disponible', '', 0, '', '']);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}

/* ============================== API HTTP ============================== */

function doGet() { return json_({ ok: true, service: 'La Belle Histoire du Jour', time: nowStr_() }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD_JSON' }); }
  if (body.token !== PropertiesService.getScriptProperties().getProperty('TOKEN')) return json_({ ok: false, error: 'UNAUTHORIZED' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'BUSY', message: 'Une autre exécution est en cours' });
  try {
    const fn = ACTIONS[body.action];
    if (!fn) return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    const res = fn(body);
    SpreadsheetApp.flush();
    return json_(res);
  } catch (err) {
    log_('ERREUR', body.action, body.id || '', String(err && err.message || err), String(err && err.stack || ''));
    return json_({ ok: false, error: 'EXCEPTION', message: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

const ACTIONS = {
  /** GitHub (avant publication) : réserve l'histoire du jour. Idempotent pour une date donnée. */
  prepare(b) {
    const date = b.date || todayStr_();
    if (!paramBool_('Automatisation publication active') && !b.test) return { ok: true, skip: true, reason: 'AUTOMATION_OFF' };
    const cal = calRowForDate_(date);
    if (cal) {
      if ([CAL_ST.RESERVED, CAL_ST.RENDER_FAIL].indexOf(cal.row['Statut']) >= 0) {
        return Object.assign({ ok: true, date: date, reused: true }, storyPayload_(cal.row['ID histoire']));
      }
      return { ok: true, skip: true, reason: 'ALREADY_PREPARED', status: cal.row['Statut'], id: cal.row['ID histoire'] };
    }
    const pick = selectStory_(b.excludeIds || []);
    if (!pick) {
      log_('ALERTE', 'prepare', '', 'Aucune histoire disponible (ni réelle prête, ni fiction disponible)', '');
      return { ok: true, skip: true, reason: 'NO_CONTENT' };
    }
    setStoryFields_(pick.sheet, pick.rowIndex, { 'Statut': ST.RESERVED, 'Réservée le': nowStr_() });
    appendCal_({ 'Date programmée': date, 'Heure': param_('Heure de publication'), 'ID histoire': pick.id,
      'Origine': pick.origin === 'fiction' ? 'Fiction (réserve)' : 'Témoignage réel', 'Statut': CAL_ST.RESERVED, 'Mis à jour le': nowStr_() });
    stockAlert_();
    log_('INFO', 'prepare', pick.id, 'Histoire réservée pour le ' + date, pick.reason);
    return Object.assign({ ok: true, date: date }, storyPayload_(pick.id));
  },

  /** GitHub : visuels et légende générés et en ligne. */
  rendered(b) {
    const cal = mustCal_(b.date, b.id);
    if (cal.row['Statut'] !== CAL_ST.RESERVED && cal.row['Statut'] !== CAL_ST.RENDER_FAIL) return { ok: false, error: 'BAD_STATE', status: cal.row['Statut'] };
    updateCal_(cal.rowIndex, { 'Type de publication': b.urls.length > 1 ? 'Carrousel' : 'Image unique', 'Nb slides': b.urls.length,
      'Légende': b.caption, 'URLs des images': b.urls.join('\n'), 'Statut': CAL_ST.RENDERED, 'Erreur technique': '', 'Mis à jour le': nowStr_() });
    const st = findStory_(b.id); setStoryFields_(st.sheet, st.rowIndex, { 'Nb slides': b.urls.length });
    return { ok: true };
  },

  /** GitHub : la génération a échoué → rien n'a été publié, l'histoire peut être libérée. */
  renderFailed(b) {
    const cal = mustCal_(b.date, b.id);
    updateCal_(cal.rowIndex, { 'Statut': CAL_ST.RENDER_FAIL, 'Erreur technique': b.error, 'Mis à jour le': nowStr_() });
    log_('ERREUR', 'génération visuels', b.id, b.error, b.detail || '');
    if (b.error !== 'TOO_LONG') return { ok: true, retry: 'same story' }; // l'histoire reste Réservée : la prochaine génération la reprendra
    // TOO_LONG : jamais de coupe automatique → adaptation humaine, et on libère la journée pour une autre histoire.
    const st = findStory_(b.id);
    const back = st.origin === 'fiction' ? ST.REVIEW : ST.TODO_REAL;
    setStoryFields_(st.sheet, st.rowIndex, { 'Statut': back, 'Réservée le': '' });
    updateCal_(cal.rowIndex, { 'Statut': CAL_ST.CANCELLED });
    return { ok: true, released: back };
  },

  /** Make (heure de publication) : renvoie le post prêt du jour et le passe en « Programmée ». */
  next(b) {
    const date = b.date || todayStr_();
    if (!paramBool_('Automatisation publication active') && !b.test) return { ok: true, skip: true, reason: 'AUTOMATION_OFF' };
    const cal = calRowForDate_(date);
    if (!cal) { log_('ALERTE', 'publication', '', 'Aucun post préparé pour ' + date, 'Vérifier l’action GitHub'); return { ok: true, skip: true, reason: 'NOTHING_PREPARED' }; }
    const s = cal.row['Statut'];
    if (s === CAL_ST.PUBLISHED) return { ok: true, skip: true, reason: 'ALREADY_PUBLISHED' };
    if (s === CAL_ST.SCHEDULED || s === CAL_ST.ERROR) {
      // Une tentative a déjà eu lieu : on NE relance PAS à l'aveugle (le post est peut-être en ligne).
      log_('ALERTE', 'publication', cal.row['ID histoire'], 'Tentative précédente non confirmée — vérification manuelle requise', s);
      return { ok: true, skip: true, reason: 'NEEDS_MANUAL_CHECK', id: cal.row['ID histoire'] };
    }
    if (s !== CAL_ST.RENDERED) return { ok: true, skip: true, reason: 'NOT_READY', status: s };
    const id = cal.row['ID histoire'];
    updateCal_(cal.rowIndex, { 'Statut': CAL_ST.SCHEDULED, 'Mis à jour le': nowStr_() });
    const st = findStory_(id); setStoryFields_(st.sheet, st.rowIndex, { 'Statut': ST.SCHEDULED });
    const urls = String(cal.row['URLs des images']).split('\n').filter(String);
    return { ok: true, skip: false, date: date, id: id, caption: cal.row['Légende'], urls: urls, count: urls.length,
      mode: urls.length > 1 ? 'carousel' : 'single', image: urls[0], media: urls.map(u => ({ url: u, type: 'IMAGE' })) };
  },

  /** Make : publication confirmée par Instagram. */
  published(b) {
    const cal = mustCal_(b.date, b.id);
    updateCal_(cal.rowIndex, { 'Statut': CAL_ST.PUBLISHED, 'ID média Instagram': b.mediaId || '', 'Lien publication': b.permalink || '', 'Erreur technique': '', 'Mis à jour le': nowStr_() });
    const st = findStory_(b.id);
    const f = { 'Statut': ST.PUBLISHED, 'Date publication': todayStr_(), 'Lien publication': b.permalink || b.mediaId || '' };
    if (st.origin === 'fiction') f['Nombre utilisations'] = (Number(st.row['Nombre utilisations']) || 0) + 1;
    setStoryFields_(st.sheet, st.rowIndex, f);
    log_('INFO', 'publication', b.id, 'Publiée', b.permalink || b.mediaId || '');
    return { ok: true };
  },

  /** Make : erreur pendant la publication. Statut figé « Erreur – à vérifier », aucune relance automatique. */
  failed(b) {
    const cal = mustCal_(b.date, b.id);
    updateCal_(cal.rowIndex, { 'Statut': CAL_ST.ERROR, 'Erreur technique': (b.stage ? '[' + b.stage + '] ' : '') + (b.error || ''), 'Mis à jour le': nowStr_() });
    const st = findStory_(b.id); setStoryFields_(st.sheet, st.rowIndex, { 'Statut': ST.ERROR });
    log_('ERREUR', 'publication', b.id, b.error || 'Échec', 'Vérifier sur Instagram si le post existe avant toute relance');
    return { ok: true };
  },

  /** Make (stories) : story du jour selon le calendrier de l'onglet Paramètres. */
  story(b) {
    if (!paramBool_('Automatisation stories active') && !b.test) return { ok: true, skip: true, reason: 'AUTOMATION_OFF' };
    const day = b.weekday || Utilities.formatDate(new Date(), TZ, 'u'); // 1 = lundi … 7 = dimanche
    const names = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const today = names[Number(day)];
    const days = String(param_('Jours des stories')).toLowerCase().split(/[,;\s]+/).filter(String);
    if (days.indexOf(today) < 0) return { ok: true, skip: true, reason: 'NOT_A_STORY_DAY', day: today };
    const sh = SpreadsheetApp.getActive().getSheetByName(SH.STORIES);
    const rows = rows_(sh);
    const todayStr = todayStr_();
    if (rows.some(r => String(r.row['Dernière publication']).indexOf(todayStr) === 0 && (r.row['Statut'] === 'Publiée' || r.row['Statut'] === 'Programmée')))
      return { ok: true, skip: true, reason: 'ALREADY_DONE_TODAY' };
    // Type de story = jour ; si le jour n'a pas de texte dédié, on prend le pool « mercredi » (appel à témoignages).
    let pool = rows.filter(r => r.row['Active'] === 'OUI' && r.row['Jour'] === today && r.row['Statut'] !== 'Erreur – à vérifier');
    if (!pool.length) pool = rows.filter(r => r.row['Active'] === 'OUI' && r.row['Jour'] === 'mercredi');
    if (!pool.length) return { ok: true, skip: true, reason: 'NO_STORY_VISUAL' };
    // Rotation : la moins publiée, puis la plus anciennement publiée, puis ordre du catalogue.
    pool.sort((a, c) => (Number(a.row['Nb publications']) || 0) - (Number(c.row['Nb publications']) || 0)
      || String(a.row['Dernière publication']).localeCompare(String(c.row['Dernière publication'])) || a.rowIndex - c.rowIndex);
    const pick = pool[0];
    setFields_(sh, pick.rowIndex, { 'Statut': 'Programmée', 'Dernière publication': nowStr_() });
    return { ok: true, skip: false, id: pick.row['ID'], image: pick.row['URL image'], text: pick.row['Texte'] };
  },
  storyPublished(b) {
    const sh = SpreadsheetApp.getActive().getSheetByName(SH.STORIES); const r = rows_(sh).find(x => x.row['ID'] === b.id);
    if (!r) throw new Error('Story inconnue ' + b.id);
    setFields_(sh, r.rowIndex, { 'Statut': 'Publiée', 'Nb publications': (Number(r.row['Nb publications']) || 0) + 1, 'ID média': b.mediaId || '', 'Erreur': '' });
    log_('INFO', 'story', b.id, 'Story publiée', b.mediaId || ''); return { ok: true };
  },
  storyFailed(b) {
    const sh = SpreadsheetApp.getActive().getSheetByName(SH.STORIES); const r = rows_(sh).find(x => x.row['ID'] === b.id);
    if (r) setFields_(sh, r.rowIndex, { 'Statut': 'Erreur – à vérifier', 'Erreur': b.error || '' });
    log_('ERREUR', 'story', b.id, b.error || 'Échec story', 'Vérifier sur Instagram avant toute relance'); return { ok: true };
  },

  /** Diagnostic */
  status() {
    return { ok: true, today: todayStr_(), fictionsDisponibles: countStatus_(SH.FICTION, ST.DISPO), reellesPretes: realReady_().length,
      publicationActive: paramBool_('Automatisation publication active'), storiesActives: paramBool_('Automatisation stories active') };
  },
  importStories(b) { return { ok: true, added: importStoriesCatalog_(b.baseUrl || param_('URL des images (GitHub Pages)')) }; },
  /** Tests : simule une sélection sans rien écrire. */
  dryRun() { const p = selectStory_([]); return { ok: true, pick: p ? { id: p.id, origin: p.origin, reason: p.reason } : null }; },
};

/* ============================== SÉLECTION ============================== */

function selectStory_(excludeIds) {
  const prio = String(param_('Priorité') || 'Réelles d’abord');
  if (prio !== 'Fictions uniquement') {
    const real = realReady_().filter(r => excludeIds.indexOf(r.id) < 0);
    if (real.length) {
      real.sort((a, b) => dateVal_(a.row['Date de réception']) - dateVal_(b.row['Date de réception']) || a.rowIndex - b.rowIndex);
      return Object.assign(real[0], { reason: 'Témoignage réel prioritaire (le plus ancien prêt)' });
    }
    if (prio === 'Réelles uniquement') return null;
  }
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.FICTION);
  const all = rows_(sh).filter(r => r.row['ID'] && r.row['Statut'] === ST.DISPO && excludeIds.indexOf(r.row['ID']) < 0)
    .map(r => Object.assign(r, { sheet: sh, id: r.row['ID'], origin: 'fiction' }));
  if (!all.length) return null;
  // Anti-répétition : thèmes et angles publiés/réservés sur les N derniers jours.
  const recent = recentThemes_(Number(param_('Anti-répétition (jours)')) || 7);
  const fresh = all.filter(r => recent.themes.indexOf(norm_(r.row['Thème'])) < 0 && recent.angles.indexOf(norm_(r.row['Angle'])) < 0);
  const pool = fresh.length ? fresh : all;
  // Choix déterministe mais varié : dépend de la date (pas de hasard non reproductible).
  const idx = hash_(todayStr_()) % pool.length;
  // Alterne aussi la longueur : on évite deux histoires de même longueur (courte/longue) d'affilée si possible.
  return Object.assign(pool[idx], { reason: fresh.length ? 'Fiction (thème/angle non utilisés récemment)' : 'Fiction (aucune alternative sans répétition)' });
}

function realReady_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.REAL);
  if (!sh) return [];
  return rows_(sh).filter(r => r.row['ID'] && String(r.row['Texte original']).trim() && r.row['Statut'] === ST.READY_REAL && r.row['Consentement publication'] === 'Oui')
    .map(r => Object.assign(r, { sheet: sh, id: r.row['ID'], origin: 'reel' }));
}

function recentThemes_(days) {
  const cal = SpreadsheetApp.getActive().getSheetByName(SH.CAL);
  const limit = new Date(Date.now() - days * 864e5);
  const ids = rows_(cal).filter(r => dateVal_(r.row['Date programmée']) >= limit.getTime() && r.row['Statut'] !== CAL_ST.CANCELLED).map(r => r.row['ID histoire']);
  const themes = [], angles = [];
  ids.forEach(id => { const s = findStory_(id, true); if (s) { themes.push(norm_(s.row['Thème'])); angles.push(norm_(s.row['Angle'] || '')); } });
  return { themes: themes.filter(String), angles: angles.filter(String) };
}

function storyPayload_(id) {
  const s = findStory_(id);
  const r = s.row;
  if (s.origin === 'fiction') return { id: id, origin: 'fiction', title: r['Titre'], theme: r['Thème'], angle: r['Angle'], text: r['Histoire fictive'] };
  const mention = r['Autorisation mention auteur'] === 'Oui';
  return { id: id, origin: 'reel', title: r['Titre'] || 'Une belle histoire', theme: r['Thème'], text: r['Texte original'],
    mentionAuthor: mention, author: mention ? r['Auteur (prénom / pseudo)'] : '', authorHandle: mention ? r['@ Instagram auteur'] : '' };
}

/* ============================== AUTOMATISMES ONGLET « Histoires réelles » ============================== */

/** Attribue un ID unique (R001…) et la date de réception quand un texte est collé. */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== SH.REAL || e.range.getRow() < 2) return;
  const last = e.range.getLastRow();
  for (let r = e.range.getRow(); r <= last; r++) {
    const text = sh.getRange(r, 3).getValue();
    if (text && !sh.getRange(r, 1).getValue()) {
      const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().flat().filter(String);
      const n = ids.reduce((m, v) => Math.max(m, Number(String(v).replace(/\D/g, '')) || 0), 0) + 1;
      sh.getRange(r, 1).setValue('R' + ('00' + n).slice(-3));
      if (!sh.getRange(r, 2).getValue()) sh.getRange(r, 2).setValue(new Date());
      if (!sh.getRange(r, 11).getValue()) sh.getRange(r, 11).setValue(ST.TODO_REAL);
      if (!sh.getRange(r, 9).getValue()) sh.getRange(r, 9).setValue('En attente');
    }
  }
}

/* ============================== OUTILS ============================== */

function dryRunSelection() {
  const p = selectStory_([]);
  SpreadsheetApp.getUi().alert(p ? ('Histoire qui serait choisie : ' + p.id + '\n' + p.reason) : 'Aucune histoire disponible');
}
function stockAlert_() {
  const n = countStatus_(SH.FICTION, ST.DISPO), seuil = Number(param_('Seuil d’alerte stock')) || 15;
  if (n < seuil) log_('ALERTE', 'stock', '', 'Plus que ' + n + ' fictions disponibles (seuil ' + seuil + ')', 'Ajouter des histoires ou recycler les plus anciennes');
}
function countStatus_(name, status) { const sh = SpreadsheetApp.getActive().getSheetByName(name); return rows_(sh).filter(r => r.row['Statut'] === status).length; }

function findStory_(id, soft) {
  for (const [name, origin] of [[SH.FICTION, 'fiction'], [SH.REAL, 'reel']]) {
    const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!sh) continue;
    const r = rows_(sh).find(x => x.row['ID'] === id);
    if (r) return Object.assign(r, { sheet: sh, origin: origin, id: id });
  }
  if (soft) return null;
  throw new Error('Histoire introuvable : ' + id);
}
function calRowForDate_(date) {
  const cal = SpreadsheetApp.getActive().getSheetByName(SH.CAL);
  const list = rows_(cal).filter(r => fmtDate_(r.row['Date programmée']) === date && r.row['Statut'] !== CAL_ST.CANCELLED);
  return list.length ? list[list.length - 1] : null;
}
function mustCal_(date, id) {
  const c = calRowForDate_(date || todayStr_());
  if (!c || c.row['ID histoire'] !== id) throw new Error('Ligne de calendrier introuvable pour ' + id + ' le ' + date);
  return c;
}
function appendCal_(obj) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CAL);
  const h = headers_(sh);
  sh.appendRow(h.map(k => obj[k] !== undefined ? obj[k] : ''));
  sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(obj['Date programmée']);
}
function updateCal_(rowIndex, obj) { setFields_(SpreadsheetApp.getActive().getSheetByName(SH.CAL), rowIndex, obj); }
function setStoryFields_(sh, rowIndex, obj) { setFields_(sh, rowIndex, obj); }
function setFields_(sh, rowIndex, obj) {
  const h = headers_(sh);
  Object.keys(obj).forEach(k => { const c = h.indexOf(k); if (c >= 0) sh.getRange(rowIndex, c + 1).setValue(obj[k]); });
}
function rows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const h = headers_(sh);
  return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map((v, i) => {
    const row = {}; h.forEach((k, j) => row[k] = v[j]); return { row: row, rowIndex: i + 2 };
  });
}
function headers_(sh) { return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String); }
function ensureSheet_(ss, name, headers, color) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  const cur = headers_(sh);
  if (!cur.filter(String).length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(color).setWrap(true);
    sh.setFrozenRows(1);
  } else {
    headers.forEach(hd => { if (cur.indexOf(hd) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(hd).setFontWeight('bold'); });
  }
  return sh;
}
function applyStatusValidation_(sh, col, values) {
  if (!values || col < 1) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  try { sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule); }
  catch (e) { // Colonne d'un « tableau » Sheets : la liste se règle dans le tableau lui-même.
    log_('ALERTE', 'setup', '', 'Liste déroulante non modifiable sur ' + sh.getName() + ' (col ' + col + ')', 'Ajouter manuellement : ' + values.join(', '));
  }
}
function param_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.PARAMS);
  const v = sh.getRange(1, 1, sh.getLastRow(), 2).getValues().find(r => r[0] === name);
  if (!v) return '';
  if (v[1] instanceof Date) return Utilities.formatDate(v[1], TZ, 'HH:mm');
  return v[1];
}
function paramBool_(name) { return String(param_(name)).trim().toUpperCase() === 'OUI'; }
function log_(level, step, id, msg, detail) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.LOG);
  if (sh) sh.appendRow([nowStr_(), level, step, id, msg, detail]);
}
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).slice(0, 10); }
function dateVal_(v) { if (v instanceof Date) return v.getTime(); const d = new Date(String(v)); return isNaN(d) ? 0 : d.getTime(); }
function norm_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function hash_(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
