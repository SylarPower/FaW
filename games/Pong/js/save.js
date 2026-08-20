const KEY = "pong-nl-save-v1";

const DEFAULT = {
  unlocked: ["classic"],
  cleared: [],
  nick: "",
  options: {
    paddleSize: "default",
    ballSpeed: "default",
    extraPowers: false,
    difficulty: "medio",
    theme: "neon"
  }
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const data = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT),
      ...data,
      options: { ...DEFAULT.options, ...(data.options || {}) },
      unlocked: Array.from(new Set(["classic", ...(data.unlocked || [])])),
      cleared: data.cleared || []
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
