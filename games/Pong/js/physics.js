const PongPhysics = (() => {
  function stepBall(ball, arena, dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y - ball.r <= 0) {
      ball.y = ball.r;
      ball.vy *= -1;
      PongAudio.wall();
      PongParticles.burst(ball.x, ball.y, '#ffffff', 8);
    } else if (ball.y + ball.r >= arena.h) {
      ball.y = arena.h - ball.r;
      ball.vy *= -1;
      PongAudio.wall();
      PongParticles.burst(ball.x, ball.y, '#ffffff', 8);
    }
  }

  function collidePaddle(ball, paddle) {
    const nx = PongModels.clamp(ball.x, paddle.x, paddle.x + paddle.w);
    const ny = PongModels.clamp(ball.y, paddle.y, paddle.y + paddle.h);
    const dx = ball.x - nx;
    const dy = ball.y - ny;
    if (dx * dx + dy * dy > ball.r * ball.r) return false;

    const rel = ((ball.y - (paddle.y + paddle.h / 2)) / (paddle.h / 2));
    const angle = rel * 0.7;
    const dir = paddle.side === 'left' ? 1 : -1;
    const speed = Math.min(780, Math.hypot(ball.vx, ball.vy) * 1.05 + 12);
    ball.vx = Math.cos(angle) * speed * dir;
    ball.vy = Math.sin(angle) * speed;
    ball.x = paddle.side === 'left' ? paddle.x + paddle.w + ball.r + 0.5 : paddle.x - ball.r - 0.5;
    PongAudio.hit();
    PongParticles.burst(ball.x, ball.y, paddle.color, 12);
    return true;
  }

  function launch(ball, dir = Math.random() < 0.5 ? -1 : 1) {
    const angle = (Math.random() * 0.6 - 0.3);
    ball.vx = Math.cos(angle) * ball.speed * dir;
    ball.vy = Math.sin(angle) * ball.speed;
  }

  return { stepBall, collidePaddle, launch };
})();
