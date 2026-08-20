import { makePowerToken } from "./models.js";
import * as THREE from "three";

export const POWER_DEFS = {
  grab: { id: "grab", name: "Presa", desc: "Trattieni e lancia la palla", color: 0x3dffd1, hold: true },
  whack: { id: "whack", name: "Schianto", desc: "I prossimi 3 colpi sono devastanti", color: 0xffc857 },
  stretch: { id: "stretch", name: "Allunga", desc: "Racchetta extra-larga", color: 0x8ee7ff },
  turbo: { id: "turbo", name: "Turbo", desc: "Scatto di velocità", color: 0xff7a3d },
  spike: { id: "spike", name: "Spine", desc: "Alza le spine difensive", color: 0xff5a5a },
  invert: { id: "invert", name: "Caos", desc: "Inverte i comandi avversari", color: 0xc77dff },
  barrier: { id: "barrier", name: "Barriera", desc: "Muro temporaneo in porta", color: 0x9be7ff },
  fan: { id: "fan", name: "Ventilatore", desc: "Soffia il disco via da te", color: 0x7ad7ff },
  tilt: { id: "tilt", name: "Inclinazione", desc: "Inclina il tavolo", color: 0xffb347 },
  hill: { id: "hill", name: "Collina", desc: "Crea un dosso al centro", color: 0x86c06c },
  dip: { id: "dip", name: "Conca", desc: "Crea una conca al centro", color: 0x5aa9e6 },
  spinlog: { id: "spinlog", name: "Rotazione", desc: "Fa girare i tronchi", color: 0xd27d2c },
  bear: { id: "bear", name: "Orso Polare", desc: "Alza il tuo bordo: la palla non passa", color: 0xf2f0ea },
  seal: { id: "seal", name: "Foca", desc: "Una foca ti aiuta a parare", color: 0x8aa0b2 },
  skull: { id: "skull", name: "Teschio", desc: "Effetto ostile sull'avversario", color: 0xff3d7f }
};

export class PowerUpManager {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.tokens = [];
    this.inventory = emptyInv();
    this.selected = emptySel();
    this.spawnT = 0;
    this.enabled = [];
    this.spawnEvery = 7;
  }

  setPool(ids) {
    this.enabled = ids.slice();
    this.inventory = emptyInv();
    this.selected = emptySel();
    this.clearTokens();
  }

  clearTokens() {
    for (const t of this.tokens) this.engine.arenaRoot.remove(t.mesh);
    this.tokens = [];
  }

  update(dt) {
    if (this.enabled.length) {
      this.spawnT += dt;
      if (this.spawnT > this.spawnEvery && this.tokens.length < 2) {
        this.spawnT = 0;
        this.spawn();
      }
    }
    for (const t of this.tokens) {
      t.mesh.rotation.z += dt * 2;
      t.mesh.position.y = 0.42 + Math.sin(performance.now() * 0.004 + t.mesh.position.x) * 0.08;
    }
    for (const b of this.world.balls) {
      if (!b.alive || b.held) continue;
      for (let i = this.tokens.length - 1; i >= 0; i--) {
        const t = this.tokens[i];
        const dx = b.x - t.x, dz = b.z - t.z;
        if (dx * dx + dz * dz < 0.55 * 0.55) {
          const side = b.lastHit || (b.vx > 0 ? "left" : "right");
          this.give(side, t.id);
          this.engine.arenaRoot.remove(t.mesh);
          this.tokens.splice(i, 1);
          this.world.emit("powerup", { side, id: t.id });
        }
      }
    }
  }

  spawn() {
    if (!this.enabled.length) return;
    const id = this.enabled[(Math.random() * this.enabled.length) | 0];
    const def = POWER_DEFS[id];
    const x = (Math.random() - 0.5) * this.world.w * 0.45;
    const z = (Math.random() - 0.5) * this.world.d * 0.55;
    const mesh = makePowerToken(def.color);
    mesh.position.set(x, 0.42, z);
    this.engine.add(mesh);
    this.tokens.push({ id, x, z, mesh });
  }

  give(side, id) {
    const list = this.inventory[side];
    if (list.length >= 3) list.shift();
    list.push(id);
    this.selected[side] = list.length - 1;
  }

  current(side) {
    const list = this.inventory[side];
    return list[this.selected[side]] || null;
  }

  cycle(side) {
    const list = this.inventory[side];
    if (list.length < 2) return;
    this.selected[side] = (this.selected[side] + 1) % list.length;
  }

  consume(side) {
    const list = this.inventory[side];
    if (!list.length) return null;
    const i = this.selected[side] % list.length;
    const id = list.splice(i, 1)[0];
    this.selected[side] = Math.min(i, Math.max(0, list.length - 1));
    return id;
  }
}

function emptyInv() {
  return { left: [], right: [], bottom: [], east: [], west: [] };
}
function emptySel() {
  return { left: 0, right: 0, bottom: 0, east: 0, west: 0 };
}

export function applyPower(id, side, ctx) {
  const other = side === "left" || side === "west" ? "right" : side === "bottom" ? "east" : "left";
  const pads = ctx.world.paddles.filter((p) => p.side === side);
  const opps = ctx.world.paddles.filter((p) => p.side === other);
  switch (id) {
    case "grab":
      for (const p of pads) p.grabT = 8;
      break;
    case "whack":
      for (const p of pads) p.powerHit = 3;
      break;
    case "stretch":
      for (const p of pads) p.stretchT = 8;
      break;
    case "turbo":
      for (const p of pads) p.turboT = 6;
      break;
    case "invert":
      for (const p of opps) p.invert = 5;
      break;
    case "barrier":
      for (const p of pads) p.barrierT = 6;
      ctx.features?.raiseBarrier?.(side, 6);
      break;
    case "spike":
      ctx.features?.raiseSpikes?.(side);
      break;
    case "fan":
      ctx.features?.blowFan?.(side);
      break;
    case "tilt":
      ctx.features?.tilt?.(side);
      break;
    case "hill":
      ctx.features?.makeHill?.();
      break;
    case "dip":
      ctx.features?.makeDip?.();
      break;
    case "spinlog":
      ctx.features?.spinLogs?.(side);
      break;
    case "bear":
      ctx.features?.polarBear?.(side);
      break;
    case "seal":
      ctx.features?.spawnSeal?.(side);
      break;
    case "skull":
      ctx.features?.skull?.(side);
      for (const p of opps) p.burn = 5;
      break;
    default:
      break;
  }
}
