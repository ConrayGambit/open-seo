# WordPress connect and fix

A project can connect its WordPress site so that fixes found by Site Audit are applied from OpenSEO instead of by hand in wp-admin. Every change shows the old and new value before it is written, is logged, and can be undone.

This first version targets the Windows desktop app, which runs single-user on the owner's PC. A server deployment served over HTTPS uses the same flow with an `https` return address.

## What it does

Project settings gain a **Connect WordPress** action. It opens the site's own authorization screen, where a WordPress administrator or editor approves OpenSEO. WordPress then hands OpenSEO an application password for that user. OpenSEO never sees the user's login password, and the site owner can revoke access at any time under Users → Profile → Application Passwords.

Once connected, supported audit issues gain a **Fix** button:

| Audit issue                                     | Fix                            | Where it is written                                                |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Title missing, too long or too short            | Edit the SEO title             | Yoast or Rank Math title field, through the companion plugin       |
| Meta description missing, too long or too short | Edit the meta description      | Yoast or Rank Math description field, through the companion plugin |
| Image missing alt text                          | Set alt text on the media item | Core REST `media` endpoint                                         |
| Thin, duplicate or unwanted page                | Set the page to draft          | Core REST `pages` or `posts` endpoint                              |

Fix opens a panel with the current value read live from the site, an editable proposed value, and the recommended length. For titles and descriptions it shows both what the page renders and what the SEO plugin has saved, since an empty saved value means the plugin's template is used. For alt text it fetches the live page, lists the images without an `alt` attribute, and offers a field for each one in the Media Library. Nothing is written until the user presses **Apply**.

Every applied change is recorded in a per-project change log: page, field, old value, new value, time, and whether it came from the app or an agent. Each entry has **Undo**. Undo writes the old value back only if the site still holds the value OpenSEO wrote. If someone has edited the field since, Undo stops and shows the three values so the user can decide.

Agents get MCP tools with the same rules:

- `get_site_fix_state` reads a page's current values, so the agent can show them next to its proposal.
- `apply_site_fix` takes a project, a page URL, a field and a new value. It returns the change log entry, including the old value. Its description tells the agent to get the user's approval first.
- `rollback_site_fix` takes a change log entry and applies the same conflict check as Undo.
- `list_site_fix_changes` returns the change log.

Connecting, disconnecting, applying and undoing need the organization's integration permission, the same as Search Console and Analytics.

Page builder content (Elementor templates, headings and body copy) is out of scope. Those fixes stay manual and the audit keeps describing them.

## How it works

### Connecting

OpenSEO first reads the site's REST API index (`/wp-json/`, or `?rest_route=/` on sites without pretty links) to find the authorization screen. It then sends the browser there with an app name, a stable app ID and a success URL. The app name carries the time, because WordPress refuses two application passwords with the same name for one user. WordPress only returns the password to an `https` URL or to a non-web URL scheme. It refuses plain `http`, which rules out the desktop app's `127.0.0.1` loopback address. The desktop app therefore registers an `openseo://` link handler with Windows, and the success URL is `openseo://wordpress/connected?project=…&state=…`. Windows passes the link to the running app, which posts it to the local server's callback in the request body, so the password never appears in a URL the app loads. On a server deployment WordPress redirects the browser to the callback directly. The callback checks a single-use `state` that expires after 15 minutes and must belong to the signed-in user.

Before saving, OpenSEO calls the site's REST API with the new credentials to confirm the user can edit posts. Project settings then check the site live: whether the companion plugin is active and which SEO plugin it found.

### Storing the credential

The connection is a row per project: site URL, WordPress username, the encrypted application password, detected SEO plugin and connection time. The password is encrypted with `WORDPRESS_CREDENTIALS_SECRET`. The desktop app generates that key once and keeps it in Windows-protected storage, the same way it stores the DataForSEO and Google keys, and passes it to the server at start-up. The database file on its own does not reveal the password. Without the key, the WordPress card explains that connections are not set up. Disconnecting revokes OpenSEO's own application password on the site through WordPress's introspection endpoint, then deletes the row; if the site can't be reached, the card tells the user to revoke it in WordPress.

### Applying a change

Fixes run through a service that takes a page URL, a field and a new value:

1. Check the page is on the connected site.
2. Resolve the URL to a WordPress post ID, or an image URL to an attachment ID, through the companion plugin.
3. Read the current value. If it already matches, nothing is written or logged.
4. Write the new value as the connected user, and log the value WordPress returns after sanitizing it.

Undo reads the field again and writes the old value only if it still equals the logged new value, so a change made by someone else in wp-admin is never overwritten. All site requests go through the same outbound URL checks Site Audit uses and never follow redirects.

Alt text lives on the Media Library item. Page builders such as Elementor read it when the page renders, so the fix shows immediately. The block editor copies alt text into the page when an image is inserted, so those images keep their old markup; the panel says so.

### The companion plugin

Yoast and Rank Math keep their titles and descriptions in post meta that the WordPress REST API does not expose, and core REST has no reliable way to turn a public URL into a post ID. A small companion plugin, **OpenSEO Connector**, closes both gaps under an `openseo/v1` namespace:

- `lookup` and `post/{id}` return a page's ID, type, status and its Yoast (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`) or Rank Math (`rank_math_title`, `rank_math_description`) values, including the static front page;
- `media-lookup` turns image URLs, including resized copies, into Media Library IDs;
- `seo/{id}` writes the title or description to whichever SEO plugin is active, and an empty value removes the override so the plugin's template applies.

Every route requires an authenticated user who can edit that post, and the plugin stores nothing and makes no outbound requests. It is a single PHP file the user downloads from the WordPress card in project settings as an installable zip. Every fix needs it, so the card reports when it is missing.

## Security and client data

Client sites and the people who approve access are covered by South Africa's POPIA. The design keeps exposure small: credentials are scoped to one WordPress user, encrypted at rest, sent only to the site they belong to, and revocable by the client. Change logs hold page content values but no personal data beyond the approving username. Before any client site is connected, the feature gets a security review of credential storage, the link handler, the companion plugin's permission checks and the MCP tools' project scoping.

No fix reaches a live client site without the user pressing Apply, or approving the agent's proposal.

## Open questions

- **Client self-connect.** The `openseo://` link only works on the PC where the app is installed, so today the agency connects each site while signed in to it. Letting a client approve access from their own browser needs an `https` success URL that OpenSEO controls, which means a hosted relay or a hosted OpenSEO.
- **Yoast's own route.** Yoast has a `yoast/v1/bulk_editor` route that might avoid the companion plugin for Yoast sites. It is undocumented, so v1 does not depend on it.
- **Block editor alt text.** Updating the `alt` attribute inside saved block markup would fix images placed with the block editor, at the cost of rewriting post content.
- **Multisite and staging.** Network installs and staging copies with different URLs are not handled in v1.

## Alternatives

**Asking for a username and application password in a form.** Simpler to build and works over plain loopback, but users have to create the password by hand in wp-admin and paste it, and it trains clients to send passwords around. The authorization screen keeps the password out of anyone's hands.

**A WordPress plugin that pulls fixes from OpenSEO.** This would make client self-connect easy, but it needs OpenSEO reachable from the internet and moves the logic into PHP on every site. A thin plugin that only exposes fields keeps the logic in OpenSEO.

**Writing through the Yoast or Rank Math REST APIs.** Neither plugin offers a documented endpoint for setting a post's SEO title and description. Registering their existing meta fields is the smallest stable surface.

**Registering the SEO plugins' meta keys for core REST writes.** That works for posts and pages but needs the keys registered per post type, and Yoast's keys are protected meta. A dedicated route is smaller and checks `edit_post` itself.

**Writing fixes without the companion plugin.** Core REST can change alt text and post status, but matching a crawled URL to a post or an image needs guesswork by slug or file name. One small plugin keeps every fix exact.

**Editing Elementor content.** Elementor stores layouts as JSON in post meta. Rewriting it from outside risks breaking a page in ways the preview can't show, so those fixes stay manual.
