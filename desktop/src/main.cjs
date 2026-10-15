// OpenSEO desktop shell.
//
// Runs the same single-user stack as the Docker image (AUTH_MODE=local_noauth,
// workerd via `wrangler dev`, D1/KV/R2/Durable Objects persisted on disk, the
// five-minute loopback cron) and shows it in a native window. All data lives
// under %APPDATA%\OpenSEO.
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PREFERRED_PORT = 47321;
const HEALTH_TIMEOUT_MS = 120_000;

const userData = app.getPath("userData");
const settingsFile = path.join(userData, "settings.json");
const stateDir = path.join(userData, "state");
const runtimeRoot = path.join(userData, "runtime");
const logDir = path.join(userData, "logs");

let mainWindow = null;
let setupWindow = null;
let server = null; // { child, port, origin, stopScheduler }
let quitting = false;

// ---------- settings ----------

const SECRET_KEYS = [
  "DATAFORSEO_API_KEY",
  "OPENROUTER_API_KEY",
  "BETTER_AUTH_SECRET",
  "CRAWLER_ACCESS_SECRET",
];

function encrypt(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable())
    return { enc: safeStorage.encryptString(value).toString("base64") };
  return { plain: value };
}

function decrypt(stored) {
  if (!stored) return "";
  if (stored.enc)
    return safeStorage.decryptString(Buffer.from(stored.enc, "base64"));
  return stored.plain ?? "";
}

function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  } catch {
    /* First run. */
  }
  const settings = {
    port: raw.port ?? PREFERRED_PORT,
    telemetryDisabled: raw.telemetryDisabled ?? false,
  };
  for (const key of SECRET_KEYS) settings[key] = decrypt(raw.secrets?.[key]);
  return settings;
}

function saveSettings(settings) {
  const secrets = {};
  for (const key of SECRET_KEYS) secrets[key] = encrypt(settings[key]);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        port: settings.port,
        telemetryDisabled: settings.telemetryDisabled,
        secrets,
      },
      null,
      2,
    ),
  );
}

// Local-only secrets the self-host stack expects; generated once per install.
function ensureGeneratedSecrets(settings) {
  let changed = false;
  for (const key of ["BETTER_AUTH_SECRET", "CRAWLER_ACCESS_SECRET"]) {
    if (!settings[key]) {
      settings[key] = crypto.randomBytes(32).toString("hex");
      changed = true;
    }
  }
  if (changed) saveSettings(settings);
}

// ---------- bundled app ----------

function bundleSource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "openseo")
    : path.join(__dirname, "..", "build", "openseo");
}

// wrangler writes .wrangler/tmp next to each Worker config, and the install
// folder may be read-only, so serve from a per-version copy in user data.
function prepareRuntime() {
  const source = bundleSource();
  const { version, builtAt } = JSON.parse(
    fs.readFileSync(path.join(source, "openseo-bundle.json"), "utf8"),
  );
  const id = `${version}-${builtAt.replace(/[^0-9]/g, "")}`;
  const target = path.join(runtimeRoot, id);
  if (!fs.existsSync(path.join(target, "openseo-bundle.json"))) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  }
  for (const entry of fs.readdirSync(runtimeRoot)) {
    if (entry !== id)
      fs.rmSync(path.join(runtimeRoot, entry), {
        recursive: true,
        force: true,
      });
  }
  return { dir: target, version };
}

// Node arguments for running wrangler's CLI on Electron's bundled Node. Same
// flags as wrangler's bin/wrangler.js launcher, which we skip so there is one
// process fewer to stop.
function wranglerArgs(args) {
  const pkg = require.resolve("wrangler/package.json");
  return [
    "--no-warnings",
    "--experimental-vm-modules",
    "--require",
    path.join(__dirname, "wrangler-shim.cjs"),
    path.join(path.dirname(pkg), "wrangler-dist", "cli.js"),
    ...args,
  ];
}

function wranglerEnv(settings) {
  const env = {
    ...process.env,
    // Run wrangler on Electron's bundled Node.
    ELECTRON_RUN_AS_NODE: "1",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: logDir,
    // Exposes the values below to the Workers' `cloudflare:workers` env.
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    AUTH_MODE: "local_noauth",
    VITE_SHOW_DEVTOOLS: "false",
  };
  for (const key of SECRET_KEYS) if (settings[key]) env[key] = settings[key];
  if (settings.telemetryDisabled) env.OPENSEO_TELEMETRY_DISABLED = "1";
  return env;
}

function logStream(name) {
  fs.mkdirSync(logDir, { recursive: true });
  return fs.createWriteStream(path.join(logDir, name), { flags: "a" });
}

function runToCompletion(args, env, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, wranglerArgs(args), {
      env,
      windowsHide: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`wrangler ${args[0]} exited with code ${code}`)),
    );
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function pickPort(preferred) {
  if (await portIsFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error("The OpenSEO server stopped while starting.");
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      /* Still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The OpenSEO server did not start in time.");
}

async function startServer(settings) {
  const runtime = prepareRuntime();
  const env = wranglerEnv(settings);
  const log = logStream("server.log");
  log.write(
    `\n--- OpenSEO ${runtime.version} starting ${new Date().toISOString()} ---\n`,
  );

  const serverConfig = path.join(runtime.dir, "server", "wrangler.json");
  const auditConfig = path.join(runtime.dir, "open_seo_audit", "wrangler.json");

  await runToCompletion(
    [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      stateDir,
      "-c",
      serverConfig,
    ],
    env,
    log,
  );

  const port = await pickPort(settings.port);
  const child = spawn(
    process.execPath,
    wranglerArgs([
      "dev",
      "-c",
      serverConfig,
      "-c",
      auditConfig,
      "--persist-to",
      stateDir,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--test-scheduled",
      "--show-interactive-dev-session=false",
    ]),
    { env, windowsHide: true },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const origin = `http://127.0.0.1:${port}`;
  server = { child, port, origin, stopScheduler: () => {} };

  child.once("exit", (code) => {
    if (server?.child === child) server = null;
    if (!quitting) {
      dialog.showErrorBox(
        "OpenSEO stopped",
        `The OpenSEO server exited (code ${code}). Details are in ${path.join(logDir, "server.log")}.`,
      );
      app.quit();
    }
  });

  await waitForHealth(origin, child);
  server.stopScheduler = await startScheduler(runtime.dir, port, log);
  return origin;
}

// Same loopback cron the Docker image runs (scripts/selfhost-scheduler.mjs):
// rank tracking, AI visibility schedules, and stale-audit cleanup.
async function startScheduler(runtimeDir, port, log) {
  const { runSelfhostScheduler } = await import(
    pathToFileURL(path.join(runtimeDir, "selfhost-scheduler.mjs")).href
  );
  const controller = new AbortController();
  runSelfhostScheduler({
    port,
    signal: controller.signal,
    log: (message) => log.write(`${message}\n`),
  }).catch((error) => log.write(`[scheduler] ${error?.message ?? error}\n`));
  return () => controller.abort();
}

function stopServer() {
  if (!server) return;
  const { child, stopScheduler } = server;
  server = null;
  stopScheduler();
  if (child.exitCode !== null) return;
  // wrangler runs workerd as a grandchild; kill the whole tree on Windows.
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  else child.kill("SIGTERM");
}

// ---------- windows ----------

const iconPath = () =>
  path.join(bundleSource(), "client", "android-chrome-512x512.png");

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "OpenSEO",
    icon: iconPath(),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mainWindow.loadFile(path.join(__dirname, "loading.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Keep OpenSEO in the window; send everything else to the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!server || !url.startsWith(server.origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (server && !url.startsWith(server.origin) && !url.startsWith("file:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function openSetupWindow({ firstRun }) {
  if (setupWindow) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    width: 560,
    height: 540,
    resizable: false,
    title: "OpenSEO Settings",
    icon: iconPath(),
    parent: firstRun ? undefined : (mainWindow ?? undefined),
    modal: !firstRun && Boolean(mainWindow),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  setupWindow.loadFile(path.join(__dirname, "setup.html"), {
    query: { firstRun: firstRun ? "1" : "0" },
  });
  setupWindow.on("closed", () => {
    setupWindow = null;
    if (firstRun && !loadSettings().DATAFORSEO_API_KEY && !mainWindow)
      app.quit();
  });
}

async function launch() {
  const settings = loadSettings();
  if (!settings.DATAFORSEO_API_KEY) return openSetupWindow({ firstRun: true });
  ensureGeneratedSecrets(settings);
  if (!mainWindow) createMainWindow();
  try {
    const origin = await startServer(settings);
    mainWindow?.loadURL(origin);
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      "OpenSEO could not start",
      `${error.message}\n\nDetails are in ${path.join(logDir, "server.log")}.`,
    );
    quitting = true;
    stopServer();
    app.quit();
  }
}

async function restart() {
  stopServer();
  mainWindow?.loadFile(path.join(__dirname, "loading.html"));
  await launch();
}

function buildMenu() {
  const template = [
    {
      label: "&File",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => openSetupWindow({ firstRun: false }),
        },
        { label: "Open Data Folder", click: () => shell.openPath(userData) },
        { label: "Open Logs Folder", click: () => shell.openPath(logDir) },
        { type: "separator" },
        { label: "Restart Server", click: () => restart() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        {
          label: "OpenSEO Documentation",
          click: () => shell.openExternal("https://openseo.so/docs"),
        },
        {
          label: "Get a DataForSEO API Key",
          click: () =>
            shell.openExternal("https://app.dataforseo.com/api-access"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC from the settings window ----------

ipcMain.handle("settings:get", () => {
  const settings = loadSettings();
  return {
    hasDataforseoKey: Boolean(settings.DATAFORSEO_API_KEY),
    hasOpenrouterKey: Boolean(settings.OPENROUTER_API_KEY),
    telemetryDisabled: settings.telemetryDisabled,
    dataDir: userData,
  };
});

ipcMain.handle("settings:save", async (_event, input) => {
  const settings = loadSettings();
  const dataforseo = String(input?.dataforseoKey ?? "").trim();
  const openrouter = String(input?.openrouterKey ?? "").trim();
  if (dataforseo) settings.DATAFORSEO_API_KEY = dataforseo;
  if (openrouter) settings.OPENROUTER_API_KEY = openrouter;
  settings.telemetryDisabled = Boolean(input?.telemetryDisabled);
  if (!settings.DATAFORSEO_API_KEY)
    return { ok: false, error: "A DataForSEO API key is required." };
  saveSettings(settings);

  // Start (which opens the main window) before closing the settings window,
  // so closing it never leaves zero windows and quits the app.
  const started = server ? restart() : mainWindow ? null : launch();
  setupWindow?.close();
  await started;
  return { ok: true };
});

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow ?? setupWindow;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    buildMenu();
    launch();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  app.on("window-all-closed", () => app.quit());
}
