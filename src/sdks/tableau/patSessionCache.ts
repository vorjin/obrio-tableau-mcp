import { ExpiringMap } from '../../utils/expiringMap.js';
import { RestApiCredentials } from './restApi.js';

// A Personal Access Token permits only one active REST session: signing in again with the same token
// terminates the previous session. Signing in and out on every tool call therefore both triples request
// volume (sign-in, call, sign-out) and races concurrent calls into invalidating each other. Instead, a
// single session is cached and reused across calls, kept safely below Tableau's fixed session lifetime.
const SESSION_TTL_MS = 100 * 60 * 1000;

let cache: ExpiringMap<string, RestApiCredentials> | undefined;
const inFlightSignIns = new Map<string, Promise<RestApiCredentials>>();

function getCache(): ExpiringMap<string, RestApiCredentials> {
  if (!cache) {
    cache = new ExpiringMap<string, RestApiCredentials>({
      defaultExpirationTimeMs: SESSION_TTL_MS,
    });
  }

  return cache;
}

export function buildSessionCacheKey(siteName: string, patName: string): string {
  return `${siteName}::${patName}`;
}

export function getCachedSession(key: string): RestApiCredentials | undefined {
  return getCache().get(key);
}

// Drop every cached session and any in-flight sign-in. Intended for test isolation.
export function clearCachedSessions(): void {
  getCache().clear();
  inFlightSignIns.clear();
}

export function invalidateCachedSession(key: string): void {
  getCache().delete(key);
}

/**
 * Return the cached session for `key`, or run `signIn` once to create it. Concurrent first-callers share a
 * single sign-in: the first runs it, the rest await the same promise, so a burst never opens competing
 * sessions. A failed sign-in clears the in-flight entry so a later call can retry.
 */
export async function getOrCreateSession(
  key: string,
  signIn: () => Promise<RestApiCredentials>,
): Promise<RestApiCredentials> {
  const cached = getCache().get(key);
  if (cached) {
    return cached;
  }

  const existing = inFlightSignIns.get(key);
  if (existing) {
    return existing;
  }

  const signInPromise = (async () => {
    const credentials = await signIn();
    getCache().set(key, credentials);
    return credentials;
  })();
  inFlightSignIns.set(key, signInPromise);

  try {
    return await signInPromise;
  } finally {
    inFlightSignIns.delete(key);
  }
}
