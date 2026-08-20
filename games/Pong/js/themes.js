/**
 * Temi grafici globali.
 *
 * Un tema non e' piu' soltanto un filtro colore: oltre alla palette espone uno
 * `style` e i parametri dei materiali. Arena, racchette e illuminazione possono
 * cosi' cambiare davvero aspetto (erba e legno, campo da calcio e scarponi,
 * ghiaccio, materiali opachi...), senza perdere le regole dell'arena scelta.
 */

// --- utility colore (interi 0xRRGGBB) ---
const toRgb = (c) => ({ r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 });
const toInt = (r, g, b) =>
  (Math.max(0, Math.min(255, Math.round(r))) << 16) |
  (Math.max(0, Math.min(255, Math.round(g))) << 8) |
  Math.max(0, Math.min(255, Math.round(b)));

/** Luminanza percepita 0..1 */
function lum(c) {
  const { r, g, b } = toRgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Vira un colore verso `target` di una quantita' `t` (0..1). */
function tint(c, target, t) {
  const a = toRgb(c), b = toRgb(target);
  return toInt(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/** Satura/desatura verso il grigio equivalente. `k`>1 satura, <1 desatura. */
function sat(c, k) {
  const { r, g, b } = toRgb(c);
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return toInt(gray + (r - gray) * k, gray + (g - gray) * k, gray + (b - gray) * k);
}

/** Moltiplica la luminosita'. */
function mul(c, k) {
  const { r, g, b } = toRgb(c);
  return toInt(r * k, g * k, b * k);
}

/** Mappa un colore sulla scala di una tinta unica, preservandone la luminanza. */
function mono(c, hue) {
  const l = lum(c);
  const h = toRgb(hue);
  return toInt(h.r * l, h.g * l, h.b * l);
}

const hex = (c) => "#" + c.toString(16).padStart(6, "0");

/** Parametri comuni al solo tema che deve davvero sembrare al neon. */
const neonMaterials = {
  tableMetalness: 0.35,
  tableRoughness: 0.38,
  tableEmissive: 0.04,
  rimGlow: 0.35,
  paddleMetalness: 0.55,
  paddleRoughness: 0.22,
  paddleEmissive: 0.22,
  edgeGlow: 1.4,
  ballMetalness: 0.65,
  ballRoughness: 0.18,
  ballEmissive: 0.18,
  ballLight: 1.6,
  showStars: true,
  showRings: true,
  accentIntensity: 1,
  sunIntensity: 1.15,
  hemiIntensity: 0.7
};

const matteMaterials = {
  tableMetalness: 0,
  tableRoughness: 0.88,
  tableEmissive: 0,
  rimGlow: 0.02,
  paddleMetalness: 0,
  paddleRoughness: 0.76,
  paddleEmissive: 0,
  edgeGlow: 0,
  ballMetalness: 0.05,
  ballRoughness: 0.62,
  ballEmissive: 0,
  ballLight: 0.12,
  showStars: false,
  showRings: false,
  accentIntensity: 0.18,
  sunIntensity: 1.65,
  hemiIntensity: 1.05
};

export const THEME_DEFS = {
  neon: {
    id: "neon",
    name: "Neon",
    swatch: [0x3dffd1, 0xff3d7f, 0xffc857],
    ball: { color: 0xffffff, emissive: 0xffffff, metalness: 0.65, roughness: 0.18, emissiveIntensity: 0.25, light: 1.8 },
    apply: (b) => ({ ...b, ...neonMaterials }),
    ui: null
  },

  jungle: {
    id: "jungle",
    name: "Giungla",
    swatch: [0x75a843, 0x274e2b, 0xc49a5a],
    spectators: "jungle",
    ball: { color: 0xd7b07a, emissive: 0x0, metalness: 0.02, roughness: 0.85, emissiveIntensity: 0, light: 0.25 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "jungle",
      bg: 0x101b12,
      fog: 0x18281a,
      table: tint(sat(b.table, 0.35), 0x477c38, 0.82),
      line: 0xd9d29a,
      p1: 0x8fcf58,
      p2: 0xe28b46,
      hemi: 0xc7d9a4,
      bloom: 0.03,
      exposure: 1.08,
      accentIntensity: 0.08,
      sunIntensity: 2,
      hemiIntensity: 1.15
    }),
    ui: {
      "--bg": "#101b12", "--panel": "rgba(18, 31, 19, 0.86)",
      "--panel-2": "rgba(26, 44, 27, 0.95)", "--line": "rgba(199, 217, 164, 0.2)",
      "--mint": "#8fcf58", "--mint-dim": "rgba(143, 207, 88, 0.17)",
      "--pink": "#e28b46", "--pink-dim": "rgba(226, 139, 70, 0.17)",
      "--gold": "#d9d29a", "--ice": "#a9c980",
      "--text": "#f1f1dc", "--muted": "#93a886"
    }
  },

  boot: {
    id: "boot",
    name: "Scarpone",
    swatch: [0x2f8a43, 0xf4efe1, 0xe04848],
    spectators: "stadium",
    // Scarpa da calcio: più corta e larga di una barra standard, stessa area.
    paddle: { wMul: 1.5, lMul: 0.667 },
    ball: { color: 0xf5f5f5, emissive: 0x0, metalness: 0.05, roughness: 0.7, emissiveIntensity: 0, light: 0.3, pattern: "soccer" },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "boot",
      bg: 0x17251a,
      fog: 0x253629,
      table: 0x317f43,
      line: 0xf4efe1,
      p1: 0x3e8ee8,
      p2: 0xe64a4a,
      hemi: 0xe8f0db,
      bloom: 0,
      exposure: 1.12,
      accentIntensity: 0,
      sunIntensity: 2.15,
      hemiIntensity: 1.2
    }),
    ui: {
      "--bg": "#111b13", "--panel": "rgba(18, 31, 21, 0.88)",
      "--panel-2": "rgba(27, 45, 31, 0.96)", "--line": "rgba(244, 239, 225, 0.2)",
      "--mint": "#66aaff", "--mint-dim": "rgba(102, 170, 255, 0.17)",
      "--pink": "#ff6464", "--pink-dim": "rgba(255, 100, 100, 0.17)",
      "--gold": "#f4efe1", "--ice": "#cde6cf",
      "--text": "#fffdf5", "--muted": "#9caf9e"
    }
  },

  airhockey: {
    id: "airhockey",
    name: "Air Hockey",
    swatch: [0x4dc6ff, 0xff5368, 0xf5fbff],
    spectators: "stadium",
    // Mazza tonda: larghezza e lunghezza quasi uguali, area invariata.
    paddle: { wMul: 2.05, lMul: 0.49 },
    ball: { color: 0xf5fbff, emissive: 0x74d5ff, metalness: 0.55, roughness: 0.16, emissiveIntensity: 0.35, light: 1.4 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "airhockey",
      bg: 0x061526,
      fog: 0x0b2238,
      table: 0x8bd7ee,
      line: 0xeafcff,
      p1: 0x1689e8,
      p2: 0xf04d68,
      hemi: 0xd9f7ff,
      tableMetalness: 0.28,
      tableRoughness: 0.24,
      tableEmissive: 0.04,
      rimGlow: 0.35,
      paddleMetalness: 0.45,
      paddleRoughness: 0.2,
      paddleEmissive: 0.24,
      edgeGlow: 0.9,
      ballMetalness: 0.55,
      ballRoughness: 0.16,
      ballEmissive: 0.3,
      ballLight: 1.4,
      bloom: 0.2,
      exposure: 1.12,
      accentIntensity: 0.5,
      sunIntensity: 1.45,
      hemiIntensity: 1.0
    }),
    ui: {
      "--bg": "#061526", "--panel": "rgba(8, 28, 48, 0.9)",
      "--panel-2": "rgba(12, 46, 73, 0.96)", "--line": "rgba(234, 252, 255, 0.24)",
      "--mint": "#4dc6ff", "--mint-dim": "rgba(77, 198, 255, 0.18)",
      "--pink": "#ff667b", "--pink-dim": "rgba(255, 102, 123, 0.18)",
      "--gold": "#f5fbff", "--ice": "#d5f6ff",
      "--text": "#f5fcff", "--muted": "#8cb5ca"
    }
  },

  baseball: {
    id: "baseball",
    name: "Baseball",
    swatch: [0x3f9652, 0xd9e4ea, 0xd84747],
    spectators: "stadium",
    // Mazza: lunga e sottile, stessa area di una barra standard.
    paddle: { wMul: 0.55, lMul: 1.82 },
    ball: { color: 0xf7f4e8, emissive: 0xffffff, metalness: 0.02, roughness: 0.62, emissiveIntensity: 0.08, light: 0.6 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "baseball",
      bg: 0x08150d,
      fog: 0x14291b,
      table: 0x3f9652,
      line: 0xf7f4e8,
      p1: 0xd84747,
      p2: 0x3d82d6,
      hemi: 0xe2f3dd,
      tableRoughness: 0.92,
      paddleMetalness: 0.08,
      paddleRoughness: 0.7,
      paddleEmissive: 0.02,
      edgeGlow: 0.1,
      ballMetalness: 0.02,
      ballRoughness: 0.62,
      ballEmissive: 0.08,
      ballLight: 0.6,
      bloom: 0.03,
      exposure: 1.08,
      accentIntensity: 0.08,
      sunIntensity: 1.9,
      hemiIntensity: 1.1
    }),
    ui: {
      "--bg": "#08150d", "--panel": "rgba(16, 38, 22, 0.9)",
      "--panel-2": "rgba(23, 57, 32, 0.96)", "--line": "rgba(247, 244, 232, 0.22)",
      "--mint": "#71cf7b", "--mint-dim": "rgba(113, 207, 123, 0.18)",
      "--pink": "#f06a6a", "--pink-dim": "rgba(240, 106, 106, 0.18)",
      "--gold": "#f7f4e8", "--ice": "#d9e4ea",
      "--text": "#f4faef", "--muted": "#91b096"
    }
  },

  aurora: {
    id: "aurora",
    name: "Ghiaccio",
    swatch: [0x76b7ff, 0xb59bff, 0xd9f5ff],
    spectators: "ice",
    // La barra sul ghiaccio si vedeva poco: piu' scura, bordo piu' marcato.
    ball: { color: 0xff3d7f, emissive: 0xff165f, metalness: 0.12, roughness: 0.18, emissiveIntensity: 1.0, light: 2.8 },
    apply: (b) => ({
      ...b,
      style: "ice",
      bg: 0x09101e,
      fog: 0x111d32,
      table: tint(sat(b.table, 0.35), 0xaad9eb, 0.68),
      line: 0xd9f5ff,
      p1: 0x3b82f6,
      p2: 0xa855f7,
      hemi: 0xdceeff,
      bloom: 0.12,
      exposure: 1.08,
      tableMetalness: 0.05,
      tableRoughness: 0.18,
      tableEmissive: 0.01,
      rimGlow: 0.18,
      // Racchetta piu' scura e con bordo marcato, cosi' non si confonde col tavolo.
      paddleMetalness: 0.15,
      paddleRoughness: 0.28,
      paddleEmissive: 0.12,
      edgeGlow: 0.55,
      ballMetalness: 0.12,
      ballRoughness: 0.12,
      ballEmissive: 0.06,
      ballLight: 0.55,
      showStars: true,
      showRings: false,
      accentIntensity: 0.35,
      sunIntensity: 1.75,
      hemiIntensity: 1.2
    }),
    ui: {
      "--bg": "#09101e", "--panel": "rgba(12, 23, 42, 0.84)",
      "--panel-2": "rgba(20, 34, 58, 0.95)", "--line": "rgba(217, 245, 255, 0.17)",
      "--mint": "#4a9eff", "--mint-dim": "rgba(74, 158, 255, 0.18)",
      "--pink": "#b480ff", "--pink-dim": "rgba(180, 128, 255, 0.18)",
      "--gold": "#d9f5ff", "--ice": "#e9fbff",
      "--text": "#f1f8ff", "--muted": "#879bb5"
    }
  },

  mono: {
    id: "mono",
    name: "Inchiostro",
    swatch: [0xf5f1e8, 0x8d8b86, 0x242424],
    spectators: "silhouette",
    ball: { color: 0xf5f1e8, emissive: 0xffffff, metalness: 0.02, roughness: 0.5, emissiveIntensity: 0.1, light: 0.5 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "mono",
      bg: 0x111111,
      fog: 0x1b1b1b,
      table: mul(sat(b.table, 0), 0.92),
      line: 0xf5f1e8,
      p1: 0xf5f1e8,
      p2: 0x969696,
      hemi: 0xffffff,
      bloom: 0,
      exposure: 1.08,
      accentIntensity: 0,
      sunIntensity: 2,
      hemiIntensity: 1.1
    }),
    ui: {
      "--bg": "#111111", "--panel": "rgba(20, 20, 20, 0.9)",
      "--panel-2": "rgba(30, 30, 30, 0.96)", "--line": "rgba(245, 241, 232, 0.2)",
      "--mint": "#f5f1e8", "--mint-dim": "rgba(245, 241, 232, 0.14)",
      "--pink": "#a8a8a8", "--pink-dim": "rgba(168, 168, 168, 0.14)",
      "--gold": "#ded9cd", "--ice": "#ffffff",
      "--text": "#f5f1e8", "--muted": "#999792"
    }
  },

  sushi: {
    id: "sushi",
    name: "Sushi",
    swatch: [0xff7a7a, 0x2c2c2c, 0xf5f0dd],
    spectators: "sushi",
    // Maki: rotolo più corto e largo, stessa area.
    paddle: { wMul: 1.35, lMul: 0.74 },
    ball: { color: 0xff9a9a, emissive: 0xff5050, metalness: 0.05, roughness: 0.45, emissiveIntensity: 0.25, light: 0.7 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "sushi",
      bg: 0x1a0e10,
      fog: 0x2b1618,
      table: 0x1f2728,
      line: 0xffb07a,
      p1: 0xff6b6b,
      p2: 0x7fd1b9,
      hemi: 0xffe2d1,
      bloom: 0.18,
      exposure: 1.1,
      tableMetalness: 0.08,
      tableRoughness: 0.45,
      tableEmissive: 0.0,
      rimGlow: 0.18,
      paddleMetalness: 0.1,
      paddleRoughness: 0.55,
      paddleEmissive: 0.15,
      edgeGlow: 0.35,
      ballEmissive: 0.2,
      ballLight: 0.7,
      accentIntensity: 0.45,
      sunIntensity: 1.7,
      hemiIntensity: 1.0
    }),
    ui: {
      "--bg": "#1a0e10", "--panel": "rgba(35, 18, 20, 0.88)",
      "--panel-2": "rgba(50, 25, 28, 0.96)", "--line": "rgba(255, 176, 122, 0.2)",
      "--mint": "#7fd1b9", "--mint-dim": "rgba(127, 209, 185, 0.17)",
      "--pink": "#ff6b6b", "--pink-dim": "rgba(255, 107, 107, 0.17)",
      "--gold": "#ffb07a", "--ice": "#f5f0dd",
      "--text": "#fff4ea", "--muted": "#b59a92"
    }
  },

  viking: {
    id: "viking",
    name: "Vichingo",
    swatch: [0xd9b26b, 0x5b3a1e, 0x9ec4d2],
    spectators: "viking",
    ball: { color: 0xf3d27a, emissive: 0xd88f2b, metalness: 0.45, roughness: 0.35, emissiveIntensity: 0.2, light: 0.7 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "viking",
      bg: 0x15100c,
      fog: 0x2a1e14,
      table: 0x4a3220,
      line: 0xe8c069,
      p1: 0xd9b26b,
      p2: 0x9ec4d2,
      hemi: 0xf6e3b5,
      bloom: 0.1,
      exposure: 1.08,
      tableRoughness: 0.82,
      paddleMetalness: 0.25,
      paddleRoughness: 0.5,
      paddleEmissive: 0.05,
      edgeGlow: 0.25,
      ballMetalness: 0.45,
      ballRoughness: 0.35,
      ballEmissive: 0.2,
      ballLight: 0.65,
      accentIntensity: 0.3,
      sunIntensity: 1.8,
      hemiIntensity: 0.95
    }),
    ui: {
      "--bg": "#15100c", "--panel": "rgba(28, 20, 14, 0.9)",
      "--panel-2": "rgba(44, 30, 20, 0.96)", "--line": "rgba(232, 192, 105, 0.2)",
      "--mint": "#d9b26b", "--mint-dim": "rgba(217, 178, 107, 0.17)",
      "--pink": "#9ec4d2", "--pink-dim": "rgba(158, 196, 210, 0.17)",
      "--gold": "#f0cf7e", "--ice": "#e8d9b8",
      "--text": "#fff2d6", "--muted": "#b59c7c"
    }
  },

  western: {
    id: "western",
    name: "Western",
    swatch: [0xc9813a, 0x5c3218, 0xf0ddb0],
    spectators: "western",
    ball: { color: 0xd9a05b, emissive: 0xa04b1a, metalness: 0.08, roughness: 0.8, emissiveIntensity: 0.05, light: 0.35 },
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "western",
      bg: 0x1e1408,
      fog: 0x3a2614,
      table: 0x7a4a22,
      line: 0xf0ddb0,
      p1: 0xc9813a,
      p2: 0xb5392a,
      hemi: 0xffe8bf,
      bloom: 0.04,
      exposure: 1.1,
      tableRoughness: 0.9,
      paddleMetalness: 0.05,
      paddleRoughness: 0.78,
      paddleEmissive: 0.02,
      edgeGlow: 0.12,
      ballMetalness: 0.08,
      ballRoughness: 0.8,
      ballEmissive: 0.05,
      ballLight: 0.3,
      accentIntensity: 0.1,
      sunIntensity: 2.1,
      hemiIntensity: 1.05
    }),
    ui: {
      "--bg": "#1e1408", "--panel": "rgba(38, 24, 12, 0.9)",
      "--panel-2": "rgba(58, 36, 20, 0.96)", "--line": "rgba(240, 221, 176, 0.2)",
      "--mint": "#e6a14a", "--mint-dim": "rgba(230, 161, 74, 0.17)",
      "--pink": "#c84535", "--pink-dim": "rgba(200, 69, 53, 0.17)",
      "--gold": "#f0ddb0", "--ice": "#e9d0a0",
      "--text": "#fff1d6", "--muted": "#b89671"
    }
  }
};

export const THEME_IDS = Object.keys(THEME_DEFS);

export function themeById(id) {
  return THEME_DEFS[id] || THEME_DEFS.neon;
}

/** Applica il tema alla palette di un'arena. */
export function applyTheme(themeId, base) {
  const def = themeById(themeId);
  const res = def.apply(base);
  // Porta in risultato anche le proprietà specifiche del tema (palla,
  // spettatori, forma racchetta, stile) che apply() non setta da sola.
  if (def.ball) res.ball = def.ball;
  if (def.spectators) res.spectators = def.spectators;
  if (def.paddle) res.paddle = def.paddle;
  if (!res.style && def.id === "neon") res.style = "neon";
  return res;
}

/**
 * Applica le variabili CSS del tema a menu/HUD.
 * Rimuove sempre quelle del tema precedente, cosi' "Neon" torna ai default.
 */
const UI_VARS = [
  "--bg", "--panel", "--panel-2", "--line", "--mint", "--mint-dim",
  "--pink", "--pink-dim", "--gold", "--ice", "--text", "--muted"
];

export function applyThemeToUI(themeId, root = document.documentElement) {
  const def = themeById(themeId);
  const vars = def.ui;
  for (const v of UI_VARS) root.style.removeProperty(v);
  root.dataset.pongTheme = def.id;
  if (!vars) return;
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
}

/** Colori di anteprima per la schermata Opzioni. */
export function themeSwatch(themeId) {
  return themeById(themeId).swatch.map(hex);
}

/** Restituisce i parametri della palla per un tema. */
export function ballStyleFor(themeId) {
  return themeById(themeId).ball || null;
}
