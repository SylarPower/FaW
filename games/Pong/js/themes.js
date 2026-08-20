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
  style: "neon",
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
    desc: "Il look originale: metallo scuro, riflessi e accenti al neon.",
    swatch: [0x3dffd1, 0xff3d7f, 0xffc857],
    apply: (b) => ({ ...b, ...neonMaterials }),
    ui: null // usa i valori di default del CSS
  },

  jungle: {
    id: "jungle",
    name: "Giungla",
    desc: "Erba vera sul tavolo, ciuffi ai bordi e racchette di legno avvolte dalle liane.",
    swatch: [0x75a843, 0x274e2b, 0xc49a5a],
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
    desc: "Un campo da calcio opaco: le barre diventano veri scarponi con lacci e tacchetti.",
    swatch: [0x2f8a43, 0xf4efe1, 0xe04848],
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

  retro: {
    id: "retro",
    name: "Retro CRT",
    desc: "Cabinet anni '70: fosfori verdi, griglia a pixel e materiali opachi, senza cromature.",
    swatch: [0x36df68, 0x10351b, 0xb4ff4a],
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "retro",
      bg: 0x010703,
      fog: 0x010703,
      table: mono(b.table, 0x2a9b4b),
      line: 0x54f27a,
      p1: 0x54f27a,
      p2: 0xb4ff4a,
      hemi: 0x83b990,
      tableRoughness: 0.72,
      paddleEmissive: 0.08,
      edgeGlow: 0.18,
      ballEmissive: 0.06,
      ballLight: 0.25,
      bloom: 0.1,
      exposure: 0.95,
      accentIntensity: 0.16,
      sunIntensity: 0.72,
      hemiIntensity: 0.55
    }),
    ui: {
      "--bg": "#010703", "--panel": "rgba(2, 14, 6, 0.9)",
      "--panel-2": "rgba(4, 22, 9, 0.96)", "--line": "rgba(84, 242, 122, 0.22)",
      "--mint": "#54f27a", "--mint-dim": "rgba(84, 242, 122, 0.15)",
      "--pink": "#b4ff4a", "--pink-dim": "rgba(180, 255, 74, 0.15)",
      "--gold": "#d8ff8a", "--ice": "#94f7ac",
      "--text": "#dcffe4", "--muted": "#568b62"
    }
  },

  aurora: {
    id: "aurora",
    name: "Ghiaccio",
    desc: "Superfici fredde e levigate, cristalli ai bordi e luce artica soffusa.",
    swatch: [0x76b7ff, 0xb59bff, 0xd9f5ff],
    apply: (b) => ({
      ...b,
      style: "ice",
      bg: 0x09101e,
      fog: 0x111d32,
      table: tint(sat(b.table, 0.35), 0xaad9eb, 0.68),
      line: 0xd9f5ff,
      p1: 0x76b7ff,
      p2: 0xb59bff,
      hemi: 0xdceeff,
      bloom: 0.12,
      exposure: 1.08,
      tableMetalness: 0.05,
      tableRoughness: 0.18,
      tableEmissive: 0.01,
      rimGlow: 0.12,
      paddleMetalness: 0.08,
      paddleRoughness: 0.2,
      paddleEmissive: 0.03,
      edgeGlow: 0.18,
      ballMetalness: 0.12,
      ballRoughness: 0.12,
      ballEmissive: 0.02,
      ballLight: 0.25,
      showStars: true,
      showRings: false,
      accentIntensity: 0.24,
      sunIntensity: 1.75,
      hemiIntensity: 1.2
    }),
    ui: {
      "--bg": "#09101e", "--panel": "rgba(12, 23, 42, 0.84)",
      "--panel-2": "rgba(20, 34, 58, 0.95)", "--line": "rgba(217, 245, 255, 0.17)",
      "--mint": "#76b7ff", "--mint-dim": "rgba(118, 183, 255, 0.16)",
      "--pink": "#b59bff", "--pink-dim": "rgba(181, 155, 255, 0.16)",
      "--gold": "#d9f5ff", "--ice": "#e9fbff",
      "--text": "#f1f8ff", "--muted": "#879bb5"
    }
  },

  sunset: {
    id: "sunset",
    name: "Terracotta",
    desc: "Argilla, sabbia e colori caldi: tutto opaco, come un campo al tramonto.",
    swatch: [0xe58a4b, 0x913f4b, 0xf1cb85],
    apply: (b) => ({
      ...b,
      ...matteMaterials,
      style: "sunset",
      bg: 0x24130f,
      fog: 0x382018,
      table: tint(sat(b.table, 0.45), 0xa55436, 0.67),
      line: 0xf1cb85,
      p1: 0xe58a4b,
      p2: 0xb94c65,
      hemi: 0xf0c093,
      bloom: 0.02,
      exposure: 1.06,
      accentIntensity: 0.08,
      sunIntensity: 1.9,
      hemiIntensity: 1.05
    }),
    ui: {
      "--bg": "#24130f", "--panel": "rgba(43, 23, 18, 0.86)",
      "--panel-2": "rgba(58, 31, 24, 0.95)", "--line": "rgba(241, 203, 133, 0.18)",
      "--mint": "#e58a4b", "--mint-dim": "rgba(229, 138, 75, 0.17)",
      "--pink": "#d35f76", "--pink-dim": "rgba(211, 95, 118, 0.17)",
      "--gold": "#f1cb85", "--ice": "#f0b88d",
      "--text": "#fff0dd", "--muted": "#b28a76"
    }
  },

  mono: {
    id: "mono",
    name: "Inchiostro",
    desc: "Bianco e nero da tavolo tecnico: carta ruvida, ombre nette, zero bagliori.",
    swatch: [0xf5f1e8, 0x8d8b86, 0x242424],
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
  }
};

export const THEME_IDS = Object.keys(THEME_DEFS);

export function themeById(id) {
  return THEME_DEFS[id] || THEME_DEFS.neon;
}

/** Applica il tema alla palette di un'arena. */
export function applyTheme(themeId, base) {
  return themeById(themeId).apply(base);
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
