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

If another program is already using the port, OpenSEO switches to a free one, keeps using it from then on, and shows a notification with the new address. Update your agent connections once when that happens (and the redirect URIs, if you use a Web application Google client), or set the port back in Settings.

## Background work

Rank tracking, AI visibility schedules and audit cleanup run every five minutes, as in Docker, for as long as OpenSEO is running. With the tray option on, that includes when the window is closed. Use **Quit OpenSEO** from the tray icon or the File menu to stop it completely.

## Google Search Console and Analytics

If your installer was built with a Google client (see [Building the installer yourself](#building-the-installer-yourself)), Settings says sign-in is built in: click **Connect** on the Search Console or GA4 card, approve in your browser, then return to OpenSEO and refresh (**View → Reload**).

Otherwise, use your own Google OAuth client. One client covers both. It takes about ten minutes in the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project (or pick one) and enable the APIs you want:
   - Search Console: [Google Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com)
   - GA4: [Google Analytics Admin API](https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com) and [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com)
2. Under **APIs & Services → OAuth consent screen**, choose **External**, fill in the app name and your email, and add the Google account you will connect as a **test user**. Without the test user Google blocks sign-in with `access_denied`. In **Testing** status Google signs you out after seven days; **Publish app** avoids that, at the cost of an "unverified app" warning you click through.
3. Under **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose **Desktop app**. It works on any local port, so there are no redirect URIs to add. (A **Web application** client also works if you add both redirect URIs shown in Settings.)
4. Copy the client ID and client secret into **Settings → Google Search Console and Analytics** and click **Save and restart**.
5. Click **Connect** on the Search Console or GA4 card. Google's consent page opens in your default browser; after you approve, return to the OpenSEO window and refresh (**View → Reload**), then pick your property.

## Building the installer yourself

On Windows, with Node 22 and pnpm:

```bash
pnpm install
pnpm --dir desktop install
pnpm --dir desktop run dist:win
```

The installer is written to `desktop/release/`. To build in one-click Google sign-in, create a **Desktop app** OAuth client as in steps 1–3 above and set `OPENSEO_DESKTOP_GOOGLE_CLIENT_ID` and `OPENSEO_DESKTOP_GOOGLE_CLIENT_SECRET` when building (the Windows workflow reads them from repository secrets of the same names). Anyone with the installer can read these values; Google expects that for desktop apps. Before Google verifies the app, users see an "unverified app" warning and at most 100 Google accounts can connect. Building on Linux or macOS also works if [Wine](https://www.winehq.org/) is installed. `pnpm --dir desktop start` builds the app and opens it without packaging.

Under the hood, the app is an Electron window around the regular OpenSEO build. It serves the built app locally with Cloudflare's `workerd` runtime (via `wrangler dev`), the same runtime the Docker image uses, on `127.0.0.1` only.
