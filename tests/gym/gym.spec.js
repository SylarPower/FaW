const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("node:fs");
const catalog = JSON.parse(fs.readFileSync("exercises.json", "utf8"));
const ex = (i, extra = {}) => ({
  uid: "ex" + i,
  exerciseId: catalog[i].id,
  name: catalog[i].name,
  rest: 60,
  tempo: "2-0-1",
  note: "Controlla la discesa.",
  sd: [
    { r: 10, w: 20, done: false },
    { r: 10, w: 20, done: false },
  ],
  ...extra,
});
const fixture = () => ({
  days: [
    { id: "push", name: "Upper · Forza e controllo", exs: [ex(0), ex(1)] },
    { id: "legs", name: "Lower body", exs: [ex(2)] },
  ],
  hist: [],
  st: { tw: 0, ts: 0, te: 0, pr: {}, sk: 0, lwd: null },
});
async function boot(page, options = {}) {
  const data = options.data || fixture();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(
    ({ data, offline, cached, empty }) => {
      localStorage.setItem("mioNome", "UI-Test");
      if (cached && !localStorage.getItem("gym-data-v2:UI-Test"))
        localStorage.setItem(
          "gym-data-v2:UI-Test",
          JSON.stringify({
            data,
            pending: false,
            baseline: JSON.stringify(data),
          }),
        );
      window.__cloud = JSON.parse(JSON.stringify(data));
      window.__writes = [];
      window.__offline = offline;
      window.firebase = {
        initializeApp() {},
        firestore() {
          return {
            collection() {
              return {
                doc() {
                  return {
                    async get() {
                      if (window.__offline) throw new Error("offline");
                      return {
                        exists: !empty,
                        data: () => JSON.parse(JSON.stringify(window.__cloud)),
                      };
                    },
                    async set(value) {
                      if (window.__offline) throw new Error("offline");
                      window.__cloud = JSON.parse(JSON.stringify(value));
                      window.__writes.push(value);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    {
      data,
      offline: !!options.offline,
      cached: !!options.cached,
      empty: !!options.empty,
    },
  );
  await page.route(
    /https:\/\/(www\.gstatic\.com|cdn\.jsdelivr\.net)\//,
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.goto("/games/palestra/index.html");
  if (!options.expectError) await expect(page.locator("#vHome")).toBeVisible();
  return errors;
}
async function start(page) {
  await page.locator("#heroStart").click();
  await page.locator("#dayStartBtn").click();
  await expect(page.locator("#vSession")).toBeVisible();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("home, scheda, focus mobile e temi senza overflow o media", async ({
  page,
}) => {
  const errors = await boot(page);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await page.locator("#heroStart").click();
    await noOverflow(page);
    await page.locator("#dayStartBtn").click();
    await noOverflow(page);
    const button = page.locator("#sesCheckBtn");
    await button.scrollIntoViewIfNeeded();
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await page.locator(".ses-exit").click();
    await page.locator(".back-link").click();
  }
  await page.locator("#thBtn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await noOverflow(page);
  expect(
    await page.locator("video, .media-box, .exo-video-popup").count(),
  ).toBe(0);
  await page.screenshot({
    path: "test-results/home-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("sessione completa: conteggi corretti e nessun doppio salvataggio", async ({
  page,
}) => {
  const errors = await boot(page);
  await start(page);
  await page.locator("#sesTimerToggle").click();
  for (let i = 0; i < 4; i++) await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesSummary")).toBeVisible();
  await expect(page.locator("#sesSumGrid")).toContainText("4");
  expect(
    await page.evaluate(() => ({
      total: D.st.tw,
      sets: D.st.ts,
      hist: D.hist.length,
    })),
  ).toEqual({ total: 1, sets: 4, hist: 2 });
  await page.evaluate(() => sesShowSummary());
  expect(await page.evaluate(() => D.st.tw)).toBe(1);
  expect(errors).toEqual([]);
});
test("chiusura parziale: riepilogo e cronologia solo serie realmente fatte", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesCheckBtn").click();
  await page.locator(".ses-nav-end").click();
  await expect(page.locator("#sesSummary")).toBeVisible();
  expect(
    await page.evaluate(() => ({
      sets: D.st.ts,
      exs: D.st.te,
      historySets: D.hist[0].sd.length,
    })),
  ).toEqual({ sets: 1, exs: 1, historySets: 1 });
  await expect(page.locator("#sesSumGrid .ses-sum-val").nth(2)).toHaveText("1");
});
test("serie selezionata, modifica completata e navigazione non contaminano altri esercizi", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesSetDots button").nth(1).click();
  await page.locator("#sesKg").fill("42.5");
  await page.locator("#sesCheckBtn").click();
  expect(
    await page.evaluate(() => D.days[0].exs[0].sd.map((s) => [s.done, s.w])),
  ).toEqual([
    [false, 20],
    [true, 42.5],
  ]);
  await page.locator("#sesSetDots button").nth(1).click();
  await page.locator("#sesKg").fill("45");
  await page.locator("#sesCheckBtn").click();
  expect(await page.evaluate(() => D.days[0].exs[0].sd[1].w)).toBe(45);
  await page.locator("#sesSetDots button").nth(1).click();
  await page.locator("#sesBtnNext").click();
  await page.locator("#sesKg").fill("25");
  await page.locator("#sesCheckBtn").click();
  expect(
    await page.evaluate(() => D.days[0].exs[1].sd.map((s) => s.done)),
  ).toEqual([true, false]);
});
test("dati invalidi bloccati; corpo libero a 0 kg consentito", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  await page.locator("#sesReps").fill("0");
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesReps")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(await page.evaluate(() => D.days[0].exs[0].sd[0].done)).toBe(false);
  await page.locator("#sesReps").fill("10");
  await page.locator("#sesKg").fill("0");
  await page.locator("#sesCheckBtn").click();
  expect(await page.evaluate(() => D.days[0].exs[0].sd[0])).toMatchObject({
    done: true,
    w: 0,
  });
});
test("timer minimizzato, scadenza assoluta, uscita e cronometro", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesTimer")).toBeVisible();
  await page.getByRole("button", { name: "Minimizza" }).click();
  await expect(page.locator("#sesTimerMini")).toBeVisible();
  await page.evaluate(() => {
    restEndTime = Date.now() - 1000;
  });
  await expect(page.locator("#sesTimerMini")).toBeHidden();
  await page.locator("#sesSwBtn").click();
  await page.locator(".ses-exit").click();
  await expect(page.locator("#sesTimer")).toBeHidden();
  await expect(page.locator("#sesTimerMini")).toBeHidden();
  expect(await page.evaluate(() => swRunning)).toBe(false);
});
test("reload con rete assente riprende serie, carichi e orario sessione", async ({
  page,
}) => {
  await boot(page, { cached: true, offline: true });
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesCheckBtn").click();
  await page.locator("#sesKg").fill("37.5");
  const started = await page.evaluate(() => sesStartTime);
  await page.reload();
  await expect(page.locator("#heroStart")).toContainText("Riprendi");
  await page.locator("#heroStart").click();
  await expect(page.locator("#sesKg")).toHaveValue("37.5");
  expect(await page.evaluate(() => sesStartTime)).toBe(started);
  await expect(page.locator("#saveStatus")).toContainText("dispositivo");
});
test("errore iniziale senza cache non crea o sovrascrive la scheda", async ({
  page,
}) => {
  await boot(page, { offline: true, expectError: true });
  await expect(page.locator("#vLoad")).toContainText(
    "I dati esistenti non sono stati modificati",
  );
  expect(await page.evaluate(() => window.__writes.length)).toBe(0);
  await expect(page.locator("#vHome")).toBeHidden();
});
test("riconnessione sincronizza le modifiche locali", async ({ page }) => {
  await boot(page, { cached: true, offline: true });
  await start(page);
  await page.locator("#sesKg").fill("33.5");
  await page.evaluate(async () => {
    window.__offline = false;
    await retrySync();
  });
  await expect(page.locator("#saveStatus")).toHaveText("Sincronizzato");
  expect(await page.evaluate(() => window.__cloud.days[0].exs[0].sd[0].w)).toBe(
    33.5,
  );
});
test("conflitto cloud non sovrascrive silenziosamente", async ({ page }) => {
  await boot(page, { cached: true, offline: true });
  await start(page);
  await page.locator("#sesKg").fill("31");
  await page.evaluate(async () => {
    window.__offline = false;
    window.__cloud.days[0].name = "Modificata altrove";
    await retrySync();
  });
  await expect(page.locator("#saveStatus")).toContainText("Dati diversi");
  expect(await page.evaluate(() => window.__writes.length)).toBe(0);
});
test("superserie alterna senza recupero tra gli esercizi dello stesso giro", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs.forEach((e) => (e.ssG = "ss1"));
  await boot(page, { data });
  await start(page);
  await page.locator("#sesCheckBtn").click();
  expect(await page.evaluate(() => sesExIdx)).toBe(1);
  await expect(page.locator("#sesTimer")).toBeHidden();
  await page.locator("#sesCheckBtn").click();
  expect(await page.evaluate(() => sesExIdx)).toBe(0);
  await expect(page.locator("#sesTimer")).toBeVisible();
});
test("scheda vuota, nome ostile trattato come testo, editor a 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const data = fixture();
  data.days[0].name = "<img src=x onerror=alert(1)>";
  data.days[1].exs = [];
  const errors = await boot(page, { data });
  await expect(page.locator("#todayHero img")).toHaveCount(0);
  await page.locator("#heroStart").click();
  await page.locator("#editDayBtn").click();
  await page.locator(".ex-header").first().click();
  await noOverflow(page);
  await page.locator(".back-link").click();
  await page.locator("#quickDays button").nth(1).click();
  await expect(page.locator("#dayStartBtn")).toBeDisabled();
  await expect(
    page
      .getByRole("button", { name: "+ Aggiungi esercizio", exact: true })
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("selettore esercizi e bottom sheet: ricerca, aggiunta, focus ed Escape", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#heroStart").click();
  await page.locator("#editDayBtn").click();
  await page.locator("#dayEditor > button").click();
  await expect(page.locator("#mSel")).toHaveAttribute("role", "dialog");
  await page.locator("#exQ").fill("zzzzinesistente");
  await expect(page.locator("#exR")).toContainText("Nessun risultato");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mSel")).toBeHidden();
  await expect(page.locator("#dayEditor > button")).toBeFocused();
});
test("accessibilità WCAG: home, scheda, focus in tema scuro e chiaro", async ({
  page,
}) => {
  await boot(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const view of ["home", "day", "session"]) {
      if (view === "day") await page.locator("#heroStart").click();
      if (view === "session") await page.locator("#dayStartBtn").click();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
    await page.locator(".ses-exit").click();
    await page.locator(".back-link").click();
  }
});

test("onboarding vuoto, creazione e aggiunta esercizio da ricerca", async ({
  page,
}) => {
  await boot(page, { data: { days: [], hist: [], st: {} } });
  await page.getByRole("button", { name: "Crea la prima scheda" }).click();
  await page.locator("#iDay").fill("Push");
  await page.locator("#homePlan .input-action button").first().click();
  await page.locator("#dList .quick-day").click();
  await page.locator("#dayOutline .bp").click();
  await page.locator("#exR button").first().click();
  await expect(page.locator("#dayStartBtn")).toBeEnabled();
  expect(await page.evaluate(() => D.days[0].exs.length)).toBe(1);
});
test("importa senza HTML attivo, limita serie e preserva lo storico", async ({
  page,
}) => {
  await boot(page);
  const text =
    "GIORNO\tN\tESERCIZIO\tID_ES\tSERIE\tREP\tRECUPERO\tCARICO\tTEMPO\tRPE\tNOTE\n<img src=x onerror=alert(1)>\t1\tPanca\tpanca\t3\t10\t90s\t22,5 kg\t2-0-1\t7\tControllo";
  await page.evaluate(() => openImport());
  await page.locator("#impText").fill(text);
  await page.evaluate(() => previewImport());
  await expect(page.locator("#impPreview img")).toHaveCount(0);
  await page.evaluate(() => doImport());
  expect(await page.evaluate(() => D.days.at(-1).exs[0].sd[0].w)).toBe(22.5);
  expect(
    await page.evaluate(() => {
      try {
        parseImport("A;1;Squat;squat;9999999;10");
        return false;
      } catch (_) {
        return true;
      }
    }),
  ).toBe(true);
});
test("esporta la scheda in testo e gestisce Chart.js non disponibile", async ({
  page,
}) => {
  const errors = await boot(page);
  await page.locator("#heroStart").click();
  await page.evaluate(() => exportDay());
  await expect(page.locator("#expText")).toHaveValue(/GIORNO/);
  const exported = await page.locator("#expText").inputValue();
  expect(exported).toContain("Upper · Forza e controllo");
  expect(
    await page.evaluate((text) => parseImport(text)[0].exs.length, exported),
  ).toBe(2);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    D.hist = [
      { eid: "panca", dt: "2026-09-01", w: 20, s: 3, r: 10 },
      { eid: "panca", dt: "2026-09-02", w: 25, s: 3, r: 10 },
    ];
    return showProgression("panca", "Panca");
  });
  await expect(page.locator("#toast")).toContainText("Grafico non disponibile");
  await expect(page.locator("#mProg")).toBeHidden();
  expect(errors).toEqual([]);
});
test("tocco doppio su conferma registra una sola serie", async ({ page }) => {
  await boot(page);
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.evaluate(() => {
    sesCheck();
    sesCheck();
  });
  expect(
    await page.evaluate(() => D.days[0].exs[0].sd.filter((s) => s.done).length),
  ).toBe(1);
});
test("tastiera ridotta e orientamento orizzontale mantengono navigazione e conferma raggiungibili", async ({
  page,
}) => {
  const errors = await boot(page);
  await start(page);
  for (const viewport of [
    { width: 320, height: 480 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    await page.locator("#sesCheckBtn").scrollIntoViewIfNeeded();
    const c = await page.locator("#sesCheckBtn").boundingBox(),
      n = await page.locator(".ses-nav").boundingBox();
    expect(c.y + c.height).toBeLessThanOrEqual(n.y + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/focus-dark.png" });
  expect(errors).toEqual([]);
});
test("accessibilità: Schede, Progressi, editor e importazione", async ({
  page,
}) => {
  await boot(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const state of ["plan", "progress", "editor", "import"]) {
      if (state === "plan" || state === "progress")
        await page.evaluate((tab) => showGymTab(tab), state);
      if (state === "editor") {
        await page.evaluate(() => goDay("push"));
        await page.locator("#editDayBtn").click();
        if (
          (await page
            .locator(".ex-header")
            .first()
            .getAttribute("aria-expanded")) !== "true"
        )
          await page.locator(".ex-header").first().click();
      }
      if (state === "import") await page.evaluate(() => openImport());
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
    await page.keyboard.press("Escape");
  }
});
test("export/import conserva ripetizioni, carichi diversi tra le serie", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(() => {
    D.days[0].exs[0].sd = [
      { r: 12, w: 20, done: false },
      { r: 10, w: 22.5, done: false },
      { r: 8, w: 25, done: false },
    ];
    return parseImport(CSV_HEADER + "\n" + exportDayToText(D.days[0]))[0].exs[0]
      .sd;
  });
  expect(result).toEqual([
    { r: 12, w: 20, done: false },
    { r: 10, w: 22.5, done: false },
    { r: 8, w: 25, done: false },
  ]);
});
test("cache disponibile anche se gli SDK Firebase non vengono caricati", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "firebase", {
      value: undefined,
      writable: false,
    }),
  );
  await boot(page, { cached: true });
  await start(page);
  await expect(page.locator("#sesExName")).not.toHaveText("—");
  await page.locator("#sesKg").fill("27.5");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("gym-data-v2:UI-Test")).data.days[0]
          .exs[0].sd[0].w,
    ),
  ).toBe(27.5);
});
test("memoria piena e cloud assente mostrano un errore, non un falso successo", async ({
  page,
}) => {
  await boot(page, { cached: true, offline: true });
  await start(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.locator("#sesKg").fill("30");
  await expect(page.locator("#sessionSaveStatus")).toContainText(
    "Non chiudere la pagina",
  );
  expect(await page.evaluate(() => storageOK)).toBe(false);
});
test("salvataggi cloud serializzati conservano anche modifiche durante una richiesta", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    window.__resolveWrite = null;
    cloudDoc = () => ({
      set: (snapshot) =>
        new Promise((resolve) => {
          window.__resolveWrite = () => {
            window.__cloud = snapshot;
            resolve();
          };
        }),
    });
    D.days[0].name = "Prima modifica";
    save();
    D.days[0].name = "Ultima modifica";
    save();
  });
  await page.evaluate(async () => {
    window.__resolveWrite();
    await new Promise((r) => setTimeout(r, 0));
  });
  await page.evaluate(async () => {
    window.__resolveWrite();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(await page.evaluate(() => window.__cloud.days[0].name)).toBe(
    "Ultima modifica",
  );
  await expect(page.locator("#saveStatus")).toHaveText("Sincronizzato");
});
test("touch target dei comandi di sessione e preferenza movimento ridotto", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  await start(page);
  const sizes = await page
    .locator(".ses-adj-btn, .ses-dot, .ses-exit, .ses-timer-toggle")
    .evaluateAll((els) =>
      els.map((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
    );
  sizes.forEach((size) => {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  });
  expect(
    await page
      .locator(".ses-check-btn")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

const dumbbell = catalog.find((item) => item.eq === "Manubri");
test("manubri: +/-2 kg, etichette dinamiche e ritorno a 2,5 kg per il bilanciere", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[0] = ex(0, { exerciseId: dumbbell.id, name: dumbbell.name });
  await boot(page, { data });
  await start(page);
  await expect(page.locator("#sesWeightStep")).toHaveText(
    "Manubri · passi di 2 kg",
  );
  await page
    .getByRole("button", { name: "Aumenta carico di 2 kg", exact: true })
    .click();
  await expect(page.locator("#sesKg")).toHaveValue("22");
  await page
    .getByRole("button", { name: "Riduci carico di 2 kg", exact: true })
    .click();
  await expect(page.locator("#sesKg")).toHaveValue("20");
  await page.locator("#sesKg").fill("20.25");
  await page
    .getByRole("button", { name: "Aumenta carico di 2 kg", exact: true })
    .click();
  await expect(page.locator("#sesKg")).toHaveValue("22.25");
  await page.locator("#sesKg").fill("1");
  await page
    .getByRole("button", { name: "Riduci carico di 2 kg", exact: true })
    .click();
  await expect(page.locator("#sesKg")).toHaveValue("0");
  await page.evaluate(() => {
    gD().exs[1].exerciseId = "panca_piana";
    gD().exs[1].name = "Panca con bilanciere";
  });
  await page.locator("#sesBtnNext").click();
  await expect(page.locator("#sesWeightStep")).toHaveText(
    "Carico · passi di 2,5 kg",
  );
  await page
    .getByRole("button", { name: "Aumenta carico di 2,5 kg", exact: true })
    .click();
  await expect(page.locator("#sesKg")).toHaveValue("22.5");
});
test("incremento manubri coerente anche per schede importate, progressioni e valori precedenti", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#heroStart").click();
  const result = await page.evaluate(() => {
    const exercise = gD().exs[0];
    exercise.exerciseId = "custom_press_manubri";
    exercise.name = "Press con manubri";
    openProgManager(exercise.uid);
    const copy = document.getElementById("pmWeightDescription").textContent;
    applyProgType("weight");
    D.hist.push({
      eid: exercise.exerciseId,
      dayId: curDay,
      name: exercise.name,
      dt: "2026-09-01T10:00:00Z",
      sd: [{ r: 10, w: 20.25 }],
    });
    const previous = buildPreviousSetHTML(curDay, exercise, 0);
    return {
      weight: exercise.sd[0].w,
      step: getWeightStep(exercise),
      copy,
      previous,
    };
  });
  expect(result).toMatchObject({ weight: 22, step: 2 });
  expect(result.copy).toContain("di 2 kg");
  expect(result.previous).toContain("20,25");
  expect(result.previous).toContain("Usa questi valori");
});
test("percentuale sulle serie, non sugli esercizi, visibile anche a 320px", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[1].sd = [
    ...data.days[0].exs[1].sd,
    ...data.days[0].exs[1].sd,
  ];
  await page.setViewportSize({ width: 320, height: 740 });
  await boot(page, { data });
  await start(page);
  await expect(page.locator("#sesExCount")).toBeVisible();
  await expect(page.locator("#sesExCount")).toHaveText("0%");
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesExCount")).toHaveText("17%");
  await expect(page.locator("#sessionProgress")).toHaveAttribute(
    "aria-valuenow",
    "17",
  );
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesExCount")).toHaveText("33%");
  await page.locator("#sesBtnPrev").click();
  await expect(page.locator("#sesExCount")).toHaveText("33%");
  await page.locator(".ses-nav-end").click();
  await expect(page.locator("#sesExCount")).toHaveText("33%");
  expect(await page.evaluate(() => getSetProgress(199, 200))).toBe(99);
  expect(await page.evaluate(() => getSetProgress(200, 200))).toBe(100);
  expect(await page.evaluate(() => getSetProgress(0, 0))).toBe(0);
});
test("report finale: volume prima del reset, conteggio esatto, storico e finalizzazione unica", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[0] = ex(0, { exerciseId: dumbbell.id, name: dumbbell.name });
  await boot(page, { data });
  await start(page);
  await page.locator("#sesTimerToggle").click();
  for (let i = 0; i < 4; i++) await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesVolumeValue")).toHaveText("800"); // 4 × 10 × 20, no hidden doubling.
  await expect(page.locator("#sesExCount")).toHaveText("100%");
  await expect(page.locator(".cargo-equivalence")).toContainText(
    "1 orso polare immaginario",
  );
  expect(
    await page.evaluate(() => D.hist.reduce((sum, h) => sum + h.volumeKg, 0)),
  ).toBe(800);
  expect(
    await page.evaluate(() =>
      D.days[0].exs.every((e) => e.sd.every((s) => !s.done)),
    ),
  ).toBe(true);
  await page.evaluate(() => sesShowSummary());
  await expect(page.locator("#sesVolumeValue")).toHaveText("800");
  expect(await page.evaluate(() => D.st.tw)).toBe(1);
  await page.locator("#sesSummary > button").click();
  await page.evaluate(() => showGymTab("progress"));
  await expect(page.locator("#recentSessions")).toContainText(
    "800 kg di volume",
  );
});
test("report parziale non include serie ancora da fare o valori negativi", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[0].sd[0] = { r: 12, w: 22.5, done: false };
  data.days[0].exs[0].sd[1].w = 9000;
  await boot(page, { data });
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesCheckBtn").click();
  await page.locator(".ses-nav-end").click();
  await expect(page.locator("#sesVolumeValue")).toHaveText("270");
  await expect(page.locator(".cargo-stamp")).toHaveText("SESSIONE PARZIALE");
  await expect(page.locator("#sesSumGrid")).toContainText("25%");
  expect(
    await page.evaluate(() => [
      getSetVolume({ r: -2, w: 10 }),
      getSetVolume({ r: 10, w: Infinity }),
      getSetVolume({ r: 10, w: 0 }),
    ]),
  ).toEqual([0, 0, 0]);
});
test("corpo libero e carichi minimi: niente equivalenze inventate", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs = [ex(0, { sd: [{ r: 15, w: 0, done: false }] })];
  await boot(page, { data });
  await start(page);
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesVolumeValue")).toHaveText("0");
  await expect(page.locator(".cargo-story")).toContainText(
    "Non tutto si misura in chili.",
  );
  await expect(page.locator(".cargo-story")).toContainText("15 ripetizioni");
  await expect(page.locator(".cargo-equivalence")).toHaveCount(0);
  expect(
    await page.evaluate(() => [
      getImpossibleCargo(0),
      getImpossibleCargo(19.99),
      getImpossibleCargo(NaN),
    ]),
  ).toEqual([null, null, null]);
  expect(await page.evaluate(() => getImpossibleCargo(7000).id)).toBe(
    "dinosaur",
  );
  expect(await page.evaluate(() => getImpossibleCargo(7000).count)).toBe(1);
  expect(await page.evaluate(() => getImpossibleCargo(6999).id)).toBe(
    "elephant",
  );
});
async function assertAlignedSession(page) {
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    };
    return {
      top: [
        ".ses-exit",
        ".ses-progress-wrap",
        "#sesExCount",
        "#sesTimerToggle",
      ].map(rect),
      fields: ["#sesReps", "#sesKg"].map(rect),
      buttons: [...document.querySelectorAll(".ses-adj-btn")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
      labels: [...document.querySelectorAll(".ses-input-group label")].map(
        (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect(),
            box = el.getBoundingClientRect();
          return {
            center: r.x + r.width / 2,
            container: box.x + box.width / 2,
            overflow: el.scrollWidth > el.clientWidth,
          };
        },
      ),
    };
  });
  for (let i = 1; i < geometry.top.length; i++)
    expect(geometry.top[i - 1].right).toBeLessThanOrEqual(
      geometry.top[i].x + 1,
    );
  for (const field of geometry.fields) {
    expect(Math.abs(field.y - geometry.fields[0].y)).toBeLessThan(1);
    expect(Math.abs(field.h - geometry.fields[0].h)).toBeLessThan(1);
  }
  for (const button of geometry.buttons) {
    expect(button.w).toBeGreaterThanOrEqual(44);
    expect(button.h).toBeGreaterThanOrEqual(44);
  }
  for (const label of geometry.labels) {
    expect(Math.abs(label.center - label.container)).toBeLessThan(1);
    expect(label.overflow).toBe(false);
  }
  await noOverflow(page);
}
test("allineamenti geometrici: intestazione, etichette, input e controlli su quattro larghezze", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[0].exerciseId = dumbbell.id;
  data.days[0].exs[0].name =
    "Distensioni con manubri su panca inclinata · controllo e pausa";
  await boot(page, { data });
  await start(page);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await assertAlignedSession(page);
    await page.locator("#sesCheckBtn").scrollIntoViewIfNeeded();
    const c = await page.locator("#sesCheckBtn").boundingBox(),
      n = await page.locator(".ses-nav").boundingBox();
    expect(c.y + c.height).toBeLessThanOrEqual(n.y + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#sesExName").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/session-refined.png" });
});
test("report: accessibilità, leggibilità e nessuna sovrapposizione nei due temi", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  await page.evaluate(() => {
    gD().exs.forEach((e) =>
      e.sd.forEach((s) => {
        s.done = true;
        s.r = 10;
        s.w = 200;
      }),
    );
    sesShowSummary();
  });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      await page.locator("#sesSummary > button").scrollIntoViewIfNeeded();
      expect(await page.locator("#sesSummary > button").isVisible()).toBe(true);
      const collision = await page.evaluate(() => {
        const volume = document
            .getElementById("sesVolumeReport")
            .getBoundingClientRect(),
          grid = document.getElementById("sesSumGrid").getBoundingClientRect();
        return volume.bottom > grid.top;
      });
      expect(collision).toBe(false);
    }
    await page.locator(".volume-method summary").click();
    await expect(page.locator(".volume-method")).toContainText(
      "non raddoppiamo",
    );
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.locator(".volume-method summary").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () => (document.getElementById("sesSummary").scrollTop = 0),
    );
    await page.screenshot({ path: `test-results/report-${theme}.png` });
  }
});
test("completare serie fuori ordine non sovrascrive il carico dell’ultima serie nel report", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs = [
    ex(0, {
      sd: [
        { r: 5, w: 10, done: false },
        { r: 8, w: 50, done: false },
      ],
    }),
  ];
  await boot(page, { data });
  await start(page);
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesSetDots button").nth(1).click();
  await page.locator("#sesCheckBtn").click();
  await page.locator("#sesCheckBtn").click();
  await expect(page.locator("#sesVolumeValue")).toHaveText("450");
  expect(
    await page.evaluate(() => D.hist[0].sd.map((s) => [s.r, s.w])),
  ).toEqual([
    [5, 10],
    [8, 50],
  ]);
  await expect(page.locator("#sesSummaryTitle")).toBeFocused();
});
test("testo al 200% e nomi lunghi non fanno sovrapporre campi e pulsanti", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await boot(page);
  await start(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await assertAlignedSession(page);
  await page.locator("#sesCheckBtn").scrollIntoViewIfNeeded();
  const button = await page.locator("#sesCheckBtn").boundingBox(),
    nav = await page.locator(".ses-nav").boundingBox();
  expect(button.y + button.height).toBeLessThanOrEqual(nav.y + 1);
  await page.evaluate(() => {
    gD().exs.forEach((e) => e.sd.forEach((s) => (s.done = true)));
    sesShowSummary();
  });
  await noOverflow(page);
  await page.locator("#sesSummary > button").scrollIntoViewIfNeeded();
});
test("report con numeri grandi, nomi lunghi e zero serie non causa overflow né log fittizi", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await boot(page);
  await start(page);
  await page.evaluate(() => sesShowSummary());
  await expect(page.locator("#sesSummary")).toBeHidden();
  expect(await page.evaluate(() => D.hist.length)).toBe(0);
  await page.evaluate(() => {
    document.getElementById("sesExCard").style.display = "none";
    document.querySelector(".ses-nav").style.display = "none";
    renderWorkoutReport({
      dayName: "A".repeat(180),
      sets: 100000,
      done: 100000,
      exercises: 1000,
      reps: 99900000,
      volume: 999800010000,
      percent: 100,
      seconds: 360000,
    });
  });
  await noOverflow(page);
  const wide = await page
    .locator("#sesVolumeReport")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(wide).toBe(false);
  await page.locator("#sesSummary > button").scrollIntoViewIfNeeded();
});

test("RPE rimosso da sessione, editor, guida, stato e nuovi salvataggi", async ({
  page,
}) => {
  const data = fixture();
  data.days[0].exs[0].sd[0].rpe = 9;
  data.hist = [
    {
      eid: data.days[0].exs[0].exerciseId,
      dayId: "push",
      dt: "2026-09-01T10:00:00Z",
      s: 1,
      rpe: 8,
      sd: [{ r: 10, w: 20, rpe: 8 }],
    },
  ];
  await boot(page, { data });
  expect(await page.evaluate(() => JSON.stringify(D).includes('"rpe"'))).toBe(
    false,
  );
  await page.locator("#heroStart").click();
  await page.locator("#editDayBtn").click();
  await page.locator(".ex-header").first().click();
  await expect(
    page.locator("#eList .set-row").first().locator("input"),
  ).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(/\bRPE\b/);
  await page.locator("#dayStartBtn").click();
  await expect(page.locator(".ses-input-group")).toHaveCount(2);
  await expect(page.locator("#sesRpe, .rpe-input")).toHaveCount(0);
  await expect(page.locator("#sesPreviousSet")).toContainText("Ultima volta");
  expect(await page.evaluate(() => typeof generateSuggestion)).toBe(
    "undefined",
  );
  await page.locator("#sesTimerToggle").click();
  await page.locator("#sesCheckBtn").click();
  await page.locator(".ses-nav-end").click();
  expect(
    await page.evaluate(() => JSON.stringify(D.hist).includes('"rpe"')),
  ).toBe(false);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("gym-data-v2:UI-Test")).data.days[0]
          .exs[0].sd[0].rpe,
    ),
  ).toBeUndefined();
});
test("import nuovo e legacy conservano le note e ignorano il campo ritirato", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const header =
      "GIORNO\tN\tESERCIZIO\tID_ES\tSERIE\tREP\tRECUPERO\tCARICO\tTEMPO";
    const base = "Push\t1\tPanca\tpanca\t2\t10\t60\t20/22\t2-0-1";
    const rows = [
      header + "\tNOTE\n" + base + "\tNon perdere questa nota",
      header +
        "\tRPE\tNOTE\n" +
        base +
        "\t99/non-usato\tNon perdere questa nota",
      base + "\t9\tNon perdere questa nota",
      header + "\tRPE\tNOTE\n" + base + "\t8\t",
    ].map((text) => parseImport(text)[0].exs[0]);
    return {
      rows,
      exported:
        CSV_HEADER + "\n" + exportDayToText({ name: "Push", exs: [rows[0]] }),
    };
  });
  result.rows.slice(0, 3).forEach((ex) => {
    expect(ex.note).toBe("Non perdere questa nota");
    expect(ex.sd.map((s) => s.w)).toEqual([20, 22]);
    expect(ex.sd[0]).not.toHaveProperty("rpe");
  });
  expect(result.rows[3].note).toBe("");
  expect(result.exported).not.toContain("RPE");
  expect(result.exported.split("\n")[0].split("\t")).toHaveLength(10);
});
test("il volume pianificato non dipende più da punteggi legacy", async ({
  page,
}) => {
  await boot(page);
  const equal = await page.evaluate(() => {
    const first = getMuscleFatigue();
    D.days.forEach((d) =>
      d.exs.forEach((e) => e.sd.forEach((s) => (s.rpe = 1))),
    );
    const second = getMuscleFatigue();
    D.days.forEach((d) =>
      d.exs.forEach((e) => e.sd.forEach((s) => (s.rpe = 10))),
    );
    return (
      JSON.stringify(first) === JSON.stringify(second) &&
      JSON.stringify(first) === JSON.stringify(getMuscleFatigue())
    );
  });
  expect(equal).toBe(true);
});
test("21 livelli: soglie corrette, illustrazioni distinte e nessuna richiesta media", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (req) => requests.push(req.url()));
  await boot(page);
  await start(page);
  const levels = await page.evaluate(() => IMPOSSIBLE_CARGO);
  expect(levels).toHaveLength(21);
  expect(new Set(levels.map((l) => l.id)).size).toBe(21);
  expect(levels.filter((l) => l.kg <= 15000).length).toBeGreaterThanOrEqual(14);
  const arts = [];
  for (const [index, level] of levels.entries()) {
    const result = await page.evaluate(
      ({ volume }) => {
        const cargo = getImpossibleCargo(volume);
        return {
          id: cargo.id,
          level: cargo.level,
          count: cargo.count,
          art: renderCargoArt(cargo.id),
          below: getImpossibleCargo(volume - 0.01)?.id || null,
        };
      },
      { volume: level.kg },
    );
    expect(result.id).toBe(level.id);
    expect(result.level).toBe(index + 1);
    expect(result.count).toBe(1);
    expect(result.below).toBe(index ? levels[index - 1].id : null);
    expect(result.art).not.toContain("undefined");
    arts.push(result.art);
    await page.evaluate(
      (v) =>
        renderWorkoutReport({
          dayName: "Test",
          sets: 2,
          done: 2,
          exercises: 1,
          reps: 20,
          volume: v,
          percent: 100,
          seconds: 600,
        }),
      level.kg,
    );
    await expect(page.locator(".cargo-art-panel")).toHaveAttribute(
      "data-cargo",
      level.id,
    );
    await expect(page.locator(".cargo-art-panel svg")).toHaveCount(1);
    await noOverflow(page);
  }
  expect(new Set(arts).size).toBe(21);
  expect(
    requests.filter((url) =>
      /\.mp4|\.gif|musclewiki|raw\.githubusercontent/.test(url),
    ),
  ).toEqual([]);
});
test("atlante dei carichi: tutti i livelli leggibili e accessibili anche a 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await boot(page);
  await start(page);
  await page.evaluate(() => {
    gD().exs.forEach((e) =>
      e.sd.forEach((s) => {
        s.done = true;
        s.w = 200;
      }),
    );
    sesShowSummary();
  });
  await page.locator(".cargo-collection summary").click();
  await expect(page.locator(".cargo-collection li")).toHaveCount(21);
  await expect(page.locator(".current-cargo")).toContainText("T-rex");
  await noOverflow(page);
  await page.locator(".cargo-collection li").last().scrollIntoViewIfNeeded();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
test("entrambi i campi hanno meno a sinistra e più a destra", async ({
  page,
}) => {
  await boot(page);
  await start(page);
  for (const group of await page.locator(".ses-input-group").all()) {
    const buttons = group.locator("button");
    await expect(buttons.nth(0)).toHaveText("−");
    await expect(buttons.nth(1)).toHaveText("+");
    expect((await buttons.nth(0).boundingBox()).x).toBeLessThan(
      (await buttons.nth(1).boundingBox()).x,
    );
  }
});
