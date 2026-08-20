const PongInput = (() => {
  const keys = new Set();
  let pointerY = { left: null, right: null };

  function sideFromX(x, w) {
    return x < w / 2 ? 'left' : 'right';
  }

  function bind(canvas) {
    window.addEventListener('keydown', e => {
      keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    const point = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const x = (clientX - r.left) * (canvas.width / r.width);
      const y = (clientY - r.top) * (canvas.height / r.height);
      pointerY[sideFromX(x, canvas.width)] = y;
    };

    canvas.addEventListener('mousemove', e => point(e.clientX, e.clientY));
    canvas.addEventListener('touchstart', e => {
      [...e.changedTouches].forEach(t => point(t.clientX, t.clientY));
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      [...e.changedTouches].forEach(t => point(t.clientX, t.clientY));
    }, { passive: false });
  }

  function apply(paddles, arena, dt, control) {
    const move = (p, dir) => {
      p.y = PongModels.clamp(p.y + dir * p.speed * dt, 8, arena.h - p.h - 8);
    };

    if (control.left === 'human') {
      if (keys.has('w') || keys.has('arrowup') && control.right !== 'human') move(paddles.left, -1);
      if (keys.has('s') || keys.has('arrowdown') && control.right !== 'human') move(paddles.left, 1);
      if (pointerY.left != null) {
        paddles.left.y = PongModels.clamp(pointerY.left - paddles.left.h / 2, 8, arena.h - paddles.left.h - 8);
      }
    }
    if (control.right === 'human') {
      if (keys.has('arrowup')) move(paddles.right, -1);
      if (keys.has('arrowdown')) move(paddles.right, 1);
      if (pointerY.right != null) {
        paddles.right.y = PongModels.clamp(pointerY.right - paddles.right.h / 2, 8, arena.h - paddles.right.h - 8);
      }
    }
  }

  function wantsPause() {
    return keys.has('escape') || keys.has('p');
  }

  return { bind, apply, wantsPause };
})();
