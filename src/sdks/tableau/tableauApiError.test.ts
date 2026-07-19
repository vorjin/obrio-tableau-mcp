import { describe, expect, it } from 'vitest';

import { isRateLimitError, parseTableauApiError } from './tableauApiError.js';

const axiosError = (status: number, data: unknown): unknown => ({
  isAxiosError: true,
  response: { status, data },
});

describe('parseTableauApiError', () => {
  it('extracts status, code, summary, and detail from a Tableau error body', () => {
    const parsed = parseTableauApiError(
      axiosError(400, {
        error: { code: '400001', summary: 'Bad Request', detail: 'Invalid field' },
      }),
    );

    expect(parsed).toEqual({
      status: 400,
      code: '400001',
      summary: 'Bad Request',
      detail: 'Invalid field',
    });
  });

  it('returns null for a non-axios error', () => {
    expect(parseTableauApiError(new Error('nope'))).toBeNull();
  });

  it('returns null when the body does not match the Tableau shape', () => {
    expect(parseTableauApiError(axiosError(400, { message: 'not a tableau error' }))).toBeNull();
  });
});

describe('isRateLimitError', () => {
  it('is true for an HTTP 429', () => {
    expect(isRateLimitError(axiosError(429, {}))).toBe(true);
  });

  it('is true for the 429000 error code regardless of status', () => {
    expect(isRateLimitError(axiosError(503, { error: { code: '429000' } }))).toBe(true);
  });

  it('is false for a 400', () => {
    expect(isRateLimitError(axiosError(400, { error: { code: '400001' } }))).toBe(false);
  });

  it('is false for a non-axios error', () => {
    expect(isRateLimitError(new Error('x'))).toBe(false);
  });
});
