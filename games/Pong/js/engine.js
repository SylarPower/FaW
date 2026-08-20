const PongEngine = (() => {
  let canvas, ctx, arena, running = false, last = 0, raf = 0;

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    PongInput.bind(canvas);
    return { canvas, arena };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    arena = { w: window.innerWidth, h: window.innerHeight };
  }

  function drawWorld(state) {
    const theme = PongArenas[state.arenaId] || PongArenas.neon;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, arena.w, arena.h);

    ctx.strokeStyle = theme.line;
    ctx.setLineDash([10, 14]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(arena.w / 2, 12);
    ctx.lineTo(arena.w / 2, arena.h - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = theme.line;
    ctx.strokeRect(10, 10, arena.w - 20, arena.h - 20);

    PongParticles.draw(ctx);
    PongPowerups.draw(ctx);

    const { ball, paddles } = state;
    drawPaddle(paddles.left);
    drawPaddle(paddles.right);

    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = ball.glow;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPaddle(p) {
    ctx.save();
    ctx.shadowBlur = 16;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.restore();
  }

  function start(tick) {
    running = true;
    last = performance.now();
    const loop = now => {
      if (!running) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      tick(dt, arena, ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function getArena() { return arena; }

  return { init, start, stop, drawWorld, getArena, resize };
})();
