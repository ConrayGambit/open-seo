# Windows Desktop App

Run OpenSEO as a regular Windows program: install it, open it from the Start menu, and it runs in its own window. No Docker, WSL, or terminal needed.

The desktop app runs the same single-user setup as [Docker self-hosting](./SELF_HOSTING_DOCKER.md): everything stays on your PC, there is no login (`AUTH_MODE=local_noauth`), and you bring your own DataForSEO key.

## Install

1. Download `OpenSEO-Setup-<version>.exe` from the **Windows desktop app** workflow run (Actions tab → latest run → `OpenSEO-Windows` artifact) or from a `desktop-v*` release.
2. Run it. The installer is not code-signed yet, so Windows SmartScreen may warn you: choose **More info → Run anyway**.
3. Open OpenSEO. On first run it asks for your DataForSEO Base64 credentials (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md)) and, optionally, an OpenRouter key for SAM, the in-app SEO agent.

The first start takes a few seconds longer while the database is created.

## Where your data lives

Everything is stored in `%APPDATA%\OpenSEO`:

- `state\` - your projects, keywords, audits and rank history.
- `settings.json` - your keys, encrypted with your Windows account.
- `logs\` - server logs, useful when reporting a problem.

**File → Open Data Folder** and **File → Open Logs Folder** open these. Uninstalling keeps your data; delete the folder yourself to remove it.

## Settings

**File → Settings…** changes your keys or turns off the anonymous usage heartbeat (the same telemetry described in [`SELF_HOSTING_DOCKER.md`](./SELF_HOSTING_DOCKER.md#telemetry)). Saving restarts the local server.

## Background work

Rank tracking, AI visibility schedules and audit cleanup run on the same five-minute schedule as Docker, but only while the app is open.

## Optional features

Google Search Console, Google Analytics and the site audit "Render JavaScript" option need extra keys that the desktop app does not ask for yet. Use [Docker](./SELF_HOSTING_DOCKER.md) or [Cloudflare](./SELF_HOSTING_CLOUDFLARE.md) self-hosting if you need them today.

## Building the installer yourself

On Windows, with Node 22 and pnpm:

```bash
pnpm install
pnpm --dir desktop install
pnpm --dir desktop run dist:win
```

The installer is written to `desktop/release/`. `pnpm --dir desktop start` builds the app and opens it without packaging.

Under the hood, the app is an Electron window around the regular OpenSEO build. It serves the built app locally with Cloudflare's `workerd` runtime (via `wrangler dev`), the same runtime the Docker image uses, on `127.0.0.1` only.
