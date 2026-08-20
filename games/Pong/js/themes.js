/**
 * Temi grafici globali.
 *
 * Ogni arena ha gia' la sua palette in THEMES (arenas.js). Un tema NON la
 * sostituisce: la trasforma. Cosi' le arene restano riconoscibili (il ghiaccio
 * resta chiaro, la giungla resta verde) ma l'insieme cambia atmosfera.
 *
 * `apply(base)` riceve la palette dell'arena e ne restituisce una nuova.
 * `ui` porta le variabili CSS di menu e HUD, applicate su <html>.
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
  // curva morbida: i colori scuri restano scuri, i chiari saturano sulla tinta
  return toInt(h.r * l, h.g * l, h.b * l);
}

const hex = (c) => "#" + c.toString(16).padStart(6, "0");

export const THEME_DEFS = {
  neon: {
    id: "neon",
    name: "Neon",
    desc: "Il look originale: nero profondo e accenti al neon.",
    swatch: [0x3dffd1, 0xff3d7f, 0xffc857],
    apply: (b) => ({ ...b }),
    ui: null // usa i valori di default del CSS
  },

  retro: {
    id: "retro",
    name: "Retro",
    desc: "Monitor a fosfori verdi, come le sale giochi anni '70.",
    swatch: [0x00ff66, 0x00c04a, 0x9dff00],
    apply: (b) => {
      const G = 0x00ff66;
      return {
        ...b,
        bg: 0x020a04,
        fog: 0x020a04,
        table: mono(b.table, G),
        line: G,
        p1: G,
        p2: 0x9dff00,
        hemi: 0x66ffaa,
        bloom: (b.bloom ?? 0.4) + 0.16,
        exposure: (b.exposure ?? 1.05) * 0.98
      };
    },
    ui: {
      "--bg": "#020a04", "--panel": "rgba(3, 16, 8, 0.82)",
      "--panel-2": "rgba(4, 22, 11, 0.94)", "--line": "rgba(0, 255, 102, 0.22)",
      "--mint": "#00ff66", "--mint-dim": "rgba(0, 255, 102, 0.16)",
      "--pink": "#9dff00", "--pink-dim": "rgba(157, 255, 0, 0.16)",
      "--gold": "#ccff33", "--ice": "#66ffaa",
      "--text": "#d6ffe4", "--muted": "#4f9668"
    }
  },

  aurora: {
    id: "aurora",
    name: "Aurora",
    desc: "Blu notte e viola freddi, con bagliori tenui.",
    swatch: [0x7aa2ff, 0xc77dff, 0x8ee7ff],
    apply: (b) => ({
      ...b,
      bg: 0x070a18,
      fog: 0x070a18,
      table: tint(sat(b.table, 0.75), 0x2a3b7a, 0.42),
      line: tint(b.line, 0x8ee7ff, 0.55),
      p1: 0x7aa2ff,
      p2: 0xc77dff,
      hemi: 0xaebfff,
      bloom: (b.bloom ?? 0.4) + 0.1
    }),
    ui: {
      "--bg": "#070a18", "--panel": "rgba(10, 14, 32, 0.8)",
      "--panel-2": "rgba(16, 20, 44, 0.93)", "--line": "rgba(160, 180, 255, 0.14)",
      "--mint": "#7aa2ff", "--mint-dim": "rgba(122, 162, 255, 0.16)",
      "--pink": "#c77dff", "--pink-dim": "rgba(199, 125, 255, 0.16)",
      "--gold": "#8ee7ff", "--ice": "#aebfff",
      "--text": "#eef2ff", "--muted": "#8b95c7"
    }
  },

  sunset: {
    id: "sunset",
    name: "Tramonto",
    desc: "Arancio caldo e magenta, atmosfera vaporwave.",
    swatch: [0xff9d4d, 0xff3d7f, 0xffd166],
    apply: (b) => ({
      ...b,
      bg: 0x1a0a18,
      fog: 0x1a0a18,
      table: tint(b.table, 0x5c1f3d, 0.45),
      line: tint(b.line, 0xffd166, 0.5),
      p1: 0xff9d4d,
      p2: 0xff3d7f,
      hemi: 0xffc9a8,
      bloom: (b.bloom ?? 0.4) + 0.12,
      exposure: (b.exposure ?? 1.05) * 1.05
    }),
    ui: {
      "--bg": "#1a0a18", "--panel": "rgba(32, 12, 28, 0.8)",
      "--panel-2": "rgba(44, 16, 36, 0.93)", "--line": "rgba(255, 180, 140, 0.16)",
      "--mint": "#ff9d4d", "--mint-dim": "rgba(255, 157, 77, 0.16)",
      "--pink": "#ff3d7f", "--pink-dim": "rgba(255, 61, 127, 0.16)",
      "--gold": "#ffd166", "--ice": "#ffb38a",
      "--text": "#fff1e8", "--muted": "#b58a94"
    }
  },

  mono: {
    id: "mono",
    name: "Mono",
    desc: "Bianco e nero ad alto contrasto, massima leggibilita'.",
    swatch: [0xffffff, 0xbbbbbb, 0x777777],
    apply: (b) => ({
      ...b,
      bg: 0x000000,
      fog: 0x000000,
      table: mul(sat(b.table, 0), 0.75),
      line: 0xffffff,
      p1: 0xffffff,
      p2: 0xbdbdbd,
      hemi: 0xffffff,
      bloom: 0.2,
      exposure: 1.0
    }),
    ui: {
      "--bg": "#000000", "--panel": "rgba(12, 12, 12, 0.86)",
      "--panel-2": "rgba(20, 20, 20, 0.95)", "--line": "rgba(255, 255, 255, 0.18)",
      "--mint": "#ffffff", "--mint-dim": "rgba(255, 255, 255, 0.14)",
      "--pink": "#bdbdbd", "--pink-dim": "rgba(189, 189, 189, 0.14)",
      "--gold": "#ffffff", "--ice": "#e0e0e0",
      "--text": "#ffffff", "--muted": "#9a9a9a"
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
  const vars = themeById(themeId).ui;
  for (const v of UI_VARS) root.style.removeProperty(v);
  if (!vars) return;
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
}

/** Colori di anteprima per la schermata Opzioni. */
export function themeSwatch(themeId) {
  return themeById(themeId).swatch.map(hex);
}
