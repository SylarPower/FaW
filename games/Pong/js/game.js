import { Engine } from "./engine.js";
import { World, Ball, rand } from "./physics.js";
import { Particles, BallTrail } from "./particles.js";
import { audio } from "./audio.js";
import { input } from "./input.js";
import { updateAI, SKILL } from "./ai.js";
import { PowerUpManager, applyPower, POWER_DEFS } from "./powerups.js";
import { ARENAS, buildArena, updateArena, handleArenaEvent, nextBallColor, arenaById } from "./arenas.js";
import { makePaddle, makeBall } from "./models.js";
import { loadSave, writeSave, SIZE_MUL, SPEED_MUL } from "./save.js";
import { net } from "./net.js";
import { PCOL, PNAME, DUEL_SIDES, TRI_SIDES } from "./players.js";

function slotSide(triangle, slot) {
  return (triangle ? TRI_SIDES : DUEL_SIDES)[slot];
}

export class Game {
  constructor(canvas, ui) {
    this.ui = ui;
    this.engine = new Engine(canvas);
    this.particles = new Particles(this.engine.scene);
    this.world = new World();
    this.powers = new PowerUpManager(this.engine, this.world);
    this.save = loadSave();
    this.state = "title";
    this.vsCPU = true;
    this.online = false;
    this.triangle = false;
    this.localSide = "left";
    this.cpuSides = ["right"];
    this.arenaId = "classic";
    this.ctrl = null;
    this.scores = { left: 0, right: 0 };
    this.trails = [];
    this.msg = "";
    this.msgT = 0;
    this.cd = 0;
    this.serveDir = 1;
    this.rally = 0;
    this.flashEl = document.getElementById("flash");
    this.acc = 0;
    this.last = performance.now();
    this.demo = true;
    this._fxSeen = 0;
    this._bindLoop();
    this._bindNet();
    this.startDemo();
  }

  _bindLoop() {
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.engine.update(dt, this.liveBall());
      this.particles.update(dt);
      this.engine.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _bindNet() {
    net.onRoom = (room) => this.onNetRoom(room);
    net.onSnap = (snap) => this.onNetSnap(snap);
    net.onGone = () => {
      if (this.online) {
        this.online = false;
        this.ui.toast("Connessione persa.");
        this.forfeit();
        this.ui.showTitle();
      }
    };
  }

  isHost() {
    return !this.online || net.host;
  }

  liveBall() {
    return this.world.balls.find((b) => b.alive) || null;
  }

  persist() { writeSave(this.save); }

  startDemo() {
    this.demo = true;
    this.vsCPU = true;
    this.online = false;
    this.triangle = false;
    this.customTarget = null;
    this.loadArena(pickDemo(), { demo: true });
    this.state = "play";
    this.serve(1);
  }

  stopDemo() { this.demo = false; }

  loadArena(id, opts = {}) {
    this.arenaId = id;
    this.engine.clearArena();
    this.particles.clear();
    for (const t of this.trails) t.dispose();
    this.trails = [];
    this.world = new World();
    this.powers = new PowerUpManager(this.engine, this.world);
    const sizeMul = SIZE_MUL[this.save.options.paddleSize] || 1;
    this.ctrl = buildArena(id, this.engine, this.world, sizeMul);
    this.triangle = !!this.world.triangle;
    const def = arenaById(id);
    let pool = (def.powerUps || []).slice();
    if (this.save.options.extraPowers) {
      for (const extra of ["grab", "whack", "stretch", "turbo"]) {
        if (!pool.includes(extra)) pool.push(extra);
      }
    }
    this.powers.setPool(pool);
    this.powers.spawnEvery = 6.5;

    for (const p of this.world.paddles) {
      const col = PCOL[p.side] || 0xffffff;
      p.mesh = makePaddle(col, p.hw, p.hd, p.hh);
      this.engine.add(p.mesh);
      this.syncPaddleMesh(p);
    }

    if (this.triangle) this.scores = { bottom: 0, east: 0, west: 0 };
    else this.scores = { left: 0, right: 0 };
    this.rally = 0;
    this.speedMul = SPEED_MUL[this.save.options.ballSpeed] || 1;
  }

  syncPaddleMesh(p) {
    if (!p.mesh) return;
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.y = p.angle;
    p.mesh.userData.body.scale.set(p.hw * 2, p.hh * 2, p.hd * 2);
  }

  beginMatch(id, opts = {}) {
    this.stopDemo();
    this.vsCPU = !!opts.vsCPU;
    this.online = !!opts.online;
    this.customTarget = Number.parseInt(opts.target, 10) || null;
    this.triangle = !!opts.triangle || id === "triangle";
    if (this.triangle) id = "triangle";
    if (this.online) this.localSide = slotSide(this.triangle, net.slot);
    else this.localSide = opts.localSide || (this.triangle ? "bottom" : "left");
    this.cpuSides = this.computeCpuSides();
    this.loadArena(id);
    this.state = "countdown";
    this.cd = 3.2;
    this.serveDir = Math.random() < 0.5 ? 1 : -1;
    this.showMsg("3");
    audio.countdown();
    this.ui.showHUD(this);
  }

  computeCpuSides() {
    const sides = this.triangle ? TRI_SIDES : DUEL_SIDES;
    if (this.online) {
      const list = net.playersList();
      return sides.filter((s, i) => {
        const pl = list.find((p) => p.slot === i);
        return !pl || pl.cpu || !pl.in;
      });
    }
    if (this.vsCPU) return sides.filter((s) => s !== this.localSide);
    return [];
  }

  showMsg(t, dur = 0.8) {
    this.msg = t;
    this.msgT = dur;
    this.ui.setCenter(t);
  }

  serve(dir = this.serveDir) {
    for (const b of this.world.balls) {
      b.alive = false;
      if (b.mesh) {
        this.engine.arenaRoot.remove(b.mesh);
        b.mesh = null;
      }
    }
    this.world.balls = [];
    this.spawnBall({ dir, center: true });
  }

  spawnBall({ dir = 1, from = null, color, colorId } = {}) {
    const info = colorId ? { color, colorId } : nextBallColor(this.ctrl);
    const b = new Ball(0.22);
    b.minSpeed = 8 * this.speedMul;
    b.maxSpeed = 22 * this.speedMul;
    b.color = info.color;
    b.colorId = info.colorId;
    b.mesh = makeBall(b.color, b.r);
    this.engine.add(b.mesh);
    const trail = new BallTrail(this.engine.scene, b.color);
    b._trail = trail;
    this.trails.push(trail);
    if (from) {
      b.x = from.x; b.z = from.z; b.y = from.y;
      const a = rand(0, Math.PI * 2);
      const s = (10 + rand(0, 4)) * this.speedMul;
      b.vx = Math.cos(a) * s;
      b.vz = Math.sin(a) * s;
    } else if (this.triangle) {
      b.x = 0; b.z = 0; b.y = b.r;
      const a = rand(0, Math.PI * 2);
      const s = 9.5 * this.speedMul;
      b.vx = Math.cos(a) * s;
      b.vz = Math.sin(a) * s;
      b.ghost = 0.2;
    } else {
      b.serve(dir, 9.5 * this.speedMul);
    }
    this.world.addBall(b);
    this.syncBall(b);
    return b;
  }

  spawnExtraBall(from) {
    const b = this.spawnBall({ from, color: 0xfff4c8, colorId: from.colorId });
    audio.pop();
    this.particles.burst(from.x, 0.3, from.z, 0xffffff, 14, 4);
    this.showMsg("MULTI", 0.45);
    return b;
  }

  syncBall(b) {
    if (!b.mesh) return;
    b.mesh.position.set(b.x, b.y, b.z);
    b.mesh.rotation.x += b.vz * 0.02;
    b.mesh.rotation.z -= b.vx * 0.02;
    if (b.mesh.userData.light) b.mesh.userData.light.intensity = b.held ? 0.4 : 1.6;
    b.mesh.visible = b.alive;
  }

  update(dt) {
    input.update();
    audio.update(dt, this.rally / 12);

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.ui.setCenter("");
    }

    if (this.online && (this.state === "play" || this.state === "countdown" || this.state === "point")) {
      net.writeInput(input.snapshot());
    }

    if (this.state === "title" || this.demo) {
      this.tickPlay(dt, true);
      input.endFrame();
      return;
    }

    if (this.state === "pause") {
      if (input.pause && this.isHost()) this.resume();
      input.endFrame();
      return;
    }

    if (!this.isHost() && this.online) {
      this.syncVisuals(dt);
      if (input.pause) { /* guest cannot pause sim */ }
      input.endFrame();
      return;
    }

    if (this.state === "countdown") {
      this.cd -= dt;
      if (this.cd > 2 && this.msg !== "3") { this.showMsg("3"); audio.countdown(); }
      else if (this.cd <= 2 && this.cd > 1 && this.msg !== "2") { this.showMsg("2"); audio.countdown(); }
      else if (this.cd <= 1 && this.cd > 0.15 && this.msg !== "1") { this.showMsg("1"); audio.countdown(); }
      else if (this.cd <= 0) {
        this.state = "play";
        this.showMsg("VIA!", 0.5);
        audio.go();
        this.serve(this.serveDir);
      }
      this.drivePaddles(dt);
      this.syncVisuals(dt);
      this.publishSnap();
      input.endFrame();
      return;
    }

    if (this.state === "point") {
      this.cd -= dt;
      this.syncVisuals(dt);
      this.publishSnap();
      if (this.cd <= 0) {
        if (this.checkWin()) this.endMatch();
        else {
          this.state = "play";
          this.serve(this.serveDir);
        }
      }
      input.endFrame();
      return;
    }

    if (this.state === "play") {
      if (input.pause && this.isHost()) {
        this.pause();
        input.endFrame();
        return;
      }
      this.tickPlay(dt, false);
      this.publishSnap();
    }

    input.endFrame();
  }

  tickPlay(dt, isDemo) {
    this.drivePaddles(dt);
    this.handleGrabThrows();

    this.acc += dt;
    const STEP = 1 / 120;
    while (this.acc >= STEP) {
      this.world.step(STEP);
      this.acc -= STEP;
    }
    this.powers.update(dt);
    if (this.ctrl) updateArena(this.ctrl, this.world, dt, this.engine, this);

    const fx = [];
    for (const ev of this.world.events) {
      const cancel = handleArenaEvent(this.ctrl, ev, this, this.world, this.engine);
      if (cancel) continue;
      if (ev.type === "hit") {
        this.rally++;
        const spd = ev.ball.speed();
        audio.hit(Math.min(1, spd / 18));
        this.engine.kick(0.08 + spd * 0.006);
        this.particles.spark(ev.ball.x, 0.3, ev.ball.z, 1, PCOL[ev.paddle.side] || 0xffffff);
        if (ev.paddle.mesh) ev.paddle.mesh.scale.z = 1.12;
        fx.push("hit");
      }
      if (ev.type === "wall") { audio.wall(); fx.push("wall"); }
      if (ev.type === "score") {
        if (this.triangle) {
          const scorer = ev.ball.lastHit;
          if (scorer && scorer !== ev.side) this.scorePoint(scorer);
          else this.serveSoon();
        } else {
          const scorer = ev.side === "left" ? "right" : "left";
          this.scorePoint(scorer);
        }
        fx.push("score");
      }
      if (ev.type === "powerup") {
        audio.powerup();
        this.ui.updateHUD(this);
      }
      if (ev.type === "powerhit") {
        this.engine.kick(0.28);
        this.engine.flash(this.flashEl, "#fff4c2", 70);
        this.particles.burst(ev.ball.x, 0.4, ev.ball.z, 0xffc857, 24, 7);
      }
    }
    this._fx = fx;

    for (const b of this.world.balls) {
      if (!b.alive && b.mesh) {
        this.engine.arenaRoot.remove(b.mesh);
        b.mesh = null;
        if (b._trail) { b._trail.dispose(); this.trails = this.trails.filter((t) => t !== b._trail); }
      }
    }
    this.world.balls = this.world.balls.filter((b) => b.alive);

    if (this.state === "play" && !isDemo && this.world.balls.filter((b) => b.alive).length === 0) {
      if (this.ctrl?.id !== "puck") this.serveSoon();
      else this.spawnBall({ dir: this.serveDir });
    }

    this.syncVisuals(dt);
  }

  drivePaddles(dt) {
    const skill = SKILL[this.save.options.difficulty] || 0.68;
    const sides = this.triangle ? TRI_SIDES : DUEL_SIDES;

    for (const p of this.world.paddles) {
      p.inputAxis = 0;
      p.inputAxis2 = 0;
    }

    const applyInp = (side, inp) => {
      if (!inp) return;
      for (const p of this.world.paddles.filter((x) => x.side === side)) {
        if (p.role === "goalie") p.inputAxis = inp.axis2 || 0;
        else if (p.role === "striker") p.inputAxis = inp.axis || 0;
        else { p.inputAxis = inp.axis || 0; p.inputAxis2 = inp.axis2 || 0; }
      }
    };

    if (this.demo) {
      for (const s of sides) updateAI(this.world, s, 0.52, dt, {});
      return;
    }

    applyInp(this.localSide, input.snapshot());

    if (this.online && this.isHost()) {
      const list = this.triangle ? TRI_SIDES : DUEL_SIDES;
      list.forEach((side, i) => {
        if (side === this.localSide) return;
        if (this.cpuSides.includes(side)) {
          updateAI(this.world, side, skill, dt, { usePower: () => this.tryPower(side) });
        } else {
          applyInp(side, net.inputFor(i));
        }
      });
    } else if (!this.online) {
      for (const s of this.cpuSides) {
        updateAI(this.world, s, skill, dt, { usePower: () => this.tryPower(s) });
      }
    }

    if (input.switch) this.powers.cycle(this.localSide);
    if (input.power) this.tryPower(this.localSide);

    if (this.online && this.isHost()) {
      const list = this.triangle ? TRI_SIDES : DUEL_SIDES;
      list.forEach((side, i) => {
        if (side === this.localSide || this.cpuSides.includes(side)) return;
        const inp = net.inputFor(i);
        if (inp?.switch) this.powers.cycle(side);
        if (inp?.power) this.tryPower(side);
      });
    }
  }

  tryPower(side) {
    const id = this.powers.consume(side);
    if (!id) return;
    applyPower(id, side, { world: this.world, features: this.ctrl.features, engine: this.engine });
    audio.powerup();
    const def = POWER_DEFS[id];
    this.showMsg(def?.name || id, 0.6);
    this.ui.updateHUD(this);
  }

  handleGrabThrows() {
    const beach = this.ctrl?.id === "beach" || this.ctrl?.id === "puck";
    const heldOf = (side) => {
      if (side === this.localSide) return input.powerHeld;
      if (this.cpuSides.includes(side)) return false;
      if (this.online) {
        const i = (this.triangle ? TRI_SIDES : DUEL_SIDES).indexOf(side);
        return !!net.inputFor(i)?.powerHeld;
      }
      return false;
    };

    for (const p of this.world.paddles) {
      const held = heldOf(p.side);
      const can = p.grabT > 0 || beach;
      if (p.heldBall && !held && !this.cpuSides.includes(p.side)) this.throwBall(p);
      if (p.heldBall && this.cpuSides.includes(p.side)) {
        p._holdT = (p._holdT || 0) + 0.016;
        if (p._holdT > 0.45) { this.throwBall(p); p._holdT = 0; }
      }
      if (!can || p.heldBall) continue;
      const want = held || (this.cpuSides.includes(p.side) && p.grabT > 0);
      if (!want) continue;
      for (const b of this.world.balls) {
        if (!b.alive || b.held) continue;
        const dx = b.x - p.x, dz = b.z - p.z;
        if (Math.abs(dx) < p.hw + b.r + 0.55 && Math.abs(dz) < p.hd + b.r + 0.25) {
          b.held = true;
          b.holder = p;
          p.heldBall = b;
          audio.whoosh();
          break;
        }
      }
    }
  }

  throwBall(p) {
    const b = p.heldBall;
    if (!b) return;
    const c = Math.cos(p.angle), s = Math.sin(p.angle);
    const spd = (13 + Math.abs(p.vz) * 0.3) * this.speedMul * (p.powerHit > 0 ? 1.4 : 1);
    b.held = false;
    b.holder = null;
    b.vx = c * spd;
    b.vz = s * spd + rand(-1.2, 1.2);
    b.ghost = 0.08;
    p.heldBall = null;
    audio.hit(0.8);
  }

  scorePoint(scorer, opts = {}) {
    if (this.state !== "play" && !this.demo) return;
    if (this._scoreLock && performance.now() - this._scoreLock < 400) return;
    this._scoreLock = performance.now();
    if (this.scores[scorer] == null) this.scores[scorer] = 0;
    this.scores[scorer]++;
    this.rally = 0;
    this.serveDir = scorer === "left" || scorer === "bottom" || scorer === "west" ? 1 : -1;
    audio.score(scorer);
    this.engine.kick(0.32);
    const hex = "#" + (PCOL[scorer] || 0xffffff).toString(16).padStart(6, "0");
    this.engine.flash(this.flashEl, hex, 90);
    if (!this.demo) {
      this.ui.updateHUD(this);
      this.showMsg("PUNTO " + (PNAME[scorer] || scorer.toUpperCase()), 0.8);
    }
    if (opts.keepBall) {
      if (this.checkWin() && !this.demo) this.endMatch();
      return;
    }
    if (this.demo) {
      const vals = Object.values(this.scores);
      if (Math.max(...vals) >= 5) {
        this.scores = this.triangle ? { bottom: 0, east: 0, west: 0 } : { left: 0, right: 0 };
        this.loadArena(pickDemo(), { demo: true });
      }
      this.serve(this.serveDir);
      return;
    }
    this.state = "point";
    this.cd = 1.15;
  }

  serveSoon() {
    if (this.state !== "play") return;
    this.state = "point";
    this.cd = 0.8;
  }

  checkWin() {
    const need = this.customTarget || this.ctrl.def.scoreToWin;
    const vals = Object.values(this.scores);
    const max = Math.max(...vals);
    if (max < need) return false;
    const sorted = vals.slice().sort((a, b) => b - a);
    const lead = sorted[0] - (sorted[1] || 0);
    if (this.vsCPU && !this.triangle && lead < 2 && max < need + 6) return false;
    return max >= need;
  }

  winnerSide() {
    let best = null, n = -1;
    for (const [k, v] of Object.entries(this.scores)) {
      if (v > n) { n = v; best = k; }
    }
    return best;
  }

  endMatch() {
    this.state = "over";
    const win = this.winnerSide();
    const iWon = win === this.localSide;
    if (iWon) {
      audio.win();
      this.unlockNext();
      if (!this.save.cleared.includes(this.arenaId)) this.save.cleared.push(this.arenaId);
      this.persist();
    } else audio.lose();
    this.publishSnap();
    this.ui.showResult(this, iWon, win);
  }

  unlockNext() {
    const ids = ARENAS.filter((a) => !a.triangle).map((a) => a.id);
    const i = ids.indexOf(this.arenaId);
    const nxt = ids[i + 1];
    if (nxt && !this.save.unlocked.includes(nxt)) this.save.unlocked.push(nxt);
  }

  pause() {
    if (this.state !== "play") return;
    this.state = "pause";
    this.ui.showPause(this);
  }
  resume() {
    this.state = "play";
    this.ui.hidePause();
  }

  async forfeit() {
    this.state = "over";
    if (this.online) await net.leave();
    this.online = false;
    this.ui.showMenu();
    this.startDemo();
  }

  rematch() {
    if (this.online && !this.isHost()) return;
    this.beginMatch(this.arenaId, {
      vsCPU: this.vsCPU,
      online: this.online,
      triangle: this.triangle,
      localSide: this.localSide
    });
    if (this.online && this.isHost()) net.start(this.arenaId);
  }

  publishSnap() {
    if (!this.online || !this.isHost()) return;
    net.writeSnap({
      st: this.state,
      sc: this.scores,
      cd: this.cd,
      msg: this.msg,
      arena: this.arenaId,
      fx: this._fx || [],
      p: this.world.paddles.map((p) => ({
        s: p.side, x: p.x, z: p.z, hd: p.hd, a: p.angle, o: p.offset || 0
      })),
      b: this.world.balls.filter((b) => b.alive).map((b) => ({
        x: b.x, z: b.z, vx: b.vx, vz: b.vz, c: b.color, h: b.held ? 1 : 0
      }))
    });
  }

  onNetRoom(room) {
    if (!this.online) return;
    if (room?.meta?.status === "play" && (this.demo || this.state === "title")) {
      const id = room.meta.arenaId || "classic";
      const settings = room.meta.settings || {};
      this.ui.applyPortalSettings?.(settings);
      this.beginMatch(id, {
        online: true,
        triangle: room.meta.mode === "tri",
        vsCPU: false,
        target: settings.target
      });
    }
    if (room?.meta?.status === "dead") {
      this.ui.toast("L'host ha lasciato.");
      this.forfeit();
      this.ui.showTitle();
    }
    this.ui.onNetRoom?.(room);
  }

  onNetSnap(snap) {
    if (!this.online || this.isHost() || !snap) return;
    if (this.state === "title" || this.demo) return;
    if (snap.st === "over" && this.state !== "over") {
      this.scores = snap.sc || this.scores;
      this.endMatch();
      return;
    }
    this.scores = snap.sc || this.scores;
    if (snap.st && snap.st !== this.state && snap.st !== "pause") {
      if (snap.st === "play" && this.state === "countdown") audio.go();
      this.state = snap.st;
    }
    if (snap.msg && snap.msg !== this.msg) this.showMsg(snap.msg, 0.6);
    if (snap.p) {
      for (const pd of snap.p) {
        const p = this.world.paddles.find((x) => x.side === pd.s);
        if (!p) continue;
        p.x = pd.x; p.z = pd.z; p.hd = pd.hd; p.angle = pd.a; p.offset = pd.o;
      }
    }
    if (snap.b) {
      while (this.world.balls.length < snap.b.length) this.spawnBall({});
      while (this.world.balls.length > snap.b.length) {
        const b = this.world.balls.pop();
        if (b.mesh) this.engine.arenaRoot.remove(b.mesh);
      }
      snap.b.forEach((sb, i) => {
        const b = this.world.balls[i];
        if (!b) return;
        b.x = sb.x; b.z = sb.z; b.vx = sb.vx; b.vz = sb.vz; b.alive = true; b.held = !!sb.h;
      });
    }
    if (snap.fx?.includes("hit")) audio.hit(0.6);
    if (snap.fx?.includes("wall")) audio.wall();
    if (snap.fx?.includes("score")) {
      audio.score("left");
      this.ui.updateHUD(this);
    }
  }

  syncVisuals(dt) {
    for (const p of this.world.paddles) {
      if (p.mesh) {
        p.mesh.scale.z += (1 - p.mesh.scale.z) * Math.min(1, dt * 10);
        p.mesh.scale.x += (1 - p.mesh.scale.x) * Math.min(1, dt * 10);
        this.syncPaddleMesh(p);
        if (p.barrierT > 0) p.mesh.userData.mat.emissiveIntensity = 0.8;
        else p.mesh.userData.mat.emissiveIntensity = 0.22;
      }
    }
    for (const b of this.world.balls) {
      this.syncBall(b);
      b._trail?.update(dt, b);
    }
  }
}

function pickDemo() {
  const pool = ["classic", "soccer", "penguin", "tilt", "logs"];
  return pool[(Math.random() * pool.length) | 0];
}
