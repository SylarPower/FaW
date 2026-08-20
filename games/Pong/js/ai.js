import { predictZ, clamp, rand } from "./physics.js";

export function updateAI(world, side, skill, dt, extra = {}) {
  const pads = world.paddles.filter((p) => p.side === side);
  if (!pads.length) return;

  const incoming = world.balls.filter((b) => b.alive && !b.held);

  if (world.triangle) {
    const p = pads[0];
    driveTri(p, incoming, skill);
    if (extra.usePower && Math.random() < dt * (0.12 + skill * 0.35)) extra.usePower();
    return;
  }

  const dir = side === "left" || side === "west" ? -1 : 1;
  const threats = incoming
    .map((b) => {
      const coming = Math.sign(b.vx || 0.001) === dir || Math.abs(b.x) * dir > 0;
      const eta = coming ? Math.abs((pads[0].x - b.x) / (b.vx || 0.001)) : 99;
      return { b, eta, coming };
    })
    .sort((a, b) => a.eta - b.eta);

  const main = pads.find((p) => p.role === "main" || p.role === "striker") || pads[0];
  const goalie = pads.find((p) => p.role === "goalie") || (pads[1] || null);

  drivePaddle(main, threats[0]?.b, world, skill, extra);
  if (goalie) {
    const gBall = threats.find((t) => t.eta < 1.6)?.b || threats[0]?.b;
    drivePaddle(goalie, gBall, world, skill * 0.9, extra);
  }

  if (extra.usePower && Math.random() < dt * (0.15 + skill * 0.4)) extra.usePower();
}

function driveTri(p, balls, skill) {
  if (!p.edge || !balls.length) {
    p.inputAxis = 0;
    return;
  }
  const e = p.edge;
  let best = null, bestThreat = -1;
  for (const b of balls) {
    const vxn = b.vx * e.nx + b.vz * e.nz;
    const approaching = vxn < -0.4;
    const along = (b.x - (e.mx - e.tx * e.len / 2)) * e.tx + (b.z - (e.mz - e.tz * e.len / 2)) * e.tz;
    const threat = (approaching ? 4 : 0.4) / (0.4 + Math.hypot(b.x - p.x, b.z - p.z));
    if (threat > bestThreat) {
      bestThreat = threat;
      best = along - e.len / 2;
    }
  }
  if (best == null) { p.inputAxis = 0; return; }
  const error = (1 - skill) * 1.6;
  best += Math.sin(performance.now() * 0.004 + p.x) * error * 0.4;
  const diff = best - p.offset;
  const dead = 0.14 + (1 - skill) * 0.3;
  let axis = 0;
  if (diff > dead) axis = 1;
  else if (diff < -dead) axis = -1;
  p.inputAxis = axis * clamp(Math.abs(diff) / 0.8, 0.35, 1);
}

function drivePaddle(p, ball, world, skill) {
  if (!ball) {
    p.inputAxis = 0;
    return;
  }
  const error = (1 - skill) * 1.8;
  const zBound = world.circle ? world.radius - 0.5 : world.d / 2 - 0.2;
  let target = predictZ(ball, p.x, world.gravityX, world.gravityZ, world.windX, world.windZ, zBound);
  target += Math.sin(performance.now() * 0.004 + p.x) * error * 0.35;
  if (Math.random() < (1 - skill) * 0.02) target += rand(-error, error);
  const diff = target - p.z;
  const dead = 0.12 + (1 - skill) * 0.25;
  let axis = 0;
  if (diff > dead) axis = 1;
  else if (diff < -dead) axis = -1;
  axis *= clamp(Math.abs(diff) / (0.6 + (1 - skill)), 0.35, 1);
  p.inputAxis = axis;
}

export const SKILL = {
  facile: 0.42,
  medio: 0.68,
  difficile: 0.88,
  leggenda: 0.97
};
