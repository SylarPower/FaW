import * as THREE from "three";
import { Paddle, clamp, rand, pick, makeTri } from "./physics.js";
import { applyTheme } from "./themes.js";
import {
  makeTable, makeCircleTable, makeTriangleTable, makePenguin, makeLog, makeHill,
  makeBalloon, makePuck, makeBumper, makeGoalFrame, makeSpike,
  makeSeal, makePolarBear, makeSpectators
} from "./models.js";

export const ARENAS = [
  {
    id: "classic", zone: "Arcade", zoneId: 1, name: "Pong Classico",
    tag: "Origine",
    desc: "Uno contro uno. Niente scuse, solo geometria pura. Si gioca a 10.",
    scoreToWin: 10, paddles: 1, powerUps: ["whack", "stretch", "turbo"]
  },
  {
    id: "walled", zone: "Arcade", zoneId: 1, name: "Muro Spezzato",
    tag: "Doppio",
    desc: "Due racchette a testa. La porta è lo squarcio nel muro centrale.",
    scoreToWin: 10, paddles: 2, powerUps: ["whack", "stretch", "grab"]
  },
  {
    id: "soccer", zone: "Arcade", zoneId: 1, name: "Calcio Stelle",
    tag: "Stadio",
    desc: "Attaccante e portiere. Segna nella porta, non sulla linea di fondo.",
    scoreToWin: 10, paddles: 2, powerUps: ["whack", "stretch", "turbo"]
  },
  {
    id: "penguin", zone: "Artide", zoneId: 2, name: "Pinguini sul Ghiaccio",
    tag: "Multiball",
    desc: "Colpisci un pinguino e nasce un'altra palla. Massimo quattro. Ghiaccio viscido.",
    scoreToWin: 10, paddles: 1, powerUps: ["seal", "stretch", "grab"]
  },
  {
    id: "snowstorm", zone: "Artide", zoneId: 2, name: "Bufera",
    tag: "Vento",
    desc: "Una raffica cambia direzione senza preavviso. Tieni la palla, non il meteo.",
    scoreToWin: 10, paddles: 1, powerUps: ["grab", "whack"]
  },
  {
    id: "logs", zone: "Ostacoli", zoneId: 3, name: "Tronchi Rotanti",
    tag: "Cantiere",
    desc: "Quattro tronchi al centro. Falli girare verso l'avversario. Due porte a testa.",
    scoreToWin: 10, paddles: 1, powerUps: ["spinlog", "whack", "stretch"]
  },
  {
    id: "moles", zone: "Ostacoli", zoneId: 3, name: "Colline delle Talpe",
    tag: "Deflessione",
    desc: "I dossi deviano la palla. Le buche la risputano dall'altra parte.",
    scoreToWin: 10, paddles: 2, powerUps: ["whack", "stretch"]
  },
  {
    id: "clown", zone: "Show", zoneId: 4, name: "Circo dei Colori",
    tag: "Abbinamento",
    desc: "La palla ha un colore. Segna solo nella casella dello stesso colore.",
    scoreToWin: 8, paddles: 1, powerUps: []
  },
  {
    id: "beach", zone: "Show", zoneId: 4, name: "Festa in Spiaggia",
    tag: "Presa infinita",
    desc: "Acqua lenta. Tieni premuto per afferrare e rilasciare la palla. Si gioca a 7.",
    scoreToWin: 7, paddles: 2, powerUps: ["grab"]
  },
  {
    id: "tilt", zone: "Show", zoneId: 4, name: "Tavolo Folle",
    tag: "Inclinazione",
    desc: "Inclina il tavolo, alza dossi, scava conche. La gravità è un'arma.",
    scoreToWin: 10, paddles: 1, powerUps: ["tilt", "hill", "dip", "whack"]
  },
  {
    id: "puck", zone: "Leggenda", zoneId: 5, name: "Hockey Puck",
    tag: "Disco",
    desc: "Afferra una palla e lanciala sul disco. Fai oltrepassare la linea avversaria.",
    scoreToWin: 5, paddles: 1, powerUps: ["grab", "fan"]
  },
  {
    id: "balloons", zone: "Leggenda", zoneId: 5, name: "Palloncini",
    tag: "Circo",
    desc: "Arena tonda. Scoppia i palloncini: l'ultimo tocco si prende il punto. Si gioca a 5.",
    scoreToWin: 5, paddles: 1, powerUps: []
  },
  {
    id: "pinball", zone: "Leggenda", zoneId: 5, name: "Pongball Wizard",
    tag: "Flipper",
    desc: "Colpisci i pilastri accesi, poi le sbarre d'oro. Multiball incluso.",
    scoreToWin: 3, paddles: 1, powerUps: ["whack"]
  },
  {
    id: "jungle", zone: "Leggenda", zoneId: 5, name: "Giungla",
    tag: "Trappole",
    desc: "Buche, quattro porte, spine. Segna in ogni porta per alzare la difesa.",
    scoreToWin: 7, paddles: 1, powerUps: ["grab", "whack", "spike", "skull"]
  },
  {
    id: "triangle", zone: "Triangolo", zoneId: 6, name: "Triangolazione",
    tag: "1v1v1",
    desc: "Tre lati, tre racchette. Chi fa passare la palla sul lato avversario segna. Si gioca a 7.",
    scoreToWin: 7, paddles: 1, powerUps: ["whack", "stretch", "turbo"], triangle: true
  }
];

export function arenaById(id) {
  return ARENAS.find((a) => a.id === id);
}

export const THEMES = {
  classic: { bg: 0x07080e, fog: 0x07080e, table: 0x10141c, line: 0x3dffd1, p1: 0x3dffd1, p2: 0xff3d7f, bloom: 0.42 },
  walled: { bg: 0x0a0b10, fog: 0x0a0b10, table: 0x141821, line: 0xffc857, p1: 0x3dffd1, p2: 0xff3d7f, bloom: 0.4 },
  soccer: { bg: 0x071409, fog: 0x071409, table: 0x1d6b32, line: 0xf5f5f5, p1: 0x3dffd1, p2: 0xff3d7f, hemi: 0xc8ffd4, bloom: 0.32 },
  penguin: { bg: 0x0a1520, fog: 0x0a1520, table: 0xc8e7f5, line: 0x3d7dff, p1: 0x3dffd1, p2: 0xff6aa8, hemi: 0xd4f0ff, bloom: 0.45, exposure: 1.12 },
  snowstorm: { bg: 0x0b1420, fog: 0x8aa, table: 0xd9eef8, line: 0x8ee7ff, p1: 0x8ee7ff, p2: 0xff3d7f, bloom: 0.5 },
  logs: { bg: 0x120c08, fog: 0x120c08, table: 0x3a2718, line: 0xd27d2c, p1: 0xffc857, p2: 0xff6a3d, hemi: 0xffe0c0, bloom: 0.34 },
  moles: { bg: 0x0c140c, fog: 0x0c140c, table: 0x2e7d3a, line: 0xf5f5f5, p1: 0x3dffd1, p2: 0xff3d7f, bloom: 0.3 },
  clown: { bg: 0x140610, fog: 0x140610, table: 0x2a1020, line: 0xffc857, p1: 0xff4d8d, p2: 0x4d9fff, bloom: 0.5 },
  beach: { bg: 0x081820, fog: 0x081820, table: 0x1a8f9a, line: 0xffe08a, p1: 0xffe08a, p2: 0xff6aa8, hemi: 0xfff0c8, bloom: 0.4, exposure: 1.15 },
  tilt: { bg: 0x0c0c14, fog: 0x0c0c14, table: 0x1a2030, line: 0x7ad7ff, p1: 0x3dffd1, p2: 0xff3d7f, bloom: 0.44 },
  puck: { bg: 0x0a1018, fog: 0x0a1018, table: 0xcfdbe6, line: 0xff3d7f, p1: 0x3d7dff, p2: 0xff3d7f, bloom: 0.4 },
  balloons: { bg: 0x14080c, fog: 0x14080c, table: 0x3a1020, line: 0xffc857, p1: 0xff4d8d, p2: 0x4dffd1, bloom: 0.55 },
  pinball: { bg: 0x080610, fog: 0x080610, table: 0x12081c, line: 0xff4dff, p1: 0x3dffd1, p2: 0xffc857, bloom: 0.62 },
  jungle: { bg: 0x071208, fog: 0x071208, table: 0x1c4a24, line: 0xffc857, p1: 0x9be36a, p2: 0xff7a3d, bloom: 0.36 },
  triangle: { bg: 0x08070f, fog: 0x08070f, table: 0x14101c, line: 0xffc857, p1: 0x3dffd1, p2: 0xff3d7f, bloom: 0.5 }
};

const P1 = 0x3dffd1;
const P2 = 0xff3d7f;

export function buildArena(id, engine, world, sizeMul = 1, themeId = "neon") {
  const def = arenaById(id);
  // La palette dell'arena viene filtrata dal tema globale scelto in Opzioni.
  const theme = applyTheme(themeId, THEMES[id] || THEMES.classic);
  engine.setTheme(theme);
  const ctrl = { id, def, theme, extras: [], snow: null, features: {}, table: null, goldHits: 0 };

  const padScale = sizeMul;
  // Forma racchetta dettata dal tema: larghezza e lunghezza cambiano ma
  // l'area (hw × hd) resta la stessa per tutti i temi.
  const aspect = theme.paddle || { wMul: 1, lMul: 1 };
  const hwBase = 0.22 * padScale * (aspect.wMul ?? 1);
  const hdBase = 1.15 * padScale * (aspect.lMul ?? 1);
  const w = 20, d = 12;

  if (id === "triangle") {
    const tri = makeTri(18);
    world.triangle = true;
    world.tri = tri;
    world.w = 18; world.d = 16; world.openEnds = false; world.circle = false;
    ctrl.table = engine.add(makeTriangleTable(
      tri.verts, tri.edges, theme.table,
      [theme.p1 ?? 0x3dffd1, theme.p2 ?? 0xff3d7f, theme.line ?? 0xffc857],
      theme
    ));
    const hd = 1.2 * padScale * (aspect.lMul ?? 1);
    const sides = ["bottom", "east", "west"];
    tri.edges.forEach((e, i) => {
      const hw = 0.22 * padScale * (aspect.wMul ?? 1);
      const p = makePState(sides[i], "main", {
        hw,
        hd,
        // Il bordo vicino alla linea resta a distanza fissa anche con
        // racchette più larghe: inset cresce con hw.
        inset: 0.4 + hw,
        edge: e,
        angle: Math.atan2(e.nz, e.nx)
      });
      p.x = e.mx + e.nx * p.inset;
      p.z = e.mz + e.nz * p.inset;
      world.paddles.push(p);
    });
    setupThemeDecor(theme, world, engine, ctrl);
    engine.setCamera({ x: 0, y: 20, z: 11.5 }, { x: 0, y: 0, z: 0.4 }, true);
    return ctrl;
  }

  if (id === "balloons") {
    world.w = 16; world.d = 16; world.circle = true; world.radius = 7.6; world.openEnds = false;
    ctrl.table = engine.add(makeCircleTable(7.6, theme.table, theme.line, theme));
  } else {
    world.circle = false;
    world.w = w; world.d = id === "soccer" || id === "moles" ? 13 : 12;
    world.openEnds = !["soccer", "moles", "walled", "logs", "clown", "jungle", "puck"].includes(id);
    ctrl.table = engine.add(makeTable(world.w, world.d, theme.table, theme.line, { openEnds: true, theme }));
  }

  const hd = hdBase;
  const makePads = (count, opts = {}) => {
    const sides = ["left", "right"];
    for (const side of sides) {
      if (count === 1) {
        world.paddles.push(makePState(side, "main", {
          x: side === "left" ? -world.w / 2 + 0.7 : world.w / 2 - 0.7,
          hw: hwBase, hd, ...opts
        }));
      } else {
        const gx = side === "left" ? -world.w / 2 + 0.55 : world.w / 2 - 0.55;
        const sx = side === "left" ? -world.w / 2 + 2.6 : world.w / 2 - 2.6;
        world.paddles.push(makePState(side, "goalie", {
          x: gx, hw: hwBase, hd: hd * 0.85, zMin: -2.2, zMax: 2.2, ...opts
        }));
        world.paddles.push(makePState(side, "striker", {
          x: sx, hw: hwBase, hd, ...opts
        }));
      }
    }
  };

  if (id === "balloons") {
    world.paddles.push(makePState("left", "main", { x: -5.8, hw: hwBase, hd, canMoveX: true, xMin: -6.6, xMax: -2.2 }));
    world.paddles.push(makePState("right", "main", { x: 5.8, hw: hwBase, hd, canMoveX: true, xMin: 2.2, xMax: 6.6 }));
  } else if (id === "classic" || id === "penguin" || id === "snowstorm" || id === "tilt" || id === "pinball") {
    makePads(1);
  } else if (id === "logs" || id === "clown" || id === "jungle" || id === "puck") {
    makePads(1);
  } else {
    makePads(def.paddles || 2);
  }

  world.icePaddles = (id === "penguin" || id === "snowstorm" || id === "puck") ? 1.2 : 0;
  world.drag = id === "beach" ? 0.035 : 0;

  setupGoals(id, world, engine, theme, ctrl);
  setupSpecial(id, world, engine, theme, ctrl);
  setupThemeDecor(theme, world, engine, ctrl);

  engine.setCamera(
    { x: 0, y: world.circle ? 18 : 16.2, z: world.circle ? 12.5 : 13.2 },
    { x: 0, y: 0, z: -0.3 },
    true
  );

  return ctrl;
}

function makePState(side, role, extra) {
  const p = new Paddle(side, { role, ...extra });
  p.role = role;
  return p;
}

/** Elementi puramente scenografici che rendono i temi diversi da un filtro. */
function setupThemeDecor(theme, world, engine, ctrl) {
  const style = theme.style || "neon";
  const hx = (world.circle
    ? world.radius
    : world.triangle ? Math.max(...world.tri.verts.map((v) => Math.abs(v.x))) : world.w / 2) + 0.35;
  const hz = (world.circle
    ? world.radius
    : world.triangle ? Math.max(...world.tri.verts.map((v) => Math.abs(v.z))) : world.d / 2) + 0.35;
  const edgePoint = (pad = 1.6) => {
    if (Math.random() < 0.5) {
      return [(Math.random() < 0.5 ? -1 : 1) * (hx + Math.random() * pad), (Math.random() - 0.5) * hz * 2.1];
    }
    return [(Math.random() - 0.5) * hx * 2.1, (Math.random() < 0.5 ? -1 : 1) * (hz + Math.random() * pad)];
  };

  if (style === "jungle") {
    const count = 260;
    const grass = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.055, 0.42, 3),
      new THREE.MeshStandardMaterial({ color: 0x4f7d36, roughness: 1 }),
      count
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const [x, z] = edgePoint(2.3);
      dummy.position.set(x, 0.14 + Math.random() * 0.08, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.18, Math.random() * Math.PI, (Math.random() - 0.5) * 0.24);
      dummy.scale.setScalar(0.65 + Math.random() * 0.85);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      grass.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0x729b45 : i % 3 === 1 ? 0x355f2e : 0x547f37));
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.receiveShadow = true;
    engine.add(grass);
    ctrl.themeDecor = grass;

    // Masse di foglie ai quattro angoli, tenute basse per non coprire il gioco.
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x315b2d, roughness: 0.95 });
    for (const [x, z] of [[-hx - 1.4, -hz - 0.8], [hx + 1.4, -hz - 0.8], [-hx - 1.4, hz + 0.8], [hx + 1.4, hz + 0.8]]) {
      const bush = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48 + Math.random() * 0.25, 1), leafMat);
        leaf.position.set((Math.random() - 0.5) * 0.8, 0.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.8);
        leaf.castShadow = true;
        bush.add(leaf);
      }
      bush.position.set(x, 0, z);
      engine.add(bush);
    }
  }

  if (style === "boot") {
    // Quattro piccoli fari da stadio: niente glow sul tavolo, solo una silhouette
    // immediatamente diversa dall'ambiente spaziale del tema Neon.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x313733, metalness: 0.18, roughness: 0.72 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xf8f2d8, emissive: 0xf8e7ad, emissiveIntensity: 0.16, roughness: 0.5 });
    for (const [x, z] of [[-hx - 1, -hz - 0.6], [hx + 1, -hz - 0.6], [-hx - 1, hz + 0.6], [hx + 1, hz + 0.6]]) {
      const tower = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 8), poleMat);
      pole.position.y = 1.7;
      const lamps = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.35, 0.12), lampMat);
      lamps.position.y = 3.35;
      lamps.lookAt(-x, 3.1, -z);
      tower.add(pole, lamps);
      tower.position.set(x, 0, z);
      engine.add(tower);
    }
  }

  if (style === "ice") {
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xb9e5f4, roughness: 0.14, metalness: 0.05 });
    const count = 34;
    const crystals = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.8, 5), iceMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const [x, z] = edgePoint(1.8);
      const s = 0.55 + Math.random() * 1.2;
      dummy.position.set(x, 0.28 * s, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.18, Math.random() * Math.PI, (Math.random() - 0.5) * 0.18);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      crystals.setMatrixAt(i, dummy.matrix);
    }
    crystals.instanceMatrix.needsUpdate = true;
    crystals.castShadow = true;
    engine.add(crystals);
  }

  if (style === "baseball") {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xf7f4e8, roughness: 0.65 });
    const bases = [[0, 0], [0, -3.4], [-3.1, 0], [3.1, 0]];
    for (const [x, z] of bases) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), baseMat);
      base.position.set(x, 0.06, z);
      base.rotation.y = Math.PI / 4;
      engine.add(base);
    }
  }

  if (style === "sushi") {
    // Lanterne rosse sospese ai quattro angoli.
    for (const [x, z] of [[-hx - 1, -hz - 1], [hx + 1, -hz - 1], [-hx - 1, hz + 1], [hx + 1, hz + 1]]) {
      const lantern = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 3.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.6 })
      );
      pole.position.y = 1.5;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xff5050, emissive: 0xff2020, emissiveIntensity: 0.6, roughness: 0.6 })
      );
      bulb.scale.y = 0.85;
      bulb.position.y = 2.9;
      const light = new THREE.PointLight(0xff6060, 0.7, 8, 2);
      light.position.y = 2.9;
      lantern.add(pole, bulb, light);
      lantern.position.set(x, 0, z);
      engine.add(lantern);
    }
  }

  if (style === "viking") {
    // Pali con tende di cuoio e bracieri.
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 0.9 });
    for (const [x, z] of [[-hx - 0.8, 0], [hx + 0.8, 0], [0, -hz - 0.8], [0, hz + 0.8]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 8), wood);
      post.position.set(x, 1.3, z);
      post.castShadow = true;
      engine.add(post);
      // Braciere
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.18, 0.2, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a2220, metalness: 0.5, roughness: 0.5 })
      );
      bowl.position.set(x, 2.7, z);
      const fire = new THREE.PointLight(0xff8030, 0.9, 7, 2);
      fire.position.set(x, 2.9, z);
      engine.add(bowl, fire);
    }
  }

  if (style === "western") {
    // Steccato di legno ai lati e un cactus per angolo.
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4022, roughness: 0.95 });
    const addFence = (x, z, w) => {
      const horiz1 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.06), wood);
      horiz1.position.set(x, 0.35, z);
      const horiz2 = horiz1.clone();
      horiz2.position.y = 0.65;
      for (let i = -w / 2; i <= w / 2 + 0.01; i += 0.8) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), wood);
        post.position.set(x + i, 0.42, z);
        engine.add(post);
      }
      engine.add(horiz1, horiz2);
    };
    addFence(0, -hz - 0.6, hx * 2);
    addFence(0, hz + 0.6, hx * 2);
  }

  // Spettatori a tema attorno al tavolo.
  const spectatorKind = theme.spectators || null;
  if (spectatorKind) {
    const crowd = makeSpectators(spectatorKind, theme, hx, hz);
    engine.add(crowd);
    ctrl.spectators = crowd;
  }
}

function setupGoals(id, world, engine, theme, ctrl) {
  world.goals = [];
  if (id === "classic" || id === "penguin" || id === "snowstorm" || id === "tilt" || id === "beach" || id === "pinball") {
    world.goals.push(
      { side: "left", zMin: -99, zMax: 99, accept: () => true, open: true },
      { side: "right", zMin: -99, zMax: 99, accept: () => true, open: true }
    );
    return;
  }
  if (id === "soccer" || id === "moles") {
    const gw = 3.6;
    for (const side of ["left", "right"]) {
      world.goals.push({ side, zMin: -gw / 2, zMax: gw / 2, accept: () => true, open: true });
      const f = makeGoalFrame(gw, 1.4, side === "left" ? P1 : P2);
      f.position.set(side === "left" ? -world.w / 2 : world.w / 2, 0, 0);
      engine.add(f);
    }
    world.openEnds = false;
    addEndWalls(world, engine, theme, gw);
    return;
  }
  if (id === "walled") {
    const gap = 2.8;
    world.openEnds = false;
    world.goals.push(
      { side: "left", zMin: -gap / 2, zMax: gap / 2, accept: () => true, open: true },
      { side: "right", zMin: -gap / 2, zMax: gap / 2, accept: () => true, open: true }
    );
    addEndWalls(world, engine, theme, gap);
    const wall = { type: "wall", x: 0, z: 3.4, hw: 0.18, hd: 2.6, mesh: null };
    const wall2 = { type: "wall", x: 0, z: -3.4, hw: 0.18, hd: 2.6, mesh: null };
    const mat = new THREE.MeshStandardMaterial({ color: 0x222833, metalness: 0.5, roughness: 0.3, emissive: theme.line, emissiveIntensity: 0.2 });
    for (const w of [wall, wall2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, 0.7, w.hd * 2), mat);
      m.position.set(w.x, 0.35, w.z);
      m.castShadow = true;
      engine.add(m);
      w.mesh = m;
      world.obstacles.push(w);
    }
    return;
  }
  if (id === "logs") {
    const gw = 2.2;
    world.openEnds = false;
    for (const side of ["left", "right"]) {
      world.goals.push(
        { side, zMin: -world.d / 2 + 0.2, zMax: -world.d / 2 + gw, accept: () => true, open: true },
        { side, zMin: world.d / 2 - gw, zMax: world.d / 2 - 0.2, accept: () => true, open: true }
      );
    }
    addEndWalls(world, engine, theme, null, true, gw);
    return;
  }
  if (id === "clown") {
    const colors = [
      { id: "red", color: 0xff3d5a },
      { id: "blue", color: 0x3d8fff },
      { id: "gold", color: 0xffc857 }
    ];
    ctrl.colors = colors;
    world.openEnds = false;
    const slot = world.d / colors.length;
    colors.forEach((c, i) => {
      const z0 = -world.d / 2 + i * slot;
      const z1 = z0 + slot;
      for (const side of ["left", "right"]) {
        world.goals.push({
          side, zMin: z0 + 0.15, zMax: z1 - 0.15, colorId: c.id,
          accept: (b) => !b.colorId || b.colorId === c.id, open: true
        });
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.55, slot - 0.25),
          new THREE.MeshStandardMaterial({ color: c.color, emissive: c.color, emissiveIntensity: 0.55 })
        );
        m.position.set(side === "left" ? -world.w / 2 - 0.05 : world.w / 2 + 0.05, 0.28, (z0 + z1) / 2);
        engine.add(m);
      }
    });
    addEndWalls(world, engine, theme, 0);
    return;
  }
  if (id === "puck") {
    world.openEnds = false;
    world.goals = [];
    addEndWalls(world, engine, theme, 0);
    const lineL = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, world.d * 0.9),
      new THREE.MeshBasicMaterial({ color: P1, transparent: true, opacity: 0.7 })
    );
    lineL.rotation.x = -Math.PI / 2;
    lineL.position.set(-world.w / 2 + 2.2, 0.02, 0);
    const lineR = lineL.clone();
    lineR.material = new THREE.MeshBasicMaterial({ color: P2, transparent: true, opacity: 0.7 });
    lineR.position.x = world.w / 2 - 2.2;
    engine.add(lineL, lineR);
    ctrl.puckLine = 2.2;
    return;
  }
  if (id === "jungle") {
    world.openEnds = false;
    const slots = [-3.6, -1.2, 1.2, 3.6];
    ctrl.scoredGoals = { left: new Set(), right: new Set() };
    slots.forEach((z, i) => {
      for (const side of ["left", "right"]) {
        world.goals.push({
          side, zMin: z - 0.7, zMax: z + 0.7, gid: i,
          accept: () => true, open: true
        });
        const f = makeGoalFrame(1.4, 0.9, side === "left" ? P1 : P2);
        f.position.set(side === "left" ? -world.w / 2 : world.w / 2, 0, z);
        engine.add(f);
      }
    });
    addEndWalls(world, engine, theme, null, true, 1.2);
    return;
  }
  if (id === "balloons") {
    world.goals = [];
  }
}

function addEndWalls(world, engine, theme, gapW, split = false, gw = 2.2) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x10141c, metalness: 0.4, roughness: 0.35, emissive: theme.line, emissiveIntensity: 0.12
  });
  const h = 0.55;
  for (const side of [-1, 1]) {
    const x = side * (world.w / 2 + 0.1);
    if (gapW === 0) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, world.d + 0.4), mat);
      m.position.set(x, h / 2, 0);
      engine.add(m);
      world.obstacles.push({ type: "wall", x, z: 0, hw: 0.12, hd: world.d / 2 + 0.1, mesh: m });
    } else if (split) {
      const mid = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, world.d - gw * 2 - 0.6), mat);
      mid.position.set(x, h / 2, 0);
      engine.add(mid);
      world.obstacles.push({ type: "wall", x, z: 0, hw: 0.12, hd: (world.d - gw * 2 - 0.6) / 2, mesh: mid });
    } else {
      const g = gapW ?? 3.6;
      const rest = (world.d - g) / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, rest), mat);
      top.position.set(x, h / 2, world.d / 4 + g / 4);
      const bot = top.clone();
      bot.position.z = -top.position.z;
      engine.add(top, bot);
      world.obstacles.push({ type: "wall", x, z: top.position.z, hw: 0.12, hd: rest / 2, mesh: top });
      world.obstacles.push({ type: "wall", x, z: bot.position.z, hw: 0.12, hd: rest / 2, mesh: bot });
    }
  }
}

function setupSpecial(id, world, engine, theme, ctrl) {
  if (id === "penguin" || id === "snowstorm") {
    ctrl.penguins = [];
    const n = id === "penguin" ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const mesh = makePenguin();
      engine.add(mesh);
      const p = {
        x: i === 0 ? -1.4 : 1.4, z: rand(-3, 3), dir: i === 0 ? 1 : -1,
        speed: 1.6 + i * 0.3, mesh, r: 0.38, type: "penguin", restitution: 0.9
      };
      mesh.position.set(p.x, 0, p.z);
      ctrl.penguins.push(p);
      world.obstacles.push(p);
    }
  }
  if (id === "snowstorm") {
    const geo = new THREE.BufferGeometry();
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-11, 11);
      pos[i * 3 + 1] = rand(0.2, 8);
      pos[i * 3 + 2] = rand(-7, 7);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    ctrl.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.75 }));
    engine.add(ctrl.snow);
    ctrl.windT = 0;
    ctrl.windDir = 1;
  }
  if (id === "logs") {
    ctrl.logs = [];
    const zs = [-3.2, -1.05, 1.05, 3.2];
    zs.forEach((z, i) => {
      const mesh = makeLog(3.4, 0.26);
      engine.add(mesh);
      const log = { type: "log", x: 0, z, hw: 1.7, hd: 0.26, omega: 0, mesh, color: i % 2 };
      mesh.position.set(0, 0.28, z);
      world.obstacles.push(log);
      ctrl.logs.push(log);
    });
  }
  if (id === "moles") {
    const spots = [[-2.2, 2.2], [2.2, -2.4], [0, 0.6], [-3.5, -1.2], [3.4, 1.8]];
    ctrl.hills = [];
    for (const [x, z] of spots) {
      const mesh = makeHill(0.7, 0.42);
      mesh.position.set(x, 0, z);
      engine.add(mesh);
      const h = { type: "hill", x, z, hw: 0.55, hd: 0.55, mesh };
      world.obstacles.push(h);
      ctrl.hills.push(h);
    }
    const holes = [[-1.2, -3.2], [1.6, 3.3], [4.2, -0.4], [-4.1, 0.8]];
    ctrl.holes = [];
    for (const [x, z] of holes) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.45, 16),
        new THREE.MeshBasicMaterial({ color: 0x0a0806 })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      engine.add(m);
      const hole = { x, z, r: 0.42, mesh: m };
      world.holes.push(hole);
      ctrl.holes.push(hole);
    }
  }
  if (id === "balloons") {
    ctrl.balloons = [];
    const cols = [0xff3d5a, 0xffc857, 0x3dffd1, 0x4d9fff, 0xff7ad9, 0xb47cff];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 2.1 + (i % 3) * 0.55;
      const mesh = makeBalloon(cols[i % cols.length]);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      mesh.position.set(x, 0, z);
      engine.add(mesh);
      const b = { type: "balloon", x, z, r: 0.4, mesh, hp: 1, color: cols[i % cols.length], restitution: 0.4 };
      world.obstacles.push(b);
      ctrl.balloons.push(b);
    }
  }
  if (id === "puck") {
    const mesh = makePuck();
    engine.add(mesh);
    ctrl.puck = { type: "puck", x: 0, z: 0, r: 0.72, vx: 0, vz: 0, mesh, restitution: 0.55, mass: 3 };
    world.obstacles.push(ctrl.puck);
  }
  if (id === "pinball") {
    ctrl.pillars = [];
    const pts = [[-2.2, 2.4], [2.2, 2.4], [-2.2, -2.4], [2.2, -2.4]];
    pts.forEach(([x, z], i) => {
      const mesh = makeBumper([0xff4d8d, 0x3dffd1, 0xffc857, 0x7ad7ff][i]);
      mesh.position.set(x, 0, z);
      engine.add(mesh);
      const p = { type: "bumper", x, z, r: 0.48, mesh, hp: 3, glow: i === 0, restitution: 1.35 };
      world.obstacles.push(p);
      ctrl.pillars.push(p);
    });
    ctrl.activePillar = 0;
    setPillarGlow(ctrl);
    ctrl.gold = { x: 0, z: 0, r: 0.55, ready: false, mesh: null };
    const gm = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.35, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xffc857, metalness: 0.85, roughness: 0.2, emissive: 0xffc857, emissiveIntensity: 0.6 })
    );
    gm.position.set(0, 0.25, 0);
    gm.visible = false;
    engine.add(gm);
    ctrl.gold.mesh = gm;
  }
  if (id === "jungle") {
    const holes = [[-3, 2.5], [3, -2.5], [0, 0], [-4.5, -2], [4.5, 2], [1.8, 3.4], [-1.8, -3.4]];
    for (const [x, z] of holes) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 16),
        new THREE.MeshBasicMaterial({ color: 0x051005 })
      );
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z);
      engine.add(m);
      world.holes.push({ x, z, r: 0.46, deadly: true });
    }
    ctrl.spikes = { left: [], right: [] };
    for (const side of ["left", "right"]) {
      for (let i = 0; i < 6; i++) {
        const s = makeSpike(0.55);
        const z = -4.5 + i * 1.8;
        s.position.set(side === "left" ? -world.w / 2 + 1.35 : world.w / 2 - 1.35, -0.7, z);
        engine.add(s);
        ctrl.spikes[side].push(s);
      }
    }
    ctrl.spikeUp = { left: false, right: false };
  }
  if (id === "tilt") {
    ctrl.tilt = { x: 0, z: 0 };
    ctrl.hillMesh = null;
  }

  ctrl.features = {
    spinLogs(side) {
      const dir = side === "left" ? 1 : -1;
      for (const l of ctrl.logs || []) l.omega = (l.omega || 0) + 6 * dir;
    },
    tilt(side) {
      const dir = side === "left" ? 1 : -1;
      world.gravityX = (world.gravityX || 0) + 6 * dir;
      ctrl.tiltWant = Math.max(-0.32, Math.min(0.32, (ctrl.tiltWant || 0) + dir * 0.12));
    },
    makeHill() {
      world.gravityX = 0;
      ctrl.hillStacks = (ctrl.hillStacks || 0) + 1;
      if (!ctrl.centerHill) {
        const mesh = makeHill(1.4, 0.7);
        mesh.position.set(0, 0, 0);
        engine.add(mesh);
        ctrl.centerHill = { type: "hill", x: 0, z: 0, hw: 1.1, hd: 1.1, mesh };
        world.obstacles.push(ctrl.centerHill);
      }
      const scale = 1 + Math.min(1.2, (ctrl.hillStacks - 1) * 0.15);
      ctrl.centerHill.mesh.scale.setScalar(scale);
      ctrl.centerHill.hw = 1.1 * scale;
      ctrl.centerHill.hd = 1.1 * scale;
    },
    makeDip() {
      world.gravityX = 0;
      world.gravityZ = 0;
      ctrl.dipStacks = (ctrl.dipStacks || 0) + 1;
      ctrl.dip = true;
    },
    blowFan(side) {
      const dir = side === "left" ? 1 : -1;
      if (ctrl.puck) {
        ctrl.puck.vx += dir * 4;
      }
      ctrl.fanDir = dir;
      ctrl.fanT = (ctrl.fanT || 0) + 2.5;
      world.windX = dir * 7;
    },
    raiseSpikes(side) {
      const other = side === "left" ? "right" : "left";
      raiseSpikesVisual(ctrl, other, world, true);
    },
    raiseBarrier(side, duration = 6) {
      // Un muro temporaneo davanti alla porta del giocatore (lato opposto).
      // Se c'e' gia' una barriera per questo lato, la rinfreschiamo.
      if (ctrl.barrier) {
        const old = ctrl.barrier[side];
        if (old) {
          // La seconda barriera non sostituisce la prima: ne prolunga la vita.
          old.t += duration;
          return;
        }
      } else {
        ctrl.barrier = {};
      }
      const x = side === "left" ? -world.w / 2 + 0.9 : world.w / 2 - 0.9;
      const hw = 0.18, hd = world.d / 2 - 1.2;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x9be7ff, emissive: 0x5fbfff, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.2
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 1.0, hd * 2), mat);
      mesh.position.set(x, 0.5, 0);
      engine.add(mesh);
      const obs = { type: "wall", x, z: 0, hw, hd, mesh };
      world.obstacles.push(obs);
      ctrl.barrier[side] = { obs, mesh, t: duration, mat };
    },
    polarBear(side) {
      if (ctrl.bear) {
        ctrl.bear.t += 5;
        return;
      }
      const mesh = makePolarBear();
      const x = side === "left" ? -world.w / 2 + 1.8 : world.w / 2 - 1.8;
      mesh.position.set(x, 0, 0);
      engine.add(mesh);
      ctrl.bear = { side, mesh, t: 5 };
      const wall = { type: "wall", x, z: 0, hw: 0.3, hd: world.d / 2 - 0.3 };
      world.obstacles.push(wall);
      ctrl.bearWall = wall;
    },
    spawnSeal(side) {
      if (ctrl.seal) {
        ctrl.seal.t += 10;
        return;
      }
      const mesh = makeSeal();
      engine.add(mesh);
      const x = side === "left" ? -world.w / 2 + 1.6 : world.w / 2 - 1.6;
      ctrl.seal = { side, mesh, x, z: 0, t: 10, r: 0.4, type: "circle", restitution: 1.1 };
      world.obstacles.push(ctrl.seal);
    },
    skull(side) {
      const other = side === "left" ? "right" : "left";
      raiseSpikesVisual(ctrl, other, world, true);
    }
  };
}

function setPillarGlow(ctrl) {
  ctrl.pillars.forEach((p, i) => {
    p.glow = i === ctrl.activePillar && p.hp > 0;
    if (p.mesh?.userData.mat) {
      p.mesh.userData.mat.emissiveIntensity = p.glow ? 1.2 : 0.15;
    }
  });
}

function raiseSpikesVisual(ctrl, side, world, up) {
  if (!ctrl.spikes) return;
  ctrl.spikeUp[side] = up;
  ctrl.spikes[side].forEach((s, i) => {
    s.userData.wantY = up ? 0 : -0.7;
  });
  if (up) {
    const x = side === "left" ? -world.w / 2 + 1.35 : world.w / 2 - 1.35;
    if (!ctrl.spikeObs) ctrl.spikeObs = {};
    if (ctrl.spikeObs[side]) {
      const idx = world.obstacles.indexOf(ctrl.spikeObs[side]);
      if (idx >= 0) world.obstacles.splice(idx, 1);
    }
    const o = { type: "wall", x, z: 0, hw: 0.16, hd: 5.2 };
    world.obstacles.push(o);
    ctrl.spikeObs[side] = o;
  }
}

export function updateArena(ctrl, world, dt, engine, game) {
  const id = ctrl.id;

  if (ctrl.penguins) {
    for (const p of ctrl.penguins) {
      p.z += p.dir * p.speed * dt;
      if (p.z > world.d / 2 - 0.8) p.dir = -1;
      if (p.z < -world.d / 2 + 0.8) p.dir = 1;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
      p.mesh.rotation.x = Math.sin(performance.now() * 0.01) * 0.08;
    }
  }

  if (ctrl.snow) {
    ctrl.windT -= dt;
    if (ctrl.windT <= 0) {
      ctrl.windT = 2.4 + Math.random() * 2;
      const a = rand(-Math.PI, Math.PI);
      const mag = 9 + Math.random() * 7;
      world.windX = Math.cos(a) * mag;
      world.windZ = Math.sin(a) * mag * 0.55;
    }
    const pos = ctrl.snow.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.array[i * 3] += world.windX * dt * 0.25;
      pos.array[i * 3 + 1] -= dt * 2.2;
      pos.array[i * 3 + 2] += world.windZ * dt * 0.25;
      if (pos.array[i * 3 + 1] < 0) pos.array[i * 3 + 1] = 8;
      if (pos.array[i * 3] > 12) pos.array[i * 3] = -12;
      if (pos.array[i * 3] < -12) pos.array[i * 3] = 12;
    }
    pos.needsUpdate = true;
  }

  if (ctrl.logs) {
    for (const l of ctrl.logs) {
      l.omega *= Math.pow(0.25, dt);
      l.mesh.rotation.x += l.omega * dt;
    }
  }

  if (ctrl.fanT > 0) {
    ctrl.fanT -= dt;
    world.windX = (ctrl.fanDir || 1) * 7;
    if (ctrl.fanT <= 0) world.windX = 0;
  }

  if (ctrl.puck) {
    const p = ctrl.puck;
    p.vx *= Math.pow(0.55, dt);
    p.vz *= Math.pow(0.55, dt);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const hx = world.w / 2 - p.r - 0.2, hz = world.d / 2 - p.r;
    if (p.z > hz) { p.z = hz; p.vz *= -0.8; }
    if (p.z < -hz) { p.z = -hz; p.vz *= -0.8; }
    if (p.x > hx) { p.x = hx; p.vx *= -0.6; }
    if (p.x < -hx) { p.x = -hx; p.vx *= -0.6; }
    p.mesh.position.set(p.x, 0.1, p.z);
    p.mesh.rotation.z -= p.vx * dt * 0.4;
    if (p.x > world.w / 2 - ctrl.puckLine - 0.4) {
      game.scorePoint("left");
      resetPuck(p);
    } else if (p.x < -world.w / 2 + ctrl.puckLine + 0.4) {
      game.scorePoint("right");
      resetPuck(p);
    }
  }

  if (ctrl.table && id === "tilt") {
    const want = ctrl.tiltWant || 0;
    ctrl.tilt.x = lerp(ctrl.tilt.x, want, 1 - Math.pow(0.1, dt));
    ctrl.table.rotation.z = -ctrl.tilt.x;
    world.gravityX = ctrl.tilt.x * 28;
    if (ctrl.dip) {
      for (const b of world.balls) {
        const dipForce = 1.8 * Math.max(1, ctrl.dipStacks || 1);
        b.vx += -b.x * dipForce * dt;
        b.vz += -b.z * dipForce * dt;
      }
    }
  }

  if (ctrl.seal) {
    ctrl.seal.t -= dt;
    const balls = world.balls.filter((b) => b.alive);
    let tz = 0;
    if (balls[0]) tz = balls[0].z;
    ctrl.seal.z = lerp(ctrl.seal.z, tz, 1 - Math.pow(0.08, dt));
    ctrl.seal.mesh.position.set(ctrl.seal.x, 0.1, ctrl.seal.z);
    if (ctrl.seal.t <= 0) {
      world.obstacles = world.obstacles.filter((o) => o !== ctrl.seal);
      engine.arenaRoot.remove(ctrl.seal.mesh);
      ctrl.seal = null;
    }
  }

  if (ctrl.bear) {
    ctrl.bear.t -= dt;
    ctrl.bear.mesh.position.y = Math.min(0.2, ctrl.bear.mesh.position.y + dt);
    if (ctrl.bear.t <= 0) {
      world.obstacles = world.obstacles.filter((o) => o !== ctrl.bearWall);
      engine.arenaRoot.remove(ctrl.bear.mesh);
      ctrl.bear = null;
    }
  }

  if (ctrl.spikes) {
    for (const side of ["left", "right"]) {
      for (const s of ctrl.spikes[side]) {
        const want = s.userData.wantY ?? -0.7;
        s.position.y = lerp(s.position.y, want, 1 - Math.pow(0.05, dt));
      }
    }
  }

  // Barriere temporanee (potere Barriera).
  if (ctrl.barrier) {
    for (const side of Object.keys(ctrl.barrier)) {
      const b = ctrl.barrier[side];
      b.t -= dt;
      if (b.mat) b.mat.opacity = Math.max(0, Math.min(0.75, b.t > 0.5 ? 0.75 : b.t));
      if (b.t <= 0) {
        world.obstacles = world.obstacles.filter((o) => o !== b.obs);
        if (b.mesh) engine.arenaRoot.remove(b.mesh);
        delete ctrl.barrier[side];
      }
    }
  }

  if (ctrl.gold?.ready) {
    ctrl.gold.mesh.rotation.y += dt * 2;
    ctrl.gold.mesh.position.y = 0.28 + Math.sin(performance.now() * 0.004) * 0.08;
  }
}

export function handleArenaEvent(ctrl, ev, game, world, engine) {
  if (ev.type === "obstacle" && ev.obs?.type === "penguin") {
    const now = performance.now();
    if ((ev.obs.hitAt || 0) + 700 < now && world.balls.filter((b) => b.alive).length < 4) {
      ev.obs.hitAt = now;
      game.spawnExtraBall(ev.ball);
    }
  }
  if (ev.type === "obstacle" && ev.obs?.type === "balloon") {
    ev.obs.hp--;
    if (ev.obs.hp <= 0 && ev.obs.alive !== false) {
      ev.obs.alive = false;
      ev.obs.mesh.visible = false;
      world.obstacles = world.obstacles.filter((o) => o !== ev.obs);
      const scorer = ev.ball.lastHit || (ev.ball.vx > 0 ? "left" : "right");
      game.scorePoint(scorer, { keepBall: true });
      game.particles.burst(ev.obs.x, 0.5, ev.obs.z, ev.obs.color, 22, 5);
      if (ctrl.balloons && ctrl.balloons.every((x) => x.alive === false) && game.checkWin?.() === false) {
        if (game.scores.left !== game.scores.right) game.endMatch();
      }
    }
  }
  if (ev.type === "obstacle" && ev.obs?.type === "puck") {
    ev.obs.vx += ev.ball.vx * 0.18;
    ev.obs.vz += ev.ball.vz * 0.18;
  }
  if (ev.type === "obstacle" && ev.obs?.type === "bumper") {
    const p = ev.obs;
    if (p.glow && p.hp > 0) {
      p.hp--;
      p.mesh.scale.setScalar(0.85 + p.hp * 0.05);
      if (p.hp <= 0) {
        p.mesh.visible = false;
        world.obstacles = world.obstacles.filter((o) => o !== p);
        ctrl.activePillar = ctrl.pillars.findIndex((x) => x.hp > 0);
        if (ctrl.activePillar < 0) {
          ctrl.gold.ready = true;
          ctrl.gold.mesh.visible = true;
          world.obstacles.push({ type: "bumper", x: 0, z: 0, r: 0.5, gold: true, restitution: 0.2, mesh: ctrl.gold.mesh });
        } else setPillarGlow(ctrl);
      }
    }
    if (p.gold) {
      game.scorePoint(ev.ball.lastHit || "left", { keepBall: true });
      ctrl.gold.mesh.scale.setScalar(1.2);
      setTimeout(() => ctrl.gold.mesh.scale.setScalar(1), 120);
    }
  }
  if (ev.type === "hole") {
    const h = ev.hole;
    if (h.deadly) {
      ev.ball.alive = false;
      game.particles.burst(ev.ball.x, 0.2, ev.ball.z, 0x1a3a1a, 10, 2);
      if (world.balls.filter((b) => b.alive).length === 0) game.serveSoon();
    } else if (ctrl.holes) {
      const others = ctrl.holes.filter((x) => x !== h);
      const dest = pick(others);
      ev.ball.x = dest.x;
      ev.ball.z = dest.z;
      ev.ball.vx *= -0.4;
      ev.ball.vz = rand(-6, 6);
      ev.ball.ghost = 0.2;
    }
  }
  if (ev.type === "score" && ctrl.id === "clown") {
    if (ev.goal && ev.ball.colorId && ev.goal.colorId !== ev.ball.colorId) {
      ev.ball.alive = true;
      const hx = world.w / 2 - ev.ball.r - 0.05;
      if (ev.side === "right") { ev.ball.x = hx; ev.ball.vx = -Math.abs(ev.ball.vx); }
      else { ev.ball.x = -hx; ev.ball.vx = Math.abs(ev.ball.vx); }
      return true;
    }
  }
  if (ev.type === "score" && ctrl.id === "jungle" && ev.goal) {
    const scorer = ev.side === "left" ? "right" : "left";
    ctrl.scoredGoals[scorer].add(ev.goal.gid);
    if (ctrl.scoredGoals[scorer].size >= 4) {
      raiseSpikesVisual(ctrl, ev.side, world, true);
    }
  }
  if (ev.type === "score" && (ctrl.id === "puck" || ctrl.id === "balloons" || ctrl.id === "pinball")) {
    if (ctrl.id === "puck") return true;
    if (ctrl.id === "balloons") return true;
  }
}

function resetPuck(p) {
  p.x = 0; p.z = 0; p.vx = 0; p.vz = 0;
}

function lerp(a, b, t) { return a + (b - a) * t; }

export function nextBallColor(ctrl) {
  if (!ctrl.colors) return { color: 0xffffff, colorId: null };
  const c = pick(ctrl.colors);
  return { color: c.color, colorId: c.id };
}

export function puckMode(id) {
  return id === "puck";
}
