// Builds the OpenSEO app at the repo root for local single-user mode and
// stages the output the desktop shell ships in desktop/build/openseo/.
//
// The staged bundle is exactly what the Docker image serves, minus Vite: the
// two built Workers (app + site-audit), the client assets, the D1 migrations,
// and the loopback cron scheduler. At runtime the shell serves it with
// `wrangler dev` (workerd), so nothing here needs Node build tooling.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootDir = path.resolve(desktopDir, "..");
const outDir = path.join(desktopDir, "build", "openseo");
const rootPkg = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

if (!process.argv.includes("--skip-build")) {
  console.log("Building OpenSEO (local_noauth)...");
  execFileSync("pnpm", ["exec", "vite", "build"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Inlined into the client bundle at build time (see vite.config.ts envPrefix).
      AUTH_MODE: "local_noauth",
      VITE_SHOW_DEVTOOLS: "false",
    },
  });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const skipLocalState = (src) =>
  !src.split(path.sep).some((part) => part === ".wrangler" || part === ".vite");
for (const dir of ["client", "server", "open_seo_audit"]) {
  cpSync(path.join(rootDir, "dist", dir), path.join(outDir, dir), {
    recursive: true,
    filter: skipLocalState,
  });
}

// The built wrangler.json files record the build machine's absolute config
// paths; drop them so the bundle is relocatable.
for (const dir of ["server", "open_seo_audit"]) {
  const file = path.join(outDir, dir, "wrangler.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  delete config.configPath;
  delete config.userConfigPath;
  writeFileSync(file, JSON.stringify(config));
}

// `migrations_dir` in the server config is relative to that config's folder.
cpSync(
  path.join(rootDir, "drizzle", "sqlite"),
  path.join(outDir, "server", "drizzle", "sqlite"),
  { recursive: true },
);
cpSync(
  path.join(rootDir, "scripts", "selfhost-scheduler.mjs"),
  path.join(outDir, "selfhost-scheduler.mjs"),
);
// Optional built-in Google OAuth client ("Desktop app" type), so Search
// Console and GA4 connect in one click. Google treats a desktop client's secret
// as public, but it still stays out of the repo: pass it when building.
const googleClientId = process.env.OPENSEO_DESKTOP_GOOGLE_CLIENT_ID?.trim();
const googleClientSecret =
  process.env.OPENSEO_DESKTOP_GOOGLE_CLIENT_SECRET?.trim();
writeFileSync(
  path.join(outDir, "openseo-bundle.json"),
  JSON.stringify({
    version: rootPkg.version,
    builtAt: new Date().toISOString(),
    google:
      googleClientId && googleClientSecret
        ? { clientId: googleClientId, clientSecret: googleClientSecret }
        : null,
  }),
);

console.log(
  `Staged OpenSEO ${rootPkg.version} in ${path.relative(rootDir, outDir)}`,
);
