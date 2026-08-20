import * as THREE from "three";

const geoCache = new Map();
function geo(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}

/**
 * Racchetta coerente con il tema. Il gruppo `body` usa coordinate normalizzate
 * e viene scalato da game.js: anche Allunga continua quindi a funzionare con
 * scarponi, tronchi e barre classiche senza cambiare la hitbox.
 */
export function makePaddle(color, hw, hd, hh, theme = {}) {
  const g = new THREE.Group();
  const style = theme.style || "neon";
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: theme.paddleMetalness ?? 0.55,
    roughness: theme.paddleRoughness ?? 0.22,
    emissive: color,
    emissiveIntensity: theme.paddleEmissive ?? 0.22
  });
  const body = new THREE.Group();
  body.scale.set(hw * 2, hh * 2, hd * 2);
  g.add(body);

  if (style === "boot") {
    // Tomaia, punta rialzata, suola, lacci e tacchetti: la barra e' davvero
    // leggibile come uno scarpone, ma resta contenuta nella hitbox originale.
    const leather = mat;
    const soleMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.88 });
    const laceMat = new THREE.MeshStandardMaterial({ color: 0xf4efe1, roughness: 0.7 });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.58, 0.68), leather);
    upper.position.set(0, 0.07, -0.12);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.82, 0.3), leather);
    heel.position.set(0, 0.18, -0.36);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), leather);
    toe.scale.set(0.88, 0.42, 0.7);
    toe.position.set(0, -0.02, 0.32);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.13, 0.94), soleMat);
    sole.position.y = -0.4;
    body.add(upper, heel, toe, sole);
    for (let i = 0; i < 3; i++) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.045), laceMat);
      lace.position.set(0, 0.4, -0.08 + i * 0.13);
      body.add(lace);
    }
    for (const x of [-0.28, 0.28]) {
      for (const z of [-0.3, 0.05, 0.32]) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.16, 8), soleMat);
        stud.position.set(x, -0.51, z);
        body.add(stud);
      }
    }
  } else if (style === "jungle") {
    const bark = mat;
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2415, roughness: 1 });
    const vine = new THREE.MeshStandardMaterial({ color: 0x4c7a32, roughness: 0.95 });
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 1, 10), bark);
    log.rotation.x = Math.PI / 2;
    body.add(log);
    for (const z of [-0.32, 0.28]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.045, 6, 14), z < 0 ? dark : vine);
      ring.position.z = z;
      body.add(ring);
    }
    for (const [x, y, z] of [[0.38, 0.25, -0.05], [-0.35, 0.2, 0.18]]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), vine);
      leaf.scale.set(0.55, 0.3, 1.25);
      leaf.position.set(x, y, z);
      body.add(leaf);
    }
  } else {
    const block = new THREE.Mesh(geo("paddle", () => new THREE.BoxGeometry(1, 1, 1)), mat);
    body.add(block);
    const edge = new THREE.Mesh(
      geo("paddleEdge", () => new THREE.BoxGeometry(1.08, 0.12, 1.02)),
      new THREE.MeshStandardMaterial({
        color: style === "mono" ? 0x2b2b2b : 0xffffff,
        emissive: color,
        emissiveIntensity: theme.edgeGlow ?? 1.4,
        roughness: style === "ice" ? 0.1 : 0.52,
        metalness: style === "ice" ? 0.08 : 0
      })
    );
    edge.position.y = 0.54;
    body.add(edge);
  }

  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.body = body;
  g.userData.mat = mat;
  g.userData.baseEmissive = theme.paddleEmissive ?? 0.22;
  return g;
}

export function makeBall(color = 0xffffff, r = 0.22, theme = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: theme.ballMetalness ?? 0.65,
    roughness: theme.ballRoughness ?? 0.18,
    emissive: color,
    emissiveIntensity: theme.ballEmissive ?? 0.18
  });
  const mesh = new THREE.Mesh(geo("ball", () => new THREE.SphereGeometry(1, 24, 18)), mat);
  mesh.scale.setScalar(r);
  mesh.castShadow = true;
  const lightBase = theme.ballLight ?? 1.6;
  const light = new THREE.PointLight(color, lightBase, 6, 2);
  mesh.add(light);
  mesh.userData.light = light;
  mesh.userData.lightBase = lightBase;
  mesh.userData.mat = mat;
  return mesh;
}

const surfaceTextures = new Map();
function surfaceTexture(style) {
  if (!["jungle", "boot", "retro"].includes(style)) return null;
  if (surfaceTextures.has(style)) return surfaceTextures.get(style);
  const S = 256;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const c = cvs.getContext("2d");

  if (style === "retro") {
    c.fillStyle = "#626262";
    c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(210,255,220,.24)";
    c.lineWidth = 2;
    for (let x = 0; x <= S; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
    for (let y = 0; y <= S; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke(); }
  } else {
    c.fillStyle = style === "boot" ? "#a8c59d" : "#a3b68b";
    c.fillRect(0, 0, S, S);
    if (style === "boot") {
      for (let x = 0; x < S; x += 64) {
        c.fillStyle = (x / 64) % 2 ? "rgba(35,75,35,.14)" : "rgba(255,255,220,.05)";
        c.fillRect(x, 0, 32, S);
      }
    }
    // Tratti corti e irregolari: a distanza sembrano fili d'erba e non una
    // superficie plastica riflettente.
    let seed = style === "boot" ? 91 : 37;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * S, y = rnd() * S;
      c.strokeStyle = rnd() > 0.5 ? "rgba(24,68,24,.2)" : "rgba(235,245,190,.12)";
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rnd() * 3 - 1.5, y - 2 - rnd() * 4); c.stroke();
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

export function makeTable(w, d, color, lineColor, opts = {}) {
  const g = new THREE.Group();
  const theme = opts.theme || {};
  const thick = opts.thick ?? 0.35;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, thick, d),
    themedStandardMaterial(color, theme)
  );
  top.position.y = -thick / 2;
  top.receiveShadow = true;
  g.add(top);

  const rimMat = new THREE.MeshStandardMaterial({
    color: theme.style === "jungle" ? 0x4b3420 : theme.style === "boot" ? 0xe7e1d4 : 0x0a0c12,
    metalness: theme.style === "neon" ? 0.7 : 0,
    roughness: theme.style === "neon" ? 0.25 : 0.78,
    emissive: lineColor,
    emissiveIntensity: theme.rimGlow ?? 0.35
  });
  const rimH = 0.42;
  const rimT = 0.22;
  if (!opts.circle) {
    const north = new THREE.Mesh(new THREE.BoxGeometry(w + rimT * 2, rimH, rimT), rimMat);
    north.position.set(0, rimH / 2 - 0.02, d / 2 + rimT / 2);
    const south = north.clone();
    south.position.z = -d / 2 - rimT / 2;
    g.add(north, south);
    if (!opts.openEnds) {
      const east = new THREE.Mesh(new THREE.BoxGeometry(rimT, rimH, d), rimMat);
      east.position.set(w / 2 + rimT / 2, rimH / 2 - 0.02, 0);
      const west = east.clone();
      west.position.x = -w / 2 - rimT / 2;
      g.add(east, west);
    }
  }

  const lineMat = new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.7 });
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.06, d * 0.92), lineMat);
  mid.rotation.x = -Math.PI / 2;
  mid.position.y = 0.01;
  g.add(mid);

  const center = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.18, 48), lineMat);
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.012;
  g.add(center);

  for (const s of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.18, d * 0.55), lineMat.clone());
    box.material.opacity = 0.18;
    box.rotation.x = -Math.PI / 2;
    box.position.set(s * w * 0.38, 0.011, 0);
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
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0;
  top.receiveShadow = true;
  g.add(top);

  edges.forEach((e, i) => {
    const A = verts[e.a], B = verts[e.b];
    const len = e.len;
    const col = edgeColors[i];
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.38, 0.18),
      new THREE.MeshStandardMaterial({
        color: theme.style === "jungle" ? 0x4b3420 : 0x0a0c12,
        metalness: theme.style === "neon" ? 0.6 : 0,
        roughness: theme.style === "neon" ? 0.28 : 0.78,
        emissive: col,
        emissiveIntensity: theme.rimGlow ?? 0.55
      })
    );
    bar.position.set(e.mx - e.nx * 0.08, 0.18, e.mz - e.nz * 0.08);
    bar.rotation.y = Math.atan2(e.tx, e.tz);
    g.add(bar);
  });

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.98, 40), lineMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  g.userData.top = top;
  return g;
}

export function makeCircleTable(radius, color, lineColor, theme = {}) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.35, 64),
    themedStandardMaterial(color, theme)
  );
  top.position.y = -0.175;
  top.receiveShadow = true;
  g.add(top);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius + 0.08, 0.12, 10, 64),
    new THREE.MeshStandardMaterial({
      color: theme.style === "jungle" ? 0x4b3420 : 0x0a0c12,
      emissive: lineColor,
      emissiveIntensity: theme.rimGlow ?? 0.5,
      metalness: theme.style === "neon" ? 0.6 : 0,
      roughness: theme.style === "neon" ? 0.3 : 0.78
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  g.add(ring);
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.22, radius * 0.24, 48),
    new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  g.add(inner);
  return g;
}

export function makePenguin() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x16171d, roughness: 0.55, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.45 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff8a2b, roughness: 0.4, emissive: 0x441800, emissiveIntensity: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), black);
  body.scale.set(0.85, 1.15, 0.75);
  body.position.y = 0.38;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), white);
  belly.position.set(0, 0.34, 0.16);
  belly.scale.set(0.9, 1.1, 0.55);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), black);
  head.position.set(0, 0.7, 0.02);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 6), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.68, 0.2);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), orange);
  footL.position.set(-0.1, 0.04, 0.06);
  const footR = footL.clone();
  footR.position.x = 0.1;
  const flipL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.12), black);
  flipL.position.set(-0.28, 0.38, 0);
  flipL.rotation.z = 0.4;
  const flipR = flipL.clone();
  flipR.position.x = 0.28;
  flipR.rotation.z = -0.4;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  eyeL.position.set(-0.06, 0.74, 0.12);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  g.add(body, belly, head, beak, footL, footR, flipL, flipR, eyeL, eyeR);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export function makeLog(len = 3.2, r = 0.28) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.75, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), wood);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  g.add(mesh);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r + 0.01, 0.04, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.8 })
  );
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  return g;
}

export function makeHill(r = 0.7, h = 0.45) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(r, h, 10),
    new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 0.9 })
  );
  m.position.y = h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makeBalloon(color) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 14),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.25, metalness: 0.15, emissive: color, emissiveIntensity: 0.25
    })
  );
  m.scale.y = 1.15;
  m.position.y = 0.5;
  m.castShadow = true;
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x222 })
  );
  knot.position.y = 0.12;
  g.add(m, knot);
  g.userData.mat = m.material;
  return g;
}

export function makePuck() {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.3, emissive: 0x111, emissiveIntensity: 0.2 })
  );
  m.position.y = 0.1;
  m.castShadow = true;
  return m;
}

export function makeBumper(color = 0xff4d8d) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.48, 0.55, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.3 })
  );
  m.position.y = 0.28;
  m.castShadow = true;
  g.add(m);
  g.userData.mat = m.material;
  return g;
}

export function makeGoalFrame(width, height, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.25 });
  const t = 0.08;
  const top = new THREE.Mesh(new THREE.BoxGeometry(t, t, width), mat);
  top.position.set(0, height, 0);
  const l = new THREE.Mesh(new THREE.BoxGeometry(t, height, t), mat);
  l.position.set(0, height / 2, width / 2);
  const r = l.clone();
  r.position.z = -width / 2;
  g.add(top, l, r);
  return g;
}

/**
 * Disegna il simbolo di un power-up su una texture, cosi' il gettone in campo
 * dice subito QUALE potere e', non solo che c'e' un potere.
 */
function powerGlyphTexture(glyph, color) {
  const S = 128;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const c = cvs.getContext("2d");
  const hex = "#" + color.toString(16).padStart(6, "0");

  // pastiglia scura: fa risaltare il simbolo sul colore acceso del disco
  c.beginPath();
  c.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  c.fillStyle = "rgba(6, 8, 14, 0.92)";
  c.fill();
  c.lineWidth = S * 0.06;
  c.strokeStyle = hex;
  c.stroke();

  c.font = `700 ${S * 0.5}px "Outfit", system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#ffffff";
  c.shadowColor = hex;
  c.shadowBlur = S * 0.18;
  c.fillText(glyph, S / 2, S * 0.54);

  const tex = new THREE.CanvasTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

// Il raggio e' condiviso da grafica e collisione: il cerchio a terra mostra
// esattamente quanto vicino deve passare il centro della palla per raccogliere.
export const POWER_PICKUP_RADIUS = 0.68;

export function makePowerToken(color, glyph = "?") {
  const g = new THREE.Group();
  const floaters = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.72, metalness: 0.18, roughness: 0.38
    })
  );
  disc.rotation.x = Math.PI / 2;

  const badge = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: powerGlyphTexture(glyph, color),
      transparent: true,
      depthTest: false
    })
  );
  badge.scale.set(0.78, 0.78, 1);
  badge.position.y = 0.38;
  badge.renderOrder = 5;

  const glow = new THREE.PointLight(color, 0.85, 3.5);
  glow.position.y = 0.2;
  floaters.add(disc, badge, glow);
  floaters.position.y = 0.4;
  g.add(floaters);

  // Zona di presa sempre appoggiata al tavolo. Nessuna scritta sotto al token:
  // il simbolo grande identifica il potere, l'anello identifica la hit area.
  const area = new THREE.Mesh(
    new THREE.CircleGeometry(POWER_PICKUP_RADIUS, 48),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.11, side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  area.rotation.x = -Math.PI / 2;
  area.position.y = 0.006;
  area.renderOrder = 2;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(POWER_PICKUP_RADIUS - 0.055, POWER_PICKUP_RADIUS, 48),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.009;
  rim.renderOrder = 3;
  g.add(area, rim);

  g.userData.disc = disc;
  g.userData.badge = badge;
  g.userData.floaters = floaters;
  g.userData.pickupArea = area;
  g.userData.pickupRim = rim;
  return g;
}

export function makePolarBear() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), fur);
  body.scale.set(1.3, 0.85, 0.8);
  body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), fur);
  head.position.set(0.42, 0.55, 0);
  g.add(body, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeSeal() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d7b86, roughness: 0.45, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat);
  body.scale.set(1.4, 0.7, 0.75);
  body.position.y = 0.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
  head.position.set(0.38, 0.28, 0);
  g.add(body, head);
  return g;
}

export function makeHen(color = 0xf2d27a) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  body.position.y = 0.28;
  body.scale.set(1, 0.85, 1.1);
  const comb = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.12, 5),
    new THREE.MeshStandardMaterial({ color: 0xe23d3d })
  );
  comb.position.set(0, 0.5, 0.04);
  g.add(body, comb);
  return g;
}

export function makeEgg(color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.15 })
  );
  m.scale.y = 1.25;
  m.castShadow = true;
  return m;
}

export function makeCoop(color) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.55, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 0.8 })
  );
  box.position.y = 0.28;
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.18, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
  );
  hole.position.set(0.36, 0.28, 0);
  hole.rotation.y = Math.PI / 2;
  g.add(box, hole);
  return g;
}

export function makeSpike(h = 0.7) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, h, 7),
    new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.7, roughness: 0.25 })
  );
  m.position.y = h / 2;
  m.castShadow = true;
  return m;
}

export function roundedLights(colorA, colorB) {
  const a = new THREE.PointLight(colorA, 2.2, 28, 2);
  a.position.set(-6, 8, 4);
  const b = new THREE.PointLight(colorB, 2.0, 28, 2);
  b.position.set(6, 8, 4);
  return [a, b];
}
