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

| Setting                                 | What it turns on                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| DataForSEO API key                      | Required. All SEO data.                                                                     |
| OpenRouter API key                      | SAM, the in-app SEO agent, and AI prompt suggestions.                                       |
| SAM model                               | The model SAM uses through OpenRouter: GPT (default), Claude Sonnet 5.5 or Claude Opus 5.5. |
| Context.dev API key                     | "Render JavaScript" in site audits, for sites built with React, Vue and similar.            |
| Google client ID and secret             | Google Search Console and Google Analytics 4. See below.                                    |
| Keep running in the system tray         | On by default. Closing the window keeps OpenSEO running so scheduled work continues.        |
| Start OpenSEO when I sign in to Windows | Starts OpenSEO in the tray at sign-in, without opening a window.                            |
| Turn off the anonymous usage heartbeat  | The telemetry described in [`SELF_HOSTING_DOCKER.md`](./SELF_HOSTING_DOCKER.md#telemetry).  |
| Local port                              | The port OpenSEO serves on (default 47321). See below.                                      |

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

## WordPress sites

A project can connect its WordPress site so audit fixes are applied from OpenSEO instead of in wp-admin: SEO titles and meta descriptions (Yoast SEO or Rank Math), image alt text, and setting a page to draft. Every change shows the current value first, is logged, and can be undone.

1. Open the project, then **Settings → Integrations → WordPress**, enter the site's address and click **Connect WordPress**.
2. The site's own **Authorize Application** page opens in your browser. Sign in to WordPress if asked, then click **Yes, I approve of this connection**.
3. Your browser asks to open OpenSEO. Allow it, and the project shows the site as connected. OpenSEO never sees your WordPress login password; WordPress gives it a separate application password that you can revoke under **Users → Profile → Application Passwords**.
4. Download the **OpenSEO Connector** plugin from the same card and install it on the site (**Plugins → Add New → Upload Plugin**, then **Activate**). OpenSEO needs it to find pages by URL and to edit Yoast SEO or Rank Math fields.

After that, supported issues in **Site Audit** have a **Fix** button. The change log and **Undo** are on the WordPress card. Undo only restores a value if nobody has edited that field on the site since.

Connecting works on the PC where OpenSEO is installed, because WordPress returns the approval to the app through an `openseo://` link. WordPress only offers application passwords on sites served over HTTPS.

## Troubleshooting

Most problems leave a clue in `%APPDATA%\OpenSEO\logs\server.log` (**File → Open Logs Folder**). Include that file when you report a problem.

### Installing and starting

- **"Windows protected your PC" when installing.** The installer is not code-signed yet. Choose **More info → Run anyway**.
- **Stuck on the loading screen.** The first start, and the first start after an update, creates or updates the database and can take a minute or two. If it takes longer, use **File → Restart Server**, then check `server.log`.
- **"OpenSEO could not start" or "OpenSEO stopped".** The message names the log file; the last lines of `server.log` say why. Restarting OpenSEO usually clears a one-off failure. If your antivirus quarantined `workerd.exe` (the local server), restore it and allow it, then reinstall.
- **Settings asks for your DataForSEO key again.** Keys are encrypted for your Windows account, so they can't be read after a Windows reset or from a `settings.json` copied from another PC. Enter them again.
- **Starting over.** Quit OpenSEO from the tray icon, rename `%APPDATA%\OpenSEO`, and open OpenSEO again. Renaming instead of deleting keeps your old data in case you need it.

### SEO data

- **Keyword, domain or backlink data fails to load.** DataForSEO is rejecting the request. An HTTP 401 or 403 in `server.log` almost always means one of these:
  - The key is wrong. Paste the **Base64** credentials from [DataForSEO API Access](https://app.dataforseo.com/api-access), which encode your email and _API password_, not your account password. See [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md).
  - Your DataForSEO balance is empty. Check it in the [DataForSEO dashboard](https://app.dataforseo.com/) and top up.
  - Your DataForSEO account isn't verified yet (error `40104` in `server.log`). Finish the verification steps in the [DataForSEO dashboard](https://app.dataforseo.com/); the key works as soon as the account is verified.

  After fixing it, save the key in **File → Settings…**; saving restarts the server.

### AI agents and the local port

- **Claude Code or another agent can't connect.** Open **File → Settings… → Connections** and copy the MCP address shown there into your agent's configuration. The address includes OpenSEO's port, which may not be the default 47321 on your PC.
- **OpenSEO moved to a different port.** `server.log` says why: `EADDRINUSE` means another program uses the port; `EACCES` means Windows has reserved it (common with Hyper-V, WSL or Docker). To see Windows' reserved ranges, run `netsh interface ipv4 show excludedportrange protocol=tcp` in a terminal. OpenSEO keeps the new port from then on, or you can choose one outside those ranges in Settings.

### Google Search Console and Analytics

- **"Google OAuth client not configured".** No Google client is set. Add one in **Settings** as described in [Google Search Console and Analytics](#google-search-console-and-analytics).
- **"Google hasn't verified this app".** Expected for a client that Google hasn't verified. Click **Advanced → Go to OpenSEO**.
- **`access_denied`.** The OAuth consent screen is in **Testing** and your Google account isn't a test user. Add it under **Audience → Test users**, or publish the app.
- **`redirect_uri_mismatch`.** You're using a **Web application** client and its redirect URIs don't match OpenSEO's port. Add the two URIs shown in Settings, or switch to a **Desktop app** client, which works on any port.
- **Signed in, but OpenSEO still says "Not connected".** Sign-in finishes in your browser. Switch back to the OpenSEO window; it refreshes after a Google sign-in. If not, use **View → Reload**. You can close the browser tab.
- **Disconnected again after about a week.** Google expires sign-ins after seven days while the consent screen is in **Testing**. Publish the app (**Audience → Publish app**), then click **Connect** once more.

### WordPress

- **"Application passwords are turned off on this site".** WordPress only offers them over HTTPS, and some security plugins (Wordfence, iThemes/Solid Security) switch them off. Turn them back on in that plugin's settings.
- **The browser doesn't offer to open OpenSEO after approving.** Install OpenSEO with the installer (not a copied folder) so Windows knows the `openseo://` link, start OpenSEO, and connect again.
- **"The OpenSEO Connector plugin isn't active on this site".** Install and activate it from the WordPress card, then click **Check again**.
- **"WordPress rejected OpenSEO's password".** It was revoked in WordPress. Click **Disconnect**, then connect again.
- **The page still shows the old title after a fix.** A caching plugin or CDN is serving an old copy. Clear its cache.

## Building the installer yourself

On Windows, with Node 22 and pnpm:

```bash
pnpm install
pnpm --dir desktop install
pnpm --dir desktop run dist:win
```

The installer is written to `desktop/release/`. To build in one-click Google sign-in, create a **Desktop app** OAuth client as in steps 1–3 above and set `OPENSEO_DESKTOP_GOOGLE_CLIENT_ID` and `OPENSEO_DESKTOP_GOOGLE_CLIENT_SECRET` when building (the Windows workflow reads them from repository secrets of the same names). Anyone with the installer can read these values; Google expects that for desktop apps. Before Google verifies the app, users see an "unverified app" warning and at most 100 Google accounts can connect. Building on Linux or macOS also works if [Wine](https://www.winehq.org/) is installed. `pnpm --dir desktop start` builds the app and opens it without packaging.

Under the hood, the app is an Electron window around the regular OpenSEO build. It serves the built app locally with Cloudflare's `workerd` runtime (via `wrangler dev`), the same runtime the Docker image uses, on `127.0.0.1` only.
