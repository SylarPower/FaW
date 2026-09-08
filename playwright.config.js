const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/gym",
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:8080",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: process.env.CHROMIUM_PATH
          ? {
              executablePath: process.env.CHROMIUM_PATH,
              args: ["--no-sandbox"],
            }
          : {},
      },
    },
    {
      name: "webkit",
      use: { browserName: "webkit", isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "python3 -m http.server 8080 --bind 0.0.0.0",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
  },
  reporter: "list",
});
