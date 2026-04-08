"use strict";

// =========================================================
// References DOM
// =========================================================
// Tous les elements utilises par le moteur de jeu sont resolves ici
// pour eviter de faire des recherches DOM repetitives dans la boucle.
const canevas = document.getElementById("gameCanvas");
const contexte = canevas.getContext("2d");
const overlayCentre = document.getElementById("overlay");
const carteMessage = document.getElementById("messageCard");
const boutonDemarrerInitial = document.getElementById("startBtn");
const scoreFixe = document.getElementById("scoreFixe");

// =========================================================
// Configuration statique
// =========================================================
// Cette section contient les constantes de gameplay.
// Modifier ici permet d'equilibrer le jeu rapidement.
const configuration = {
  objectifScore: 30,
  physique: { gravite: 980, impulsionSaut: -340, vitesseChuteMax: 560 },
  monde: {
    vitesseDefilementBase: 185,
    intervalleTuyauBase: 1.35,
    largeurTuyau: 82,
    ouvertureMinDebut: 170,
    ouvertureMinFin: 130,
    ouvertureMaxDebut: 210,
    ouvertureMaxFin: 165
  },
  joueur: { ratioX: 0.27, ratioYDepart: 0.45, rayonCollision: 16 }
};

// =========================================================
// Etat runtime de la partie
// =========================================================
// Toute l'information dynamique de la session en cours.
const partie = {
  mode: "menu", // menu | en_cours | pause | perdu | gagne
  score: 0,
  temps: 0,
  signeGravite: 1,
  minuterieTurbo: 0,
  minuterieBouclier: 0,
  minuterieInverse: 0,
  minuterieRafale: 0,
  forceRafale: 0,
  tuyauFinalGenere: false,
  dernierTypeTuyau: "normal"
};

// Etat du decor, des obstacles et des vitesses de defilement.
const monde = {
  ySol: 0,
  minuterieTuyau: 0,
  tuyaux: [],
  particules: [],
  arbresLointains: [],
  fleurs: [],
  vitesseDefilement: configuration.monde.vitesseDefilementBase,
  intervalleTuyau: configuration.monde.intervalleTuyauBase
};

// Etat d'entree minimaliste: le saut est file d'attente
// pour rester robuste meme si plusieurs events arrivent vite.
const entree = { sautEnAttente: false };
// Entite joueur (position, vitesse, feedback visuel).
const henriette = { x: 0, y: 0, vitesseY: 0, rayonCollision: configuration.joueur.rayonCollision, minuterieFlash: 0, tracees: [] };
// Context audio cree uniquement apres interaction utilisateur.
const audioJeu = { contexte: null };

// =========================================================
// Utilitaires mathematiques
// =========================================================
function borner(v, min, max) { return Math.max(min, Math.min(max, v)); }
function interpolationLineaire(a, b, t) { return a + (b - a) * t; }
function aleatoire(min, max) { return Math.random() * (max - min) + min; }
function collisionCercleRectangle(rect, cercle) {
  // Projection du centre du cercle sur le rectangle puis distance.
  const nx = borner(cercle.x, rect.x, rect.x + rect.w);
  const ny = borner(cercle.y, rect.y, rect.y + rect.h);
  const dx = cercle.x - nx;
  const dy = cercle.y - ny;
  return dx * dx + dy * dy < cercle.r * cercle.r;
}

// =========================================================
// Audio procedural
// =========================================================
// Aucun fichier son externe: de petits bips synthetiques WebAudio.
function initialiserAudioSiNecessaire() {
  if (!audioJeu.contexte) {
    const ContexteAudio = window.AudioContext || window.webkitAudioContext;
    if (ContexteAudio) audioJeu.contexte = new ContexteAudio();
  }
}
function debloquerAudio() {
  initialiserAudioSiNecessaire();
  if (audioJeu.contexte && audioJeu.contexte.state === "suspended") audioJeu.contexte.resume();
}
function jouerSon(fd, ff, d, type, vol) {
  // fd=frequence depart, ff=frequence fin, d=duree.
  if (!audioJeu.contexte) return;
  const t0 = audioJeu.contexte.currentTime;
  const osc = audioJeu.contexte.createOscillator();
  const gain = audioJeu.contexte.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fd, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, ff), t0 + d);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  osc.connect(gain);
  gain.connect(audioJeu.contexte.destination);
  osc.start(t0);
  osc.stop(t0 + d);
}
// Presets de sons utilises par les moments clefs du jeu.
const jouerSonSaut = () => jouerSon(520, 290, 0.07, "triangle", 0.04);
const jouerSonPoint = () => jouerSon(630, 760, 0.06, "square", 0.03);
const jouerSonBonus = () => jouerSon(420, 960, 0.11, "sine", 0.05);
const jouerSonPause = () => jouerSon(320, 220, 0.08, "triangle", 0.035);
const jouerSonDefaite = () => jouerSon(280, 90, 0.2, "sawtooth", 0.05);
const jouerSonVictoire = () => jouerSon(480, 920, 0.2, "triangle", 0.055);

// =========================================================
// Mise en page responsive
// =========================================================
function redimensionnerCanevas() {
  // Le sol est defini a 86% de la hauteur ecran.
  canevas.width = window.innerWidth;
  canevas.height = window.innerHeight;
  monde.ySol = canevas.height * 0.86;
  henriette.x = canevas.width * configuration.joueur.ratioX;
}
window.addEventListener("resize", redimensionnerCanevas);

// =========================================================
// Generation du decor de fond
// =========================================================
function initialiserDecor() {
  monde.arbresLointains = [];
  monde.fleurs = [];
  for (let i = 0; i < 14; i++) monde.arbresLointains.push({ x: (i / 14) * canevas.width, hauteurTronc: aleatoire(40, 80), rayonCime: aleatoire(22, 34) });
  for (let i = 0; i < 26; i++) monde.fleurs.push({ x: aleatoire(0, canevas.width), y: aleatoire(monde.ySol + 8, canevas.height - 8), teinte: Math.floor(aleatoire(0, 360)) });
}
function choisirTypeTuyau() {
  // Le tuyau de fin est genere a part (hors tirage normal).
  // On evite deux tuyaux rouges consecutifs via dernierTypeTuyau.
  const r = Math.random();
  if (partie.score >= 8 && r < 0.18 && partie.dernierTypeTuyau !== "boost") return "boost";
  if (partie.score >= 10 && r < 0.34) return "mobile";
  if (partie.score >= 14 && r < 0.30) return "inverse";
  if (partie.score >= 20 && r < 0.42) return "rafale";
  return "normal";
}
function genererPaireTuyaux() {
  // Plus on avance, plus les ouvertures se resserrent.
  const prog = borner(partie.score / configuration.objectifScore, 0, 1);
  const min = interpolationLineaire(configuration.monde.ouvertureMinDebut, configuration.monde.ouvertureMinFin, prog);
  const max = interpolationLineaire(configuration.monde.ouvertureMaxDebut, configuration.monde.ouvertureMaxFin, prog);
  const ouverture = aleatoire(min, max);
  const centre = aleatoire(70 + ouverture * 0.5, (monde.ySol - 70) - ouverture * 0.5);
  const type = choisirTypeTuyau();
  monde.tuyaux.push({
    x: canevas.width + 40,
    w: configuration.monde.largeurTuyau,
    centreOuvertureY: centre,
    hauteurOuverture: ouverture,
    type,
    phase: aleatoire(0, Math.PI * 2),
    // Les tuyaux "mobile" se deplacent verticalement.
    vitesseVerticale: type === "mobile" ? aleatoire(35, 70) * (Math.random() < 0.5 ? -1 : 1) : 0,
    scoreDejaCompte: false
  });
  partie.dernierTypeTuyau = type;
}

function genererTuyauFinal() {
  // Ce tuyau unique valide le dernier point (objectif final).
  const prog = borner(partie.score / configuration.objectifScore, 0, 1);
  const min = interpolationLineaire(configuration.monde.ouvertureMinDebut, configuration.monde.ouvertureMinFin, prog);
  const max = interpolationLineaire(configuration.monde.ouvertureMaxDebut, configuration.monde.ouvertureMaxFin, prog);
  const ouverture = aleatoire(min, max);
  const centre = aleatoire(70 + ouverture * 0.5, (monde.ySol - 70) - ouverture * 0.5);

  monde.tuyaux.push({
    x: canevas.width + 120,
    w: configuration.monde.largeurTuyau,
    centreOuvertureY: centre,
    hauteurOuverture: ouverture,
    type: "fin",
    phase: aleatoire(0, Math.PI * 2),
    vitesseVerticale: 0,
    scoreDejaCompte: false
  });
  partie.tuyauFinalGenere = true;
  partie.dernierTypeTuyau = "fin";
}

// =========================================================
// Particules
// =========================================================
function ajouterParticulesTap(x, y) {
  for (let i = 0; i < 9; i++) monde.particules.push({ x, y, vx: aleatoire(-55, 55), vy: aleatoire(-20, 70), vie: aleatoire(0.16, 0.32), taille: aleatoire(2, 4), teinte: aleatoire(35, 65) });
}
function mettreAJourParticules(dt) {
  // Les particules ont une duree de vie courte.
  for (const p of monde.particules) {
    p.vie -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt;
  }
  monde.particules = monde.particules.filter((p) => p.vie > 0);
}

// =========================================================
// Entrees joueur (souris/tactile/clavier)
// =========================================================
function demanderSaut() { if (partie.mode === "en_cours") entree.sautEnAttente = true; }
function mettreEnPause() { if (partie.mode !== "en_cours") return; partie.mode = "pause"; jouerSonPause(); afficherPause(); }
function reprendrePartie() { if (partie.mode !== "pause") return; partie.mode = "en_cours"; overlayCentre.classList.add("hidden"); dernierTemps = performance.now(); jouerSonPause(); }

canevas.addEventListener("pointerdown", () => {
  debloquerAudio();
  if (partie.mode === "menu") demarrerPartie();
  else if (partie.mode === "pause") reprendrePartie();
  else if (partie.mode === "perdu" || partie.mode === "gagne") { reinitialiserPartie(); demarrerPartie(); }
  else demanderSaut();
});
window.addEventListener("keydown", (e) => {
  // P / Echap: toggle pause.
  if (e.code === "KeyP" || e.code === "Escape") { if (partie.mode === "en_cours") mettreEnPause(); else if (partie.mode === "pause") reprendrePartie(); return; }
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault(); debloquerAudio();
    if (partie.mode === "menu") demarrerPartie();
    else if (partie.mode === "pause") reprendrePartie();
    else if (partie.mode === "perdu" || partie.mode === "gagne") { reinitialiserPartie(); demarrerPartie(); }
    else demanderSaut();
  }
  if (e.code === "Enter" && (partie.mode === "perdu" || partie.mode === "gagne")) reinitialiserPartie();
});

// =========================================================
// Cycle de partie
// =========================================================
function reinitialiserPartie() {
  // Reinitialisation COMPLETE pour repartir proprement.
  partie.mode = "menu"; partie.score = 0; partie.temps = 0; partie.signeGravite = 1;
  partie.minuterieTurbo = 0; partie.minuterieBouclier = 0; partie.minuterieInverse = 0; partie.minuterieRafale = 0; partie.forceRafale = 0;
  partie.tuyauFinalGenere = false; partie.dernierTypeTuyau = "normal";
  monde.minuterieTuyau = 0; monde.tuyaux = []; monde.particules = [];
  monde.vitesseDefilement = configuration.monde.vitesseDefilementBase; monde.intervalleTuyau = configuration.monde.intervalleTuyauBase;
  henriette.y = canevas.height * configuration.joueur.ratioYDepart; henriette.vitesseY = 0; henriette.minuterieFlash = 0; henriette.tracees = [];
  entree.sautEnAttente = false;
  initialiserDecor(); mettreAJourScoreFixe(); afficherMenu();
}
function mettreAJourScoreFixe() {
  if (!scoreFixe) return;
  scoreFixe.textContent = `Score: ${partie.score} / ${configuration.objectifScore}`;
}
function appliquerEntree() {
  if (!entree.sautEnAttente) return;
  henriette.vitesseY = configuration.physique.impulsionSaut * partie.signeGravite;
  henriette.minuterieFlash = 0.12;
  jouerSonSaut();
  ajouterParticulesTap(henriette.x - 5, henriette.y + 6);
  entree.sautEnAttente = false;
}
function mettreAJourHenriette(dt) {
  // Physique verticale simple: gravite + vitesse.
  let g = configuration.physique.gravite;
  henriette.vitesseY += g * partie.signeGravite * dt;
  henriette.vitesseY = borner(henriette.vitesseY, -configuration.physique.vitesseChuteMax, configuration.physique.vitesseChuteMax);
  if (partie.minuterieRafale > 0) henriette.vitesseY += partie.forceRafale * dt;
  henriette.y += henriette.vitesseY * dt;
  if (henriette.minuterieFlash > 0) henriette.minuterieFlash -= dt;
  henriette.tracees.push({ x: henriette.x, y: henriette.y, alpha: 1 });
  if (henriette.tracees.length > 14) henriette.tracees.shift();
  for (const t of henriette.tracees) t.alpha *= 0.88;
}
function appliquerPouvoirTuyau(t) {
  // Un seul effet special a la fois pour garder la lisibilite.
  const effetActif = partie.minuterieTurbo > 0 || partie.minuterieBouclier > 0 || partie.minuterieInverse > 0 || partie.minuterieRafale > 0;
  if (effetActif && t.type !== "fin" && t.type !== "normal") return;

  if (t.type === "boost") {
    // Le boost combine acceleration + bouclier temporaire.
    partie.minuterieTurbo = 2.8;
    partie.minuterieBouclier = 5.0; // Bouclier limite a 5 secondes max.
    henriette.vitesseY -= 60 * partie.signeGravite;
    jouerSonBonus();
  }
  else if (t.type === "mobile") {
    // Pas d'effet direct joueur: ce type change la navigation.
  }
  else if (t.type === "inverse") { partie.signeGravite *= -1; partie.minuterieInverse = 3.8; jouerSonBonus(); }
  else if (t.type === "rafale") { partie.minuterieRafale = 3.0; partie.forceRafale = aleatoire(-260, 260); jouerSonBonus(); }
  else if (t.type === "fin") { jouerSonBonus(); }
}
function mettreAJourDifficulte() {
  // Courbe lineaire de difficulte sur le score.
  const p = borner(partie.score / configuration.objectifScore, 0, 1);
  monde.vitesseDefilement = interpolationLineaire(configuration.monde.vitesseDefilementBase, 270, p);
  monde.intervalleTuyau = interpolationLineaire(configuration.monde.intervalleTuyauBase, 0.88, p);
}
function mettreAJourMonde(dt) {
  mettreAJourDifficulte();
  // Timers des effets temporaires.
  if (partie.minuterieTurbo > 0) partie.minuterieTurbo -= dt;
  if (partie.minuterieBouclier > 0) partie.minuterieBouclier -= dt;
  const multiplicateurTurbo = partie.minuterieTurbo > 0 ? 1.25 : 1;
  const v = monde.vitesseDefilement * multiplicateurTurbo;
  partie.temps += dt; monde.minuterieTuyau += dt;
  // Le spawn standard s'arrete des que le tuyau final est planifie/genere.
  if (!partie.tuyauFinalGenere && monde.minuterieTuyau >= monde.intervalleTuyau) { monde.minuterieTuyau = 0; genererPaireTuyaux(); }
  if (partie.minuterieInverse > 0) { partie.minuterieInverse -= dt; if (partie.minuterieInverse <= 0) { partie.signeGravite = 1; } }
  if (partie.minuterieRafale > 0) partie.minuterieRafale -= dt;
  for (const t of monde.tuyaux) {
    if (t.type === "mobile") {
      // Mouvements haut/bas en rebond sur bornes verticales.
      t.centreOuvertureY += t.vitesseVerticale * dt;
      if (t.centreOuvertureY < 95 || t.centreOuvertureY > monde.ySol - 95) {
        t.vitesseVerticale *= -1;
        t.centreOuvertureY = borner(t.centreOuvertureY, 95, monde.ySol - 95);
      }
    }
    if (t.type === "rafale") { t.centreOuvertureY += Math.sin(partie.temps * 2.6 + t.phase) * 18 * dt; t.centreOuvertureY = borner(t.centreOuvertureY, 95, monde.ySol - 95); }
    t.x -= v * dt;
    if (!t.scoreDejaCompte && t.x + t.w < henriette.x) {
      t.scoreDejaCompte = true;

      // Le score 30 ne peut etre valide que par le tuyau de fin dore.
      if (t.type === "fin") {
        partie.score = configuration.objectifScore;
        jouerSonPoint();
        appliquerPouvoirTuyau(t);
        ajouterParticulesTap(henriette.x + 2, henriette.y - 2);
        return gagnerPartie();
      }

      partie.score = Math.min(configuration.objectifScore - 1, partie.score + 1);
      jouerSonPoint();
      appliquerPouvoirTuyau(t);
      ajouterParticulesTap(henriette.x + 2, henriette.y - 2);

      // A objectif-1: purge totale puis creation du tuyau de fin unique.
      if (partie.score === configuration.objectifScore - 1 && !partie.tuyauFinalGenere) {
        monde.tuyaux = [];
        genererTuyauFinal();
        return;
      }
    }
  }
  monde.tuyaux = monde.tuyaux.filter((t) => t.x + t.w > -20);
  for (const a of monde.arbresLointains) { a.x -= v * 0.3 * dt; if (a.x < -60) a.x = canevas.width + aleatoire(20, 180); }
  for (const f of monde.fleurs) { f.x -= v * dt; if (f.x < -8) f.x = canevas.width + aleatoire(10, 80); }
}
function verifierCollisions() {
  // Collision sol/plafond.
  const c = { x: henriette.x, y: henriette.y, r: henriette.rayonCollision };
  if (henriette.y + henriette.rayonCollision >= monde.ySol) { henriette.y = monde.ySol - henriette.rayonCollision; return perdrePartie("Le carre touche le sol"); }
  if (henriette.y - henriette.rayonCollision <= 0) { henriette.y = henriette.rayonCollision; return perdrePartie("Le carre touche le haut"); }
  for (const t of monde.tuyaux) {
    const haut = { x: t.x, y: 0, w: t.w, h: t.centreOuvertureY - t.hauteurOuverture * 0.5 };
    const bas = { x: t.x, y: t.centreOuvertureY + t.hauteurOuverture * 0.5, w: t.w, h: monde.ySol - (t.centreOuvertureY + t.hauteurOuverture * 0.5) };
    if (collisionCercleRectangle(haut, c) || collisionCercleRectangle(bas, c)) {
      if (partie.minuterieBouclier > 0) {
        // Le bouclier absorbe UNE collision puis disparait.
        partie.minuterieBouclier = 0;
        t.x = -200;
        henriette.vitesseY = -220 * partie.signeGravite;
        jouerSonBonus();
        return;
      }
      return perdrePartie("Collision avec un tuyau");
    }
  }
}

// =========================================================
// Interface et overlays
// =========================================================
function afficherMenu() {
  overlayCentre.classList.remove("hidden");
  carteMessage.innerHTML = `
    <h1>Henriette Flappy Challenge</h1>
    <p>Atteins <strong>${configuration.objectifScore}</strong> points pour gagner.</p>
    <p>Tap/clic ou Espace/Fleche haut pour flap.</p>
    <div class="legende-tuyaux">
      <div class="carte-tuyau">
        <div class="mini-tuyau boost"></div>
        <span class="effet-tuyau">Turbo +<br>bouclier</span>
      </div>
      <div class="carte-tuyau">
        <div class="mini-tuyau mobile"></div>
        <span class="effet-tuyau">Monte /<br>descend</span>
      </div>
      <div class="carte-tuyau">
        <div class="mini-tuyau inverse"></div>
        <span class="effet-tuyau">Gravite<br>inversee</span>
      </div>
      <div class="carte-tuyau">
        <div class="mini-tuyau rafale"></div>
        <span class="effet-tuyau">Rafales<br>verticales</span>
      </div>
      <div class="carte-tuyau">
        <div class="mini-tuyau fin"></div>
        <span class="effet-tuyau">Tuyau<br>de fin</span>
      </div>
    </div>
    <div class="btn-row">
      <button class="primary" id="startBtn">Demarrer</button>
    </div>
    <p class="hint">Pause: touche P ou Echap.</p>
  `;
  brancherBoutonsOverlay();
}
function afficherPause() {
  overlayCentre.classList.remove("hidden");
  carteMessage.innerHTML = `<h1>Jeu en pause</h1><p>La partie est suspendue.</p><p>Score actuel: <strong>${partie.score}</strong></p><div class="btn-row"><button class="primary" id="resumeBtn">Reprendre</button><button class="secondary" id="restartBtn">Recommencer</button></div><p class="hint">Utilise aussi P ou Echap pour reprendre.</p>`;
  brancherBoutonsOverlay();
}
function afficherFinPartie(titre, sousTitre, succes) {
  overlayCentre.classList.remove("hidden");
  carteMessage.innerHTML = `<h1 style="color:${succes ? "var(--succes)" : "var(--danger)"};">${titre}</h1><p>${sousTitre}</p><p>Score final: <strong>${partie.score}</strong></p><div class="btn-row"><button class="primary" id="startBtn">Rejouer</button></div><p class="hint">Tap ou Espace pour redemarrer rapidement.</p>`;
  brancherBoutonsOverlay();
}
function brancherBoutonsOverlay() {
  // Les boutons de l'overlay sont recrees via innerHTML,
  // il faut donc les re-brancher a chaque affichage.
  const bDemarrer = document.getElementById("startBtn");
  const bReprendre = document.getElementById("resumeBtn");
  const bRecommencer = document.getElementById("restartBtn");
  if (bDemarrer) bDemarrer.addEventListener("click", () => { debloquerAudio(); if (partie.mode === "menu" || partie.mode === "perdu" || partie.mode === "gagne") demarrerPartie(); });
  if (bReprendre) bReprendre.addEventListener("click", () => reprendrePartie());
  if (bRecommencer) bRecommencer.addEventListener("click", () => { reinitialiserPartie(); demarrerPartie(); });
}
function demarrerPartie() {
  // Lancement depuis menu / reprise depuis fin de partie.
  debloquerAudio();
  if (partie.mode === "perdu" || partie.mode === "gagne") reinitialiserPartie();
  if (partie.mode === "pause") return reprendrePartie();
  partie.mode = "en_cours";
  overlayCentre.classList.add("hidden");
  henriette.vitesseY = -120;
  ajouterParticulesTap(henriette.x, henriette.y);
  jouerSonSaut();
  if (monde.tuyaux.length === 0) genererPaireTuyaux();
}
function perdrePartie(raison) { if (partie.mode !== "en_cours") return; partie.mode = "perdu"; jouerSonDefaite(); afficherFinPartie("Partie terminee", raison, false); }
function gagnerPartie() { if (partie.mode !== "en_cours") return; partie.mode = "gagne"; jouerSonVictoire(); afficherFinPartie("Bravo, objectif atteint!", `Tu as atteint ${configuration.objectifScore} points.`, true); }

// =========================================================
// Rendu
// =========================================================
function dessinerNuage(x, y, e) {
  contexte.fillStyle = "#fff";
  contexte.beginPath(); contexte.arc(x - 25 * e, y, 18 * e, 0, Math.PI * 2); contexte.arc(x, y - 8 * e, 24 * e, 0, Math.PI * 2); contexte.arc(x + 25 * e, y, 18 * e, 0, Math.PI * 2); contexte.fill();
}
function dessinerFond() {
  const d = contexte.createLinearGradient(0, 0, 0, canevas.height); d.addColorStop(0, "#7ed7ff"); d.addColorStop(1, "#d6f6ff");
  contexte.fillStyle = d; contexte.fillRect(0, 0, canevas.width, canevas.height);
  contexte.globalAlpha = 0.45; dessinerNuage(120, 85, 1.1); dessinerNuage(canevas.width * 0.5, 66, 0.9); dessinerNuage(canevas.width - 160, 100, 1.25); contexte.globalAlpha = 1;
  for (const a of monde.arbresLointains) { const h = monde.ySol - a.hauteurTronc; contexte.fillStyle = "#8f613b"; contexte.fillRect(a.x - 4, h, 8, a.hauteurTronc); contexte.fillStyle = "#58b95a"; contexte.beginPath(); contexte.arc(a.x, h, a.rayonCime, 0, Math.PI * 2); contexte.fill(); }
  contexte.fillStyle = "#65c961"; contexte.fillRect(0, monde.ySol, canevas.width, canevas.height - monde.ySol);
  contexte.fillStyle = "#4a9e4a"; contexte.fillRect(0, monde.ySol + 15, canevas.width, canevas.height - monde.ySol);
  for (const f of monde.fleurs) { contexte.fillStyle = `hsl(${f.teinte}, 85%, 67%)`; contexte.beginPath(); contexte.arc(f.x, f.y, 2.6, 0, Math.PI * 2); contexte.fill(); }
}
function paletteTuyau(type) {
  if (type === "fin") return { corps: "#f1c232", tete: "#c89f1a", marque: "*" };
  if (type === "boost") return { corps: "#d94949", tete: "#a62f2f", marque: "B" };
  if (type === "mobile") return { corps: "#55c88a", tete: "#329b66", marque: "M" };
  if (type === "inverse") return { corps: "#4386e0", tete: "#2a5dab", marque: "I" };
  if (type === "rafale") return { corps: "#9b58d5", tete: "#6f38a8", marque: "W" };
  return { corps: "#3fb15f", tete: "#2f8f4c", marque: "" };
}
function dessinerPaireTuyaux(t) {
  // Les caps ("tetes") rendent les tuyaux plus lisibles visuellement.
  const tete = 14, haut = t.centreOuvertureY - t.hauteurOuverture * 0.5, yBas = t.centreOuvertureY + t.hauteurOuverture * 0.5, bas = monde.ySol - yBas, p = paletteTuyau(t.type);
  contexte.fillStyle = p.corps; contexte.fillRect(t.x, 0, t.w, haut); contexte.fillRect(t.x, yBas, t.w, bas);
  contexte.fillStyle = p.tete; contexte.fillRect(t.x - 4, haut - tete, t.w + 8, tete); contexte.fillRect(t.x - 4, yBas, t.w + 8, tete);
  contexte.strokeStyle = "rgba(0,0,0,0.16)"; contexte.lineWidth = 2; contexte.strokeRect(t.x, 0, t.w, haut); contexte.strokeRect(t.x, yBas, t.w, bas);
  if (p.marque) { contexte.fillStyle = "rgba(255,255,255,0.92)"; contexte.font = "bold 18px Trebuchet MS"; contexte.textAlign = "center"; contexte.fillText(p.marque, t.x + t.w * 0.5, haut + 22); }
}
function dessinerHenriette() {
  for (let i = 0; i < henriette.tracees.length; i++) { const t = henriette.tracees[i]; const a = (i / henriette.tracees.length) * 0.2; contexte.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; contexte.fillRect(t.x - 12, t.y - 12, 24, 24); }
  const incl = borner(henriette.vitesseY / 700, -0.35, 0.35);
  contexte.save(); contexte.translate(henriette.x, henriette.y); contexte.rotate(incl);
  if (partie.minuterieBouclier > 0) {
    // Sphère bleue de bouclier autour du joueur.
    contexte.strokeStyle = "rgba(90, 180, 255, 0.9)";
    contexte.lineWidth = 3;
    contexte.beginPath();
    contexte.arc(0, 0, 22, 0, Math.PI * 2);
    contexte.stroke();
    contexte.fillStyle = "rgba(90, 180, 255, 0.16)";
    contexte.beginPath();
    contexte.arc(0, 0, 21, 0, Math.PI * 2);
    contexte.fill();

    // Barre de duree du bouclier (5 secondes max) sous le joueur.
    const largeurBarre = 36;
    const hauteurBarre = 5;
    const ratioBouclier = borner(partie.minuterieBouclier / 5, 0, 1);
    const xBarre = -largeurBarre / 2;
    const yBarre = 23;

    contexte.fillStyle = "rgba(12, 28, 50, 0.55)";
    contexte.fillRect(xBarre, yBarre, largeurBarre, hauteurBarre);
    contexte.fillStyle = "rgba(90, 180, 255, 0.95)";
    contexte.fillRect(xBarre, yBarre, largeurBarre * ratioBouclier, hauteurBarre);
    contexte.strokeStyle = "rgba(190, 225, 255, 0.9)";
    contexte.lineWidth = 1;
    contexte.strokeRect(xBarre, yBarre, largeurBarre, hauteurBarre);
  }
  if (henriette.minuterieFlash > 0) { contexte.fillStyle = "rgba(255, 238, 166, 0.85)"; contexte.fillRect(-16, -16, 32, 32); }
  contexte.fillStyle = "#fff"; contexte.fillRect(-15, -15, 30, 30);
  contexte.strokeStyle = "rgba(90,120,150,0.7)"; contexte.lineWidth = 2; contexte.strokeRect(-15, -15, 30, 30);
  contexte.fillStyle = "#39536c"; contexte.font = "bold 8px Trebuchet MS"; contexte.textAlign = "center"; contexte.fillText("henriette", 0, 2);
  contexte.restore();
}
function dessinerParticules() {
  for (const p of monde.particules) { const a = borner(p.vie / 0.32, 0, 1); contexte.fillStyle = `hsla(${p.teinte}, 90%, 67%, ${a})`; contexte.beginPath(); contexte.arc(p.x, p.y, p.taille, 0, Math.PI * 2); contexte.fill(); }
}
function dessinerFrame() { dessinerFond(); for (const t of monde.tuyaux) dessinerPaireTuyaux(t); dessinerParticules(); dessinerHenriette(); }

// =========================================================
// Boucle principale
// =========================================================
let dernierTemps = performance.now();
function boucleJeu(tempsActuel) {
  // Clamp de dt pour eviter les sauts physiques en cas de freeze onglet.
  const dt = Math.min((tempsActuel - dernierTemps) / 1000, 0.033);
  dernierTemps = tempsActuel;
  if (partie.mode === "en_cours") {
    appliquerEntree(); mettreAJourHenriette(dt); mettreAJourMonde(dt); mettreAJourParticules(dt); verifierCollisions(); mettreAJourScoreFixe();
  } else if (partie.mode !== "pause") {
    mettreAJourParticules(dt);
  }
  dessinerFrame();
  requestAnimationFrame(boucleJeu);
}

// =========================================================
// Bootstrap application
// =========================================================
boutonDemarrerInitial.addEventListener("click", () => { if (partie.mode === "menu") demarrerPartie(); });
redimensionnerCanevas();
reinitialiserPartie();
requestAnimationFrame(boucleJeu);