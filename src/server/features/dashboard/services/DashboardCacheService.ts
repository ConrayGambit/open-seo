import { z } from "zod";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { DataRefreshClaimRepository } from "@/server/features/dashboard/repositories/DataRefreshClaimRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import { errorCodeSchema } from "@/shared/error-codes";

// Cached provider responses are disposable; keep them longer than their refresh
// cadence so credit/provider failures can display the last successful result.
async function readThrough<T>(input: {
  namespace: string;
  organizationId: string;
  params: Record<string, unknown>;
  schema: z.ZodType<T>;
  maxAgeMs: number;
  load: () => Promise<T>;
}) {
  const key = await buildCacheKey(input.namespace, {
    ...input.params,
    organizationId: input.organizationId,
  });
  const schema = z.object({ value: input.schema, fetchedAt: z.string() });
  const parsed = schema.safeParse(await getCached(key));
  const cached = parsed.success ? parsed.data : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < input.maxAgeMs) {
    return { ...cached, stale: false, refreshError: null };
  }
  const token = await DataRefreshClaimRepository.claim(
    key,
    input.organizationId,
  );
  // A failed cold load pauses retries; repeat its error meanwhile so the card
  // keeps showing the real cause, not "too many requests".
  const failureKey = `${key}:failure`;
  if (!token) {
    if (cached)
      return {
        ...cached,
        stale: true,
        refreshError: "Update already running or temporarily paused.",
      };
    const failure = z
      .object({ code: errorCodeSchema })
      .safeParse(await getCached(failureKey));
    if (failure.success) throw new AppError(failure.data.code);
    throw new AppError(
      "RATE_LIMITED",
      "An update is already running or temporarily paused. Try again shortly.",
    );
  }
  try {
    // Recheck after winning the claim: a preceding request may have completed
    // between the initial cache read and this database write.
    const latest = schema.safeParse(await getCached(key));
    if (
      latest.success &&
      Date.now() - Date.parse(latest.data.fetchedAt) < input.maxAgeMs
    ) {
      await DataRefreshClaimRepository.finish(key, token, 0);
      return { ...latest.data, stale: false, refreshError: null };
    }
    const value = input.schema.parse(await input.load());
    const result = { value, fetchedAt: new Date().toISOString() };
    await setCached(key, result, 90 * 86400);
    await DataRefreshClaimRepository.finish(key, token, 0);
    return { ...result, stale: false, refreshError: null };
  } catch (error) {
    await DataRefreshClaimRepository.finish(key, token, 5 * 60_000);
    const code = asAppError(error)?.code ?? "UPSTREAM_UNAVAILABLE";
    if (!cached) {
      await setCached(failureKey, { code }, 5 * 60);
      throw error;
    }
    return { ...cached, stale: true, refreshError: code };
  }
}

export const DashboardCacheService = { readThrough };
