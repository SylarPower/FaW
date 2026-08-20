import { ARENAS, arenaById } from "./arenas.js";
import { POWER_DEFS } from "./powerups.js";
import { net, isFirebaseConfigured, codeFromSeed } from "./net.js";
import { PNAME, TRI_SIDES, DUEL_SIDES } from "./players.js";
import { THEME_IDS, themeById, applyThemeToUI } from "./themes.js";

/**
 * Navigazione da tastiera per i menu: W/S oppure ↑/↓ per muovere la selezione,
 * SPAZIO (o Enter) per confermare, ESC per tornare alla schermata precedente.
 * Funziona su ogni schermata agganciando `.menu-focusable` come elementi
 * selezionabili (bottoni, slot, ecc.).
 */
class MenuNav {
  constructor(ui) {
    this.ui = ui;
    this.index = 0;
    this.items = [];
    this.onConfirm = null;
  }
  itemKey(el) {
    if (!el) return "";
    const data = el.dataset || {};
    if (data.opt) return `opt:${data.opt}:${data.val || ""}`;
    if (data.cst) return `cst:${data.cst}:${data.val || ""}`;
    if (data.power) return `power:${data.power}`;
    if (data.act) return `act:${data.act}`;
    return el.textContent.trim();
  }
  attach(root, { onBack } = {}) {
    const previous = this.items[this.index];
    const previousKey = this.itemKey(previous);
    this.root = root;
    this.onBack = onBack || null;
    // Tutti gli elementi interattivi del menu che vogliamo selezionare.
    this.items = Array.from(root.querySelectorAll(
      ".btn, button.card, .pw-pick, [data-cst], [data-opt], [data-power], button.pw-pick"
    )).filter((b) => !b.disabled);
    const restored = previousKey ? this.items.findIndex((b) => this.itemKey(b) === previousKey) : -1;
    this.index = restored >= 0 ? restored : 0;
    this.items.forEach((item, i) => {
      item.addEventListener("click", () => {
        this.index = i;
        this.focus();
      });
    });
    this.focus();
  }
  focus() {
    this.items.forEach((b, i) => b.classList.toggle("active", i === this.index));
    const el = this.items[this.index];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  move(delta) {
    if (!this.items.length) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.focus();
  }
  confirm() {
    const el = this.items[this.index];
    if (!el) return;
    el.click();
  }
  back() {
    if (this.onBack) this.onBack();
    else {
      const backBtn = this.root?.querySelector(".back");
      if (backBtn) backBtn.click();
    }
  }
  handleInput(input) {
    // axis = -1 (su) / +1 (giu') — leggiamo un solo step per pressione.
    if (input.axisJustUp) this.move(-1);
    else if (input.axisJustDown) this.move(1);
    if (input.confirm) this.confirm();
    if (input.pause) this.back();
  }
}

export class UI {
  constructor(root) {
    this.root = root;
    this.game = null;
    this.screen = "load";
    this.vsCPU = true;
    this.online = false;
    this.triangle = false;
    this.nav = new MenuNav(this);
    this._previewArena = null;
    this._previewSize = null;
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
  show(node) {
    this.clear();
    this.root.appendChild(node);
    // Aggiungi la legenda dei tasti in tutti i menu (non in HUD/Pausa/Portale di
    // caricamento dove non servirebbe o disturberebbe).
    if (this.screen !== "hud" && this.screen !== "load" && this.screen !== "pause") {
      const hint = this.el(`<p class="hint-keys"><span class="k">W</span><span class="k">S</span> muovi · <span class="k">Spazio</span> seleziona · <span class="k">Esc</span> indietro</p>`);
      this.root.appendChild(hint);
    }
  }

  // Aggancia la navigazione tastiera dopo ogni render.
  _hookScreen(opts = {}) {
    // Prima la navigazione: se Space/Enter scatena un rerender, l'indice
    // dell'elemento appena scelto viene catturato e ripristinato.
    this.nav.attach(this.root, opts);
    this.hook();
  }

  _tickNav() {
    // Usato dal loop principale (game.tickPlay non c'entra: leggiamo input
    // direttamente qui per i menu). Richiamato da updateMenu() sotto.
    // Importato dinamicamente per evitare cicli.
  }

  // Chiamato dal main loop quando siamo in un menu (non in partita).
  updateMenuNav(input) {
    if (!this.nav.items.length) return;
    if (input.axisJustUp) this.nav.move(-1);
    else if (input.axisJustDown) this.nav.move(1);
    if (input.confirm) this.nav.confirm();
    if (input.pause) {
      // Esc in menu = torna indietro, tranne che nella title dove non c'e' back.
      if (this.screen !== "title" && this.screen !== "load" && this.screen !== "hud") this.nav.back();
    }
  }

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
          <p>Vs CPU, 1v1 online. Solo tastiera.</p>
        </div>
        <div class="menu">
          <button class="btn" data-act="play">Gioca</button>
          <button class="btn ghost" data-act="opt">Opzioni</button>
          <button class="btn ghost" data-act="ctrl">Comandi</button>
          <button class="btn ghost" data-act="pwr">Poteri</button>
        </div>
      </div>`));
    this._hookScreen({ onBack: () => {} });
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
        </div>
      </div>`));
    this._hookScreen();
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
                <h4 class="card-arena-title">${a.name}</h4>
                <p>${a.desc}</p>
                ${lock ? `<span class="lock">BLOCCATA</span>` : ""}
              </button>`;
          }).join("")}
        </div>
      </div>`).join("");

    const customBlock = `
      <div class="zone-block">
        <h3>Su misura</h3>
        <div class="cards">
          <button class="card card-custom" data-act="custom">
            <div class="tag">Personalizzata · ${vsCPU ? "vs CPU" : "online"}</div>
            <h4 class="card-arena-title">Arena su misura</h4>
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
    this._hookScreen();
    this.root.querySelectorAll("[data-arena]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.showBrief(btn.dataset.arena, vsCPU);
      });
    });
  }

  /**
   * Arena personalizzata contro CPU o online. Mostra subito in sfondo il tavolo
   * e la dimensione racchetta scelti, ricaricando la demo in tempo reale.
   */
  showCustom() {
    this.screen = "custom";
    const vsCPU = this.vsCPU;
    if (!this._custom) {
      const opts = this.game?.save?.options || {};
      this._custom = {
        base: "classic",
        target: 10,
        ballSpeed: opts.ballSpeed || "default",
        paddleSize: opts.paddleSize || "default",
        powers: ["whack", "stretch", "turbo", "grab"]
      };
    }
    const c = this._custom;

    // Appena entriamo, aggiorniamo la demo del background con il tavolo e la
    // dimensione scelti. Poi riagganciamo quando cambiano.
    this._applyCustomPreview();

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
          <span class="pw-pick-name"><span class="pw-glyph" style="color:${hex}">${p.glyph || ""}</span> ${p.name}</span>
          <span class="pw-pick-desc">${p.desc}</span>
        </button>`;
    }).join("");

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="zones">← Arene</button>
        <div class="panel">
          <h2 class="section">Arena su misura</h2>
          <p class="sub">${vsCPU
            ? "Configura la partita libera e affronta la CPU con le tue regole."
            : "Configura la partita, poi crea la stanza e manda il codice al collega."}</p>

          <div class="opt">
            <div><label>Tavolo di base</label><span class="hint">Ostacoli e forma del campo (anteprima sullo sfondo)</span></div>
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
            <div><label>Dimensione racchetta</label><span class="hint">Anteprima sullo sfondo</span></div>
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
            <button class="btn" id="cstGo">${vsCPU ? "Gioca contro CPU" : "Crea stanza"}</button>
            <button class="btn small ghost" id="cstNone">Nessun potere</button>
            <button class="btn small ghost" id="cstAll">Tutti</button>
          </div>
        </div>
      </div>`));
    this._hookScreen();

    this.root.querySelectorAll("[data-cst]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.cst;
        let v = b.dataset.val;
        if (k === "target") v = Number.parseInt(v, 10);
        this._custom[k] = v;
        if (k === "base" || k === "paddleSize") this._applyCustomPreview();
        this.showCustom();
      });
    });
    this.root.querySelectorAll("[data-power]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.power;
        const i = this._custom.powers.indexOf(id);
        if (i >= 0) this._custom.powers.splice(i, 1);
        else this._custom.powers.push(id);
        this.showCustom();
      });
    });
    this.root.querySelector("#cstNone").onclick = () => { this._custom.powers = []; this.showCustom(); };
    this.root.querySelector("#cstAll").onclick = () => { this._custom.powers = Object.keys(POWER_DEFS); this.showCustom(); };
    this.root.querySelector("#cstGo").onclick = async () => {
      const cfg = this._custom;
      const options = { ballSpeed: cfg.ballSpeed, paddleSize: cfg.paddleSize };
      // Ripristina la demo standard quando usciamo.
      this._clearCustomPreview();
      if (vsCPU) {
        this.game.beginMatch(cfg.base, {
          vsCPU: true,
          target: cfg.target,
          powers: cfg.powers.slice(),
          options
        });
        return;
      }
      await this.createRoom({
        mode: "duel",
        arenaId: cfg.base,
        seats: 2,
        settings: {
          arenaId: cfg.base,
          target: cfg.target,
          custom: { powers: cfg.powers.slice() },
          options
        }
      });
    };
  }

  _applyCustomPreview() {
    if (!this._custom || !this.game) return;
    const c = this._custom;
    const changed =
      this._previewArena !== c.base ||
      this._previewSize !== c.paddleSize ||
      this._previewBall !== c.ballSpeed;
    if (!changed) return;
    this._previewArena = c.base;
    this._previewSize = c.paddleSize;
    this._previewBall = c.ballSpeed;
    // Sostituiamo la demo con una preview del tavolo/palla/racchetta scelti.
    this.game.matchOptions = { paddleSize: c.paddleSize, ballSpeed: c.ballSpeed };
    this.game.customPowers = [];
    this.game.customTarget = null;
    this.game.demo = true;
    this.game.loadArena(c.base, { demo: true });
    this.game.serve(1);
  }

  _clearCustomPreview() {
    this._previewArena = null;
    this._previewSize = null;
    this._previewBall = null;
    this.game.matchOptions = null;
    this.game.customPowers = null;
    // Torna a una demo casuale invece di lasciare in scena l'ultimo tavolo
    // della preview.
    if (this.game.demo) {
      this.game.loadArena(pickDemoSafe(), { demo: true });
      this.game.serve(1);
    }
  }

  showBrief(id, vsCPU) {
    this.screen = "brief";
    const a = arenaById(id);
    const theme = themeById(this.game.save.options.theme);
    // Titolo con massimo contrasto: testo chiaro, contorno scuro spesso.
    const titleColor = theme.ui?.["--gold"] || "var(--gold)";
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="zones">← Arene</button>
        <div class="panel brief">
          <div class="tag" style="color:var(--gold);letter-spacing:.28em;font-size:11px;font-weight:700">${a.zone} · ${a.tag}</div>
          <div class="arena-name" style="color:${titleColor};text-shadow:0 0 18px rgba(0,0,0,.9),0 3px 0 #000,0 0 24px ${titleColor}">${a.name}</div>
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
    this._hookScreen();
    this.root.querySelector("[data-start]").addEventListener("click", async () => {
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
          <p class="sub">Finché la config è YOUR_API_KEY, vs CPU funziona comunque.</p>
        </div>
      </div>`));
    this._hookScreen();
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
    this._hookScreen();
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
    this._hookScreen();
    const go = async () => {
      const code = this.root.querySelector("#code").value;
      try {
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

    this._hookScreen({ onBack: async () => {
      await net.leave(); this.game.online = false; this.showMain();
    }});
    this.root.querySelector("#leaveLobby").onclick = async () => {
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
      const id = meta.arenaId || this._pendingArena || (seats === 3 ? "triangle" : "classic");
      const settings = meta.settings || {};
      for (let i = 0; i < seats; i++) {
        const pl = playersList_safe().find((p) => p.slot === i && p.in);
        if (!pl) await net.fillCpu(i, "CPU " + (i + 1));
      }
      await net.start(id);
      if (!settings.custom) this.applyPortalSettings(settings);
      this.game.beginMatch(id, {
        online: true,
        triangle: seats === 3,
        vsCPU: false,
        target: settings.target,
        powers: settings.custom?.powers,
        options: settings.options
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
              <span><span class="k">Q E</span> curva (colpo forte sul timing)</span>
              <span><span class="k">Spazio</span> presa (se disponibile)</span>
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
    this.renderPow("powL", game.powers, game.localSide, game);
  }

  renderPow(id, _mgr, side, game) {
    const el = document.getElementById(id);
    if (!el) return;
    const pads = game.world.paddles.filter((p) => p.side === side);
    const tags = [];
    const whack = Math.max(0, ...pads.map((p) => p.powerHit || 0));
    const whackStep = Math.max(0, ...pads.map((p) => p.whackStep || 0));
    const stretch = Math.max(0, ...pads.map((p) => p.stretchStacks || 0));
    const timers = (key) => Math.ceil(Math.max(0, ...pads.map((p) => p[key] || 0)));
    const stretchLeft = () => {
      const all = pads.flatMap((p) => p.stretchTimers || []);
      return all.length ? Math.ceil(Math.max(0, ...all)) : 0;
    };
    if (whack) {
      const stepTxt = whackStep > 0 ? ` · ${whackStep}° colpo ${(1.8 + 0.55 * (whackStep - 1)).toFixed(2)}×` : "";
      tags.push(`<div class="slot active" title="I prossimi 3 colpi accelerano la palla: ognuno più veloce del precedente">✸ Schianto ×${whack}${stepTxt}</div>`);
    }
    if (stretch) tags.push(`<div class="slot active" title="Allunga la racchetta; gli effetti si sommano">↔ Allunga ×${stretch} · ${stretchLeft()}s</div>`);
    if (timers("grabT")) tags.push(`<div class="slot active">✋ Presa ${timers("grabT")}s</div>`);
    if (timers("turboT")) tags.push(`<div class="slot active">≫ Turbo ${timers("turboT")}s</div>`);
    if (timers("barrierT")) tags.push(`<div class="slot active">▤ Barriera ${timers("barrierT")}s</div>`);
    if (timers("invert")) tags.push(`<div class="slot active">⇄ Caos ${timers("invert")}s</div>`);
    if (timers("burn")) tags.push(`<div class="slot active">☠ Bruciatura ${timers("burn")}s</div>`);
    if (!tags.length) tags.push(`<div class="slot">—</div>`);
    el.innerHTML = tags.join("");
  }

  setCenter(t) {
    const el = document.getElementById("center");
    if (!el) return;
    el.textContent = t;
    el.style.display = t ? "block" : "none";
    el.classList.remove("center-pop");
    if (t) {
      void el.offsetWidth;
      el.classList.add("center-pop");
    }
  }

  showPause(game) {
    this.screen = "pause";
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
    this.nav.attach(overlay, {
      onBack: () => { this.hidePause(); game.resume(); }
    });
    overlay.querySelector("[data-act=resume]").onclick = () => { this.hidePause(); game.resume(); };
    overlay.querySelector("[data-act=rematch]")?.addEventListener("click", () => { this.hidePause(); game.rematch(); });
    overlay.querySelector("[data-act=leave]").onclick = () => { this.hidePause(); game.forfeit(); this.showTitle(); };
  }

  hidePause() {
    document.getElementById("pauseScr")?.remove();
    this.screen = "hud";
  }

  showResult(game, iWon, winSide) {
    const a = game.ctrl.def;
    const ids = this.campaignArenas().map((x) => x.id);
    const nxt = ids[ids.indexOf(a.id) + 1];
    const just = iWon && nxt && game.save.unlocked.includes(nxt);
    const scoreLine = (game.triangle ? TRI_SIDES : DUEL_SIDES)
      .map((s) => `${PNAME[s]} ${game.scores[s] ?? 0}`).join("  ·  ");
    const theme = themeById(game.save.options.theme);
    const titleColor = iWon ? (theme.ui?.["--mint"] || "var(--mint)") : (theme.ui?.["--pink"] || "var(--pink)");
    this.show(this.el(`
      <div class="screen">
        <div class="panel result">
          <div class="kicker" style="letter-spacing:.3em;color:var(--gold);font-size:11px">${a.name.toUpperCase()}</div>
          <div class="who ${iWon ? "win" : "lose"}" style="color:${titleColor};text-shadow:0 0 22px rgba(0,0,0,.85),0 2px 0 #000,0 0 28px ${titleColor}">${iWon ? "HAI VINTO" : "VINCE " + (PNAME[winSide] || "")}</div>
          <div class="final-score">${scoreLine}</div>
          ${just ? `<p class="sub">Nuova arena sbloccata: <strong style="color:var(--mint)">${arenaById(nxt).name}</strong></p>` : ""}
          <div class="menu">
            ${game.online && !net.host ? "" : `<button class="btn" data-act="again">Rivincita</button>`}
            <button class="btn ghost" data-act="play">Menu modi</button>
            <button class="btn ghost" data-act="title">Titolo</button>
          </div>
        </div>
      </div>`));
    this._hookScreen();
    this.root.querySelector("[data-act=again]")?.addEventListener("click", () => { game.rematch(); });
    this.root.querySelector("[data-act=play]").onclick = () => { game.forfeit(); this.showMain(); };
    this.root.querySelector("[data-act=title]").onclick = () => { game.forfeit(); this.showTitle(); };
  }

  showOptions() {
    this.screen = "options";
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
            <div><label>Tema grafica</label></div>
            <div class="seg th-seg">${THEME_IDS.map((id) => {
              const t = themeById(id);
              const dots = t.swatch.map((c) =>
                `<i style="background:#${c.toString(16).padStart(6, "0")}"></i>`).join("");
              return `<button data-opt="theme" data-val="${id}" class="${o.theme === id ? "on" : ""}"><span class="th-dots">${dots}</span>${t.name}</button>`;
            }).join("")}</div>
          </div>
          <div class="opt">
            <div><label>Dimensione racchetta</label></div>
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
          <div class="row" style="margin-top:18px">
            <button class="btn small ghost" data-act="reset">Reset progressi</button>
          </div>
        </div>
      </div>`));
    this._hookScreen();
    this.root.querySelectorAll("[data-opt]").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.dataset.opt;
        let val = b.dataset.val;
        if (val === "true") val = true;
        else if (val === "false") val = false;
        this.game.save.options[key] = val;
        this.game.persist();
        if (key === "theme") {
          applyThemeToUI(val);
          this.game.refreshTheme();
        } else if (key === "paddleSize" || key === "ballSpeed") {
          this.game.refreshTheme();
        }
        this.showOptions();
      });
    });
    this.root.querySelector("[data-act=reset]").onclick = () => {
      this.game.save.unlocked = ["classic"];
      this.game.save.cleared = [];
      this.game.persist();
      this.toast("Progressi azzerati.");
    };
  }

  showControls() {
    this.screen = "controls";
    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel options">
          <h2 class="section">Comandi</h2>
          <p class="sub">Ogni giocatore sta sul proprio computer. Puoi giocare anche solo con W/S, Spazio ed Esc.</p>
          <div class="opt"><div><label>Muovi selezione menu</label><span class="hint">Solo nei menu</span></div><div>W / S oppure ↑ ↓</div></div>
          <div class="opt"><div><label>Conferma nei menu</label></div><div>Spazio / Invio</div></div>
          <div class="opt"><div><label>Presa / lancio (quando disponibile)</label></div><div>Spazio</div></div>
          <div class="opt"><div><label>Torna indietro / Pausa</label></div><div>Esc</div></div>
          <div class="opt"><div><label>Racchetta</label><span class="hint">Lungo il tuo lato del tavolo</span></div><div>W / S oppure ↑ ↓</div></div>
          <div class="opt"><div><label>Seconda racchetta</label><span class="hint">Portiere / attaccante</span></div><div>A / D oppure ← →</div></div>
          <p class="sub" style="margin-top:16px">I power-up si attivano appena li raccogli. Presa, spiaggia e hockey: tieni premuto Spazio vicino alla palla, rilascia per lanciare.</p>
        </div>
      </div>`));
    this._hookScreen();
  }

  /**
   * Elenco dei poteri.
   */
  showPowers() {
    this.screen = "powers";
    const arenasFor = (id) => ARENAS.filter((a) => (a.powerUps || []).includes(id));
    const ids = Object.keys(POWER_DEFS).sort((a, b) => POWER_DEFS[a].name.localeCompare(POWER_DEFS[b].name));

    const cards = ids.map((id) => {
      const p = POWER_DEFS[id];
      const hex = "#" + p.color.toString(16).padStart(6, "0");
      const used = arenasFor(id);
      const where = used.length
        ? used.map((a) => a.name).join(" · ")
        : "Nessuna arena al momento";
      return `
        <div class="pw-card">
          <div class="pw-head">
            <span class="pw-dot" style="background:${hex};box-shadow:0 0 12px ${hex}"></span>
            <h4><span class="pw-glyph" style="color:${hex}">${p.glyph || ""}</span> ${p.name}</h4>
            ${p.hold ? `<span class="pw-flag">DOPO LA RACCOLTA</span>` : p.charges ? `<span class="pw-flag">+${p.charges} COLPI</span>` : ""}
          </div>
          <p class="pw-desc">${p.desc}</p>
          <div class="pw-where"><span>Arene</span>${where}</div>
        </div>`;
    }).join("");

    this.show(this.el(`
      <div class="screen">
        <button class="btn small ghost back" data-act="title">← Indietro</button>
        <div class="panel">
          <h2 class="section">Poteri</h2>
          <p class="sub">Colpisci il gettone che compare sul tavolo: ogni potere si attiva immediatamente e gli effetti si sommano. Non c'è più una borsa da gestire.</p>
          <div class="pw-grid">${cards}</div>
          <p class="sub" style="margin:18px 0 0">Ogni arena ha il suo set di poteri. Nell'arena personalizzata puoi scegliere tu quali far comparire.</p>
        </div>
      </div>`));
    this._hookScreen();
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
    if (act === "play") this.showMain();
    if (act === "title") { this._clearCustomPreview(); this.showTitle(); }
    if (act === "opt") this.showOptions();
    if (act === "ctrl") this.showControls();
    if (act === "pwr") this.showPowers();
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
    if (act === "zones") { this._clearCustomPreview(); this.showZones(this.vsCPU); }
  }
}

function playersList_safe() {
  return net.playersList ? net.playersList() : [];
}

function pickDemoSafe() {
  const pool = ["classic", "soccer", "penguin", "tilt", "logs"];
  return pool[(Math.random() * pool.length) | 0];
}
