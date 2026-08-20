const KEY = "pong-nl-save-v2";

const DEFAULT = {
  unlocked: ["classic"],
  cleared: [],
  nick: "",
  options: {
    paddleSize: "default",
    ballSpeed: "default",
    difficulty: "medio",
    theme: "neon"
  },
  stats: {
    partite: 0,
    vinte: 0,
    puntiFatti: 0,
    puntiSubiti: 0,
    colpi: 0,
    rallyMax: 0,
    velMax: 0,
    curve: 0,
    schianti: 0
  }
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const data = JSON.parse(raw);
    const legacyTheme = data.options?.theme;
    const theme =
      legacyTheme === "retro" ? "airhockey" :
      legacyTheme === "sunset" ? "baseball" :
      legacyTheme === "tennis" ? "neon" : // tema rimosso
      legacyTheme === "mono" ? "colori" : // "Inchiostro" ora è "Colori"
      legacyTheme;
    return {
      ...structuredClone(DEFAULT),
      ...data,
      options: { ...DEFAULT.options, ...(data.options || {}), ...(theme ? { theme } : {}) },
      unlocked: Array.from(new Set(["classic", ...(data.unlocked || [])])),
      cleared: data.cleared || [],
      stats: { ...structuredClone(DEFAULT.stats), ...(data.stats || {}) }
    };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function writeSave(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export const SIZE_MUL = { small: 0.72, default: 1, medium: 1.28, large: 1.55 };
export const SPEED_MUL = { slow: 0.72, default: 1, fast: 1.38 };
