import { symmetricDecrypt } from "better-auth/crypto";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  WordpressRepository,
  type WordpressConnection,
} from "@/server/features/wordpress/WordpressRepository";
import {
  WordpressError,
  type WordpressCredentials,
} from "@/server/features/wordpress/wordpressClient";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

export async function getEncryptionKey(): Promise<string> {
  const secret = (
    await getOptionalEnvValue("WORDPRESS_CREDENTIALS_SECRET")
  )?.trim();
  if (!secret || secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new WordpressError(
      `WordPress connections are not set up on this server. Set WORDPRESS_CREDENTIALS_SECRET to at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

export async function isWordpressConfigured() {
  const secret = (
    await getOptionalEnvValue("WORDPRESS_CREDENTIALS_SECRET")
  )?.trim();
  return Boolean(secret && secret.length >= MIN_BETTER_AUTH_SECRET_LENGTH);
}

export async function credentialsFor(
  connection: WordpressConnection,
): Promise<WordpressCredentials> {
  const key = await getEncryptionKey();
  let password: string;
  try {
    password = await symmetricDecrypt({
      key,
      data: connection.encryptedPassword,
    });
  } catch {
    throw new WordpressError(
      "OpenSEO can no longer read this site's saved password. Connect the site again.",
    );
  }
  return {
    restUrl: connection.restUrl,
    username: connection.username,
    password,
  };
}

export async function requireConnection(projectId: string) {
  const connection = await WordpressRepository.getConnection(projectId);
  if (!connection) {
    throw new WordpressError(
      "This project isn't connected to a WordPress site. Connect it in project settings under Integrations.",
    );
  }
  return { connection, credentials: await credentialsFor(connection) };
}

function bareHost(url: string) {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** True when both URLs are on the same host, ignoring a leading www. */
export function sameSite(a: string, b: string) {
  try {
    return bareHost(a) === bareHost(b);
  } catch {
    return false;
  }
}
