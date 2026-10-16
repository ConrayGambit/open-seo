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

**File → Settings…** (or the tray icon's menu) changes your keys and app options. Saving restarts the local server. Leave a key field blank to keep its saved value.

| Setting                                 | What it turns on                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| DataForSEO API key                      | Required. All SEO data.                                                                    |
| OpenRouter API key                      | SAM, the in-app SEO agent, and AI prompt suggestions.                                      |
| Context.dev API key                     | "Render JavaScript" in site audits, for sites built with React, Vue and similar.           |
| Google client ID and secret             | Google Search Console and Google Analytics 4. See below.                                   |
| Keep running in the system tray         | On by default. Closing the window keeps OpenSEO running so scheduled work continues.       |
| Start OpenSEO when I sign in to Windows | Starts OpenSEO in the tray at sign-in, without opening a window.                           |
| Turn off the anonymous usage heartbeat  | The telemetry described in [`SELF_HOSTING_DOCKER.md`](./SELF_HOSTING_DOCKER.md#telemetry). |
| Local port                              | The port OpenSEO serves on (default 47321). See below.                                     |

## Local port and AI agents

OpenSEO serves on `http://127.0.0.1:47321` and keeps that port between launches. Connect AI agents such as Claude Code to its MCP endpoint, shown in **Settings → Connections**:

```
http://127.0.0.1:47321/mcp
```

If another program is already using the port, OpenSEO switches to a free one, keeps using it from then on, and shows a notification with the new address. Update your agent connections and Google redirect URIs once when that happens, or set the port back in Settings.

## Background work

Rank tracking, AI visibility schedules and audit cleanup run every five minutes, as in Docker, for as long as OpenSEO is running. With the tray option on, that includes when the window is closed. Use **Quit OpenSEO** from the tray icon or the File menu to stop it completely.

## Google Search Console and Analytics

1. Follow steps 1–3 of [`SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md`](./SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) (and enable the APIs in [`SELF_HOSTING_GOOGLE_ANALYTICS.md`](./SELF_HOSTING_GOOGLE_ANALYTICS.md) for GA4) to create a "Web application" OAuth client.
2. Add both redirect URIs shown in **Settings → Google Search Console and Analytics**. With the default port they are:
   - `http://127.0.0.1:47321/api/gsc/oauth/callback`
   - `http://127.0.0.1:47321/api/ga4/oauth/callback`
3. Paste the client ID and secret into Settings and save.
4. Click **Connect** in OpenSEO. Google's consent page opens in your default browser; after you approve, return to the OpenSEO window and refresh (**View → Reload**).

If you change the [local port](#local-port-and-ai-agents), add the new redirect URIs to your Google OAuth client too.

## Building the installer yourself

On Windows, with Node 22 and pnpm:

```bash
pnpm install
pnpm --dir desktop install
pnpm --dir desktop run dist:win
```

The installer is written to `desktop/release/`. Building on Linux or macOS also works if [Wine](https://www.winehq.org/) is installed. `pnpm --dir desktop start` builds the app and opens it without packaging.

Under the hood, the app is an Electron window around the regular OpenSEO build. It serves the built app locally with Cloudflare's `workerd` runtime (via `wrangler dev`), the same runtime the Docker image uses, on `127.0.0.1` only.
