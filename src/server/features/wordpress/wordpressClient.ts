import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  isCrawlableUrl,
  normalizeAndValidateStartUrl,
} from "@/server/lib/audit/url-policy";

/**
 * HTTP access to a connected WordPress site's REST API. Every failure a user
 * can act on becomes a WordpressError whose message is safe to show them.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export class WordpressError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "WordpressError";
  }
}

export type WordpressCredentials = {
  restUrl: string;
  username: string;
  password: string;
};

/** Build a REST URL for both pretty (/wp-json/) and plain (?rest_route=) roots. */
function restEndpoint(
  restUrl: string,
  route: string,
  query: Record<string, string> = {},
) {
  const root = new URL(restUrl);
  let url: URL;
  if (root.searchParams.has("rest_route")) {
    url = new URL(root);
    url.searchParams.set("rest_route", `/${route}`);
  } else {
    url = new URL(route, root.href.endsWith("/") ? root : `${root.href}/`);
  }
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function basicAuth(credentials: WordpressCredentials) {
  return `Basic ${btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(
        `${credentials.username}:${credentials.password}`,
      ),
    ),
  )}`;
}

const wpErrorSchema = z.object({ code: z.string(), message: z.string() });

function describeFailure(status: number, body: unknown, route: string) {
  const wpError = wpErrorSchema.safeParse(body);
  const code = wpError.success ? wpError.data.code : null;
  if (status === 401 || code === "incorrect_password") {
    return "WordPress rejected OpenSEO's password. It may have been revoked. Connect the site again.";
  }
  if (code === "rest_no_route" && route.startsWith("openseo/")) {
    return "The OpenSEO Connector plugin isn't active on this site. Install it from the WordPress card in project settings.";
  }
  if (status === 403) {
    return "The connected WordPress user isn't allowed to make this change.";
  }
  if (wpError.success) {
    return `WordPress said: ${wpError.data.message.slice(0, 300)}`;
  }
  return `The site answered with HTTP ${status}.`;
}

/** Call the site's REST API as the connected user. */
export async function wordpressRequest(
  credentials: WordpressCredentials,
  route: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    query?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const url = restEndpoint(credentials.restUrl, route, options.query);
  if (!isCrawlableUrl(url.href)) {
    throw new WordpressError("OpenSEO can't reach this site's address.");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      redirect: "manual",
      headers: {
        Authorization: basicAuth(credentials),
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new WordpressError(
      "The WordPress site didn't respond. Check that it's online and try again.",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new WordpressError(
      "The WordPress site redirected OpenSEO's request. If the site moved to a new address, connect it again.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WordpressError(describeFailure(response.status, body, route));
  }
  return body;
}

/** GET a public URL with redirects revalidated; returns the final response and URL. */
async function fetchPublic(
  input: string,
  accept: string,
): Promise<{ response: Response; url: string }> {
  let current = await normalizeAndValidateStartUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { Accept: accept, "User-Agent": "OpenSEO/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, url: current };
    }
    current = await normalizeAndValidateStartUrl(
      new URL(location, current).toString(),
    );
  }
  throw new WordpressError("The site redirected too many times.");
}

const restIndexSchema = z.object({
  home: z.string(),
  namespaces: z.array(z.string()),
  authentication: z
    .object({
      "application-passwords": z
        .object({ endpoints: z.object({ authorization: z.string() }) })
        .optional(),
    })
    .partial()
    .or(z.array(z.unknown()))
    .optional(),
});

type DiscoveredSite = {
  homeUrl: string;
  restUrl: string;
  authorizeUrl: string;
};

/**
 * Find a site's REST API and its Authorize Application screen. Tries the
 * pretty /wp-json/ root first, then ?rest_route= for sites on plain links.
 */
export async function discoverWordpressSite(
  siteUrl: string,
): Promise<DiscoveredSite> {
  let origin: string;
  try {
    origin = new URL(await normalizeAndValidateStartUrl(siteUrl)).origin;
  } catch (error) {
    if (error instanceof AppError && error.code === "CRAWL_TARGET_BLOCKED") {
      throw new WordpressError("OpenSEO can't connect to this address.");
    }
    throw new WordpressError("Enter the site's address, like example.com.");
  }

  for (const candidate of [`${origin}/wp-json/`, `${origin}/?rest_route=/`]) {
    let fetched: { response: Response; url: string };
    try {
      fetched = await fetchPublic(candidate, "application/json");
    } catch (error) {
      if (error instanceof WordpressError) throw error;
      throw new WordpressError(
        "The site didn't respond. Check the address and that the site is online.",
      );
    }
    if (!fetched.response.ok) continue;
    const parsed = restIndexSchema.safeParse(
      await fetched.response.json().catch(() => null),
    );
    if (!parsed.success) continue;

    const authorizeUrl = Array.isArray(parsed.data.authentication)
      ? undefined
      : parsed.data.authentication?.["application-passwords"]?.endpoints
          .authorization;
    if (!authorizeUrl) {
      throw new WordpressError(
        "Application passwords are turned off on this site. WordPress only offers them over HTTPS, and some security plugins disable them.",
      );
    }
    const home = new URL(parsed.data.home);
    const authorize = new URL(authorizeUrl);
    if (
      authorize.hostname !== home.hostname ||
      !["http:", "https:"].includes(authorize.protocol)
    ) {
      throw new WordpressError(
        "This site's sign-in page is on a different address, which OpenSEO doesn't support.",
      );
    }
    return {
      homeUrl: parsed.data.home,
      restUrl: fetched.url,
      authorizeUrl,
    };
  }
  throw new WordpressError(
    "This doesn't look like a WordPress site, or its REST API is turned off.",
  );
}

/** Fetch a public page's HTML from the connected site. */
export async function fetchPageHtml(pageUrl: string): Promise<string> {
  const { response } = await fetchPublic(pageUrl, "text/html");
  if (!response.ok) {
    throw new WordpressError(
      `The page answered with HTTP ${response.status}, so OpenSEO couldn't read its images.`,
    );
  }
  return response.text();
}
