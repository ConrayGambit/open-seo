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
  Notification,
  Tray,
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
const { openTeamSetup, sealTeamSetup } = require("./team-setup.cjs");

const PREFERRED_PORT = 47321;
const HEALTH_TIMEOUT_MS = 120_000;

const userData = app.getPath("userData");
const settingsFile = path.join(userData, "settings.json");
const stateDir = path.join(userData, "state");
const runtimeRoot = path.join(userData, "runtime");
const logDir = path.join(userData, "logs");

let mainWindow = null;
let setupWindow = null;
let tray = null;
let server = null; // { child, port, origin, stopScheduler }
let quitting = false;
// Server processes we stopped on purpose (restart), so their exit is not an error.
const stoppedChildren = new WeakSet();
// Started at Windows sign-in: stay in the tray instead of opening a window.
const startHidden = process.argv.includes("--hidden");

// ---------- settings ----------

// Every value here reaches the Workers as an env var of the same name.
const SECRET_KEYS = [
  "DATAFORSEO_API_KEY",
  "OPENROUTER_API_KEY",
  // Google Search Console + GA4 (docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md)
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  // Context.dev: the site-audit "Render JavaScript" renderer outside Cloudflare
  "CONTEXT_API_KEY",
  "BETTER_AUTH_SECRET",
  "CRAWLER_ACCESS_SECRET",
  // Encrypts WordPress application passwords in the database.
  "WORDPRESS_CREDENTIALS_SECRET",
];

// Models SAM can use through OpenRouter; "" keeps OpenSEO's default (GPT).
const SAM_MODELS = [
  "",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
];

// Optional keys the settings window edits; a blank field keeps the saved value.
const OPTIONAL_KEYS = [
  "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CONTEXT_API_KEY",
];

function encrypt(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable())
    return { enc: safeStorage.encryptString(value).toString("base64") };
  return { plain: value };
}

function decrypt(stored) {
  if (!stored) return "";
  if (!stored.enc) return stored.plain ?? "";
  try {
    return safeStorage.decryptString(Buffer.from(stored.enc, "base64"));
  } catch {
    // Encrypted under another Windows profile (reset, or a copied
    // settings.json): treat it as unset so the settings window asks again.
    return "";
  }
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
    samModel: raw.samModel ?? "",
    keepRunningInTray: raw.keepRunningInTray ?? true,
    openAtLogin: raw.openAtLogin ?? false,
    trayHintShown: raw.trayHintShown ?? false,
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
        samModel: settings.samModel,
        keepRunningInTray: settings.keepRunningInTray,
        openAtLogin: settings.openAtLogin,
        trayHintShown: settings.trayHintShown,
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
  for (const key of [
    "BETTER_AUTH_SECRET",
    "CRAWLER_ACCESS_SECRET",
    "WORDPRESS_CREDENTIALS_SECRET",
  ]) {
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

// The Google client built into this installer, if any (see prepare-app.mjs).
function builtInGoogleClient() {
  const bundle = JSON.parse(
    fs.readFileSync(path.join(bundleSource(), "openseo-bundle.json"), "utf8"),
  );
  return bundle.google ?? null;
}

// The user's own Google client wins; otherwise use the built-in one.
function googleClient(settings) {
  if (settings.GOOGLE_CLIENT_ID && settings.GOOGLE_CLIENT_SECRET)
    return {
      clientId: settings.GOOGLE_CLIENT_ID,
      clientSecret: settings.GOOGLE_CLIENT_SECRET,
    };
  return builtInGoogleClient();
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
    // Tells the app to receive WordPress connections as openseo:// links.
    OPENSEO_DESKTOP: "1",
  };
  for (const key of SECRET_KEYS) if (settings[key]) env[key] = settings[key];
  const google = googleClient(settings);
  if (google) {
    env.GOOGLE_CLIENT_ID = google.clientId;
    env.GOOGLE_CLIENT_SECRET = google.clientSecret;
  }
  if (settings.telemetryDisabled) env.OPENSEO_TELEMETRY_DISABLED = "1";
  if (settings.samModel) env.OPENROUTER_MODEL = settings.samModel;
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

// Resolves null when the port can be used, otherwise the error code:
// EADDRINUSE (another program) or EACCES (reserved by Windows, e.g. Hyper-V).
function portError(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error) => resolve(error.code ?? "unknown"));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(null)));
  });
}

// A hard kill of OpenSEO (installer, Task Manager, crash) can leave the old
// wrangler and workerd processes running and holding the port. Stop the ones
// started from this install so the saved port is free again.
function stopOrphanedServers() {
  if (process.platform !== "win32") return;
  const root = (
    app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, "..")
  ).replaceAll("'", "''");
  const script = `Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith('${root}', 'OrdinalIgnoreCase') -and
    ($_.Name -eq 'workerd.exe' -or $_.CommandLine -like '*wrangler-dist*')
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000 },
  );
}

// Try the nearby ports first: they stay below Windows' dynamic range
// (49152+), which Windows hands out for outgoing connections and reserves.
async function pickPort(preferred) {
  for (let port = preferred; port < preferred + 10 && port <= 65535; port++)
    if (!(await portError(port))) return port;
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

  // Leftovers from a hard kill also hold the database, so clear them first.
  if (await portError(settings.port)) {
    stopOrphanedServers();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

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
  if (port !== settings.port) {
    // Keep the new port from now on, so agent (MCP) connections and Google
    // redirect URIs only need updating once.
    log.write(
      `Port ${settings.port} is unavailable (${await portError(settings.port)}); switching to ${port}.\n`,
    );
    notifyPortChange(settings.port, port);
    settings.port = port;
    saveSettings(settings);
  }
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
    if (!quitting && !stoppedChildren.has(child)) {
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
  serverReady = false;
  if (!server) return;
  const { child, stopScheduler } = server;
  server = null;
  stopScheduler();
  if (child.exitCode !== null) return;
  stoppedChildren.add(child);
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

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Google sign-in finishes in the default browser, so the app window does not
// see the new connection. Reload it when the user comes back for a while after.
const GOOGLE_SIGN_IN_WINDOW_MS = 10 * 60_000;
let googleSignInUntil = 0;

const GOOGLE_SETUP_GUIDE =
  "https://github.com/ConrayGambit/open-seo/blob/main/docs/WINDOWS_DESKTOP.md#google-search-console-and-analytics";

// The in-app "Open setup guide" links describe server env vars; the desktop
// app takes the Google client in Settings instead.
const DESKTOP_GUIDES = {
  "https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md":
    GOOGLE_SETUP_GUIDE,
  "https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_ANALYTICS.md":
    GOOGLE_SETUP_GUIDE,
};

// Only web links leave the app. Other schemes (file:, search-ms:, ms-msdt:,
// ...) reach Windows protocol handlers, and links can come from crawled pages
// shown in audits and SERP tables.
function openInBrowser(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return;
  if (parsed.host === "accounts.google.com")
    googleSignInUntil = Date.now() + GOOGLE_SIGN_IN_WINDOW_MS;
  shell.openExternal(DESKTOP_GUIDES[url] ?? url);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Closing the window keeps OpenSEO in the tray so scheduled rank tracking and
// AI visibility checks keep running; Quit from the tray or File menu stops it.
function createTray() {
  if (tray) return;
  const icon =
    process.platform === "win32"
      ? path.join(bundleSource(), "client", "favicon.ico")
      : path.join(bundleSource(), "client", "favicon-32x32.png");
  tray = new Tray(icon);
  tray.setToolTip("OpenSEO");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open OpenSEO", click: showMainWindow },
      {
        label: "Open in Browser",
        click: () => server && shell.openExternal(server.origin),
      },
      {
        label: "Settings…",
        click: () => openSetupWindow({ firstRun: false }),
      },
      { type: "separator" },
      { label: "Quit OpenSEO", click: () => app.quit() },
    ]),
  );
  tray.on("click", showMainWindow);
}

function hideToTray() {
  mainWindow.hide();
  const settings = loadSettings();
  if (settings.trayHintShown || !Notification.isSupported()) return;
  new Notification({
    title: "OpenSEO is still running",
    body: "Scheduled tracking keeps running in the background. Right-click the tray icon to quit.",
  }).show();
  settings.trayHintShown = true;
  saveSettings(settings);
}

function notifyPortChange(from, to) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: `OpenSEO moved to port ${to}`,
    body: `Port ${from} was in use. Update agent connections to http://127.0.0.1:${to}/mcp. You can change the port in Settings.`,
  }).show();
}

function applyLoginItem(settings) {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  app.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    args: ["--hidden"],
  });
}

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
  mainWindow.once("ready-to-show", () => {
    // A sign-in start stays hidden only when the tray icon is there to reopen it.
    if (!startHidden || !loadSettings().keepRunningInTray) mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (quitting || !loadSettings().keepRunningInTray) return;
    event.preventDefault();
    hideToTray();
  });
  mainWindow.on("focus", () => {
    if (Date.now() < googleSignInUntil && server)
      mainWindow.webContents.reload();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Keep OpenSEO in the window. New-window links (including same-origin ones
  // such as report share links) and navigations away from the app open in the
  // default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (server && originOf(url) === server.origin) return;
    event.preventDefault();
    openInBrowser(url);
  });
}

function parentForSettings(firstRun) {
  return !firstRun && mainWindow?.isVisible() ? mainWindow : undefined;
}

function openSetupWindow({ firstRun }) {
  if (setupWindow) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    width: 600,
    height: 800,
    resizable: false,
    title: "OpenSEO Settings",
    icon: iconPath(),
    parent: parentForSettings(firstRun),
    modal: Boolean(parentForSettings(firstRun)),
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
  applyLoginItem(settings);
  const isNewWindow = !mainWindow;
  if (isNewWindow) createMainWindow();
  if (settings.keepRunningInTray) createTray();
  else {
    tray?.destroy();
    tray = null;
    // Without a tray, a window hidden to the tray would have no way back.
    if (!isNewWindow) showMainWindow();
  }
  try {
    const origin = await startServer(settings);
    mainWindow?.loadURL(origin);
    serverReady = true;
    if (pendingLink) handleLink(pendingLink);
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
        {
          label: "Open in Browser",
          click: () => server && shell.openExternal(server.origin),
        },
        { type: "separator" },
        {
          label: "Quit OpenSEO",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
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
        {
          label: "Connect Google Search Console",
          click: () => shell.openExternal(GOOGLE_SETUP_GUIDE),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- openseo:// links ----------

// WordPress's Authorize Application screen only hands its new password to an
// https address or an app link, never to plain http on 127.0.0.1. So the app
// registers openseo:// and forwards the approval to the local server by POST,
// which keeps the password out of URLs and logs.
const LINK_SCHEME = "openseo";
let serverReady = false;
let pendingLink = null;

function registerLinkScheme() {
  if (process.defaultApp && process.argv.length >= 2) {
    // `electron .` in development: Windows must relaunch with the app path.
    app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(LINK_SCHEME);
  }
}

function linkFromArgv(argv) {
  return argv.find((arg) => arg.startsWith(`${LINK_SCHEME}://`)) ?? null;
}

function handleLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (
    parsed.protocol !== `${LINK_SCHEME}:` ||
    parsed.host !== "wordpress" ||
    parsed.pathname !== "/callback"
  )
    return;
  if (!serverReady || !mainWindow) {
    pendingLink = parsed.href;
    return;
  }
  pendingLink = null;
  mainWindow.loadURL(`${server.origin}/api/wordpress/callback`, {
    postData: [
      { type: "rawData", bytes: Buffer.from(parsed.searchParams.toString()) },
    ],
    extraHeaders: "Content-Type: application/x-www-form-urlencoded",
  });
  showMainWindow();
}

// ---------- IPC from the settings window ----------

ipcMain.handle("settings:get", () => {
  const settings = loadSettings();
  const saved = {};
  for (const key of OPTIONAL_KEYS) saved[key] = Boolean(settings[key]);
  return {
    hasDataforseoKey: Boolean(settings.DATAFORSEO_API_KEY),
    saved,
    // Not secret, and shown so the user can check what they pasted.
    googleClientId: settings.GOOGLE_CLIENT_ID,
    builtInGoogle: Boolean(builtInGoogleClient()),
    telemetryDisabled: settings.telemetryDisabled,
    samModel: settings.samModel,
    keepRunningInTray: settings.keepRunningInTray,
    openAtLogin: settings.openAtLogin,
    port: settings.port,
    dataDir: userData,
  };
});

ipcMain.handle("settings:save", async (_event, input) => {
  const settings = loadSettings();
  const dataforseo = String(input?.dataforseoKey ?? "").trim();
  if (dataforseo) settings.DATAFORSEO_API_KEY = dataforseo;
  for (const key of OPTIONAL_KEYS) {
    const value = String(input?.keys?.[key] ?? "").trim();
    if (value) settings[key] = value;
  }
  settings.telemetryDisabled = Boolean(input?.telemetryDisabled);
  if (SAM_MODELS.includes(input?.samModel)) settings.samModel = input.samModel;
  settings.keepRunningInTray = Boolean(input?.keepRunningInTray);
  settings.openAtLogin = Boolean(input?.openAtLogin);
  const port = Number(input?.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    return {
      ok: false,
      error: "The port must be a number from 1024 to 65535.",
    };
  settings.port = port;
  if (!settings.DATAFORSEO_API_KEY)
    return { ok: false, error: "A DataForSEO API key is required." };
  saveSettings(settings);
  await applySavedSettings();
  return { ok: true };
});

// Start (which opens the main window) before closing the settings window,
// so closing it never leaves zero windows and quits the app.
async function applySavedSettings() {
  const started = server ? restart() : mainWindow ? null : launch();
  setupWindow?.close();
  await started;
}

const TEAM_FILE_FILTERS = [
  { name: "OpenSEO team setup", extensions: ["openseo-team"] },
];

ipcMain.handle("team:export", async (_event, password) => {
  const settings = loadSettings();
  if (!settings.DATAFORSEO_API_KEY)
    return { ok: false, error: "Save a DataForSEO key before exporting." };
  let sealed;
  try {
    sealed = sealTeamSetup(settings, String(password ?? ""));
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const { canceled, filePath } = await dialog.showSaveDialog(setupWindow, {
    title: "Export team setup",
    defaultPath: "OpenSEO team setup.openseo-team",
    filters: TEAM_FILE_FILTERS,
  });
  if (canceled || !filePath) return { ok: false, error: "" };
  fs.writeFileSync(filePath, sealed);
  return { ok: true, filePath };
});

ipcMain.handle("team:import", async (_event, password) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(setupWindow, {
    title: "Import team setup",
    filters: TEAM_FILE_FILTERS,
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return { ok: false, error: "" };
  let values;
  try {
    values = openTeamSetup(
      fs.readFileSync(filePaths[0], "utf8"),
      String(password ?? ""),
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (!values.DATAFORSEO_API_KEY)
    return { ok: false, error: "This file has no DataForSEO key in it." };
  const settings = loadSettings();
  Object.assign(settings, values);
  if (!SAM_MODELS.includes(settings.samModel)) settings.samModel = "";
  saveSettings(settings);
  await applySavedSettings();
  return { ok: true };
});

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Started by an openseo:// link while OpenSEO wasn't running.
  pendingLink = linkFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    const link = linkFromArgv(argv);
    if (link) return handleLink(link);
    if (mainWindow) return showMainWindow();
    setupWindow?.focus();
  });

  app.whenReady().then(() => {
    // Windows ties notifications and taskbar grouping to this id.
    if (process.platform === "win32")
      app.setAppUserModelId("so.openseo.desktop");
    registerLinkScheme();
    buildMenu();
    launch();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleLink(url);
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  // With the tray on, a hidden main window is not "closed"; this only fires
  // when the tray is off or before the main window exists (first-run setup).
  app.on("window-all-closed", () => app.quit());
}
