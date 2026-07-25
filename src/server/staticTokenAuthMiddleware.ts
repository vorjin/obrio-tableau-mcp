import { createHash, timingSafeEqual } from 'crypto';
import express, { NextFunction, RequestHandler, Response } from 'express';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { getHeader } from './requestUtils.js';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_SCHEME = 'bearer';

export type StaticTokenAuthenticatedRequest = express.Request & {
  staticAuthClientName?: string;
};

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Returns the credential from an `Authorization: Bearer <token>` header value, or an empty string
 * when the header is absent, uses another scheme, or carries no credential.
 */
function getBearerToken(headerValue: string): string {
  const separatorIndex = headerValue.indexOf(' ');
  if (separatorIndex < 0) {
    return '';
  }

  if (headerValue.slice(0, separatorIndex).toLowerCase() !== BEARER_SCHEME) {
    return '';
  }

  return headerValue.slice(separatorIndex + 1).trim();
}

/**
 * Requires a pre-shared bearer token on every request and resolves it to a client name.
 *
 * The credential is read from the `Authorization` header only: the MCP specification forbids
 * carrying access tokens in the URI query string, where they would also reach proxy and CDN access
 * logs. Rejections reveal nothing about the reason, and the challenge is a bare `Bearer` because no
 * protected-resource metadata is served for a client to discover.
 */
export function staticTokenAuthMiddleware(): RequestHandler {
  const { staticAuthClients } = getConfig();

  if (staticAuthClients.length === 0) {
    throw new Error('Static token authentication is not configured');
  }

  const clients = staticAuthClients.map(({ name, token }) => ({
    name,
    digest: tokenDigest(token),
  }));

  return (req: express.Request, res: Response, next: NextFunction): void => {
    const presentedToken = getBearerToken(getHeader(req, AUTHORIZATION_HEADER));
    if (!presentedToken) {
      rejectRequest(req, res, 'missing or malformed Authorization header');
      return;
    }

    const presentedDigest = tokenDigest(presentedToken);

    let clientName: string | undefined;
    for (const client of clients) {
      // No early exit and equal-length digests: match position, client count and token length stay hidden.
      if (timingSafeEqual(presentedDigest, client.digest)) {
        clientName = client.name;
      }
    }

    if (!clientName) {
      rejectRequest(req, res, 'unrecognized token');
      return;
    }

    (req as StaticTokenAuthenticatedRequest).staticAuthClientName = clientName;
    next();
  };
}

function rejectRequest(req: express.Request, res: Response, reason: string): void {
  log({
    message: `Rejected unauthenticated request: ${reason}`,
    level: 'warning',
    logger: 'auth',
    data: {
      method: req.method,
      path: req.path,
      sourceAddress: req.ip,
      // Client-supplied, so an operational hint about an unknown caller and never a trust signal.
      forwardedFor: getHeader(req, 'x-forwarded-for') || undefined,
    },
  });

  res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'invalid_token' });
}
