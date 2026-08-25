import { predictZ, clamp, rand } from "./physics.js";
const TIERS = [
  { s: 0.30, blend: 0.35, err: 2.0, speedCap: 0.55, aimInterval: 0.25 },  // facile
  { s: 0.50, blend: 0.22, err: 1.4, speedCap: 0.72, aimInterval: 0.14 },  // medio
  { s: 0.70, blend: 0.15, err: 1.0, speedCap: 0.85, aimInterval: 0.08 },  // difficile
  { s: 0.85, blend: 0.12, err: 1.1, speedCap: 0.93, aimInterval: 0.05 }   // leggenda
];
function tune(skill) {
  let best = TIERS[0];
  for (const t of TIERS) if (Math.abs(t.s - skill) < Math.abs(best.s - skill)) best = t;
  return best;
}
export function updateAI(world, side, skill, dt, extra = {}) {
  const pads = world.paddles.filter((p) => p.side === side);
  if (!pads.length) return;
  const incoming = world.balls.filter((b) => b.alive && !b.held);
  if (world.triangle) {
    driveTri(pads[0], incoming, skill, dt);
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
  drivePaddle(main, threats[0]?.b, world, skill, dt);
  if (goalie) {
    const gBall = threats.find((t) => t.eta < 1.6)?.b || threats[0]?.b;
    drivePaddle(goalie, gBall, world, skill * 0.9, dt);
  }
  if (extra.usePower && Math.random() < dt * (0.15 + skill * 0.4)) extra.usePower();
}
function driveTri(p, balls, skill, dt) {
  const t = tune(skill);
  if (!p.edge || !balls.length) { p.inputAxis = 0; return; }
  const e = p.edge;
  let best = null, bestThreat = -1;
  for (const b of balls) {
    const vxn = b.vx * e.nx + b.vz * e.nz;
    const approaching = vxn < -0.4;
    const along = (b.x - (e.mx - e.tx * e.len / 2)) * e.tx + (b.z - (e.mz - e.tz * e.len / 2)) * e.tz;
    const threat = (approaching ? 4 : 0.4) / (0.4 + Math.hypot(b.x - p.x, b.z - p.z));
    if (threat > bestThreat) { bestThreat = threat; best = along - e.len / 2; }
  }
  if (best == null) { p.inputAxis = 0; return; }
  const st = (p._ai ??= { clock: 0, aim: null, bias: 0, ball: null });
  if (st.ball !== balls[0]) { st.ball = balls[0]; st.bias = rand(-1, 1) * t.err; }
  st.clock -= dt;
  if (st.clock <= 0 || st.aim == null) { st.clock = t.aimInterval; st.aim = best * (1 - t.blend) + st.bias; }
  const error = (1 - skill) * 1.6;
  const wob = Math.sin(performance.now() * 0.004 + p.x) * error * 0.4;
  const diff = (st.aim + wob) - p.offset;
  const dead = 0.14 + (1 - skill) * 0.3;
  let axis = 0;
  if (diff > dead) axis = 1; else if (diff < -dead) axis = -1;
  p.inputAxis = axis * clamp(Math.abs(diff) / 0.8, 0.35, 1) * t.speedCap;
}
function drivePaddle(p, ball, world, skill, dt) {
  if (!ball) { p.inputAxis = 0; return; }
  const t = tune(skill);
  const st = (p._ai ??= { clock: 0, aim: null, bias: 0, ball: null });
  st.clock -= dt;
  if (st.ball !== ball) { st.ball = ball; st.bias = rand(-1, 1) * t.err; }
  const zBound = world.circle ? world.radius - 0.5 : world.d / 2 - 0.2;
  if (st.clock <= 0 || st.aim == null) {
    st.clock = t.aimInterval;
    const pred = predictZ(ball, p.x, world.gravityX, world.gravityZ, world.windX, world.windZ, zBound);
    st.aim = pred * (1 - t.blend) + st.bias;
  }
  const error = (1 - skill) * 1.9;
  const wob = Math.sin(performance.now() * 0.004 + p.x) * error * 0.4;
  const diff = (st.aim + wob) - p.z;
  const dead = 0.14 + (1 - skill) * 0.3;
  let axis = 0;
  if (diff > dead) axis = 1; else if (diff < -dead) axis = -1;
  axis *= clamp(Math.abs(diff) / (0.6 + (1 - skill)), 0.3, 1);
  p.inputAxis = axis * t.speedCap;
}
export const SKILL = { facile: 0.30, medio: 0.50, difficile: 0.70, leggenda: 0.85 };
