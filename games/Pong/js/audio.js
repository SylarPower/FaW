const PongAudio = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function beep(freq, dur, type = 'square', gain = 0.05) {
    if (!enabled) return;
    try {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain * (PongSave.load().volume ?? 0.7);
      o.connect(g);
      g.connect(c.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.stop(c.currentTime + dur);
    } catch {}
  }

  return {
    setEnabled(v) { enabled = v; },
    hit() { beep(420, 0.06); },
    wall() { beep(220, 0.05, 'triangle'); },
    score() { beep(180, 0.18, 'sawtooth', 0.07); beep(320, 0.12); },
    power() { beep(660, 0.12, 'sine', 0.06); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'sine', 0.07), i * 120)); }
  };
})();
