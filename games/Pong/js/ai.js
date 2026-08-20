const PongAI = (() => {
  const difficulties = {
    easy: { track: 0.42, error: 48, max: 280 },
    normal: { track: 0.62, error: 22, max: 380 },
    hard: { track: 0.86, error: 8, max: 520 }
  };

  function move(paddle, ball, arena, dt, level = 'normal') {
    const cfg = difficulties[level] || difficulties.normal;
    const target = ball.vx > 0
      ? ball.y + Math.sin(performance.now() / 240) * cfg.error
      : arena.h / 2;
    const center = paddle.y + paddle.h / 2;
    const dy = target - center;
    const step = cfg.max * dt;
    paddle.y = PongModels.clamp(paddle.y + PongModels.clamp(dy * cfg.track, -step, step), 8, arena.h - paddle.h - 8);
  }

  return { move };
})();
