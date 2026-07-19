import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSessionCacheKey,
  clearCachedSessions,
  getCachedSession,
  getOrCreateSession,
  invalidateCachedSession,
} from './patSessionCache.js';
import { RestApiCredentials } from './restApi.js';

const makeCredentials = (token: string): RestApiCredentials =>
  ({
    type: 'X-Tableau-Auth',
    site: { id: 'site-1' },
    user: { id: 'user-1' },
    token,
  }) as RestApiCredentials;

describe('patSessionCache', () => {
  beforeEach(() => {
    clearCachedSessions();
  });

  it('builds a stable key from site and PAT name', () => {
    expect(buildSessionCacheKey('my-site', 'my-pat')).toBe('my-site::my-pat');
  });

  it('signs in once then serves the cached session', async () => {
    const signIn = vi.fn().mockResolvedValue(makeCredentials('a'));

    const first = await getOrCreateSession('k', signIn);
    const second = await getOrCreateSession('k', signIn);

    expect(first).toBe(second);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(getCachedSession('k')).toBe(first);
  });

  it('runs a single sign-in for concurrent first-callers', async () => {
    let resolveSignIn: (credentials: RestApiCredentials) => void = () => {};
    const signIn = vi.fn().mockImplementation(
      () =>
        new Promise<RestApiCredentials>((resolve) => {
          resolveSignIn = resolve;
        }),
    );

    const first = getOrCreateSession('k', signIn);
    const second = getOrCreateSession('k', signIn);
    resolveSignIn(makeCredentials('a'));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('retries a sign-in after a failure clears the in-flight entry', async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeCredentials('b'));

    await expect(getOrCreateSession('k', signIn)).rejects.toThrow('boom');
    const result = await getOrCreateSession('k', signIn);

    expect(result.token).toBe('b');
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the cached session so the next call signs in again', async () => {
    const signIn = vi.fn().mockResolvedValue(makeCredentials('a'));

    await getOrCreateSession('k', signIn);
    invalidateCachedSession('k');
    expect(getCachedSession('k')).toBeUndefined();

    await getOrCreateSession('k', signIn);
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
