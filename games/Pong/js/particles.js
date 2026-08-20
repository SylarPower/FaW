const PongParticles = (() => {
  let bits = [];

  function burst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 220;
      bits.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.45 + Math.random() * 0.35,
        color,
        r: 1.5 + Math.random() * 2.5
      });
    }
  }

  function update(dt) {
    bits = bits.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      return p.life > 0;
    });
  }

  function draw(ctx) {
    bits.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function clear() { bits = []; }

  return { burst, update, draw, clear };
})();
