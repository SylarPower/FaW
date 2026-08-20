import { Game } from "./game.js";
import { UI } from "./ui.js";
import { audio } from "./audio.js";
import { input } from "./input.js";
import { net } from "./net.js";
import { applyThemeToUI } from "./themes.js";

window.addEventListener("error", (e) => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#3a1020;color:#ffd0dc;padding:12px 16px;border-radius:8px;font:12px/1.4 Outfit,sans-serif";
  d.textContent = e.message || String(e);
  document.body.appendChild(d);
});

const ui = new UI(document.getElementById("ui"));
ui.showLoad();
input.attach();
net.init();

let p = 0;
const timer = setInterval(() => {
  p += 0.07;
  ui.setLoad(Math.min(1, p));
  if (p < 1) return;
  clearInterval(timer);
  boot();
}, 35);

function boot() {
  const canvas = document.getElementById("gl");
  const game = new Game(canvas, ui);
  ui.bind(game);
  // Il tema salvato deve colorare menu e HUD gia' dalla prima schermata.
  applyThemeToUI(game.save.options.theme);
  audio.init();

  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("matchId");
  if (matchId) ui.openPortalMatch(matchId);
  else ui.showTitle();

  const unlock = async () => {
    await audio.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
