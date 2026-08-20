import * as THREE from "three";

const geoCache = new Map();
function geo(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}

// ============================================================
//  RACCHETTE  (tutte hanno la STESSA hitbox orizzontale `hd`;
//             possono avere verticalità extra a livello grafico)
// ============================================================
export function makePaddle(color, hw, hd, hh, theme = {}) {
  const g = new THREE.Group();
  const style = theme.style || "neon";

  // Colore del corpo un po' più scuro per il ghiaccio, come prima.
  const baseColor = style === "ice" ? darken(color, 0.3) : color;
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: theme.paddleMetalness ?? 0.55,
    roughness: theme.paddleRoughness ?? 0.22,
    emissive: color,
    emissiveIntensity: theme.paddleEmissive ?? 0.22
  });

  // "body" viene scalato da game.js (allunga, powerup, paddleSize).
  // Tutte le grafiche devono quindi vivere DENTRO body per ridimensionarsi.
  const body = new THREE.Group();
  body.scale.set(hw * 2, hh * 2, hd * 2);
  const art = new THREE.Group();
  body.add(art);
  g.add(body);

  if (style === "boot") {
    buildBoot(art, mat);
  } else if (style === "jungle") {
    buildJungle(art, mat);
  } else if (style === "sushi") {
    buildSushi(art, mat);
  } else if (style === "viking") {
    buildVikingShip(art, mat);
  } else if (style === "western") {
    buildWesternPlank(art, mat);
  } else if (style === "airhockey") {
    buildAirHockey(art, mat, color);
  } else if (style === "baseball") {
    buildBaseball(art, mat);
  } else if (style === "tennis") {
    buildTennis(art, mat);
  } else {
    buildDefault(art, mat, color, theme, style);
  }

  // La misura di contatto è la fonte di verità. Gli oggetti tematici possono
  // essere alti quanto serve, ma non devono mai sembrare più lunghi della
  // racchetta che effettivamente può colpire (asse locale Z).
  fitPaddleArt(art, body, hd);

  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.body = body;
  g.userData.mat = mat;
  // I modelli tematici mantengono le proporzioni anche quando Allunga
  // aumenta la misura della hitbox lungo Z: la parte scenica può crescere in Y.
  g.userData.scaleHeightWithLength = style !== "neon";
  g.userData.baseEmissive = theme.paddleEmissive ?? 0.22;
  return g;
}

// ---- costruzioni dei corpi (tutte in coordinate normalizzate [-0.5..0.5]) ----

function fitPaddleArt(art, body, hitLength) {
  body.updateMatrixWorld(true);
  art.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(art);
  const worldLength = box.max.z - box.min.z;
  const allowed = hitLength * 2 * 0.98;
  if (worldLength > allowed && worldLength > 0.001) {
    art.scale.z *= allowed / worldLength;
  }
}

function buildDefault(body, mat, color, theme, style) {
  const block = new THREE.Mesh(geo("paddle", () => new THREE.BoxGeometry(1, 1, 1)), mat);
  body.add(block);
  const edgeCol = style === "ice" ? 0xffffff : (style === "mono" ? 0xcccccc : 0xffffff);
  const edgeThickness = style === "ice" ? 0.22 : 0.14;
  const edge = new THREE.Mesh(
    geo("paddleEdge-" + style, () => new THREE.BoxGeometry(1.1, edgeThickness, 1.04)),
    new THREE.MeshStandardMaterial({
      color: edgeCol,
      emissive: color,
      emissiveIntensity: theme.edgeGlow ?? 1.4,
      roughness: style === "ice" ? 0.08 : 0.52,
      metalness: style === "ice" ? 0.18 : 0
    })
  );
  edge.position.y = 0.55;
  body.add(edge);
}

function buildBoot(body, leather) {
  // Uno scarpone da calcio visto dall'alto: punta, tomaia, lacci e tacchetti
  // restano dentro la lunghezza reale della zona di contatto (asse Z).
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.92 });
  const laceMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.65 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd82828, roughness: 0.55, emissive: 0x300000, emissiveIntensity: 0.15 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.6 });

  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.14, 1.0), soleMat);
  sole.position.y = -0.18;
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.42, 5, 12), leather);
  upper.rotation.x = Math.PI / 2;
  upper.scale.set(1.15, 1, 0.92);
  upper.position.set(0, 0.08, 0.02);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), leather);
  toe.scale.set(1.15, 0.7, 0.85);
  toe.position.set(0, 0.0, 0.36);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.38, 0.28), leather);
  heel.position.set(0, 0.1, -0.32);
  const toeCap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.2, 0.16), white);
  toeCap.position.set(0, 0.06, 0.48);
  // Colletto alto: la racchetta deve leggere come uno scarpone anche di lato.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.92, 14), leather);
  collar.position.set(0, 0.65, -0.22);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.055, 7, 14), white);
  cuff.position.set(0, 1.08, -0.22);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.48), leather);
  tongue.position.set(0, 0.58, 0.03);

  // Lacci trasversali sopra la linguetta.
  for (let i = 0; i < 4; i++) {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.035, 0.045), laceMat);
    lace.position.set(0, 0.47 - i * 0.015, -0.12 + i * 0.1);
    body.add(lace);
  }
  // Strisce laterali che seguono la tomaia.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.14), stripeMat);
      stripe.position.set(side * 0.39, 0.12, -0.12 + i * 0.14);
      stripe.rotation.y = side * 0.2;
      body.add(stripe);
    }
  }
  // Tacchetti, visibili sotto la suola senza allargare il contatto laterale.
  for (let zi = 0; zi < 4; zi++) {
    for (let xi = 0; xi < 2; xi++) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.12, 8), soleMat);
      stud.position.set(-0.22 + xi * 0.44, -0.3, -0.34 + zi * 0.22);
      body.add(stud);
    }
  }
  body.add(sole, upper, toe, heel, toeCap, collar, cuff, tongue);
}

function buildJungle(body, barkMat) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x30200e, roughness: 1 });
  const vine = new THREE.MeshStandardMaterial({ color: 0x3d6f28, roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x5ea23a, roughness: 0.9 });
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 1.02, 12), barkMat);
  log.rotation.x = Math.PI / 2;
  for (const z of [-0.4, 0.38]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.05, 6, 14), z < 0 ? dark : vine);
    ring.position.z = z;
    body.add(ring);
  }
  // Foglie 3D che spuntano dal tronco.
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), leaf);
    l.scale.set(0.5, 0.25, 1.1);
    l.position.set(Math.cos(a) * 0.46, 0.3 + Math.random() * 0.2, Math.sin(a) * 0.2);
    l.rotation.z = a;
    body.add(l);
  }
  body.add(log);
}

function buildSushi(body, _mat) {
  // Un solo maki: riso visibile soltanto sulle due piccole estremità, nori
  // avvolto quasi per tutta la lunghezza. Nessun accessorio sporge dal rotolo.
  const riceMat = new THREE.MeshStandardMaterial({ color: 0xf7f2e4, roughness: 0.65 });
  const noriMat = new THREE.MeshStandardMaterial({ color: 0x0b1516, roughness: 0.9, side: THREE.DoubleSide });
  const R = 0.46;
  const L = 0.98;
  const rice = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24), riceMat);
  rice.rotation.x = Math.PI / 2;

  // Il bordo nori lascia solo l'ultimo 5% di ciascun lato al riso bianco.
  const noriLength = L * 0.9;
  const nori = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.008, R + 0.008, noriLength, 24, 1, true),
    noriMat
  );
  nori.rotation.x = Math.PI / 2;
  body.add(rice, nori);
}

function buildVikingShip(body, _mat) {
  // DRAKKAR: scafo lungo Z (la lunghezza della racchetta), prua verso +X
  // (la palla), albero con vela a strisce, scudi sui due fianchi, remi.
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a3e1c, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1809, roughness: 0.95 });
  const sail = new THREE.MeshStandardMaterial({ color: 0xe6d0a5, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb58c3a, metalness: 0.7, roughness: 0.3, emissive: 0x402800, emissiveIntensity: 0.25 });
  const red  = new THREE.MeshStandardMaterial({ color: 0xa82020, roughness: 0.7 });

  // Scafo: capsula lunga Z (larga ~0.7, lunga ~1.3 in Z).
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 6, 14), wood);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1, 0.75, 1.3);
  hull.position.set(0, -0.05, 0);
  // Ponte piatto.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 1.05), dark);
  deck.position.set(0, 0.2, 0);
  // Chiglia rossa sotto.
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.12), red);
  keel.position.set(0, -0.3, 0);
  // Albero.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.0, 8), wood);
  mast.position.set(-0.02, 0.72, 0);
  // Vela (steccata, con striscia rossa al centro).
  const sailCloth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, 0.85), sail);
  sailCloth.position.set(-0.02, 0.8, 0);
  const redStripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.86), red);
  redStripe.position.set(-0.01, 0.8, 0);
  // Testa di drago a prua (+X: verso la palla).
  const dragonGrp = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 8), wood);
  neck.rotation.z = -Math.PI / 3;
  neck.position.set(0.42, 0.3, 0);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 8), wood);
  head.rotation.z = -Math.PI / 2.2;
  head.position.set(0.58, 0.52, 0);
  for (const sy of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 6), metal);
    horn.rotation.z = Math.PI / 3.5;
    horn.position.set(0.52 + sy*0.02, 0.62, sy * 0.07);
    dragonGrp.add(horn);
  }
  dragonGrp.add(neck, head);
  // Coda a poppa (-X).
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 8), wood);
  tail.rotation.z = Math.PI / 2.5;
  tail.position.set(-0.48, 0.32, 0);
  // Scudi rotondi sui due fianchi (±Z).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const zPos = -0.3 + i * 0.3;
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 14), i % 2 ? red : metal);
      sh.rotation.x = Math.PI / 2;
      sh.position.set(0, 0.2, side * 0.42);
      sh.position.z = zPos;
      body.add(sh);
    }
  }
  // Remi da entrambi i lati (±Z).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const zPos = -0.35 + i * 0.24;
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.5, 6), dark);
      oar.rotation.z = -side * 0.55;
      oar.position.set(0.05, 0.0, side * 0.42);
      oar.position.z = zPos;
      body.add(oar);
    }
  }
  body.add(hull, deck, keel, mast, sailCloth, redStripe, dragonGrp, tail);
}

function buildWesternPlank(body, _mat) {
  // Tavoletta da saloon: assi verticali con borchie e stella da sceriffo.
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5022, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x40210c, roughness: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a84a, metalness: 0.8, roughness: 0.25, emissive: 0x5c3a08, emissiveIntensity: 0.18 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8b2626, roughness: 0.7, emissive: 0x2a0808, emissiveIntensity: 0.15 });
  // Tre assi verticali che formano la tavola.
  for (let i = 0; i < 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 1.0), wood);
    plank.position.set(-0.3 + i * 0.3, 0, 0);
    body.add(plank);
  }
  // Cornice scura (bordo tutt'attorno).
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.05), dark);
  top.position.set(0, 0.28, 0);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.05), dark);
  bot.position.set(0, -0.28, 0);
  body.add(top, bot);
  // Borchie agli angoli.
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.42, 0.42]) {
      const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), brass);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(x, 0.26, z);
      body.add(rivet);
      const r2 = rivet.clone();
      r2.position.y = -0.26;
      body.add(r2);
    }
  }
  // Stella da sceriffo al centro.
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), brass);
  star.position.set(0, 0.05, 0.35);
  // Fazzoletto rosso da cowboy in angolo (un piccolo cono = bandana annodata).
  const bandana = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 6), red);
  bandana.rotation.z = Math.PI / 2;
  bandana.position.set(-0.38, -0.1, 0.38);
  body.add(star, bandana);
}

function buildAirHockey(body, _mat, color) {
  // Mazza da air hockey: base circolare bassa, manico corto e bordo luminoso.
  const baseMat = new THREE.MeshStandardMaterial({ color: color || 0x5fd8ff, metalness: 0.45, roughness: 0.25, emissive: color || 0x5fd8ff, emissiveIntensity: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x162b42, metalness: 0.35, roughness: 0.32 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.18, 24), baseMat);
  base.position.y = -0.12;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.055, 8, 24), dark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.01;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.86, 12), dark);
  handle.position.y = 0.48;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), baseMat);
  cap.position.y = 0.94;
  body.add(base, rim, handle, cap);
}

function buildBaseball(body, _mat) {
  // Mazza da baseball: canna larga, manico sottile e pomello. L'asse Z è la
  // lunghezza di contatto, mentre la parte alta può crescere senza falsare la hitbox.
  const batMat = new THREE.MeshStandardMaterial({ color: 0xc58a4a, roughness: 0.72 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x30231a, roughness: 0.9 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.72, 16), batMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.12;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.48, 12), gripMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.48;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), gripMat);
  knob.scale.set(1.15, 0.7, 0.8);
  knob.position.z = -0.72;
  const tape = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 12), gripMat);
  tape.rotation.x = Math.PI / 2;
  tape.position.z = -0.55;
  body.add(barrel, handle, knob, tape);
}

function buildTennis(body, _mat) {
  // Racchetta da tennis stilizzata: telaio, corde e manico. La lunghezza del
  // telaio segue Z e viene ricondotta alla hitbox dalla misura applicata in
  // makePaddle; l'altezza del manico può invece sporgere in Y.
  const frame = new THREE.MeshStandardMaterial({ color: 0x1b552f, metalness: 0.15, roughness: 0.48 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x8b4d2e, roughness: 0.86 });
  const strings = new THREE.MeshBasicMaterial({ color: 0xe7f4d2, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
  const ball = new THREE.MeshStandardMaterial({ color: 0xc7f03d, roughness: 0.5, emissive: 0x536b12, emissiveIntensity: 0.12 });
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 8, 18), frame);
  hoop.scale.set(0.78, 1, 1.18);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = 0.12;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.74), strings);
  net.rotation.x = Math.PI / 2;
  net.position.set(0, 0.12, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.48), grip);
  handle.position.set(0, -0.2, -0.43);
  const butt = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), grip);
  butt.scale.set(1, 0.65, 1.1);
  butt.position.set(0, -0.2, -0.66);
  const tennisBall = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), ball);
  tennisBall.position.set(0.18, 0.38, 0.16);
  // Seconda lettura in altezza: una racchetta da tennis riconoscibile anche
  // dal profilo, non solo come un anello schiacciato sul tavolo.
  const uprightHoop = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 8, 18), frame);
  uprightHoop.scale.set(0.78, 1.25, 1);
  uprightHoop.position.set(0, 0.62, 0.02);
  const uprightNet = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.74), strings);
  uprightNet.position.set(0, 0.62, 0.08);
  body.add(hoop, net, handle, butt, tennisBall, uprightHoop, uprightNet);
}

function darken(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return (Math.floor(r * (1 - k)) << 16) | (Math.floor(g * (1 - k)) << 8) | Math.floor(b * (1 - k));
}

// ============================================================
//  PALLINE: grafiche a tema (il collisore resta SEMPRE una sfera)
// ============================================================
export function makeBall(color = 0xffffff, r = 0.22, theme = {}) {
  const style = theme.style || "neon";
  const styleData = theme.ball || null;
  // Se la chiamata impone un colore (es. clown multiball) quel colore prevale.
  const forcedColor = (color !== 0xffffff);
  const finalColor = forcedColor ? color : (styleData?.color ?? color);
  const finalEmissive = forcedColor ? color : (styleData?.emissive ?? color);
  const mat = new THREE.MeshStandardMaterial({
    color: finalColor,
    metalness: styleData?.metalness ?? (theme.ballMetalness ?? 0.65),
    roughness: styleData?.roughness ?? (theme.ballRoughness ?? 0.18),
    emissive: finalEmissive,
    emissiveIntensity: styleData?.emissiveIntensity ?? (theme.ballEmissive ?? 0.18)
  });

  // Il nodo radice è una sfera invisibile che fa da collisore/centro;
  // la grafica tematica (proiettili, asce) è come "decorazione" agganciata
  // ma ruota/segue la palla.
  const root = new THREE.Group();
  const collider = new THREE.Mesh(geo("ball-collider", () => new THREE.SphereGeometry(1, 16, 12)),
    new THREE.MeshBasicMaterial({ visible: false }));
  root.add(collider);

  const mesh = root; // useremo root come mesh (posizione/scala dal codice esistente)
  mesh.scale.setScalar(r);
  mesh.castShadow = true;

  // Decorazioni tematiche visibili.
  const deco = new THREE.Group();
  if (style === "viking" || style === "western") {
    // Più grande della sfera-collisore e orientata nella direzione del volo:
    // la forma resta leggibile anche senza la scia.
    deco.scale.setScalar(1.45);
    deco.userData.directional = true;
  }
  mesh.add(deco);

  if (style === "baseball") {
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f4e8, roughness: 0.62 });
    const red = new THREE.MeshBasicMaterial({ color: 0xd84747 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.92, 20, 14), white);
    const seamA = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.035, 6, 24), red);
    const seamB = seamA.clone();
    seamA.rotation.set(0.65, 0.25, 0.2);
    seamB.rotation.set(-0.65, -0.25, 0.2);
    deco.add(base, seamA, seamB);
  } else if (style === "boot") {
    // Pallone da calcio classico: base bianca + pentagoni neri.
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.55 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.92, 24, 18), whiteMat);
    deco.add(base);
    addSoccerPattern(deco);
  } else if (style === "western") {
    // PALLOTTOLA: bossolo di ottone + punta conica di piombo.
    const brass = new THREE.MeshStandardMaterial({ color: 0xd2a046, metalness: 0.85, roughness: 0.28, emissive: 0x402200, emissiveIntensity: 0.2 });
    const lead  = new THREE.MeshStandardMaterial({ color: 0x3a3028, metalness: 0.75, roughness: 0.45 });
    const brassCap = new THREE.MeshStandardMaterial({ color: 0x904020, roughness: 0.6 });
    // Tutte le misure sono calibrate per stare dentro un raggio ~1.
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.7, 16), brass);
    shell.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.55, 18), lead);
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.6;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 16), brassCap);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = -0.38;
    // Incisione anulare sul bossolo (dettaglio realistico).
    const groove = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.025, 6, 18),
      new THREE.MeshStandardMaterial({ color: 0x8a6020, metalness: 0.8, roughness: 0.35 }));
    groove.rotation.y = Math.PI / 2;
    groove.position.x = -0.25;
    deco.add(shell, tip, cap, groove);
  } else if (style === "viking") {
    // ASCIA VICHINGA: manico trasversale e lama larga, leggibile anche mentre
    // la pallina ruota rapidamente.
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2d14, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0xe1e5df, metalness: 0.82, roughness: 0.2, emissive: 0x303844, emissiveIntensity: 0.28 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xb58c3a, metalness: 0.7, roughness: 0.3, emissive: 0x402800, emissiveIntensity: 0.2 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 1.15, 8), wood);
    handle.rotation.z = Math.PI / 2;
    const axeShape = new THREE.Shape();
    axeShape.moveTo(-0.03, 0.42);
    axeShape.quadraticCurveTo(0.36, 0.42, 0.48, 0.12);
    axeShape.quadraticCurveTo(0.42, -0.34, 0.04, -0.43);
    axeShape.lineTo(0.12, -0.06);
    axeShape.lineTo(-0.03, 0.42);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(axeShape, { depth: 0.11, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2 }), iron);
    blade.rotation.y = Math.PI / 2;
    blade.position.x = 0.48;
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), gold);
    wrap.rotation.y = Math.PI / 2;
    wrap.position.x = 0.05;
    deco.add(handle, blade, wrap);
  } else if (style === "sushi") {
    // NIGIRI: blocco di riso ovale, fetta di salmone sopra, fascia di nori.
    const rice = new THREE.MeshStandardMaterial({ color: 0xf5efdc, roughness: 0.7 });
    const nori = new THREE.MeshStandardMaterial({ color: 0x10181a, roughness: 0.9 });
    const fish = new THREE.MeshStandardMaterial({ color: 0xff7a6a, roughness: 0.5, emissive: 0x601a10, emissiveIntensity: 0.15 });
    const avo  = new THREE.MeshStandardMaterial({ color: 0x7dc268, roughness: 0.6 });
    const riceBlob = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 14), rice);
    riceBlob.scale.set(1.05, 0.72, 0.9);
    const fishTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.78), fish);
    fishTop.position.y = 0.4;
    // Venature bianche sul salmone (sottili striscioline).
    for (let i = 0; i < 4; i++) {
      const vein = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.72), rice);
      vein.position.set(-0.3 + i * 0.2, 0.49, 0);
      deco.add(vein);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 6, 22), nori);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.1;
    // Un puntino di wasabi verde per rendere il tema subito riconoscibile.
    const wasabi = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), avo);
    wasabi.scale.set(0.8, 0.6, 0.8);
    wasabi.position.set(-0.3, 0.5, -0.2);
    deco.add(riceBlob, fishTop, band, wasabi);
  } else if (style === "jungle") {
    // Noce di cocco con tre "solchi" scuri.
    const shell = new THREE.MeshStandardMaterial({ color: 0x5a3818, roughness: 0.95 });
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), shell);
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.03, 4, 12),
        new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 1 }));
      line.rotation.y = (i / 3) * Math.PI;
      line.rotation.x = 0.5;
      deco.add(line);
    }
    deco.add(c);
  } else if (style === "neon") {
    const neonBall = new THREE.Mesh(geo("ball-neon", () => new THREE.SphereGeometry(0.95, 24, 18)), mat);
    deco.add(neonBall);
  } else if (style === "ice") {
    // Sul ghiaccio una pallina quasi bianca si perdeva nel tavolo. Usiamo un
    // cristallo ambra ad alto contrasto, con bordo ghiacciato e luce intensa.
    const iceColor = styleData?.color ?? 0xff3d7f;
    const iceGlow = styleData?.emissive ?? 0xff165f;
    const ice = new THREE.Mesh(geo("ball-ice", () => new THREE.IcosahedronGeometry(0.9, 1)),
      new THREE.MeshStandardMaterial({ color: iceColor, emissive: iceGlow, emissiveIntensity: 1.0, metalness: 0.12, roughness: 0.18 }));
    const facets = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.76, wireframe: true }));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.045, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb4d2, transparent: true, opacity: 0.98 }));
    halo.rotation.x = Math.PI / 2;
    deco.add(ice, facets, halo);
  } else if (style === "tennis") {
    const tennis = new THREE.Mesh(geo("ball-tennis", () => new THREE.SphereGeometry(0.92, 20, 14)),
      new THREE.MeshStandardMaterial({ color: 0xc8f23d, emissive: 0x718d16, emissiveIntensity: 0.18, roughness: 0.52 }));
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xf4ffd0, transparent: true, opacity: 0.9 }));
    seam.rotation.set(0.7, 0.35, 0.2);
    deco.add(tennis, seam);
  } else if (style === "airhockey") {
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: 0xf5fbff, metalness: 0.3, roughness: 0.2, emissive: 0x8fdcff, emissiveIntensity: 0.28 }));
    const puckEdge = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.055, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x4dc6ff }));
    puckEdge.rotation.x = Math.PI / 2;
    deco.add(puck, puckEdge);
  } else if (style === "mono") {
    const ink = new THREE.Mesh(geo("ball-mono", () => new THREE.SphereGeometry(0.9, 18, 12)),
      new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.4 }));
    deco.add(ink);
  } else {
    const plain = new THREE.Mesh(geo("ball-plain", () => new THREE.SphereGeometry(0.9, 20, 14)), mat);
    deco.add(plain);
  }

  // Se è un pattern di default non-sovrascritto, aggiungi i pentagoni da calcio.
  if (style === "neon" || style === "mono" || style === "airhockey" || style === "ice" || style === "tennis") {
    // nessun pattern, già fatto
  }

  const lightBase = styleData?.light ?? (theme.ballLight ?? 1.6);
  const light = new THREE.PointLight(finalEmissive, lightBase, 6, 2);
  mesh.add(light);
  mesh.userData.light = light;
  mesh.userData.lightBase = lightBase;
  mesh.userData.mat = mat;
  mesh.userData.deco = deco;
  // Aggancio l'update per far ruotare la decorazione in base alla velocità.
  mesh.userData.spin = () => {
    const speed = Math.hypot(mesh.userData.vx || 0, mesh.userData.vz || 0);
    deco.rotation.x += (mesh.userData.vz || 0) * 0.02;
    deco.rotation.z -= (mesh.userData.vx || 0) * 0.02;
  };
  return mesh;
}

function addSoccerPattern(deco) {
  const black = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.75 });
  const pent = [
    [0, 0.98, 0], [0.9, 0.32, 0.2], [-0.9, 0.32, 0.2],
    [0.58, -0.78, 0.55], [0.58, -0.78, -0.55], [-0.58, -0.78, 0.55], [-0.58, -0.78, -0.55],
    [0, 0.32, 0.95], [0, 0.32, -0.95]
  ];
  for (const [x, y, z] of pent) {
    const len = Math.sqrt(x * x + y * y + z * z);
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.22, 5), black);
    p.position.set(x / len, y / len, z / len);
    p.lookAt(x / len * 2, y / len * 2, z / len * 2);
    deco.add(p);
  }
}

// Aggiorna la pallina (passiamo vx/vz nel syncBall di game.js).
export function tickBallMesh(mesh, vx, vz, dt) {
  if (!mesh) return;
  mesh.userData.vx = vx;
  mesh.userData.vz = vz;
  const deco = mesh.userData.deco;
  if (!deco) return;
  // Rotazione della decorazione in base alla direzione della palla.
  const sp = Math.hypot(vx, vz);
  if (sp > 0.1) {
    const axisX = -vz / sp;
    const axisZ = vx / sp;
    deco.rotateOnWorldAxis(new THREE.Vector3(axisX, 0, axisZ), sp * dt * 0.6);
  }
}

// ============================================================
//  TAVOLI / elementi di arena (già esistenti, adattati ai nuovi stili)
// ============================================================
const surfaceTextures = new Map();
function surfaceTexture(style) {
  const styles = ["jungle", "boot", "airhockey", "baseball", "western", "sushi", "viking", "tennis"];
  if (!styles.includes(style)) return null;
  if (surfaceTextures.has(style)) return surfaceTextures.get(style);
  const S = 256;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const c = cvs.getContext("2d");
  if (style === "airhockey") {
    c.fillStyle = "#8bd7ee"; c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(255,255,255,.28)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, S / 2); c.lineTo(S, S / 2); c.stroke();
    c.strokeStyle = "rgba(29,105,170,.24)";
    c.strokeRect(18, 18, S - 36, S - 36);
    c.beginPath(); c.arc(S / 2, S / 2, 36, 0, Math.PI * 2); c.stroke();
  } else if (style === "baseball") {
    c.fillStyle = "#3f9652"; c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 24) {
      c.fillStyle = y % 48 ? "rgba(255,255,255,.025)" : "rgba(5,60,24,.08)";
      c.fillRect(0, y, S, 24);
    }
    c.strokeStyle = "rgba(247,244,232,.85)"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(S / 2, S / 2); c.lineTo(S / 2, S - 20); c.lineTo(S - 20, S - 20); c.stroke();
    c.strokeStyle = "rgba(216,71,71,.5)"; c.lineWidth = 2;
    c.strokeRect(18, 18, S - 36, S - 36);
  } else if (style === "western") {
    c.fillStyle = "#8a5022"; c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {
      c.strokeStyle = `rgba(50,25,8,${0.04 + Math.random() * 0.08})`;
      c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke();
    }
    for (const x of [S/4, S/2, (S*3)/4]) {
      c.strokeStyle = "rgba(30,15,5,0.6)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke();
    }
  } else if (style === "viking") {
    c.fillStyle = "#55361d"; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = `rgba(${30 + Math.random()*25},${15+Math.random()*15},${5+Math.random()*8},0.35)`;
      c.fillRect(Math.random() * S, Math.random() * S, 2, 1);
    }
  } else if (style === "sushi") {
    c.fillStyle = "#1a2628"; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 600; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      c.fillRect(Math.random() * S, Math.random() * S, 1, 1);
    }
  } else if (style === "tennis") {
    c.fillStyle = "#b85c38"; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = `rgba(${90+Math.random()*30},${30+Math.random()*20},${10+Math.random()*10},0.32)`;
      c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    c.strokeStyle = "rgba(247,240,221,.8)"; c.lineWidth = 3;
    c.strokeRect(24, 18, S - 48, S - 36);
    c.beginPath(); c.moveTo(S / 2, 18); c.lineTo(S / 2, S - 18); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.moveTo(24, S / 2); c.lineTo(S - 24, S / 2); c.stroke();
  } else {
    c.fillStyle = style === "boot" ? "#a8c59d" : "#a3b68b";
    c.fillRect(0, 0, S, S);
    if (style === "boot") {
      for (let x = 0; x < S; x += 64) {
        c.fillStyle = (x/64) % 2 ? "rgba(35,75,35,.14)" : "rgba(255,255,220,.05)";
        c.fillRect(x, 0, 32, S);
      }
    }
    let seed = style === "boot" ? 91 : 37;
    const rnd = () => ((seed = (seed*1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 900; i++) {
      const x = rnd()*S, y = rnd()*S;
      c.strokeStyle = rnd() > 0.5 ? "rgba(24,68,24,.2)" : "rgba(235,245,190,.12)";
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x+rnd()*3-1.5, y-2-rnd()*4); c.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  tex.anisotropy = 4;
  surfaceTextures.set(style, tex);
  return tex;
}

function themedStandardMaterial(color, theme = {}, extra = {}) {
  const style = theme.style || "neon";
  return new THREE.MeshStandardMaterial({
    color,
    map: surfaceTexture(style),
    metalness: theme.tableMetalness ?? 0.35,
    roughness: theme.tableRoughness ?? 0.38,
    emissive: color,
    emissiveIntensity: theme.tableEmissive ?? 0.04,
    ...extra
  });
}

function rimMaterial(lineColor, theme) {
  const style = theme.style || "neon";
  const woodStyles = ["jungle", "viking", "western", "sushi", "tennis"];
  return new THREE.MeshStandardMaterial({
    color: woodStyles.includes(style) ? 0x2a180a : (style === "boot" ? 0xe7e1d4 : (style === "ice" ? 0xffffff : 0x0a0c12)),
    metalness: (style === "neon" || style === "ice") ? 0.7 : 0,
    roughness: (style === "neon" || style === "ice") ? (style === "ice" ? 0.08 : 0.25) : 0.78,
    emissive: lineColor,
    emissiveIntensity: theme.rimGlow ?? 0.35
  });
}

export function makeTable(w, d, color, lineColor, opts = {}) {
  const g = new THREE.Group();
  const theme = opts.theme || {};
  const thick = opts.thick ?? 0.35;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), themedStandardMaterial(color, theme));
  top.position.y = -thick / 2;
  top.receiveShadow = true;
  g.add(top);
  const rimMat = rimMaterial(lineColor, theme);
  const rimH = theme.style === "ice" ? 0.46 : 0.42;
  const rimT = 0.22;
  if (!opts.circle) {
    const north = new THREE.Mesh(new THREE.BoxGeometry(w + rimT * 2, rimH, rimT), rimMat);
    north.position.set(0, rimH/2 - 0.02, d/2 + rimT/2);
    const south = north.clone(); south.position.z = -d/2 - rimT/2;
    g.add(north, south);
    if (!opts.openEnds) {
      const east = new THREE.Mesh(new THREE.BoxGeometry(rimT, rimH, d), rimMat);
      east.position.set(w/2 + rimT/2, rimH/2 - 0.02, 0);
      const west = east.clone(); west.position.x = -w/2 - rimT/2;
      g.add(east, west);
    }
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.7 });
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.06, d*0.92), lineMat);
  mid.rotation.x = -Math.PI/2; mid.position.y = 0.01; g.add(mid);
  const center = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.18, 48), lineMat);
  center.rotation.x = -Math.PI/2; center.position.y = 0.012; g.add(center);
  for (const s of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.PlaneGeometry(w*0.18, d*0.55), lineMat.clone());
    box.material.opacity = 0.18;
    box.rotation.x = -Math.PI/2;
    box.position.set(s*w*0.38, 0.011, 0);
    g.add(box);
  }
  g.userData.top = top;
  return g;
}

export function makeTriangleTable(verts, edges, color, edgeColors, theme = {}) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(verts[0].x, -verts[0].z);
  shape.lineTo(verts[1].x, -verts[1].z);
  shape.lineTo(verts[2].x, -verts[2].z);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, steps: 1 });
  const top = new THREE.Mesh(geo, themedStandardMaterial(color, theme));
  top.rotation.x = -Math.PI/2; top.position.y = 0; top.receiveShadow = true; g.add(top);
  edges.forEach((e, i) => {
    const col = edgeColors[i];
    const style = theme.style || "neon";
    const wood = ["jungle","viking","western","sushi"].includes(style);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(e.len, 0.38, 0.18),
      new THREE.MeshStandardMaterial({
        color: wood ? 0x2a180a : 0x0a0c12,
        metalness: (style==="neon"||style==="ice") ? 0.6 : 0,
        roughness: (style==="neon"||style==="ice") ? (style==="ice"?0.1:0.28) : 0.78,
        emissive: col, emissiveIntensity: theme.rimGlow ?? 0.55
      }));
    bar.position.set(e.mx - e.nx*0.08, 0.18, e.mz - e.nz*0.08);
    bar.rotation.y = Math.atan2(e.tx, e.tz);
    g.add(bar);
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.98, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.02; g.add(ring);
  g.userData.top = top;
  return g;
}

export function makeCircleTable(radius, color, lineColor, theme = {}) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.35, 64), themedStandardMaterial(color, theme));
  top.position.y = -0.175; top.receiveShadow = true; g.add(top);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius+0.08, 0.12, 10, 64), rimMaterial(lineColor, theme));
  ring.rotation.x = Math.PI/2; ring.position.y = 0.12; g.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(radius*0.22, radius*0.24, 48),
    new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  inner.rotation.x = -Math.PI/2; inner.position.y = 0.01; g.add(inner);
  return g;
}

// ============================================================
//  SPETTATORI (tribune PIENE, tante sagome)
// ============================================================
export function makeSpectators(spectatorKind, theme, hx, hz) {
  const group = new THREE.Group();
  const layers = 3;       // 3 file di tribuna
  const perLayer = 22;    // 22 persone per lato
  const kindsBySide = ["top", "bottom", "left", "right"];

  for (const side of kindsBySide) {
    for (let L = 0; L < layers; L++) {
      for (let i = 0; i < perLayer; i++) {
        const t = (i + 0.5) / perLayer;
        let x = 0, z = 0, rotY = 0;
        const depth = 1.7 + L * 0.55;
        if (side === "top")     { x = -hx + t * hx * 2; z = hz + depth; rotY = Math.PI; }
        if (side === "bottom")  { x = -hx + t * hx * 2; z = -hz - depth; rotY = 0; }
        if (side === "left")   { x = -hx - depth; z = -hz + t * hz * 2; rotY = Math.PI / 2; }
        if (side === "right")  { x = hx + depth; z = -hz + t * hz * 2; rotY = -Math.PI / 2; }
        const m = makeSpectator(spectatorKind, theme);
        if (!m) continue;
        m.scale.setScalar(0.85 + L * 0.05);
        m.position.set(x + (Math.random()-0.5)*0.25, L * 0.15 + Math.random()*0.05, z + (Math.random()-0.5)*0.25);
        m.rotation.y = rotY + (Math.random()-0.5)*0.5;
        group.add(m);
      }
    }
  }
  group.userData.kind = spectatorKind;
  return group;
}

function makeSpectator(kind, theme) {
  switch (kind) {
    case "jungle":    return makeMonkey();
    case "ice":       return Math.random() < 0.6 ? makePolarBearFan() : makeSealFan();
    case "stadium":   return makeFan();
    case "canyon":    return Math.random() < 0.4 ? makeCactus() : makeFan();
    case "pixel":     return makePixelFan();
    case "silhouette":return makeSilhouetteFan();
    case "sushi":     return makeSushiChef();
    case "viking":    return makeVikingFan();
    case "western":   return makeCowboyFan();
    default: return null;
  }
}

// --- Spettatori ---
function bodyHead(bodyColor, headColor, bodyH = 0.55) {
  const g = new THREE.Group();
  const skin = headColor || new THREE.MeshStandardMaterial({ color: 0xd9a87c, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, bodyH, 8), bodyColor);
  body.position.y = bodyH / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin);
  head.position.y = bodyH + 0.05;
  g.add(body, head);
  g.userData.body = body; g.userData.head = head;
  return g;
}
function makeMonkey() {
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4a25, roughness: 0.95 });
  const face = new THREE.MeshStandardMaterial({ color: 0xd7b089, roughness: 0.85 });
  const g = bodyHead(fur, face, 0.5);
  for (const sx of [-0.13, 0.13]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), fur);
    ear.position.set(sx, 0.72, 0);
    g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.35, 6), fur);
  tail.position.set(0, 0.2, 0.2);
  tail.rotation.x = -0.9;
  g.add(tail);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makePolarBearFan() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.75 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), fur);
  body.position.y = 0.28; body.scale.set(1, 0.8, 0.9);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), fur);
  head.position.set(0, 0.58, 0.1);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fur);
  snout.position.set(0, 0.52, 0.28);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  nose.position.set(0, 0.5, 0.37);
  g.add(body, head, snout, nose);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeSealFan() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a8792, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat);
  body.position.y = 0.2; body.scale.set(1.4, 0.7, 0.8);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat);
  head.position.set(0.28, 0.26, 0);
  g.add(body, head);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeFan() {
  const colors = [0x3e8ee8, 0xe64a4a, 0xf4d442, 0x52c862, 0xb363e2];
  const shirt = new THREE.MeshStandardMaterial({ color: colors[(Math.random()*colors.length)|0], roughness: 0.9 });
  const g = bodyHead(shirt, null, 0.5);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeCactus() {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 8), green);
  stem.position.y = 0.35;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 6), green);
  arm.position.set(0.16, 0.45, 0); arm.rotation.z = -0.8;
  g.add(stem, arm);
  g.userData.static = true;
  return g;
}
function makePixelFan() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x36df68, emissive: 0x155827, emissiveIntensity: 0.4 });
  for (let i = 0; i < 5; i++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), mat);
    v.position.set((Math.random()-0.5)*0.04, 0.12 + i*0.14, 0);
    g.add(v);
  }
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeSilhouetteFan() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.65, 7), mat);
  body.position.y = 0.33;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), mat);
  head.position.y = 0.75;
  const g = new THREE.Group(); g.add(body, head);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeSushiChef() {
  const coat = new THREE.MeshStandardMaterial({ color: 0xf5f0dd, roughness: 0.8 });
  const g = bodyHead(coat, null, 0.55);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 12), coat);
  hat.position.y = 0.83;
  g.add(hat);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeVikingFan() {
  const tunic = new THREE.MeshStandardMaterial({ color: [0x7a3a1d,0x2b4e72,0x463a2a][(Math.random()*3)|0], roughness: 0.9 });
  const g = bodyHead(tunic, null, 0.5);
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9a36a, metalness: 0.7, roughness: 0.3 });
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI*2, 0, Math.PI/2), metal);
  helm.position.y = 0.72;
  for (const sx of [-1,1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6),
      new THREE.MeshStandardMaterial({ color: 0xe6d4ae, roughness: 0.5 }));
    horn.position.set(sx*0.16, 0.85, 0); horn.rotation.z = sx*0.7;
    g.add(horn);
  }
  g.add(helm);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}
function makeCowboyFan() {
  const shirt = new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0x9b4830 : 0x3c5a7a, roughness: 0.9 });
  const g = bodyHead(shirt, null, 0.55);
  const felt = new THREE.MeshStandardMaterial({ color: 0x6b4022, roughness: 0.9 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14), felt);
  brim.position.y = 0.82;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 12), felt);
  crown.position.y = 0.92;
  g.add(brim, crown);
  g.userData.cheerOffset = Math.random() * 10;
  return g;
}

/** Animazione di salto tipo Wii/Rocket League quando si fa punto. */
export function cheerSpectators(group, dt, t, intensity = 1) {
  if (!group) return;
  group.traverse((o) => {
    if (!o.userData) return;
    if (o.userData.static) return;
    if (o.userData.cheerOffset === undefined) return;
    // Al primo passaggio memorizziamo la Y di riposo per poter saltare da lì.
    if (o.userData.baseY === undefined) o.userData.baseY = o.position.y;
    const jump = Math.max(0, Math.sin((t + o.userData.cheerOffset) * 10)) * 0.22 * intensity;
    o.position.y = o.userData.baseY + jump;
  });
}

/** "Boom" tipo Rocket League: cono di luce + shockwave + tante particelle + scossa. */
export function makeGoalCelebration(scene, x, color) {
  const group = new THREE.Group();
  group.position.set(x, 0.05, 0);
  // Shockwave (anello che si espande).
  const wave = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.35, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  wave.rotation.x = -Math.PI/2;
  group.add(wave);
  // Cono di luce verso l'alto.
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 8, 20, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  cone.position.y = 4;
  group.add(cone);
  // Luce.
  const light = new THREE.PointLight(color, 3, 12, 2);
  light.position.y = 1.5;
  group.add(light);
  scene.add(group);
  const start = performance.now();
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    if (t > 1.2) { scene.remove(group); return; }
    const s = 1 + t * 12;
    wave.scale.set(s, s, s);
    wave.material.opacity = 0.9 * (1 - t/1.2);
    cone.scale.set(1 + t*4, 1, 1 + t*4);
    cone.material.opacity = 0.5 * (1 - t/1.2);
    light.intensity = 3 * (1 - t/1.2);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return group;
}

// Particelle d'urto a tema (chiamate quando la palla colpisce una racchetta).
export function impactParticles(scene, x, z, theme, color) {
  const style = theme.style || "neon";
  let particles = null;
  if (style === "jungle") {
    particles = makeBurst(scene, x, z, [0x6fae3a, 0x3c6824, 0x9bd25d], { leaf: true });
  } else if (style === "sushi") {
    // Gocce di salsa di soia e granelli di riso.
    particles = makeBurst(scene, x, z, [0x1a1a20, 0xffffff, 0xff8060], {});
  } else if (style === "boot") {
    particles = makeBurst(scene, x, z, [0xffffff, 0xf4efe1, 0x66aaff], {});
  } else if (style === "western") {
    particles = makeBurst(scene, x, z, [0xd4a046, 0x8a5022, 0xffdf7e], { spark: true });
  } else if (style === "viking") {
    particles = makeBurst(scene, x, z, [0xb9a36a, 0xe6d4ae, 0xc83030], { spark: true });
  } else if (style === "ice") {
    particles = makeBurst(scene, x, z, [0xb9e5f4, 0xffffff, 0x76b7ff], { ice: true });
  } else if (style === "airhockey") {
    particles = makeBurst(scene, x, z, [0x4dc6ff, 0xf5fbff], { spark: true });
  } else if (style === "baseball") {
    particles = makeBurst(scene, x, z, [0xd84747, 0xf7f4e8, 0xc58a4a], { spark: true });
  } else if (style === "tennis") {
    particles = makeBurst(scene, x, z, [0xc8f23d, 0xf7f0dd], { spark: true });
  } else {
    particles = makeBurst(scene, x, z, [color, 0xffffff], { spark: true });
  }
  return particles;
}

function makeBurst(scene, x, z, colors, opts = {}) {
  const items = [];
  const n = opts.leaf ? 16 : (opts.pixel ? 10 : 22);
  for (let i = 0; i < n; i++) {
    let geo;
    if (opts.leaf) geo = new THREE.ConeGeometry(0.07, 0.18, 3);
    else if (opts.pixel) geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    else if (opts.ice) geo = new THREE.TetrahedronGeometry(0.08);
    else geo = new THREE.SphereGeometry(0.05 + Math.random()*0.05, 6, 5);
    const c = colors[(Math.random()*colors.length)|0];
    const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 1 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.3 + Math.random()*0.2, z);
    scene.add(m);
    items.push({
      mesh: m,
      vx: (Math.random()-0.5) * 6,
      vy: 2 + Math.random() * 4,
      vz: (Math.random()-0.5) * 6,
      rx: Math.random() * 8, ry: Math.random() * 8, rz: Math.random() * 8,
      life: 0.55 + Math.random() * 0.4, age: 0
    });
  }
  return items;
}

export function updateBurst(items, dt, scene) {
  if (!items) return;
  for (let i = items.length-1; i >= 0; i--) {
    const p = items[i];
    p.age += dt;
    p.vy -= 12 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.rx * dt;
    p.mesh.rotation.y += p.ry * dt;
    p.mesh.rotation.z += p.rz * dt;
    const t = 1 - p.age / p.life;
    p.mesh.material.opacity = Math.max(0, t);
    p.mesh.scale.setScalar(Math.max(0.05, t));
    if (p.age >= p.life) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      items.splice(i, 1);
    }
  }
}

// ============================================================
//  Elementi d'arena (già esistenti, mantenuti)
// ============================================================
export function makePenguin() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x16171d, roughness: 0.55, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.45 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff8a2b, roughness: 0.4, emissive: 0x441800, emissiveIntensity: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), black);
  body.scale.set(0.85, 1.15, 0.75); body.position.y = 0.38;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), white);
  belly.position.set(0, 0.34, 0.16); belly.scale.set(0.9, 1.1, 0.55);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), black);
  head.position.set(0, 0.7, 0.02);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 6), orange);
  beak.rotation.x = Math.PI/2; beak.position.set(0, 0.68, 0.2);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), orange);
  footL.position.set(-0.1, 0.04, 0.06);
  const footR = footL.clone(); footR.position.x = 0.1;
  const flipL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.12), black);
  flipL.position.set(-0.28, 0.38, 0); flipL.rotation.z = 0.4;
  const flipR = flipL.clone(); flipR.position.x = 0.28; flipR.rotation.z = -0.4;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  eyeL.position.set(-0.06, 0.74, 0.12);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.06;
  g.add(body, belly, head, beak, footL, footR, flipL, flipR, eyeL, eyeR);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeLog(len=3.2, r=0.28) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.75, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), wood);
  mesh.rotation.z = Math.PI/2; mesh.castShadow = true; g.add(mesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r+0.01, 0.04, 8, 16), new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.8 }));
  ring.rotation.y = Math.PI/2; g.add(ring);
  return g;
}
export function makeHill(r=0.7, h=0.45) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 0.9 }));
  m.position.y = h/2; m.castShadow = true; m.receiveShadow = true; return m;
}
export function makeBalloon(color) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.15, emissive: color, emissiveIntensity: 0.25 }));
  m.scale.y = 1.15; m.position.y = 0.5; m.castShadow = true;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: 0x222 }));
  knot.position.y = 0.12; g.add(m, knot); g.userData.mat = m.material; return g;
}
export function makePuck() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.3, emissive: 0x111, emissiveIntensity: 0.2 }));
  m.position.y = 0.1; m.castShadow = true; return m;
}
export function makeBumper(color=0xff4d8d) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.55, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.3 }));
  m.position.y = 0.28; m.castShadow = true; g.add(m); g.userData.mat = m.material; return g;
}
export function makeGoalFrame(width, height, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.25 });
  const t = 0.08;
  const top = new THREE.Mesh(new THREE.BoxGeometry(t, t, width), mat); top.position.set(0, height, 0);
  const l = new THREE.Mesh(new THREE.BoxGeometry(t, height, t), mat); l.position.set(0, height/2, width/2);
  const r = l.clone(); r.position.z = -width/2;
  g.add(top, l, r); return g;
}
function powerGlyphTexture(glyph, color) {
  const S = 128, cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const c = cvs.getContext("2d"), hex = "#" + color.toString(16).padStart(6, "0");
  c.beginPath(); c.arc(S/2, S/2, S*0.46, 0, Math.PI*2);
  c.fillStyle = "rgba(6,8,14,0.92)"; c.fill();
  c.lineWidth = S*0.06; c.strokeStyle = hex; c.stroke();
  c.font = `700 ${S*0.5}px "Outfit", system-ui, sans-serif`;
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = "#fff"; c.shadowColor = hex; c.shadowBlur = S*0.18;
  c.fillText(glyph, S/2, S*0.54);
  const tex = new THREE.CanvasTexture(cvs); tex.anisotropy = 4; return tex;
}
export const POWER_PICKUP_RADIUS = 0.68;
export function makePowerToken(color, glyph = "?") {
  const g = new THREE.Group();
  const floaters = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.72, metalness: 0.18, roughness: 0.38 }));
  disc.rotation.x = Math.PI/2;
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: powerGlyphTexture(glyph, color), transparent: true, depthTest: false }));
  badge.scale.set(0.78, 0.78, 1); badge.position.y = 0.38; badge.renderOrder = 5;
  const glow = new THREE.PointLight(color, 0.85, 3.5); glow.position.y = 0.2;
  floaters.add(disc, badge, glow); floaters.position.y = 0.4; g.add(floaters);
  const area = new THREE.Mesh(new THREE.CircleGeometry(POWER_PICKUP_RADIUS, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false }));
  area.rotation.x = -Math.PI/2; area.position.y = 0.006; area.renderOrder = 2;
  const rim = new THREE.Mesh(new THREE.RingGeometry(POWER_PICKUP_RADIUS - 0.055, POWER_PICKUP_RADIUS, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }));
  rim.rotation.x = -Math.PI/2; rim.position.y = 0.009; rim.renderOrder = 3;
  g.add(area, rim);
  g.userData.disc = disc; g.userData.badge = badge; g.userData.floaters = floaters;
  g.userData.pickupArea = area; g.userData.pickupRim = rim;
  return g;
}
export function makePolarBear() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), fur);
  body.scale.set(1.3, 0.85, 0.8); body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), fur); head.position.set(0.42, 0.55, 0);
  g.add(body, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeSeal() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d7b86, roughness: 0.45, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat);
  body.scale.set(1.4, 0.7, 0.75); body.position.y = 0.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat); head.position.set(0.38, 0.28, 0);
  g.add(body, head); return g;
}
export function makeHen(color=0xf2d27a) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  body.position.y = 0.28; body.scale.set(1, 0.85, 1.1);
  const comb = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 5), new THREE.MeshStandardMaterial({ color: 0xe23d3d }));
  comb.position.set(0, 0.5, 0.04);
  g.add(body, comb); return g;
}
export function makeEgg(color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.15 }));
  m.scale.y = 1.25; m.castShadow = true; return m;
}
export function makeCoop(color) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 0.8 }));
  box.position.y = 0.28;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  hole.position.set(0.36, 0.28, 0); hole.rotation.y = Math.PI/2;
  g.add(box, hole); return g;
}
export function makeSpike(h=0.7) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, h, 7),
    new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.7, roughness: 0.25 }));
  m.position.y = h/2; m.castShadow = true; return m;
}
export function roundedLights(colorA, colorB) {
  const a = new THREE.PointLight(colorA, 2.2, 28, 2); a.position.set(-6, 8, 4);
  const b = new THREE.PointLight(colorB, 2.0, 28, 2); b.position.set(6, 8, 4);
  return [a, b];
}
