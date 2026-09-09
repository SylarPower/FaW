const { defineConfig } = require("@playwright/test");

/**
 * Configurazione dei test dei giochi multiplayer FaW.
 *
 * Server: `tests/support/faw-relay.js` — file statici + backend "stile Firestore"
 * in memoria. I test non toccano il progetto Firebase reale.
 * Ogni test usa contesti browser SEPARATI (un contesto per giocatore), quindi
 * la sincronizzazione passa per la rete e non per una simulazione in pagina.
 */
const chromiumLaunch = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
  : {};
module.exports = defineConfig({
  testDir: "./tests/faw",
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8090",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: chromiumLaunch } },
    { name: "chromium-desktop", use: { browserName: "chromium", launchOptions: chromiumLaunch, viewport: { width: 1280, height: 800 } } },
    { name: "webkit", use: { browserName: "webkit", isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: "node tests/support/faw-relay.js 8090",
    url: "http://127.0.0.1:8090/api/time",
    reuseExistingServer: true,
    timeout: 30000
  },
  reporter: "list"
});
