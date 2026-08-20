export function makeTri(S = 18) {
  const H = S * Math.sqrt(3) / 2;
  const verts = [
    { x: -S / 2, z: H / 3 },
    { x: S / 2, z: H / 3 },
    { x: 0, z: -2 * H / 3 }
  ];
  const specs = [
    { a: 0, b: 1, side: "bottom" },
    { a: 1, b: 2, side: "east" },
    { a: 2, b: 0, side: "west" }
  ];
  const edges = specs.map((e) => {
    const A = verts[e.a], B = verts[e.b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const tx = dx / len, tz = dz / len;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    let nx = -tz, nz = tx;
    if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; }
    return { ...e, tx, tz, nx, nz, len, mx, mz };
  });
  return { verts, edges, S, H };
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function rand(a, b) {
  return a + Math.random() * (b - a);
}
export function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

export class Ball {
  constructor(r = 0.22) {
    this.x = 0; this.y = 0.22; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.r = r;
    this.minSpeed = 8;
    this.maxSpeed = 22;
    this.alive = true;
    this.held = false;
    this.holder = null;
    this.color = 0xffffff;
    this.colorId = null;
    this.spin = 0;
    this.lastHit = null;
    this.age = 0;
    this.ghost = 0;
    this.mesh = null;
    this.light = null;
    this.trail = [];
  }
  speed() {
    return Math.hypot(this.vx, this.vz);
  }
  setSpeed(s) {
    const cur = this.speed() || 1;
    this.vx *= s / cur;
    this.vz *= s / cur;
  }
  serve(dirX, speed) {
    this.x = 0; this.z = rand(-1.2, 1.2); this.y = this.r;
    const ang = rand(-0.42, 0.42);
    this.vx = Math.cos(ang) * speed * dirX;
    this.vz = Math.sin(ang) * speed;
    this.held = false;
    this.holder = null;
    this.alive = true;
    this.ghost = 0.15;
  }
}

export class Paddle {
  constructor(side, opts = {}) {
    this.side = side;
    this.role = opts.role || "main";
    this.x = opts.x ?? (side === "left" ? -9.4 : 9.4);
    this.z = opts.z ?? 0;
    this.y = 0.28;
    this.hw = opts.hw ?? 0.22;
    this.hd = opts.hd ?? 1.15;
    this.hh = opts.hh ?? 0.28;
    this.baseHd = this.hd;
    this.vz = 0;
    this.vx = 0;
    this.maxSpeed = opts.maxSpeed ?? 14;
    this.accel = 90;
    this.ice = 0;
    this.canMoveX = !!opts.canMoveX;
    this.xMin = opts.xMin ?? this.x - 1.4;
    this.xMax = opts.xMax ?? this.x + 1.4;
    this.zMin = -999;
    this.zMax = 999;
    this.holding = false;
    this.heldBall = null;
    this.stretchT = 0;
    this.stretchStacks = 0;
    this.stretchTimers = [];
    this.powerHit = 0;
    this.stun = 0;
    this.burn = 0;
    this.invert = 0;
    this.grabT = 0;
    this.barrierT = 0;
    this.turboT = 0;
    this.mesh = null;
    this.inputAxis = 0;
    this.inputAxis2 = 0;
    this.locked = false;
    this.angle = opts.angle ?? (side === "right" || side === "east" ? Math.PI : 0);
    this.edge = opts.edge || null;
    this.offset = 0;
    this.inset = opts.inset ?? 0.55;
  }
}

export class World {
  constructor() {
    this.w = 20;
    this.d = 12;
    this.balls = [];
    this.paddles = [];
    this.obstacles = [];
    this.holes = [];
    this.goals = [];
    this.gravityX = 0;
    this.gravityZ = 0;
    this.windX = 0;
    this.windZ = 0;
    this.drag = 0;
    this.icePaddles = 0;
    this.openEnds = true;
    this.circle = false;
    this.triangle = false;
    this.tri = null;
    this.radius = 8;
    this.events = [];
    this.tiltX = 0;
    this.tiltZ = 0;
  }

  resetEvents() {
    this.events = [];
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  addBall(ball) {
    this.balls.push(ball);
    return ball;
  }

  /**
   * Avanza la simulazione di `dt`.
   *
   * NB: gli eventi NON vengono azzerati qui. Il game loop esegue piu' sotto-step
   * per frame (acc/STEP in game.js) e legge world.events una volta sola a fine
   * frame: azzerando a ogni step si perdevano punti, rimbalzi e power-up
   * avvenuti nei sotto-step precedenti. Ora e' il chiamante a fare resetEvents()
   * una volta per frame, prima della serie di step.
   */
  step(dt) {
    for (const p of this.paddles) this.stepPaddle(p, dt);
    for (const b of this.balls) {
      if (!b.alive) continue;
      this.stepBall(b, dt);
    }
    this.balls = this.balls.filter((b) => b.alive || b.mesh);
  }

  stepPaddle(p, dt) {
    if (p.stun > 0) p.stun -= dt;
    if (p.burn > 0) p.burn -= dt;
    if (p.invert > 0) p.invert -= dt;
    // Ogni Allunga ha il suo timer: più raccolte nello stesso momento
    // producono una racchetta progressivamente più lunga.
    if (p.stretchTimers?.length) {
      p.stretchTimers = p.stretchTimers.map((t) => t - dt).filter((t) => t > 0);
      p.stretchStacks = p.stretchTimers.length;
      p.stretchT = Math.max(...p.stretchTimers, 0);
    } else {
      p.stretchStacks = 0;
      p.stretchT = 0;
    }
    const stretchFactor = Math.min(4.2, 1 + (p.stretchStacks || 0) * 0.7);
    const targetHd = p.baseHd * stretchFactor;
    p.hd = lerp(p.hd, targetHd, 1 - Math.pow(0.001, dt));
    if (p.turboT > 0) p.turboT -= dt;
    if (p.grabT > 0) p.grabT -= dt;
    if (p.barrierT > 0) p.barrierT -= dt;
    if (p.powerHit > 0) { /* charges, not time */ }

    if (p.locked || p.stun > 0) {
      p.vz *= Math.pow(0.02, dt);
      return;
    }

    let axis = p.inputAxis;
    if (p.invert > 0) axis *= -1;
    const max = p.maxSpeed * (p.turboT > 0 ? 1.45 : 1) * (p.burn > 0 ? 0.55 : 1);
    const target = axis * max;
    const slip = this.icePaddles;
    if (slip > 0) {
      p.vz += (target - p.vz) * Math.min(1, dt * (2.2 - slip));
    } else {
      p.vz = target;
    }

    if (p.edge) {
      p.offset += axis * max * dt;
      const maxOff = p.edge.len / 2 - p.hd - 0.45;
      p.offset = clamp(p.offset, -maxOff, maxOff);
      p.x = p.edge.mx + p.edge.tx * p.offset + p.edge.nx * p.inset;
      p.z = p.edge.mz + p.edge.tz * p.offset + p.edge.nz * p.inset;
      p.angle = Math.atan2(p.edge.nz, p.edge.nx);
    } else {
      p.z += p.vz * dt;
      const limit = this.circle ? this.radius - p.hd - 0.4 : this.d / 2 - p.hd - 0.08;
      const z0 = Math.max(p.zMin, -limit);
      const z1 = Math.min(p.zMax, limit);
      p.z = clamp(p.z, z0, z1);

      if (p.canMoveX) {
        p.x += p.inputAxis2 * max * 0.7 * dt;
        p.x = clamp(p.x, p.xMin, p.xMax);
      }
    }

    if (p.heldBall) {
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      p.heldBall.x = p.x + c * (p.hw + p.heldBall.r + 0.15);
      p.heldBall.z = p.z + s * (p.hw + p.heldBall.r + 0.15);
      p.heldBall.vx = 0;
      p.heldBall.vz = 0;
      p.heldBall.held = true;
    }
  }

  stepBall(b, dt) {
    b.age += dt;
    if (b.ghost > 0) b.ghost -= dt;
    if (b.held) return;

    b.vx += (this.gravityX + this.windX) * dt;
    b.vz += (this.gravityZ + this.windZ) * dt;
    if (this.drag > 0) {
      const d = Math.pow(1 - this.drag, dt * 60);
      b.vx *= d;
      b.vz *= d;
    }

    const spd = b.speed();
    if (spd > b.maxSpeed) b.setSpeed(b.maxSpeed);
    if (spd < 3 && spd > 0 && !this.drag) b.setSpeed(Math.max(b.minSpeed * 0.7, spd));

    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.spin += b.vz * dt * 3;
    b.y = b.r + Math.abs(Math.sin(b.age * 18) * 0.01);

    if (this.triangle) this.collideTriangle(b);
    else if (this.circle) this.collideCircle(b);
    else this.collideRect(b);

    for (const p of this.paddles) {
      if (this.collideBallPaddle(b, p)) {
        this.emit("hit", { ball: b, paddle: p });
      }
    }

    for (const o of this.obstacles) {
      if (!o.alive && o.alive !== undefined) continue;
      if (o.type === "circle" || o.type === "penguin" || o.type === "bumper" || o.type === "balloon" || o.type === "puck") {
        if (this.collideBallCircle(b, o)) this.emit("obstacle", { ball: b, obs: o });
      } else if (o.type === "box" || o.type === "log" || o.type === "hill" || o.type === "wall") {
        if (this.collideBallBox(b, o)) this.emit("obstacle", { ball: b, obs: o });
      }
    }

    for (const h of this.holes) {
      const dx = b.x - h.x, dz = b.z - h.z;
      if (dx * dx + dz * dz < (h.r - b.r * 0.2) ** 2) {
        this.emit("hole", { ball: b, hole: h });
      }
    }
  }

  collideRect(b) {
    const hz = this.d / 2 - b.r;
    if (b.z > hz) { b.z = hz; b.vz = -Math.abs(b.vz); this.emit("wall", { ball: b }); }
    if (b.z < -hz) { b.z = -hz; b.vz = Math.abs(b.vz); this.emit("wall", { ball: b }); }

    const hx = this.w / 2 - b.r;
    if (b.x > hx) this.handleEnd(b, "right");
    if (b.x < -hx) this.handleEnd(b, "left");
  }

  /**
   * Tavolo a triangolo (1v1v1).
   *
   * Ogni lato di `world.tri.edges` ha una normale (nx, nz) rivolta verso il
   * centro del tavolo (garantito da makeTri). La distanza con segno dal lato e'
   * quindi: dot(pos - mid, n); positiva dentro, negativa fuori.
   *
   * Nel triangolo ogni lato e' una porta: se la palla lo oltrepassa emettiamo
   * "score" con `side` = lato attraversato, come fa collideCircle con le porte.
   * Sara' game.js a decidere chi segna (chi ha toccato per ultimo,
   * `ball.lastHit`) e ad annullare l'autogol.
   *
   * Un lato rimbalza SOLO se non ha racchette (caso anomalo: senza rimbalzo la
   * palla scapperebbe all'infinito da un lato scoperto). Con le tre racchette
   * standard i lati restano quindi sempre "aperti" e il punto e' possibile.
   */
  collideTriangle(b) {
    const tri = this.tri;
    if (!tri) { this.collideRect(b); return; }

    for (const e of tri.edges) {
      // Distanza con segno dal lato: positiva verso l'interno del tavolo.
      const dist = (b.x - e.mx) * e.nx + (b.z - e.mz) * e.nz;

      const guarded = this.paddles.some((p) => p.side === e.side);
      if (guarded) {
        // Lato-porta: punto quando la palla e' uscita del tutto.
        if (dist < -b.r) {
          this.emit("score", { ball: b, side: e.side, edge: e });
          b.alive = false;
          return;
        }
        continue;
      }

      // Lato scoperto: muro pieno, la palla rimbalza dentro.
      if (dist < b.r) {
        b.x += e.nx * (b.r - dist);
        b.z += e.nz * (b.r - dist);
        const vn = b.vx * e.nx + b.vz * e.nz;
        if (vn < 0) {
          b.vx -= 2 * vn * e.nx;
          b.vz -= 2 * vn * e.nz;
        }
        this.emit("wall", { ball: b, edge: e });
      }
    }
  }

  collideCircle(b) {
    const dist = Math.hypot(b.x, b.z);
    const max = this.radius - b.r;
    if (dist > max) {
      const nx = b.x / dist, nz = b.z / dist;
      const scored = this.goals.length
        ? this.goals.some((g) => this.inGoalAngle(b, g))
        : false;
      if (scored) {
        const g = this.goals.find((gg) => this.inGoalAngle(b, gg));
        this.emit("score", { ball: b, side: g.side, goal: g });
        b.alive = false;
        return;
      }
      b.x = nx * max;
      b.z = nz * max;
      const vn = b.vx * nx + b.vz * nz;
      if (vn > 0) {
        b.vx -= 2 * vn * nx;
        b.vz -= 2 * vn * nz;
      }
      this.emit("wall", { ball: b });
    }
  }

  inGoalAngle(b, g) {
    const ang = Math.atan2(b.z, b.x);
    return Math.abs(wrapAngle(ang - g.angle)) < g.half;
  }

  handleEnd(b, side) {
    const goal = this.findGoal(side, b.z);
    if (goal && goal.accept(b)) {
      this.emit("score", { ball: b, side, goal });
      b.alive = false;
      return;
    }
    if (this.openEnds && this.goals.filter((g) => g.side === side).length === 0) {
      this.emit("score", { ball: b, side, goal: null });
      b.alive = false;
      return;
    }
    const hx = this.w / 2 - b.r;
    if (side === "right") { b.x = hx; b.vx = -Math.abs(b.vx); }
    else { b.x = -hx; b.vx = Math.abs(b.vx); }
    this.emit("wall", { ball: b, end: true });
  }

  findGoal(side, z) {
    const gs = this.goals.filter((g) => g.side === side);
    if (!gs.length) return this.openEnds ? { accept: () => true, open: true } : null;
    return gs.find((g) => z >= g.zMin && z <= g.zMax) || null;
  }

  collideBallPaddle(b, p) {
    if (b.ghost > 0) return false;

    // La palla ha gia' superato il piano di gioco della racchetta? Allora e'
    // un punto in arrivo: non deve piu' essere colpita, altrimenti il rimbalzo
    // forzato qui sotto la rispedisce in campo e il punto non viene assegnato.
    // (Solo per le racchette "dritte": quelle su un lato del triangolo hanno
    // una normale propria e usano il controllo generico.)
    if (!p.edge) {
      if (p.side === "left" && b.x < p.x - p.hw) return false;
      if (p.side === "right" && b.x > p.x + p.hw) return false;
    }

    const closestX = clamp(b.x, p.x - p.hw, p.x + p.hw);
    const closestZ = clamp(b.z, p.z - p.hd, p.z + p.hd);
    const dx = b.x - closestX;
    const dz = b.z - closestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 > b.r * b.r) return false;
    const dist = Math.sqrt(d2) || 0.0001;
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = b.r - dist + 0.01;
    b.x += nx * overlap;
    b.z += nz * overlap;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= 2.05 * vn * nx;
      b.vz -= 2.05 * vn * nz;
    }
    const rel = clamp((b.z - p.z) / p.hd, -1, 1);
    b.vz += rel * 6.5 + p.vz * 0.35;
    // Spinta minima verso il campo avversario, così la palla non resta
    // "incollata" alla racchetta. Applicata solo se la palla è davanti alla
    // racchetta (per le racchette dritte il controllo sopra lo garantisce già).
    if (!p.edge) {
      if (p.side === "left" && b.vx < 1.5) b.vx = Math.abs(b.vx) + 1.2;
      if (p.side === "right" && b.vx > -1.5) b.vx = -Math.abs(b.vx) - 1.2;
    }

    let spd = b.speed();
    let boost = 1.035;
    if (p.powerHit > 0) {
      boost = 1.55;
      // Schianto ha tre cariche per giocatore, non tre per ogni eventuale
      // racchetta dell'arena: sincronizziamo il contatore su tutte le sue barre.
      const charges = p.powerHit - 1;
      for (const mate of this.paddles) {
        if (mate.side === p.side) mate.powerHit = charges;
      }
      this.emit("powerhit", { ball: b, paddle: p, charges });
    }
    spd = clamp(spd * boost, b.minSpeed, b.maxSpeed);
    b.setSpeed(spd);
    b.lastHit = p.side;
    b.ghost = 0.04;
    return true;
  }

  collideBallCircle(b, o) {
    const dx = b.x - o.x;
    const dz = b.z - o.z;
    const rr = b.r + (o.r || 0.4);
    const d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || d2 === 0) return false;
    const dist = Math.sqrt(d2);
    const nx = dx / dist, nz = dz / dist;
    const overlap = rr - dist;
    b.x += nx * overlap;
    b.z += nz * overlap;
    const relVx = b.vx - (o.vx || 0);
    const relVz = b.vz - (o.vz || 0);
    const vn = relVx * nx + relVz * nz;
    if (vn < 0) {
      const rest = o.restitution ?? 1.15;
      b.vx -= (1 + rest) * vn * nx;
      b.vz -= (1 + rest) * vn * nz;
    }
    if (o.omega) {
      b.vx += -nz * o.omega * 0.4;
      b.vz += nx * o.omega * 0.4;
    }
    return true;
  }

  collideBallBox(b, o) {
    const hw = o.hw, hd = o.hd;
    const closestX = clamp(b.x, o.x - hw, o.x + hw);
    const closestZ = clamp(b.z, o.z - hd, o.z + hd);
    const dx = b.x - closestX;
    const dz = b.z - closestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 > b.r * b.r) return false;
    const dist = Math.sqrt(d2) || 0.0001;
    const nx = dx / dist, nz = dz / dist;
    b.x += nx * (b.r - dist + 0.01);
    b.z += nz * (b.r - dist + 0.01);
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= 2 * vn * nx;
      b.vz -= 2 * vn * nz;
    }
    if (o.omega) {
      b.vx += -nz * o.omega * 0.8;
      b.vz += nx * o.omega * 0.8;
    }
    return true;
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function predictZ(ball, targetX, gravityX = 0, gravityZ = 0, windX = 0, windZ = 0, zBound = 6) {
  let x = ball.x, z = ball.z, vx = ball.vx, vz = ball.vz;
  if (Math.abs(vx) < 0.2) return z;
  const dir = Math.sign(targetX - x);
  if (Math.sign(vx) !== dir && dir !== 0) return z;
  for (let i = 0; i < 90; i++) {
    const dt = 0.02;
    vx += (gravityX + windX) * dt;
    vz += (gravityZ + windZ) * dt;
    x += vx * dt;
    z += vz * dt;
    if (z > zBound) { z = zBound; vz = -Math.abs(vz); }
    if (z < -zBound) { z = -zBound; vz = Math.abs(vz); }
    if ((dir >= 0 && x >= targetX) || (dir <= 0 && x <= targetX)) return z;
  }
  return z;
}
