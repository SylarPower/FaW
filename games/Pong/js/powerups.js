const PongPowerups = (() => {
  const TYPES = [
    { id: 'grow', label: 'PADDLE+', color: '#00ffc8' },
    { id: 'shrink', label: 'PADDLE-', color: '#ff2bd6' },
    { id: 'slow', label: 'SLOW', color: '#7ad0ff' },
    { id: 'fast', label: 'FAST', color: '#ffd166' }
  ];

  let items = [];
  let timer = 0;

  function reset() {
    items = [];
    timer = 2.5;
  }

  function spawn(arena) {
    const t = TYPES[Math.floor(Math.random() * TYPES.length)];
    items.push({
      ...t,
      x: arena.w * (0.35 + Math.random() * 0.3),
      y: 40 + Math.random() * (arena.h - 80),
      r: 12,
      life: 8
    });
  }

  function update(dt, arena, ball, paddles, enabled) {
    if (!enabled) return;
    timer -= dt;
    if (timer <= 0 && items.length < 2) {
      spawn(arena);
      timer = 6 + Math.random() * 4;
    }
    items = items.filter(it => {
      it.life -= dt;
      const dx = ball.x - it.x;
      const dy = ball.y - it.y;
      if (dx * dx + dy * dy < (ball.r + it.r) * (ball.r + it.r)) {
        apply(it, ball, paddles, ball.vx >= 0 ? paddles.right : paddles.left);
        PongAudio.power();
        return false;
      }
      return it.life > 0;
    });
  }

  function apply(it, ball, paddles, lastHitter) {
    if (it.id === 'grow') lastHitter.h = Math.min(160, lastHitter.h + 28);
    if (it.id === 'shrink') {
      const other = lastHitter === paddles.left ? paddles.right : paddles.left;
      other.h = Math.max(48, other.h - 24);
    }
    if (it.id === 'slow') {
      ball.vx *= 0.72;
      ball.vy *= 0.72;
    }
    if (it.id === 'fast') {
      ball.vx *= 1.28;
      ball.vy *= 1.28;
    }
    PongParticles.burst(it.x, it.y, it.color, 18);
  }

  function draw(ctx) {
    items.forEach(it => {
      ctx.save();
      ctx.shadowBlur = 16;
      ctx.shadowColor = it.color;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#041016';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(it.label[0], it.x, it.y + 0.5);
      ctx.restore();
    });
  }

  return { reset, update, draw };
})();
