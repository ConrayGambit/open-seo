<div align="center">

<img src="src/public/android-chrome-192x192.png" width="96" alt="OpenSEO logo" />

# OpenSEO for Windows

**The open-source SEO suite, packaged as a native Windows desktop app.**

Keyword research, rank tracking, backlinks, site audits and AI visibility, running entirely on your PC.

[Download](#download) · [Features](#features) · [Getting started](#getting-started) · [Build from source](#build-from-source) · [Upstream project](https://github.com/every-app/open-seo)

</div>

---

> [!NOTE]
> This is a community fork of [every-app/open-seo](https://github.com/every-app/open-seo). It adds a Windows desktop edition on top of the upstream app and tracks upstream for everything else. It is not affiliated with or supported by the OpenSEO maintainers; please report Windows app issues on this fork.

## Why this fork

Upstream OpenSEO runs as a hosted service, on Cloudflare, or in Docker. This fork adds a fourth option for people who just want a program they can install:

|                          | Windows desktop (this fork) | Docker                      | Cloudflare               |
| ------------------------ | --------------------------- | --------------------------- | ------------------------ |
| Install                  | Setup wizard                | Docker Desktop + terminal   | Cloudflare account + CLI |
| Runs on                  | Your PC                     | Your PC or server           | Cloudflare's network     |
| Login                    | None (single user)          | None (single user)          | Cloudflare Access        |
| Background rank tracking | While running (tray)        | Always                      | Always                   |
| Best for                 | One person, one PC          | Trying it out, home servers | Teams, multiple devices  |

## Features

Everything in upstream OpenSEO, including:

- **Keyword research:** volumes, difficulty, intent and related ideas.
- **Rank tracking:** scheduled position checks for the keywords you care about.
- **Competitor insights:** domain overviews, top pages and keyword gaps.
- **Backlinks:** referring domains and link profiles.
- **Site audits:** crawl for broken links, missing tags and indexability problems.
- **AI visibility:** see how AI assistants answer the questions your customers ask.
- **SAM, the in-app SEO agent:** optional, with an OpenRouter key.

The Windows edition adds:

- A standard installer with Start menu and desktop shortcuts.
- A first-run setup screen for your API keys, so there are no `.env` files to edit.
- Keys encrypted with your Windows account.
- All data kept locally in `%APPDATA%\OpenSEO`, kept through updates and uninstall.
- A system tray icon, so scheduled tracking keeps running with the window closed, and optional start at Windows sign-in.
- Settings for every optional integration: OpenRouter (SAM), Context.dev (JavaScript rendering), and Google Search Console and Analytics.

## Download

Installers are built by GitHub Actions on Windows:

- **Releases:** tagged builds (`desktop-v*`) attach `OpenSEO-Setup-<version>.exe` to the [Releases](../../releases) page.
- **Latest build:** open the [Windows desktop app workflow](../../actions/workflows/desktop-windows.yml), pick the latest successful run and download the `OpenSEO-Windows` artifact.

Requirements: Windows 10 or 11, 64-bit.

> [!IMPORTANT]
> The installer is not code-signed yet. Windows SmartScreen will show "Windows protected your PC" on first install. Choose **More info → Run anyway**.

## Getting started

1. **Get a DataForSEO key.** OpenSEO pulls SEO data from [DataForSEO](https://dataforseo.com/?aff=255379), a pay-as-you-go API. New accounts include $1 of free credit. Follow [`docs/DATAFORSEO_API_KEY.md`](./docs/DATAFORSEO_API_KEY.md) to copy your Base64 credentials.
2. **Install and open OpenSEO.**
3. **Paste your key** on the welcome screen. Add an [OpenRouter](https://openrouter.ai) key too if you want SAM, the in-app agent.
4. Click **Save and start**. Your dashboard opens a few seconds later.

You pay DataForSEO directly for the data you use; there is no OpenSEO subscription. See [openseo.so/pricing](https://openseo.so/pricing) for typical costs.

### Using the app

| Menu                        | What it does                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| **File → Settings…**        | API keys, Google client, local port and MCP address, tray options. Restarts the local server. |
| **File → Open Data Folder** | Your database, settings and logs. Back this folder up to keep your data.                      |
| **File → Open Logs Folder** | Server logs, useful when reporting a problem.                                                 |
| **File → Restart Server**   | Restarts OpenSEO's local server without closing the window.                                   |

Full details: [`docs/WINDOWS_DESKTOP.md`](./docs/WINDOWS_DESKTOP.md). Something not working? See [Troubleshooting](./docs/WINDOWS_DESKTOP.md#troubleshooting).

### Current limitations

- Scheduled work (rank tracking, AI visibility checks) runs only while OpenSEO is running. It keeps running in the system tray when you close the window, and can start when you sign in to Windows.
- No automatic updates yet; install a newer build over the old one. Your data is kept.
- 64-bit Windows only. macOS and Linux users can use the upstream Docker setup.

## How it works

OpenSEO is a [TanStack Start](https://tanstack.com/start) app built for Cloudflare Workers, using D1, KV, R2, Durable Objects and Workflows. The desktop edition does not change the app. It wraps the same build the Docker image serves:

```
OpenSEO.exe (Electron)
 ├─ native window ──────────────► http://127.0.0.1:<port>
 └─ local server (wrangler dev, Electron's Node)
     └─ workerd: app worker + site-audit worker
         └─ D1 / KV / R2 / Durable Objects, stored in %APPDATA%\OpenSEO\state
```

On launch, the shell applies database migrations, starts the server on `127.0.0.1` only, waits for `/api/health`, loads the dashboard, and triggers scheduled jobs every five minutes. Closing the window hides OpenSEO to the tray; quitting stops the server.

## Build from source

Prerequisites: Windows, [Node.js 22](https://nodejs.org) and [pnpm](https://pnpm.io) (`corepack enable`).

```bash
git clone https://github.com/ConrayGambit/open-seo.git
cd open-seo
pnpm install
pnpm --dir desktop install

# Run without packaging
pnpm --dir desktop start

# Build the installer → desktop/release/OpenSEO-Setup-<version>.exe
pnpm --dir desktop run dist:win
```

Layout of the Windows additions:

| Path                                    | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `desktop/src/`                          | Electron main process, setup screen and loading screen                      |
| `desktop/scripts/prepare-app.mjs`       | Builds OpenSEO in single-user mode and stages it for packaging              |
| `desktop/scripts/smoke-test.mjs`        | Starts the packaged server and checks health and the scheduler (used in CI) |
| `desktop/electron-builder.config.cjs`   | Installer configuration (NSIS, x64)                                         |
| `.github/workflows/desktop-windows.yml` | Builds, smoke-tests and publishes the installer                             |

For working on the web app itself, see [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md).

### Releasing

Push a tag starting with `desktop-v` (for example `desktop-v0.1.14`). The workflow builds the installer and attaches it to a draft GitHub release for you to review and publish. The installer version is `desktop/package.json`; bump it for every build you hand out. The OpenSEO version it bundles still follows the root `package.json`.

### Staying up to date with upstream

```bash
git remote add upstream https://github.com/every-app/open-seo.git
git fetch upstream
git merge upstream/main
```

The Windows additions live in their own folder and touch only a few upstream files, so merges are usually clean.

## Other ways to run OpenSEO

- **Hosted:** [openseo.so](https://openseo.so), run by the upstream maintainers.
- **Docker:** [`docs/SELF_HOSTING_DOCKER.md`](./docs/SELF_HOSTING_DOCKER.md).
- **Cloudflare:** [`docs/SELF_HOSTING_CLOUDFLARE.md`](./docs/SELF_HOSTING_CLOUDFLARE.md).
- **MCP and agent skills:** connect Claude Code, ChatGPT, Codex and others; see [openseo.so/docs/mcp](https://openseo.so/docs/mcp).

## Privacy

Your projects, keywords and audit results never leave your PC except as requests to the APIs you configure (DataForSEO, and OpenRouter if enabled). The app sends the upstream project's anonymous usage heartbeat (counts only, no URLs, keywords or prompts), which you can turn off in **File → Settings…**. Details: [`docs/SELF_HOSTING_DOCKER.md#telemetry`](./docs/SELF_HOSTING_DOCKER.md#telemetry).

## Credits and license

OpenSEO is created by [Ben Senescu](https://x.com/bensenescu) and the [every-app/open-seo](https://github.com/every-app/open-seo) contributors. Join the upstream community on [Discord](https://discord.gg/c9uGs3cFXr).

This fork is released under the same [MIT License](./LICENSE).
