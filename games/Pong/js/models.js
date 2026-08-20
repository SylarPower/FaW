import * as THREE from "three";

const geoCache = new Map();
function geo(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}

export function makePaddle(color, hw, hd, hh) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.22,
    emissive: color,
    emissiveIntensity: 0.22
  });
  const body = new THREE.Mesh(
    geo("paddle", () => new THREE.BoxGeometry(1, 1, 1)),
    mat
  );
  body.scale.set(hw * 2, hh * 2, hd * 2);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const edge = new THREE.Mesh(
    geo("paddleEdge", () => new THREE.BoxGeometry(1.08, 0.12, 1.02)),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.1
    })
  );
  edge.position.y = hh + 0.02;
  edge.scale.set(hw * 2, 1, hd * 2);
  g.add(edge);

  g.userData.body = body;
  g.userData.mat = mat;
  return g;
}

export function makeBall(color = 0xffffff, r = 0.22) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.65,
    roughness: 0.18,
    emissive: color,
    emissiveIntensity: 0.18
  });
  const mesh = new THREE.Mesh(geo("ball", () => new THREE.SphereGeometry(1, 24, 18)), mat);
  mesh.scale.setScalar(r);
  mesh.castShadow = true;
  const light = new THREE.PointLight(color, 1.6, 6, 2);
  mesh.add(light);
  mesh.userData.light = light;
  mesh.userData.mat = mat;
  return mesh;
}

export function makeTable(w, d, color, lineColor, opts = {}) {
  const g = new THREE.Group();
  const thick = opts.thick ?? 0.35;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, thick, d),
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.35,
      roughness: 0.38,
      emissive: color,
      emissiveIntensity: 0.04
    })
  );
  top.position.y = -thick / 2;
  top.receiveShadow = true;
  g.add(top);

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c12,
    metalness: 0.7,
    roughness: 0.25,
    emissive: lineColor,
    emissiveIntensity: 0.35
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

export function makeTriangleTable(verts, edges, color, edgeColors) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(verts[0].x, -verts[0].z);
  shape.lineTo(verts[1].x, -verts[1].z);
  shape.lineTo(verts[2].x, -verts[2].z);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, steps: 1 });
  const top = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color, metalness: 0.35, roughness: 0.38, emissive: color, emissiveIntensity: 0.05
    })
  );
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
        color: 0x0a0c12, metalness: 0.6, roughness: 0.28, emissive: col, emissiveIntensity: 0.55
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

export function makeCircleTable(radius, color, lineColor) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.35, 64),
    new THREE.MeshStandardMaterial({
      color, metalness: 0.32, roughness: 0.4, emissive: color, emissiveIntensity: 0.05
    })
  );
  top.position.y = -0.175;
  top.receiveShadow = true;
  g.add(top);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius + 0.08, 0.12, 10, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0c12, emissive: lineColor, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 })
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

/** Etichetta col nome del potere, da mostrare sotto il gettone. */
function powerLabelSprite(text, color) {
  const W = 256, H = 64;
  const cvs = document.createElement("canvas");
  cvs.width = W; cvs.height = H;
  const c = cvs.getContext("2d");
  const hex = "#" + color.toString(16).padStart(6, "0");

  const label = String(text).toUpperCase();
  c.font = `700 ${H * 0.46}px "Outfit", system-ui, sans-serif`;
  const tw = c.measureText(label).width;
  const pad = H * 0.28;
  const bw = Math.min(W, tw + pad * 2), bx = (W - bw) / 2;

  c.beginPath();
  if (c.roundRect) c.roundRect(bx, H * 0.18, bw, H * 0.64, H * 0.32);
  else c.rect(bx, H * 0.18, bw, H * 0.64);
  c.fillStyle = "rgba(6, 8, 14, 0.85)";
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = hex;
  c.stroke();

  c.font = `700 ${H * 0.46}px "Outfit", system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = hex;
  c.fillText(label, W / 2, H * 0.52);

  const tex = new THREE.CanvasTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

export function makePowerToken(color, glyph = "?", label = "") {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.08, 24),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.85, metalness: 0.3, roughness: 0.25
    })
  );
  disc.rotation.x = Math.PI / 2;

  // Il simbolo e' un billboard: game.js lo tiene rivolto alla telecamera.
  const badge = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: powerGlyphTexture(glyph, color),
      transparent: true,
      depthTest: false
    })
  );
  badge.scale.set(0.62, 0.62, 1);
  badge.position.y = 0.34;
  badge.renderOrder = 5;

  const glow = new THREE.PointLight(color, 1.2, 4);
  g.add(disc, badge, glow);

  if (label) {
    const tag = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: powerLabelSprite(label, color),
        transparent: true,
        depthTest: false
      })
    );
    tag.scale.set(1.15, 0.29, 1);
    tag.position.y = -0.16;
    tag.renderOrder = 5;
    g.add(tag);
    g.userData.tag = tag;
  }

  g.userData.disc = disc;
  g.userData.badge = badge;
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
