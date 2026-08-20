let ctx, master, sfxGain;

function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.72;
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(master);
}

function envGain(duration, peak = 0.3, attack = 0.008) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(peak, ctx.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  g.connect(sfxGain);
  return g;
}

function tone(freq, type, duration, peak) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = envGain(duration, peak);
  o.connect(g);
  o.start();
  o.stop(ctx.currentTime + duration + 0.05);
}

function noise(duration, peak, hp = 400) {
  if (!ctx) return;
  const n = ctx.createBufferSource();
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  n.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = envGain(duration, peak, 0.002);
  n.connect(f);
  f.connect(g);
  n.start();
}

export const audio = {
  init() { ensure(); },
  async resume() {
    ensure();
    if (ctx.state !== "running") await ctx.resume();
  },
  update() {},
  hit(intensityAmt = 0.5) {
    if (!ctx) return;
    noise(0.06, 0.12 * intensityAmt, 600);
    tone(180 + intensityAmt * 220, "triangle", 0.12, 0.16 * intensityAmt);
    tone(90, "sine", 0.1, 0.1 * intensityAmt);
  },
  wall() {
    tone(320, "square", 0.07, 0.06);
    noise(0.04, 0.05, 1200);
  },
  score(side) {
    const base = side === "right" || side === "east" ? 330 : side === "west" ? 440 : 392;
    tone(base, "sine", 0.25, 0.16);
    tone(base * 1.25, "triangle", 0.3, 0.1);
    tone(base * 1.5, "sine", 0.35, 0.08);
  },
  powerup() {
    tone(523, "sine", 0.12, 0.1);
    tone(784, "sine", 0.16, 0.08);
    tone(1046, "triangle", 0.2, 0.07);
  },
  ui() { tone(660, "sine", 0.06, 0.05); },
  confirm() {
    tone(440, "sine", 0.08, 0.07);
    tone(880, "sine", 0.12, 0.05);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, "triangle", 0.28, 0.12), i * 110));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, "sine", 0.3, 0.1), i * 140));
  },
  countdown() { tone(440, "square", 0.1, 0.08); },
  go() {
    tone(660, "square", 0.16, 0.1);
    tone(880, "sine", 0.2, 0.08);
  },
  whoosh() { noise(0.18, 0.08, 300); },
  pop() {
    noise(0.08, 0.12, 400);
    tone(700, "sine", 0.1, 0.08);
  }
};
