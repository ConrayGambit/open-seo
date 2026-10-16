// Starts the packaged OpenSEO server the way the desktop shell does (Electron's
// Node running wrangler on workerd), checks health and the cron handler, and
// stops it. Used by CI on the Windows build output.
//
//   node scripts/smoke-test.mjs <electron exe> <app dir> <bundle dir>
//   e.g. release/win-unpacked/OpenSEO.exe release/win-unpacked/resources/app
//        release/win-unpacked/resources/openseo
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [exe, appDir, bundleDir] = process.argv
  .slice(2)
  .map((p) => path.resolve(p));
if (!bundleDir)
  throw new Error("usage: smoke-test.mjs <exe> <app dir> <bundle dir>");

const work = mkdtempSync(path.join(os.tmpdir(), "openseo-smoke-"));
const runtime = path.join(work, "runtime");
cpSync(bundleDir, runtime, { recursive: true });
const port = 47399;
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: path.join(work, "logs"),
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
  AUTH_MODE: "local_noauth",
  OPENSEO_TELEMETRY_DISABLED: "1",
  DATAFORSEO_API_KEY: Buffer.from("smoke:test").toString("base64"),
};
const wrangler = (args) => [
  "--no-warnings",
  "--experimental-vm-modules",
  "--require",
  path.join(appDir, "src", "wrangler-shim.cjs"),
  path.join(appDir, "node_modules", "wrangler", "wrangler-dist", "cli.js"),
  ...args,
];
const serverConfig = path.join(runtime, "server", "wrangler.json");
const auditConfig = path.join(runtime, "open_seo_audit", "wrangler.json");
const state = path.join(work, "state");

const migrate = spawnSync(
  exe,
  wrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    state,
    "-c",
    serverConfig,
  ]),
  { env, stdio: "inherit" },
);
if (migrate.status !== 0)
  throw new Error(`migrations failed (${migrate.status})`);

const server = spawn(
  exe,
  wrangler([
    "dev",
    "-c",
    serverConfig,
    "-c",
    auditConfig,
    "--persist-to",
    state,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--test-scheduled",
    "--show-interactive-dev-session=false",
  ]),
  { env, stdio: "inherit" },
);

function stop() {
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else server.kill("SIGTERM");
}

const origin = `http://127.0.0.1:${port}`;
try {
  let health;
  for (let i = 0; i < 90 && !health; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (server.exitCode !== null)
      throw new Error("server exited during startup");
    health = await fetch(`${origin}/api/health`)
      .then((r) => (r.ok ? r.json() : undefined))
      .catch(() => undefined);
  }
  if (!health) throw new Error("server never became healthy");
  console.log(
    "health:",
    health.status,
    health.authMode,
    health.checks.database,
  );

  const home = await fetch(origin);
  if (!home.ok) throw new Error(`home page returned ${home.status}`);

  const cron = await fetch(
    `${origin}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*&format=json`,
  ).then((r) => r.json());
  if (cron.outcome !== "ok")
    throw new Error(`scheduled handler: ${JSON.stringify(cron)}`);
  console.log("Smoke test passed.");
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
