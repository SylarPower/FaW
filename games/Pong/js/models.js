const PongModels = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function ball(arena) {
    return {
      x: arena.w / 2,
      y: arena.h / 2,
      r: 8,
      vx: 0,
      vy: 0,
      speed: 420,
      glow: '#ffffff'
    };
  }

  function paddle(side, arena) {
    const w = 14;
    const h = 92;
    return {
      side,
      x: side === 'left' ? 28 : arena.w - 28 - w,
      y: arena.h / 2 - h / 2,
      w,
      h,
      vy: 0,
      speed: 560,
      color: side === 'left' ? '#00ffc8' : '#ff2bd6'
    };
  }

  return { clamp, ball, paddle };
})();
