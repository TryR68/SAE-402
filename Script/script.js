"use strict";

// =========================================================
// References DOM / Canvas
// =========================================================
const canevas = document.getElementById("gameCanvas");
const contexte = canevas.getContext("2d");
const overlayCentre = document.getElementById("overlay");
const carteMessage = document.getElementById("messageCard");
const boutonDemarrerInitial = document.getElementById("startBtn");
const boutonGyroInitial = document.getElementById("motionBtn");
const panneauScore = document.getElementById("distancePanel");
const panneauEtat = document.getElementById("statusPanel");

// =========================================================
// Configuration de jeu (constantes)
// =========================================================
const configuration = {
  objectifScore: 50,
  physique: {
    gravite: 980,
    impulsionSaut: -340,
    vitesseChuteMax: 560
  },
  monde: {
    vitesseDefilementBase: 185,
    intervalleTuyauBase: 1.35,
    largeurTuyau: 82,
    ouvertureMinDebut: 170,
    ouvertureMinFin: 130,
    ouvertureMaxDebut: 210,
    ouvertureMaxFin: 165
  },
  joueur: {
    ratioX: 0.27,
    ratioYDepart: 0.45,
    rayonCollision: 16
  }
};

// =========================================================
// Etat dynamique de la partie
// =========================================================
const partie = {
  mode: "menu", // menu | en_cours | perdu | gagne
  score: 0,
  temps: 0,
  signeGravite: 1, // 1 normal, -1 inverse
  minuterieBoost: 0,
  minuterieInverse: 0,
  minuterieRafale: 0,
  forceRafale: 0
};

// =========================================================
// Etat du monde
// =========================================================
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

// =========================================================
// Etat des entrees joueur
// =========================================================
const entree = {
  sautEnAttente: false
};

// =========================================================
// Etat de l'objet Henriette (carre)
// =========================================================
const henriette = {
  x: 0,
  y: 0,
  vitesseY: 0,
  rayonCollision: configuration.joueur.rayonCollision,
  minuterieFlash: 0,
  tracees: []
};

// =========================================================
// Utilitaires mathematiques
// =========================================================
function borner(valeur, min, max) {
  return Math.max(min, Math.min(max, valeur));
}

function interpolationLineaire(a, b, t) {
  return a + (b - a) * t;
}

function aleatoire(min, max) {
  return Math.random() * (max - min) + min;
}

// Collision cercle/rectangle (rapide et robuste)
function collisionCercleRectangle(rect, cercle) {
  const xLePlusProche = borner(cercle.x, rect.x, rect.x + rect.w);
  const yLePlusProche = borner(cercle.y, rect.y, rect.y + rect.h);
  const dx = cercle.x - xLePlusProche;
  const dy = cercle.y - yLePlusProche;
  return dx * dx + dy * dy < cercle.r * cercle.r;
}

// =========================================================
// Dimensionnement responsive
// =========================================================
function redimensionnerCanevas() {
  canevas.width = window.innerWidth;
  canevas.height = window.innerHeight;
  monde.ySol = canevas.height * 0.86;
  henriette.x = canevas.width * configuration.joueur.ratioX;
}
window.addEventListener("resize", redimensionnerCanevas);

// =========================================================
// Creation du decor de fond
// =========================================================
function initialiserDecor() {
  monde.arbresLointains = [];
  monde.fleurs = [];

  // Arbres loins: effet de parallaxe
  for (let i = 0; i < 14; i++) {
    monde.arbresLointains.push({
      x: (i / 14) * canevas.width,
      hauteurTronc: aleatoire(40, 80),
      rayonCime: aleatoire(22, 34)
    });
  }

  // Fleurs de premier plan
  for (let i = 0; i < 26; i++) {
    monde.fleurs.push({
      x: aleatoire(0, canevas.width),
      y: aleatoire(monde.ySol + 8, canevas.height - 8),
      teinte: Math.floor(aleatoire(0, 360))
    });
  }
}

// =========================================================
// Logique de generation des tuyaux speciaux
// =========================================================
function choisirTypeTuyau() {
  const tirage = Math.random();
  if (partie.score >= 8 && tirage < 0.18) return "boost";   // Rouge
  if (partie.score >= 14 && tirage < 0.30) return "inverse"; // Bleu
  if (partie.score >= 20 && tirage < 0.42) return "rafale"; // Violet
  return "normal";
}

function genererPaireTuyaux() {
  // Plus le score monte, plus les ouvertures diminuent.
  const progression = borner(partie.score / configuration.objectifScore, 0, 1);
  const ouvertureMin = interpolationLineaire(configuration.monde.ouvertureMinDebut, configuration.monde.ouvertureMinFin, progression);
  const ouvertureMax = interpolationLineaire(configuration.monde.ouvertureMaxDebut, configuration.monde.ouvertureMaxFin, progression);
  const ouverture = aleatoire(ouvertureMin, ouvertureMax);

  const margeHaut = 70;
  const margeBas = monde.ySol - 70;
  const centreOuvertureY = aleatoire(margeHaut + ouverture * 0.5, margeBas - ouverture * 0.5);

  monde.tuyaux.push({
    x: canevas.width + 40,
    w: configuration.monde.largeurTuyau,
    centreOuvertureY,
    hauteurOuverture: ouverture,
    type: choisirTypeTuyau(),
    phase: aleatoire(0, Math.PI * 2),
    scoreDejaCompte: false
  });
}

// =========================================================
// Particules (feedback visuel)
// =========================================================
function ajouterParticulesTap(x, y) {
  for (let i = 0; i < 9; i++) {
    monde.particules.push({
      x,
      y,
      vx: aleatoire(-55, 55),
      vy: aleatoire(-20, 70),
      vie: aleatoire(0.16, 0.32),
      taille: aleatoire(2, 4),
      teinte: aleatoire(35, 65)
    });
  }
}

function mettreAJourParticules(dt) {
  for (const p of monde.particules) {
    p.vie -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt;
  }
  monde.particules = monde.particules.filter((p) => p.vie > 0);
}

// =========================================================
// Entrees utilisateur
// =========================================================
function demanderSaut() {
  if (partie.mode === "en_cours") {
    entree.sautEnAttente = true;
  }
}

canevas.addEventListener("pointerdown", () => {
  if (partie.mode === "menu") {
    demarrerPartie();
  } else if (partie.mode === "perdu" || partie.mode === "gagne") {
    reinitialiserPartie();
    demarrerPartie();
  } else {
    demanderSaut();
  }
});

window.addEventListener("keydown", (evenement) => {
  if (evenement.code === "Space" || evenement.code === "ArrowUp") {
    evenement.preventDefault();
    if (partie.mode === "menu") {
      demarrerPartie();
    } else if (partie.mode === "perdu" || partie.mode === "gagne") {
      reinitialiserPartie();
      demarrerPartie();
    } else {
      demanderSaut();
    }
  }

  if (evenement.code === "Enter" && (partie.mode === "perdu" || partie.mode === "gagne")) {
    reinitialiserPartie();
  }
});

// Le gyroscope est volontairement informatif ici (pas necessaire au gameplay)
async function demanderPermissionGyroscope() {
  if (typeof DeviceOrientationEvent === "undefined") {
    definirEtat("Gyroscope indisponible");
    return;
  }

  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const reponse = await DeviceOrientationEvent.requestPermission();
      if (reponse !== "granted") {
        definirEtat("Permission gyroscope refusee");
        return;
      }
    }
    definirEtat("Gyroscope active (jeu au tap)");
  } catch (erreur) {
    definirEtat("Erreur gyroscope");
    console.error(erreur);
  }
}

// =========================================================
// Flux de partie
// =========================================================
function reinitialiserPartie() {
  // Etat general
  partie.mode = "menu";
  partie.score = 0;
  partie.temps = 0;
  partie.signeGravite = 1;
  partie.minuterieBoost = 0;
  partie.minuterieInverse = 0;
  partie.minuterieRafale = 0;
  partie.forceRafale = 0;

  // Monde
  monde.minuterieTuyau = 0;
  monde.tuyaux = [];
  monde.particules = [];
  monde.vitesseDefilement = configuration.monde.vitesseDefilementBase;
  monde.intervalleTuyau = configuration.monde.intervalleTuyauBase;

  // Joueur
  henriette.y = canevas.height * configuration.joueur.ratioYDepart;
  henriette.vitesseY = 0;
  henriette.minuterieFlash = 0;
  henriette.tracees = [];
  entree.sautEnAttente = false;

  // UI
  initialiserDecor();
  mettreAJourHud();
  definirEtat("Pret");
  afficherMenu();
}

function appliquerEntree() {
  if (!entree.sautEnAttente) return;

  // Le boost augmente legerement la force du saut.
  const multiplicateurBoost = partie.minuterieBoost > 0 ? 1.22 : 1;
  const impulsion = configuration.physique.impulsionSaut * multiplicateurBoost;
  henriette.vitesseY = impulsion * partie.signeGravite;
  henriette.minuterieFlash = 0.12;
  ajouterParticulesTap(henriette.x - 5, henriette.y + 6);
  entree.sautEnAttente = false;
}

function mettreAJourHenriette(dt) {
  // Gravite de base potentiellement reduite pendant le boost.
  let graviteActive = configuration.physique.gravite;
  if (partie.minuterieBoost > 0) graviteActive *= 0.78;

  henriette.vitesseY += graviteActive * partie.signeGravite * dt;
  henriette.vitesseY = borner(
    henriette.vitesseY,
    -configuration.physique.vitesseChuteMax,
    configuration.physique.vitesseChuteMax
  );

  // Rafale: force verticale aleatoire temporaire.
  if (partie.minuterieRafale > 0) {
    henriette.vitesseY += partie.forceRafale * dt;
  }

  henriette.y += henriette.vitesseY * dt;

  // Mise a jour du timer de flash
  if (henriette.minuterieFlash > 0) henriette.minuterieFlash -= dt;

  // Tracees visuelles derriere le carre
  henriette.tracees.push({ x: henriette.x, y: henriette.y, alpha: 1 });
  if (henriette.tracees.length > 14) henriette.tracees.shift();
  for (const t of henriette.tracees) t.alpha *= 0.88;
}

function appliquerPouvoirTuyau(tuyau) {
  if (tuyau.type === "boost") {
    partie.minuterieBoost = 2.6;
    henriette.vitesseY -= 80 * partie.signeGravite;
    ajouterParticulesTap(henriette.x + 6, henriette.y - 4);
    definirEtat("Boost rouge!");
    return;
  }

  if (tuyau.type === "inverse") {
    partie.signeGravite *= -1;
    partie.minuterieInverse = 3.8;
    ajouterParticulesTap(henriette.x + 6, henriette.y - 4);
    definirEtat("Gravite inversee!");
    return;
  }

  if (tuyau.type === "rafale") {
    partie.minuterieRafale = 3.0;
    partie.forceRafale = aleatoire(-260, 260);
    definirEtat("Rafale violette!");
  }
}

function mettreAJourDifficulte() {
  // Difficulte continue basee sur la progression du score.
  const progression = borner(partie.score / configuration.objectifScore, 0, 1);
  monde.vitesseDefilement = interpolationLineaire(configuration.monde.vitesseDefilementBase, 270, progression);
  monde.intervalleTuyau = interpolationLineaire(configuration.monde.intervalleTuyauBase, 0.88, progression);
}

function mettreAJourMonde(dt) {
  mettreAJourDifficulte();

  const vitesse = monde.vitesseDefilement;
  partie.temps += dt;
  monde.minuterieTuyau += dt;

  // Spawn tuyaux
  if (monde.minuterieTuyau >= monde.intervalleTuyau) {
    monde.minuterieTuyau = 0;
    genererPaireTuyaux();
  }

  // Timers des pouvoirs
  if (partie.minuterieBoost > 0) partie.minuterieBoost -= dt;

  if (partie.minuterieInverse > 0) {
    partie.minuterieInverse -= dt;
    if (partie.minuterieInverse <= 0) {
      partie.signeGravite = 1;
      definirEtat("Gravite normale");
    }
  }

  if (partie.minuterieRafale > 0) partie.minuterieRafale -= dt;

  // Deplacement des tuyaux + score
  for (const tuyau of monde.tuyaux) {
    // Les tuyaux "rafale" ont une ouverture qui oscille.
    if (tuyau.type === "rafale") {
      tuyau.centreOuvertureY += Math.sin(partie.temps * 2.6 + tuyau.phase) * 18 * dt;
      tuyau.centreOuvertureY = borner(tuyau.centreOuvertureY, 95, monde.ySol - 95);
    }

    tuyau.x -= vitesse * dt;

    // Quand Henriette depasse le tuyau, on marque le point.
    if (!tuyau.scoreDejaCompte && tuyau.x + tuyau.w < henriette.x) {
      tuyau.scoreDejaCompte = true;
      partie.score += 1;
      appliquerPouvoirTuyau(tuyau);
      ajouterParticulesTap(henriette.x + 2, henriette.y - 2);

      // Condition de victoire
      if (partie.score >= configuration.objectifScore) {
        gagnerPartie();
        return;
      }
    }
  }

  monde.tuyaux = monde.tuyaux.filter((t) => t.x + t.w > -20);

  // Parallaxe du fond
  for (const arbre of monde.arbresLointains) {
    arbre.x -= vitesse * 0.3 * dt;
    if (arbre.x < -60) arbre.x = canevas.width + aleatoire(20, 180);
  }

  for (const fleur of monde.fleurs) {
    fleur.x -= vitesse * dt;
    if (fleur.x < -8) fleur.x = canevas.width + aleatoire(10, 80);
  }
}

function verifierCollisions() {
  const cercleCollision = { x: henriette.x, y: henriette.y, r: henriette.rayonCollision };

  // Collision sol
  if (henriette.y + henriette.rayonCollision >= monde.ySol) {
    henriette.y = monde.ySol - henriette.rayonCollision;
    perdrePartie("Le carre touche le sol");
    return;
  }

  // Collision plafond
  if (henriette.y - henriette.rayonCollision <= 0) {
    henriette.y = henriette.rayonCollision;
    perdrePartie("Le carre touche le haut");
    return;
  }

  // Collision tuyaux
  for (const tuyau of monde.tuyaux) {
    const rectHaut = {
      x: tuyau.x,
      y: 0,
      w: tuyau.w,
      h: tuyau.centreOuvertureY - tuyau.hauteurOuverture * 0.5
    };

    const rectBas = {
      x: tuyau.x,
      y: tuyau.centreOuvertureY + tuyau.hauteurOuverture * 0.5,
      w: tuyau.w,
      h: monde.ySol - (tuyau.centreOuvertureY + tuyau.hauteurOuverture * 0.5)
    };

    if (collisionCercleRectangle(rectHaut, cercleCollision) || collisionCercleRectangle(rectBas, cercleCollision)) {
      perdrePartie("Collision avec un tuyau");
      return;
    }
  }
}

// =========================================================
// Interface utilisateur
// =========================================================
function mettreAJourHud() {
  panneauScore.innerHTML = `Score: <strong>${partie.score} / ${configuration.objectifScore}</strong>`;
}

function definirEtat(texte) {
  panneauEtat.innerHTML = `Etat: <strong>${texte}</strong>`;
}

function afficherMenu() {
  overlayCentre.classList.remove("hidden");
  carteMessage.innerHTML = `
    <h1>Henriette Flappy Challenge</h1>
    <p>Atteins <strong>${configuration.objectifScore}</strong> points pour gagner.</p>
    <p>Tap/clic ou Espace/Fleche haut pour flap.<br>
    Rouge = boost, Bleu = gravite inversee, Violet = rafales.</p>
    <div class="btn-row">
      <button class="primary" id="startBtn">Demarrer</button>
      <button class="secondary" id="motionBtn">Info gyroscope</button>
    </div>
    <p class="hint">Le jeu accelere et les ouvertures se reduisent avec le score.</p>
  `;
  brancherBoutonsOverlay();
}

function afficherFinPartie(titre, sousTitre, estSucces) {
  overlayCentre.classList.remove("hidden");
  carteMessage.innerHTML = `
    <h1 style="color:${estSucces ? "var(--succes)" : "var(--danger)"};">${titre}</h1>
    <p>${sousTitre}</p>
    <p>Score final: <strong>${partie.score}</strong></p>
    <div class="btn-row">
      <button class="primary" id="startBtn">Rejouer</button>
      <button class="secondary" id="motionBtn">Info gyroscope</button>
    </div>
    <p class="hint">Tap ou Espace pour redemarrer rapidement.</p>
  `;
  brancherBoutonsOverlay();
}

function brancherBoutonsOverlay() {
  // Les boutons du message sont recrees a chaque affichage.
  const boutonDemarrer = document.getElementById("startBtn");
  const boutonGyro = document.getElementById("motionBtn");

  boutonDemarrer.addEventListener("click", () => {
    if (partie.mode === "menu" || partie.mode === "perdu" || partie.mode === "gagne") {
      demarrerPartie();
    }
  });

  boutonGyro.addEventListener("click", demanderPermissionGyroscope);
}

function demarrerPartie() {
  if (partie.mode === "perdu" || partie.mode === "gagne") {
    reinitialiserPartie();
  }

  partie.mode = "en_cours";
  overlayCentre.classList.add("hidden");
  definirEtat("En vol");
  henriette.vitesseY = -120;
  ajouterParticulesTap(henriette.x, henriette.y);
  if (monde.tuyaux.length === 0) genererPaireTuyaux();
}

function perdrePartie(raison) {
  if (partie.mode !== "en_cours") return;
  partie.mode = "perdu";
  definirEtat("Perdu");
  afficherFinPartie("Partie terminee", raison, false);
}

function gagnerPartie() {
  if (partie.mode !== "en_cours") return;
  partie.mode = "gagne";
  definirEtat("Victoire");
  afficherFinPartie("Bravo, objectif atteint!", "Tu as atteint 50 points.", true);
}

// =========================================================
// Rendu visuel
// =========================================================
function dessinerNuage(x, y, echelle) {
  contexte.fillStyle = "#ffffff";
  contexte.beginPath();
  contexte.arc(x - 25 * echelle, y, 18 * echelle, 0, Math.PI * 2);
  contexte.arc(x, y - 8 * echelle, 24 * echelle, 0, Math.PI * 2);
  contexte.arc(x + 25 * echelle, y, 18 * echelle, 0, Math.PI * 2);
  contexte.fill();
}

function dessinerFond() {
  const degradeCiel = contexte.createLinearGradient(0, 0, 0, canevas.height);
  degradeCiel.addColorStop(0, "#7ed7ff");
  degradeCiel.addColorStop(1, "#d6f6ff");
  contexte.fillStyle = degradeCiel;
  contexte.fillRect(0, 0, canevas.width, canevas.height);

  // Nuages
  contexte.globalAlpha = 0.45;
  dessinerNuage(120, 85, 1.1);
  dessinerNuage(canevas.width * 0.5, 66, 0.9);
  dessinerNuage(canevas.width - 160, 100, 1.25);
  contexte.globalAlpha = 1;

  // Arbres loins
  for (const arbre of monde.arbresLointains) {
    const hautTronc = monde.ySol - arbre.hauteurTronc;
    contexte.fillStyle = "#8f613b";
    contexte.fillRect(arbre.x - 4, hautTronc, 8, arbre.hauteurTronc);
    contexte.fillStyle = "#58b95a";
    contexte.beginPath();
    contexte.arc(arbre.x, hautTronc, arbre.rayonCime, 0, Math.PI * 2);
    contexte.fill();
  }

  // Sol
  contexte.fillStyle = "#65c961";
  contexte.fillRect(0, monde.ySol, canevas.width, canevas.height - monde.ySol);
  contexte.fillStyle = "#4a9e4a";
  contexte.fillRect(0, monde.ySol + 15, canevas.width, canevas.height - monde.ySol);

  // Fleurs
  for (const fleur of monde.fleurs) {
    contexte.fillStyle = `hsl(${fleur.teinte}, 85%, 67%)`;
    contexte.beginPath();
    contexte.arc(fleur.x, fleur.y, 2.6, 0, Math.PI * 2);
    contexte.fill();
  }
}

function paletteTuyau(type) {
  if (type === "boost") return { corps: "#d94949", tete: "#a62f2f", marque: "B" };
  if (type === "inverse") return { corps: "#4386e0", tete: "#2a5dab", marque: "I" };
  if (type === "rafale") return { corps: "#9b58d5", tete: "#6f38a8", marque: "W" };
  return { corps: "#3fb15f", tete: "#2f8f4c", marque: "" };
}

function dessinerPaireTuyaux(tuyau) {
  const hauteurTete = 14;
  const hauteurHaut = tuyau.centreOuvertureY - tuyau.hauteurOuverture * 0.5;
  const yBas = tuyau.centreOuvertureY + tuyau.hauteurOuverture * 0.5;
  const hauteurBas = monde.ySol - yBas;
  const palette = paletteTuyau(tuyau.type);

  contexte.fillStyle = palette.corps;
  contexte.fillRect(tuyau.x, 0, tuyau.w, hauteurHaut);
  contexte.fillRect(tuyau.x, yBas, tuyau.w, hauteurBas);

  contexte.fillStyle = palette.tete;
  contexte.fillRect(tuyau.x - 4, hauteurHaut - hauteurTete, tuyau.w + 8, hauteurTete);
  contexte.fillRect(tuyau.x - 4, yBas, tuyau.w + 8, hauteurTete);

  contexte.strokeStyle = "rgba(0,0,0,0.16)";
  contexte.lineWidth = 2;
  contexte.strokeRect(tuyau.x, 0, tuyau.w, hauteurHaut);
  contexte.strokeRect(tuyau.x, yBas, tuyau.w, hauteurBas);

  // Lettre de type pour la lisibilite
  if (palette.marque) {
    contexte.fillStyle = "rgba(255,255,255,0.92)";
    contexte.font = "bold 18px Trebuchet MS";
    contexte.textAlign = "center";
    contexte.fillText(palette.marque, tuyau.x + tuyau.w * 0.5, hauteurHaut + 22);
  }
}

function dessinerHenriette() {
  // Tracees
  for (let i = 0; i < henriette.tracees.length; i++) {
    const t = henriette.tracees[i];
    const alpha = (i / henriette.tracees.length) * 0.2;
    contexte.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    contexte.fillRect(t.x - 12, t.y - 12, 24, 24);
  }

  // Petite rotation selon la vitesse verticale
  const inclinaison = borner(henriette.vitesseY / 700, -0.35, 0.35);
  contexte.save();
  contexte.translate(henriette.x, henriette.y);
  contexte.rotate(inclinaison);

  // Halo au moment d'un saut
  if (henriette.minuterieFlash > 0) {
    contexte.fillStyle = "rgba(255, 238, 166, 0.85)";
    contexte.fillRect(-16, -16, 32, 32);
  }

  // Corps du carre
  contexte.fillStyle = "#ffffff";
  contexte.fillRect(-15, -15, 30, 30);
  contexte.strokeStyle = "rgba(90,120,150,0.7)";
  contexte.lineWidth = 2;
  contexte.strokeRect(-15, -15, 30, 30);

  // Etiquette "henriette"
  contexte.fillStyle = "#39536c";
  contexte.font = "bold 8px Trebuchet MS";
  contexte.textAlign = "center";
  contexte.fillText("henriette", 0, 2);
  contexte.restore();
}

function dessinerParticules() {
  for (const p of monde.particules) {
    const alpha = borner(p.vie / 0.32, 0, 1);
    contexte.fillStyle = `hsla(${p.teinte}, 90%, 67%, ${alpha})`;
    contexte.beginPath();
    contexte.arc(p.x, p.y, p.taille, 0, Math.PI * 2);
    contexte.fill();
  }
}

function dessinerFrame() {
  dessinerFond();
  for (const tuyau of monde.tuyaux) dessinerPaireTuyaux(tuyau);
  dessinerParticules();
  dessinerHenriette();
}

// =========================================================
// Boucle principale (requestAnimationFrame)
// =========================================================
let dernierTemps = performance.now();

function boucleJeu(tempsActuel) {
  const dt = Math.min((tempsActuel - dernierTemps) / 1000, 0.033);
  dernierTemps = tempsActuel;

  if (partie.mode === "en_cours") {
    appliquerEntree();
    mettreAJourHenriette(dt);
    mettreAJourMonde(dt);
    mettreAJourParticules(dt);
    verifierCollisions();
    mettreAJourHud();
  } else {
    mettreAJourParticules(dt);
  }

  dessinerFrame();
  requestAnimationFrame(boucleJeu);
}

// =========================================================
// Demarrage initial de l'application
// =========================================================
boutonDemarrerInitial.addEventListener("click", () => {
  if (partie.mode === "menu") demarrerPartie();
});
boutonGyroInitial.addEventListener("click", demanderPermissionGyroscope);

redimensionnerCanevas();
reinitialiserPartie();
requestAnimationFrame(boucleJeu);