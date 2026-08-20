import { makePowerToken, POWER_PICKUP_RADIUS } from "./models.js";

export const POWER_DEFS = {
  grab: { id: "grab", glyph: "✋", name: "Presa", desc: "Permette di trattenere e lanciare la palla", color: 0x3dffd1, hold: true },
  whack: { id: "whack", glyph: "✸", name: "Schianto", desc: "3 colpi potenziati: ognuno più veloce del precedente", color: 0xffc857, charges: 3 },
  stretch: { id: "stretch", glyph: "↔", name: "Allunga", desc: "Allunga ancora la racchetta; gli effetti si sommano", color: 0x8ee7ff },
  turbo: { id: "turbo", glyph: "≫", name: "Turbo", desc: "Aumenta temporaneamente la velocità di movimento", color: 0xff7a3d },
  spike: { id: "spike", glyph: "▲", name: "Spine", desc: "Alza le spine difensive", color: 0xff5a5a },
  invert: { id: "invert", glyph: "⇄", name: "Caos", desc: "Inverte temporaneamente i comandi avversari", color: 0xc77dff },
  barrier: { id: "barrier", glyph: "▤", name: "Barriera", desc: "Crea un muro temporaneo in porta", color: 0x9be7ff },
  fan: { id: "fan", glyph: "✺", name: "Ventilatore", desc: "Soffia il disco via da te", color: 0x7ad7ff },
  tilt: { id: "tilt", glyph: "◣", name: "Inclinazione", desc: "Inclina il tavolo", color: 0xffb347 },
  hill: { id: "hill", glyph: "⌒", name: "Collina", desc: "Crea o rafforza il dosso al centro", color: 0x86c06c },
  dip: { id: "dip", glyph: "⌄", name: "Conca", desc: "Crea o rafforza la conca al centro", color: 0x5aa9e6 },
  spinlog: { id: "spinlog", glyph: "↻", name: "Rotazione", desc: "Fa girare i tronchi", color: 0xd27d2c },
  bear: { id: "bear", glyph: "❆", name: "Orso Polare", desc: "Alza il tuo bordo: la palla non passa", color: 0xf2f0ea },
  seal: { id: "seal", glyph: "◕", name: "Foca", desc: "Una foca ti aiuta a parare", color: 0x8aa0b2 },
  skull: { id: "skull", glyph: "☠", name: "Teschio", desc: "Effetto ostile sull'avversario", color: 0xff3d7f }
};

/**
 * I gettoni non finiscono più in una borsa: la raccolta è l'attivazione.
 * `onPickup` viene chiamato subito, nello stesso frame del contatto con la palla.
 */
export class PowerUpManager {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.tokens = [];
    this.spawnT = 0;
    this.enabled = [];
    this.spawnEvery = 7;
    this.onPickup = null;
  }

  setPool(ids) {
    this.enabled = ids.slice();
    this.clearTokens();
    this.spawnT = 0;
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
      // Il token fluttua, mentre l'anello resta sul tavolo e rende esplicita la
      // vera zona di raccolta.
      if (t.mesh.userData.disc) t.mesh.userData.disc.rotation.y += dt * 2;
      const wave = Math.sin(performance.now() * 0.004 + t.mesh.position.x);
      if (t.mesh.userData.floaters) t.mesh.userData.floaters.position.y = 0.42 + wave * 0.08;
      if (t.mesh.userData.pickupRim) {
        const pulse = 1 + wave * 0.035;
        t.mesh.userData.pickupRim.scale.setScalar(pulse);
        t.mesh.userData.pickupRim.material.opacity = 0.72 + wave * 0.12;
      }
    }
    for (const b of this.world.balls) {
      if (!b.alive || b.held) continue;
      for (let i = this.tokens.length - 1; i >= 0; i--) {
        const t = this.tokens[i];
        const dx = b.x - t.x, dz = b.z - t.z;
        if (dx * dx + dz * dz < POWER_PICKUP_RADIUS * POWER_PICKUP_RADIUS) {
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
    const mesh = makePowerToken(def.color, def.glyph || "?");
    mesh.position.set(x, 0.012, z);
    this.engine.add(mesh);
    this.tokens.push({ id, x, z, mesh });
  }

  give(side, id) {
    // Non c'è più una selezione da cambiare: il potere parte ora.
    this.onPickup?.(side, id);
  }
}

export function applyPower(id, side, ctx) {
  const other = side === "left" || side === "west" ? "right" : side === "bottom" ? "east" : "left";
  const pads = ctx.world.paddles.filter((p) => p.side === side);
  const opps = ctx.world.paddles.filter((p) => p.side === other);
  const addTime = (p, key, seconds) => { p[key] = (p[key] || 0) + seconds; };

  switch (id) {
    case "grab":
      for (const p of pads) addTime(p, "grabT", 8);
      break;
    case "whack":
      // Ogni raccolta aggiunge tre rimbalzi, condivisi tra tutte le racchette.
      // Una nuova raccolta fa ripartire la catena dal primo colpo.
      for (const p of pads) {
        p.powerHit = (p.powerHit || 0) + 3;
        p.whackStep = 0;
      }
      break;
    case "stretch":
      // Un timer per ogni raccolta: quando si raccolgono più Allunga insieme,
      // la racchetta cresce di più invece di sostituire il potere precedente.
      for (const p of pads) {
        if (!p.stretchTimers) p.stretchTimers = [];
        p.stretchTimers.push(10);
        p.stretchStacks = p.stretchTimers.length;
      }
      break;
    case "turbo":
      for (const p of pads) addTime(p, "turboT", 6);
      break;
    case "invert":
      for (const p of opps) addTime(p, "invert", 5);
      break;
    case "barrier":
      for (const p of pads) addTime(p, "barrierT", 6);
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
      for (const p of opps) addTime(p, "burn", 5);
      break;
    default:
      break;
  }
}

// Lasciate esportate per eventuali integrazioni esterne, ma senza più stato di
// inventario: servono solo a descrivere i lati della partita.
export function sidesForPowerState() {
  return ["left", "right", "bottom", "east", "west"];
}
