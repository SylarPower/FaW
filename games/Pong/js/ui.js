import { ARENAS, arenaById } from "./arenas.js";
import { audio } from "./audio.js";
import { POWER_DEFS } from "./powerups.js";
import { net, isFirebaseConfigured, codeFromSeed } from "./net.js";
import { PNAME, TRI_SIDES, DUEL_SIDES } from "./players.js";
import { THEME_IDS, themeById, applyThemeToUI } from "./themes.js";

export class UI {
  constructor(root) {
    this.root = root;
    this.game = null;
    this.screen = "load";
    this.vsCPU = true;
    this.online = false;
    this.triangle = false;
  }

  bind(game) {
    this.game = game;
    this.onNetRoom = (room) => {
      if (this.screen === "lobby" && room) this.renderLobby(room);
    };
  }

  el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  clear() { this.root.innerHTML = ""; }
  show(node) { this.clear(); this.root.appendChild(node); }

  showLoad() {
    this.screen = "load";
    this.show(this.el(`
      <div class="screen">
        <div class="brand">
          <div class="kicker">Edizione interna</div>
          <h1>PONG<span>NEXT LEVEL</span></h1>
        </div>
        <div class="load">Calibrazione tavolo</div>
        <div class="bar"><i id="loadbar"></i></div>
      </div>`));
  }

  setLoad(p) {
    const b = document.getElementById("loadbar");
    if (b) b.style.width = `${Math.floor(p * 100)}%`;
  }



  async fetchPortalSettings(matchId) {
    try {
      await net.init();
      const { getFirestore, doc, getDoc } = await import("firebase/firestore");
      const db = getFirestore(net.app);
      const snap = await getDoc(doc(db, "partite", matchId));
      if (!snap.exists()) return {};
      const opzioni = snap.data()?.opzioni || {};
      return this.normalizePortalSettings(opzioni);
    } catch (e) {
      console.warn("Impossibile leggere opzioni Pong dal portale", e);
      return {};
    }
  }

  normalizePortalSettings(opzioni = {}) {
    const arenaMap = {
      neon: "classic",
      dusk: "beach",
      ice: "penguin",
      arcade: "walled"
    };
    const arenaId = arenaById(opzioni.arena) ? opzioni.arena : (arenaMap[opzioni.arena] || "classic");
    const target = Number.parseInt(opzioni.target, 10) || null;
    const mode = opzioni.mode || "classic";
    return {
      arenaId,
      target,
      mode,
      options: {
        extraPowers: mode === "power",
        ballSpeed: mode === "hardcore" ? "fast" : "default",
        paddleSize: mode === "hardcore" ? "small" : "default"
      }
    };
  }

  applyPortalSettings(settings = {}) {
    if (!settings.options) return;
    Object.assign(this.game.save.options, settings.options);
    this.game.persist();
  }

  async openPortalMatch(matchId) {
    const code = codeFromSeed(matchId);
    const nick = (localStorage.getItem("mioNome") || this.game.save.nick || "Ospite").slice(0, 16);
    this.game.save.nick = nick;
    this.game.persist();
    this.screen = "portal";
    this.show(this.el(`
      <div class="screen">
        <div class="panel brief">
          <h2 class="section">Sfida Pong</h2>
          <p class="sub">Connessione alla stanza online condivisa con i colleghi…</p>
          <div class="room-code">${code}</div>
          <p class="sub" id="portalErr"></p>
        </div>
      </div>`));

    if (!isFirebaseConfigured()) {
      this.root.querySelector("#portalErr").textContent = "Firebase non configurato per Pong.";
      return;
    }

    try {
      const portalSettings = await this.fetchPortalSettings(matchId);
      const snap = await net.fb.get(net.roomRef(code));
      if (snap.exists()) {
        await net.join(code, nick);
      } else {
        await net.create({
          mode: "duel",
          arenaId: portalSettings.arenaId || "classic",
          seats: 2,
          nick,
          codeHint: code,
          settings: portalSettings
        });
      }
      const settings = net.room?.meta?.settings || portalSettings;
      this.applyPortalSettings(settings);
      this.game.online = true;
      this.triangle = false;
      this._pendingArena = settings.arenaId || "classic";
      this.showLobby();
    } catch (e) {
      try {
        await net.join(code, nick);
        const settings = net.room?.meta?.settings || {};
        this.applyPortalSettings(settings);
        this.game.online = true;
        this.triangle = false;
        this._pendingArena = settings.arenaId || "classic";
        this.showLobby();
      } catch (joinErr) {
        this.root.querySelector("#portalErr").textContent = joinErr.message || e.message || "Errore nella sfida online";
      }
    }
  }


  showTitle() {
    this.screen = "title";
    this.show(this.el(`
      <div class="screen">
        <div class="brand">
          <div class="kicker">Due PC · Un tavolo</div>
          <h1>PONG<span>NEXT LEVEL</span></h1>
          <p>Vs CPU, 1v1 online, triangolo 1v1v1. Solo tastiera.</p>
        </div>
        <div class="menu">
          <button class="btn" data-act="play">Gioca</button>
          <button class="btn ghost" data-act="opt">Opzioni</button>
          <button class="btn ghost" data-act="ctrl">Comandi</button>
          <button class="btn ghost" data-act="pwr">Poteri</button>
          <button class="btn ghost" data-act="cred">Crediti</button>
        </div>
      </div>`));
    this.hook();
  }

  showMain() {
    this.screen = "versus";
    const fb = isFirebaseConfigured();
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <h2 class="section">Chi gioca</h2>
        <p class="sub">Un PC, un giocatore. L'avversario è la CPU oppure un altro computer.</p>
        <div class="menu">
          <button class="btn" data-act="cpu">1 vs Computer</button>
          <button class="btn pink" data-act="pvp">${fb ? "1 vs Giocatore · online" : "1 vs Giocatore · configura Firebase"}</button>
          <!-- Triangolo 1v1v1 temporaneamente nascosto: la resa a schermo non e'
               all'altezza del 1v1 e va riprogettata. Il codice resta al suo posto
               (arena "triangle", collideTriangle, TRI_SIDES) e per riattivarlo
               basta rimettere qui i due bottoni tri-cpu / tri-on. -->
        </div>
      </div>`));
    this.hook();
  }

  campaignArenas() {
    return ARENAS.filter((a) => !a.triangle);
  }

  showZones(vsCPU) {
    this.screen = "zones";
    this.vsCPU = vsCPU;
    this.online = !vsCPU && !this.triangle;
    const save = this.game.save;
    const zones = [];
    for (const a of this.campaignArenas()) {
      let z = zones.find((x) => x.name === a.zone);
      if (!z) { z = { name: a.zone, items: [] }; zones.push(z); }
      z.items.push(a);
    }
    const cards = zones.map((z) => `
      <div class="zone-block">
        <h3>Zona — ${z.name}</h3>
        <div class="cards">
          ${z.items.map((a) => {
            const lock = vsCPU && !save.unlocked.includes(a.id);
            const cleared = save.cleared.includes(a.id);
            return `
              <button class="card ${lock ? "locked" : ""} ${cleared ? "cleared" : ""}" data-arena="${a.id}" ${lock ? "disabled" : ""}>
                <div class="tag">${a.tag}</div>
                <h4>${a.name}</h4>
                <p>${a.desc}</p>
                ${lock ? `<span class="lock">BLOCCATA</span>` : ""}
              </button>`;
          }).join("")}
        </div>
      </div>`).join("");

    // Nell'online si puo' costruire un'arena su misura (regole + power-up).
    const customBlock = vsCPU ? "" : `
      <div class="zone-block">
        <h3>Su misura</h3>
        <div class="cards">
          <button class="card card-custom" data-act="custom">
            <div class="tag">Personalizzata</div>
            <h4>Arena su misura</h4>
            <p>Scegli tavolo, punteggio, velocità, racchette e quali power-up entrano in campo.</p>
          </button>
        </div>
      </div>`;

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="play">← Indietro</button>
        <div class="panel">
          <h2 class="section">${vsCPU ? "Campagna" : "Scontro online"}</h2>
          <p class="sub">${vsCPU ? "Vinci con 2 punti di scarto per sbloccare la successiva." : "Scegli l'arena. Poi crei una stanza e mandi il codice al collega."}</p>
          <div class="zones">${customBlock}${cards}</div>
        </div>
      </div>`));
    this.hook();
    this.root.querySelectorAll("[data-arena]").forEach((btn) => {
      btn.addEventListener("click", () => {
        audio.confirm();
        this.showBrief(btn.dataset.arena, vsCPU);
      });
    });
  }

  /**
   * Arena personalizzata (solo online): l'host sceglie tavolo di base, regole e
   * quali power-up entrano in campo. Le scelte finiscono in `settings.custom`
   * dentro la stanza Firebase, quindi valgono anche per chi si unisce.
   */
  showCustom() {
    this.screen = "custom";
    const c = this._custom || (this._custom = {
      base: "classic",
      target: 10,
      ballSpeed: "default",
      paddleSize: "default",
      powers: ["whack", "stretch", "turbo", "grab"]
    });

    const bases = this.campaignArenas().filter((a) => !a.triangle);
    const baseOpts = bases.map((a) =>
      `<button data-cst="base" data-val="${a.id}" class="${c.base === a.id ? "on" : ""}">${a.name}</button>`).join("");
    const seg = (key, vals) => vals.map((v) =>
      `<button data-cst="${key}" data-val="${v.id}" class="${String(c[key]) === String(v.id) ? "on" : ""}">${v.label}</button>`).join("");

    const powerCards = Object.keys(POWER_DEFS).map((id) => {
      const p = POWER_DEFS[id];
      const on = c.powers.includes(id);
      const hex = "#" + p.color.toString(16).padStart(6, "0");
      return `
        <button class="pw-pick ${on ? "on" : ""}" data-power="${id}">
          <span class="pw-dot" style="background:${hex};box-shadow:0 0 10px ${hex}"></span>
          <span class="pw-pick-name">${p.name}</span>
          <span class="pw-pick-desc">${p.desc}</span>
        </button>`;
    }).join("");

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="zones">← Arene</button>
        <div class="panel">
          <h2 class="section">Arena su misura</h2>
          <p class="sub">Configura la partita, poi crea la stanza e manda il codice al collega.</p>

          <div class="opt">
            <div><label>Tavolo di base</label><span class="hint">Ostacoli e forma del campo</span></div>
            <div class="seg th-seg">${baseOpts}</div>
          </div>
          <div class="opt">
            <div><label>Punti per vincere</label></div>
            <div class="seg">${seg("target", [
              { id: 5, label: "5" }, { id: 7, label: "7" }, { id: 10, label: "10" }, { id: 15, label: "15" }
            ])}</div>
          </div>
          <div class="opt">
            <div><label>Velocità palla</label></div>
            <div class="seg">${seg("ballSpeed", [
              { id: "slow", label: "Lenta" }, { id: "default", label: "Media" }, { id: "fast", label: "Veloce" }
            ])}</div>
          </div>
          <div class="opt">
            <div><label>Dimensione racchetta</label></div>
            <div class="seg">${seg("paddleSize", [
              { id: "small", label: "Piccola" }, { id: "default", label: "Media" },
              { id: "medium", label: "Grande" }, { id: "large", label: "Maxi" }
            ])}</div>
          </div>

          <div style="margin-top:18px">
            <label style="font-weight:600">Power-up in campo</label>
            <span class="hint" style="display:block;margin:3px 0 10px">Tocca per attivarli o spegnerli. Nessuno selezionato = partita pulita.</span>
            <div class="pw-picks">${powerCards}</div>
          </div>

          <div class="row" style="margin-top:20px">
            <button class="btn" id="cstGo">Crea stanza</button>
            <button class="btn small ghost" id="cstNone">Nessun potere</button>
            <button class="btn small ghost" id="cstAll">Tutti</button>
          </div>
        </div>
      </div>`));
    this.hook();

    this.root.querySelectorAll("[data-cst]").forEach((b) => {
      b.addEventListener("click", () => {
        audio.ui();
        const k = b.dataset.cst;
        let v = b.dataset.val;
        if (k === "target") v = Number.parseInt(v, 10);
        this._custom[k] = v;
        this.showCustom();
      });
    });
    this.root.querySelectorAll("[data-power]").forEach((b) => {
      b.addEventListener("click", () => {
        audio.ui();
        const id = b.dataset.power;
        const i = this._custom.powers.indexOf(id);
        if (i >= 0) this._custom.powers.splice(i, 1);
        else this._custom.powers.push(id);
        this.showCustom();
      });
    });
    this.root.querySelector("#cstNone").onclick = () => { audio.ui(); this._custom.powers = []; this.showCustom(); };
    this.root.querySelector("#cstAll").onclick = () => { audio.ui(); this._custom.powers = Object.keys(POWER_DEFS); this.showCustom(); };
    this.root.querySelector("#cstGo").onclick = async () => {
      audio.confirm();
      const cfg = this._custom;
      await this.createRoom({
        mode: "duel",
        arenaId: cfg.base,
        seats: 2,
        settings: {
          arenaId: cfg.base,
          target: cfg.target,
          custom: { powers: cfg.powers.slice() },
          options: { ballSpeed: cfg.ballSpeed, paddleSize: cfg.paddleSize }
        }
      });
    };
  }

  showBrief(id, vsCPU) {
    this.screen = "brief";
    const a = arenaById(id);
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="zones">← Arene</button>
        <div class="panel brief">
          <div class="tag" style="color:var(--gold);letter-spacing:.28em;font-size:11px;font-weight:700">${a.zone} · ${a.tag}</div>
          <div class="arena-name">${a.name}</div>
          <p class="sub">${a.desc}</p>
          <div class="vs">
            <span class="chip p1">Tu · W S</span>
            <span>VS</span>
            <span class="chip p2">${vsCPU ? "CPU" : "Collega · altro PC"}</span>
          </div>
          <p class="sub">Si gioca a ${a.scoreToWin}${vsCPU ? " · vittoria con 2 di scarto" : ""}</p>
          <div class="row">
            <button class="btn" data-start="${id}">${vsCPU ? "Inizia" : "Crea stanza"}</button>
          </div>
        </div>
      </div>`));
    this.hook();
    this.root.querySelector("[data-start]").addEventListener("click", async () => {
      audio.confirm();
      if (vsCPU) this.game.beginMatch(id, { vsCPU: true });
      else await this.createRoom({ mode: "duel", arenaId: id, seats: 2 });
    });
  }

  showFirebaseHelp() {
    this.screen = "fb";
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="play">← Indietro</button>
        <div class="panel options">
          <h2 class="section">Firebase</h2>
          <p class="sub">Per il 1v1 e il triangolo tra PC diversi serve Realtime Database.</p>
          <ol class="help">
            <li>Crea un progetto su <strong>console.firebase.google.com</strong></li>
            <li>Aggiungi un'app Web e copia la config</li>
            <li>Crea un <strong>Realtime Database</strong> (Europa)</li>
            <li>Incolla le chiavi in <code>games/shared/firebase-config.js</code></li>
            <li>Regole: usa il file <code>database.rules.json</code> di questa cartella</li>
          </ol>
          <p class="sub">Finché la config è YOUR_API_KEY, vs CPU e triangolo vs 2 CPU funzionano comunque.</p>
        </div>
      </div>`));
    this.hook();
  }

  showOnlineHub(triangle) {
    this.triangle = triangle;
    this.screen = "hub";
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="play">← Indietro</button>
        <h2 class="section">${triangle ? "Triangolo online" : "1 vs 1 online"}</h2>
        <p class="sub">Stesso link, due (o tre) computer. Un codice stanza e si parte.</p>
        <div class="panel" style="width:min(480px, calc(100% - 40px));text-align:center">
          <div class="opt" style="border:none;display:block">
            <label>Il tuo nome</label>
            <input id="nick" class="code-input" style="letter-spacing:.08em;font-size:18px;margin-top:8px" maxlength="16" value="${this.game.save.nick || ""}" placeholder="Nome" />
          </div>
          <div class="menu" style="margin-top:18px">
            <button class="btn" data-act="${triangle ? "tri-create" : "pvp-create"}">Crea stanza</button>
            <button class="btn ghost" data-act="join">Unisciti con codice</button>
          </div>
        </div>
      </div>`));
    this.hook();
    this.root.querySelector("#nick").addEventListener("change", (e) => {
      this.game.save.nick = e.target.value.trim();
      this.game.persist();
    });
  }

  showJoin() {
    this.screen = "join";
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="play">← Indietro</button>
        <h2 class="section">Codice stanza</h2>
        <div class="panel brief">
          <input id="code" class="code-input" maxlength="6" placeholder="AB3K" autocomplete="off" />
          <p class="sub" id="joinErr"></p>
          <button class="btn" id="doJoin">Entra</button>
        </div>
      </div>`));
    this.hook();
    const go = async () => {
      const code = this.root.querySelector("#code").value;
      try {
        audio.confirm();
        await net.join(code, this.game.save.nick || "Ospite");
        this.game.online = true;
        this.showLobby();
      } catch (e) {
        this.root.querySelector("#joinErr").textContent = e.message || "Errore";
      }
    };
    this.root.querySelector("#doJoin").onclick = go;
    this.root.querySelector("#code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
    this.root.querySelector("#code").focus();
  }

  async createRoom({ mode, arenaId, seats, settings = {} }) {
    try {
      const code = await net.create({
        mode,
        arenaId,
        seats,
        settings,
        nick: this.game.save.nick || (mode === "tri" ? "Blu" : "Blu")
      });
      this.game.online = true;
      this.triangle = mode === "tri";
      this._pendingArena = arenaId;
      this.showLobby();
      return code;
    } catch (e) {
      this.toast(e.message || "Impossibile creare la stanza");
    }
  }

  showLobby() {
    this.screen = "lobby";
    this.renderLobby(net.room);
  }

  renderLobby(room) {
    if (this.screen !== "lobby") return;
    const meta = room?.meta || {};
    const seats = meta.seats || 2;
    const players = net.playersList();
    const names = seats === 3
      ? [{ s: "bottom", l: "Blu · base" }, { s: "east", l: "Rosa · destra" }, { s: "west", l: "Oro · sinistra" }]
      : [{ s: "left", l: "Blu · sinistra" }, { s: "right", l: "Rosa · destra" }];
    const seatsHtml = names.map((n, i) => {
      const pl = players.find((p) => p.slot === i && p.in);
      const col = n.s === "west" ? "p3" : i === 0 ? "p1" : "p2";
      return `<div class="seat ${col}">
        <div class="tag">${n.l}</div>
        <strong>${pl ? (pl.cpu ? "CPU" : pl.nick || "Giocatore") : "In attesa…"}</strong>
      </div>`;
    }).join("");
    const filled = players.filter((p) => p.in).length;
    const host = net.host;
    const arena = arenaById(meta.arenaId || this._pendingArena || "classic");

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" id="leaveLobby">← Esci</button>
        <div class="panel brief">
          <p class="sub">Codice stanza — condividilo</p>
          <div class="room-code" id="copyCode">${net.code || "----"}</div>
          <p class="sub">${arena ? arena.name : ""} · ${seats === 3 ? "triangolo" : "1 vs 1"}</p>
          <div class="seats">${seatsHtml}</div>
          ${host ? `
            <div class="row" style="margin-top:18px">
              ${seats === 3 ? `<button class="btn small ghost" id="fillCpu">Riempi posti con CPU</button>` : ""}
              <button class="btn" id="goPlay" ${filled < 2 ? "disabled" : ""}>Avvia</button>
            </div>
            <p class="sub">Servono almeno 2 presenze. I posti vuoti diventano CPU.</p>
          ` : `<p class="sub">Aspetta che l'host avvii il match.</p>`}
        </div>
      </div>`));

    this.root.querySelector("#leaveLobby").onclick = async () => {
      audio.ui();
      await net.leave();
      this.game.online = false;
      this.showMain();
    };
    this.root.querySelector("#copyCode")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(net.code || "");
      this.toast("Codice copiato.");
    });
    this.root.querySelector("#fillCpu")?.addEventListener("click", async () => {
      for (let i = 0; i < seats; i++) {
        const pl = players.find((p) => p.slot === i && p.in);
        if (!pl) await net.fillCpu(i, "CPU " + (i + 1));
      }
    });
    this.root.querySelector("#goPlay")?.addEventListener("click", async () => {
      audio.confirm();
      const id = meta.arenaId || this._pendingArena || (seats === 3 ? "triangle" : "classic");
      const settings = meta.settings || {};
      for (let i = 0; i < seats; i++) {
        const pl = net.playersList().find((p) => p.slot === i && p.in);
        if (!pl) await net.fillCpu(i, "CPU " + (i + 1));
      }
      await net.start(id);
      this.applyPortalSettings(settings);
      this.game.beginMatch(id, {
        online: true,
        triangle: seats === 3,
        vsCPU: false,
        target: settings.target,
        powers: settings.custom?.powers
      });
    });
  }

  showHUD(game) {
    this.screen = "hud";
    const a = game.ctrl.def;
    const tri = game.triangle;
    const local = game.localSide;
    const scoreBits = tri
      ? TRI_SIDES.map((s) => `<div class="score ${s === "west" ? "p3" : s === "bottom" ? "p1" : "p2"}" id="sc-${s}">0<span class="name">${PNAME[s]}${s === local ? " · TU" : ""}</span></div>`).join(`<div class="sep"></div>`)
      : DUEL_SIDES.map((s) => `<div class="score ${s === "left" ? "p1" : "p2"}" id="sc-${s}">0<span class="name">${PNAME[s]}${s === local ? " · TU" : (game.cpuSides.includes(s) ? " · CPU" : "")}</span></div>`).join(`<div class="sep"></div>`);

    this.show(this.el(`
      <div class="screen transparent">
        <div class="hud">
          <div class="hud-top" style="grid-template-columns:1fr auto 1fr">
            <div class="side-info">
              <div class="chip p1">TU · ${PNAME[local]}</div>
              <div class="power" id="powL"></div>
            </div>
            <div class="scoreboard">
              ${scoreBits}
              <div class="sep"></div>
              <div class="hud-meta">
                <div class="arena">${a.name.toUpperCase()}</div>
                <div class="need">a ${game.customTarget || a.scoreToWin}${game.vsCPU && !tri ? " · scarto 2" : ""}</div>
              </div>
            </div>
            <div class="side-info right">
              <div class="chip p2">${game.online ? (net.code || "ONLINE") : "LOCALE"}</div>
            </div>
          </div>
          <div class="center-msg" id="center"></div>
          <div class="hud-bottom">
            <div class="keys">
              <span><span class="k">W S</span> racchetta</span>
              <span><span class="k">A D</span> 2ª</span>
              <span><span class="k">Spazio</span> potere</span>
              <span><span class="k">E</span> cambia</span>
            </div>
            <div class="keys"><span class="k">Esc</span> pausa</div>
          </div>
        </div>
      </div>`));
    this.updateHUD(game);
  }

  updateHUD(game) {
    const sides = game.triangle ? TRI_SIDES : DUEL_SIDES;
    for (const s of sides) {
      const el = document.getElementById("sc-" + s);
      if (el) el.innerHTML = `${game.scores[s] ?? 0}<span class="name">${PNAME[s]}${s === game.localSide ? " · TU" : ""}</span>`;
    }
    this.renderPow("powL", game.powers, game.localSide);
  }

  renderPow(id, mgr, side) {
    const el = document.getElementById(id);
    if (!el) return;
    const list = mgr.inventory[side] || [];
    if (!list.length) {
      el.innerHTML = `<div class="slot">—</div>`;
      return;
    }
    el.innerHTML = list.map((pid, i) => {
      const d = POWER_DEFS[pid];
      const sel = i === mgr.selected[side];
      return `<div class="slot ${sel ? "ready" : ""}">${d?.name || pid}</div>`;
    }).join("");
  }

  setCenter(t) {
    const el = document.getElementById("center");
    if (!el) return;
    el.textContent = t;
    el.style.display = t ? "block" : "none";
  }

  showPause(game) {
    const overlay = this.el(`
      <div class="screen" id="pauseScr">
        <div class="pause-title">PAUSA</div>
        <div class="menu">
          <button class="btn" data-act="resume">Riprendi</button>
          ${game.online && !net.host ? "" : `<button class="btn ghost" data-act="rematch">Ricomincia</button>`}
          <button class="btn ghost" data-act="leave">Lascia il tavolo</button>
        </div>
      </div>`);
    this.root.appendChild(overlay);
    overlay.querySelector("[data-act=resume]").onclick = () => { audio.ui(); game.resume(); };
    overlay.querySelector("[data-act=rematch]")?.addEventListener("click", () => { audio.ui(); game.rematch(); });
    overlay.querySelector("[data-act=leave]").onclick = () => { audio.ui(); game.forfeit(); this.showTitle(); };
  }

  hidePause() { document.getElementById("pauseScr")?.remove(); }

  showResult(game, iWon, winSide) {
    const a = game.ctrl.def;
    const ids = this.campaignArenas().map((x) => x.id);
    const nxt = ids[ids.indexOf(a.id) + 1];
    const just = iWon && nxt && game.save.unlocked.includes(nxt);
    const scoreLine = (game.triangle ? TRI_SIDES : DUEL_SIDES)
      .map((s) => `${PNAME[s]} ${game.scores[s] ?? 0}`).join("  ·  ");
    this.show(this.el(`
      <div class="screen">
        <div class="panel result">
          <div class="kicker" style="letter-spacing:.3em;color:var(--gold);font-size:11px">${a.name.toUpperCase()}</div>
          <div class="who ${iWon ? "win" : "lose"}">${iWon ? "HAI VINTO" : "VINCE " + (PNAME[winSide] || "")}</div>
          <div class="final-score">${scoreLine}</div>
          ${just ? `<p class="sub">Nuova arena sbloccata: <strong style="color:var(--mint)">${arenaById(nxt).name}</strong></p>` : ""}
          <div class="menu">
            ${game.online && !net.host ? "" : `<button class="btn" data-act="again">Rivincita</button>`}
            <button class="btn ghost" data-act="play">Menu modi</button>
            <button class="btn ghost" data-act="title">Titolo</button>
          </div>
        </div>
      </div>`));
    this.root.querySelector("[data-act=again]")?.addEventListener("click", () => { audio.confirm(); game.rematch(); });
    this.root.querySelector("[data-act=play]").onclick = () => { audio.ui(); game.forfeit(); this.showMain(); };
    this.root.querySelector("[data-act=title]").onclick = () => { audio.ui(); game.forfeit(); this.showTitle(); };
  }

  showOptions() {
    const o = this.game.save.options;
    const seg = (key, vals) => vals.map((v) =>
      `<button data-opt="${key}" data-val="${v.id}" class="${String(o[key]) === String(v.id) ? "on" : ""}">${v.label}</button>`
    ).join("");
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel options">
          <h2 class="section">Opzioni</h2>
          <p class="sub">Restano salvate su questo browser.</p>
          <div class="opt">
            <div><label>Tema grafica</label><span class="hint">${themeById(o.theme).desc}</span></div>
            <div class="seg th-seg">${THEME_IDS.map((id) => {
              const t = themeById(id);
              const dots = t.swatch.map((c) =>
                `<i style="background:#${c.toString(16).padStart(6, "0")}"></i>`).join("");
              return `<button data-opt="theme" data-val="${id}" class="${o.theme === id ? "on" : ""}" title="${t.desc}"><span class="th-dots">${dots}</span>${t.name}</button>`;
            }).join("")}</div>
          </div>
          <div class="opt">
            <div><label>Dimensione racchetta</label><span class="hint">Default, piccola, media, grande</span></div>
            <div class="seg">${seg("paddleSize", [
              { id: "small", label: "Piccola" }, { id: "default", label: "Default" },
              { id: "medium", label: "Media" }, { id: "large", label: "Grande" }
            ])}</div>
          </div>
          <div class="opt">
            <div><label>Velocità palla</label></div>
            <div class="seg">${seg("ballSpeed", [
              { id: "slow", label: "Lenta" }, { id: "default", label: "Default" }, { id: "fast", label: "Veloce" }
            ])}</div>
          </div>
          <div class="opt">
            <div><label>Difficoltà CPU</label></div>
            <div class="seg">${seg("difficulty", [
              { id: "facile", label: "Facile" }, { id: "medio", label: "Media" },
              { id: "difficile", label: "Difficile" }, { id: "leggenda", label: "Leggenda" }
            ])}</div>
          </div>
          <div class="opt">
            <div><label>Power-up extra</label><span class="hint">Presa, schianto, allunga, turbo in ogni arena</span></div>
            <div class="seg">${seg("extraPowers", [
              { id: "false", label: "Off" }, { id: "true", label: "On" }
            ])}</div>
          </div>
          <div class="row" style="margin-top:18px">
            <button class="btn small gold" data-act="unlock">Sblocca tutto</button>
            <button class="btn small ghost" data-act="reset">Reset progressi</button>
          </div>
        </div>
      </div>`));
    this.hook();
    this.root.querySelectorAll("[data-opt]").forEach((b) => {
      b.addEventListener("click", () => {
        audio.ui();
        const key = b.dataset.opt;
        let val = b.dataset.val;
        if (val === "true") val = true;
        else if (val === "false") val = false;
        this.game.save.options[key] = val;
        this.game.persist();
        if (key === "theme") {
          // Effetto immediato: variabili CSS di menu/HUD + ricolorazione della
          // scena 3D che sta girando dietro (demo o partita in corso).
          applyThemeToUI(val);
          this.game.refreshTheme();
        }
        this.showOptions();
      });
    });
    this.root.querySelector("[data-act=unlock]").onclick = () => {
      audio.confirm();
      this.game.save.unlocked = ARENAS.map((a) => a.id);
      this.game.persist();
      this.toast("Tutte le arene sono aperte.");
    };
    this.root.querySelector("[data-act=reset]").onclick = () => {
      this.game.save.unlocked = ["classic"];
      this.game.save.cleared = [];
      this.game.persist();
      this.toast("Progressi azzerati.");
    };
  }

  showControls() {
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel options">
          <h2 class="section">Comandi</h2>
          <p class="sub">Ogni giocatore sta sul proprio computer. Stessi tasti per tutti.</p>
          <div class="opt"><div><label>Racchetta</label><span class="hint">Lungo il tuo lato del tavolo</span></div><div>W / S oppure frecce ↑ ↓</div></div>
          <div class="opt"><div><label>Seconda racchetta</label><span class="hint">Portiere / attaccante</span></div><div>A / D oppure ← →</div></div>
          <div class="opt"><div><label>Potere</label></div><div>Spazio · cambia con E</div></div>
          <div class="opt"><div><label>Pausa</label></div><div>Esc oppure P</div></div>
          <p class="sub" style="margin-top:16px">Spiaggia e hockey: tieni premuto Spazio vicino alla palla, rilascia per lanciare.</p>
        </div>
      </div>`));
    this.hook();
  }

  /**
   * Elenco dei poteri: cosa fanno, come si usano e in quali arene compaiono.
   * Le arene vengono ricavate da ARENAS.powerUps, cosi' la pagina resta
   * allineata da sola se un'arena cambia pool.
   */
  showPowers() {
    this.screen = "powers";
    const ALWAYS = ["grab", "whack", "stretch", "turbo"];

    const arenasFor = (id) => ARENAS.filter((a) => (a.powerUps || []).includes(id));

    // Ordine: prima quelli sempre disponibili, poi gli altri per nome.
    const ids = Object.keys(POWER_DEFS).sort((a, b) => {
      const aa = ALWAYS.includes(a), bb = ALWAYS.includes(b);
      if (aa !== bb) return aa ? -1 : 1;
      return POWER_DEFS[a].name.localeCompare(POWER_DEFS[b].name);
    });

    const cards = ids.map((id) => {
      const p = POWER_DEFS[id];
      const hex = "#" + p.color.toString(16).padStart(6, "0");
      const used = arenasFor(id);
      const extra = ALWAYS.includes(id);
      const unused = !used.length && !extra;
      const where = used.length
        ? used.map((a) => a.name).join(" · ")
        : "Nessuna arena al momento";
      return `
        <div class="pw-card${unused ? " pw-unused" : ""}">
          <div class="pw-head">
            <span class="pw-dot" style="background:${hex};box-shadow:0 0 12px ${hex}"></span>
            <h4>${p.name}</h4>
            ${p.hold ? `<span class="pw-flag">TIENI PREMUTO</span>` : ""}
          </div>
          <p class="pw-desc">${p.desc}</p>
          <div class="pw-where"><span>Arene</span>${where}</div>
          ${extra ? `<div class="pw-where"><span>Extra</span>Sempre disponibile con «Poteri extra»</div>` : ""}
        </div>`;
    }).join("");

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel">
          <h2 class="section">Poteri</h2>
          <p class="sub">Colpisci il gettone che compare sul tavolo per raccoglierlo. Ne tieni al massimo 3: <b class="k">E</b> per cambiare, <b class="k">Spazio</b> per usarlo.</p>
          <div class="pw-grid">${cards}</div>
          <p class="sub" style="margin:18px 0 0">Ogni arena mette in campo solo i suoi poteri. In Opzioni puoi attivare «Poteri extra» per aggiungere ovunque Presa, Schianto, Allunga e Turbo.</p>
        </div>
      </div>`));
    this.hook();
  }

  showCredits() {
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel credits">
          <h2 class="section">Crediti</h2>
          <p>Ispirato a <strong>Pong: The Next Level</strong> (Hasbro / Atari, 1999).</p>
          <p>Edizione interna: 3D moderno, 1v1 online su Firebase, tavolo a triangolo 1v1v1.</p>
          <p>Motore 3D: Three.js · SFX procedurali · Un giocatore, un PC.</p>
          <p style="margin-top:18px;color:var(--gold);letter-spacing:.2em;font-size:12px">KEEP THE BALL IN PLAY</p>
        </div>
      </div>`));
    this.hook();
  }

  showMenu() { this.showTitle(); }

  toast(msg) {
    document.querySelector(".toast")?.remove();
    const t = this.el(`<div class="toast">${msg}</div>`);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  hook() {
    this.root.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => this.onAct(b.dataset.act));
    });
  }

  async onAct(act) {
    audio.ui();
    if (act === "play") this.showMain();
    if (act === "title") this.showTitle();
    if (act === "opt") this.showOptions();
    if (act === "ctrl") this.showControls();
    if (act === "pwr") this.showPowers();
    if (act === "cred") this.showCredits();
    if (act === "cpu") { this.triangle = false; this.showZones(true); }
    if (act === "pvp") {
      if (!isFirebaseConfigured()) return this.showFirebaseHelp();
      this.triangle = false;
      this.showOnlineHub(false);
    }
    if (act === "pvp-create") this.showZones(false);
    if (act === "custom") this.showCustom();
    if (act === "tri-cpu") {
      this.game.beginMatch("triangle", { vsCPU: true, triangle: true });
    }
    if (act === "tri-on") {
      if (!isFirebaseConfigured()) return this.showFirebaseHelp();
      this.showOnlineHub(true);
    }
    if (act === "tri-create") {
      await this.createRoom({ mode: "tri", arenaId: "triangle", seats: 3 });
    }
    if (act === "join") this.showJoin();
    if (act === "zones") this.showZones(this.vsCPU);
  }
}
