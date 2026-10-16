# WordPress connect and fix

A project can connect its WordPress site so that fixes found by Site Audit are applied from OpenSEO instead of by hand in wp-admin. Every change shows the old and new value before it is written, is logged, and can be undone.

This first version targets the Windows desktop app, which runs single-user on the owner's PC.

## What it does

Project settings gain a **Connect WordPress** action. It opens the site's own authorization screen, where a WordPress administrator or editor approves OpenSEO. WordPress then hands OpenSEO an application password for that user. OpenSEO never sees the user's login password, and the site owner can revoke access at any time under Users → Profile → Application Passwords.

Once connected, supported audit issues gain a **Fix** button:

| Audit issue                                     | Fix                            | Where it is written                                                |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Title missing, too long or too short            | Edit the SEO title             | Yoast or Rank Math title field, through the companion plugin       |
| Meta description missing, too long or too short | Edit the meta description      | Yoast or Rank Math description field, through the companion plugin |
| Image missing alt text                          | Set alt text on the media item | Core REST `media` endpoint                                         |
| Thin, duplicate or unwanted page                | Set the page to draft          | Core REST `pages` or `posts` endpoint                              |

Fix opens a panel with the current value read live from the site, an editable proposed value, and the checks the audit used (length, presence). Nothing is written until the user presses **Apply**. Bulk apply takes the same preview as a table.

Every applied change is recorded in a per-project change log: page, field, old value, new value, time, and whether it came from the app or an agent. Each entry has **Undo**. Undo writes the old value back only if the site still holds the value OpenSEO wrote. If someone has edited the field since, Undo stops and shows the three values so the user can decide.

Agents get two MCP tools with the same rules:

- `apply_site_fix` takes a project, a page URL, a field and a new value. It returns the change log entry, including the old value.
- `rollback_site_fix` takes a change log entry and applies the same conflict check as Undo.

There is no preview step in the MCP tools themselves. The agent is expected to show the user the proposed change first, and the shipped skills say so.

Page builder content (Elementor templates, headings and body copy) is out of scope. Those fixes stay manual and the audit keeps describing them.

## How it works

### Connecting

OpenSEO sends the browser to `/wp-admin/authorize-application.php` on the site with an app name, a stable app ID and a success URL. WordPress only returns the password to an `https` URL or to a non-web URL scheme. It refuses plain `http`, which rules out the desktop app's `127.0.0.1` loopback address. The desktop app therefore registers an `openseo://` link handler with Windows, and the success URL is `openseo://wordpress/connected?project=…&state=…`. Windows passes the link to the running app, which checks `state`, then hands the site URL, username and password to the local server.

Before saving, OpenSEO calls the site's REST API with the new credentials to confirm the user can edit posts, and records which SEO plugin is active and whether the companion plugin is present. Connection status and those findings are shown in project settings.

### Storing the credential

The connection is a row per project: site URL, WordPress username, the encrypted application password, detected SEO plugin and connection time. The password is encrypted with a key held by the desktop app in Windows-protected storage, the same way the app already stores the DataForSEO and Google keys. The key reaches the server as an environment variable at start-up, so the database file on its own does not reveal the password. Disconnecting deletes the row and asks the user to also revoke the password in WordPress, because OpenSEO cannot revoke it remotely without extra permissions.

### Applying a change

Fixes run through a service that takes a page URL, a field and a new value:

1. Resolve the URL to a WordPress post ID, and an image URL to an attachment ID, through the companion plugin's lookup route.
2. Read the current value.
3. Write the new value with the application password over HTTPS.
4. Read the value back and record the change log entry only when the write took effect.

All site requests go through the same outbound URL checks Site Audit uses, against the connected site's own host only.

### The companion plugin

Yoast and Rank Math keep their titles and descriptions in post meta that the WordPress REST API does not expose for writing. A small companion plugin, **OpenSEO Connector**, closes that gap. It:

- registers the Yoast (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`) and Rank Math (`rank_math_title`, `rank_math_description`) fields for REST writes, limited to users who can edit that post;
- adds a read-only lookup route that turns a page or image URL into its post or attachment ID;
- does nothing else, stores nothing and makes no outbound requests.

The plugin is a single PHP file the user installs once per site from a download in project settings. Without it, only the core fixes (alt text and draft) are offered, and the title and description buttons explain why they are unavailable.

## Security and client data

Client sites and the people who approve access are covered by South Africa's POPIA. The design keeps exposure small: credentials are scoped to one WordPress user, encrypted at rest, sent only to the site they belong to, and revocable by the client. Change logs hold page content values but no personal data beyond the approving username. Before any client site is connected, the feature gets a security review of credential storage, the link handler, the companion plugin's permission checks and the MCP tools' project scoping.

No fix reaches a live client site without the user pressing Apply, or approving the agent's proposal.

## Open questions

- **Client self-connect.** The `openseo://` link only works on the PC where the app is installed, so today the agency connects each site while signed in to it. Letting a client approve access from their own browser needs an `https` success URL that OpenSEO controls, which means a hosted relay or a hosted OpenSEO.
- **Yoast's own route.** Yoast has a `yoast/v1/bulk_editor` route that might avoid the companion plugin for Yoast sites. It is untested and undocumented, so v1 does not depend on it.
- **Multisite and staging.** Network installs and staging copies with different URLs are not handled in v1.

## Alternatives

**Asking for a username and application password in a form.** Simpler to build and works over plain loopback, but users have to create the password by hand in wp-admin and paste it, and it trains clients to send passwords around. The authorization screen keeps the password out of anyone's hands.

**A WordPress plugin that pulls fixes from OpenSEO.** This would make client self-connect easy, but it needs OpenSEO reachable from the internet and moves the logic into PHP on every site. A thin plugin that only exposes fields keeps the logic in OpenSEO.

**Writing through the Yoast or Rank Math REST APIs.** Neither plugin offers a documented endpoint for setting a post's SEO title and description. Registering their existing meta fields is the smallest stable surface.

**Writing every fix without the companion plugin.** Core REST covers alt text and post status, so those ship without it. Titles and descriptions are the most common audit fixes, which is why the plugin is part of v1 rather than deferred.

**Editing Elementor content.** Elementor stores layouts as JSON in post meta. Rewriting it from outside risks breaking a page in ways the preview can't show, so those fixes stay manual.
