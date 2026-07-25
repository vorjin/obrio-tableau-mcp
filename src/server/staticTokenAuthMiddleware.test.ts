import express from 'express';
import http from 'http';
import request from 'supertest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { startExpressServer } from './express.js';
import {
  StaticTokenAuthenticatedRequest,
  staticTokenAuthMiddleware,
} from './staticTokenAuthMiddleware.js';

const logMock = vi.hoisted(() => vi.fn());
vi.mock('../logging/logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../logging/logger.js')>()),
  log: logMock,
}));

const validToken = 'token-one';
const secondToken = 'token-two';

type ResponseDouble = {
  statusCode?: number;
  headers: Record<string, string>;
  body?: unknown;
  status: (code: number) => ResponseDouble;
  set: (name: string, value: string) => ResponseDouble;
  json: (payload: unknown) => ResponseDouble;
};

function createResponse(): ResponseDouble {
  const res: ResponseDouble = {
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };

  return res;
}

function createRequest(headers: Record<string, string>): StaticTokenAuthenticatedRequest {
  return {
    method: 'POST',
    path: '/tableau-mcp',
    ip: '203.0.113.5',
    headers,
  } as unknown as StaticTokenAuthenticatedRequest;
}

function invoke(headers: Record<string, string>): {
  req: StaticTokenAuthenticatedRequest;
  res: ResponseDouble;
  next: ReturnType<typeof vi.fn>;
} {
  const middleware = staticTokenAuthMiddleware();
  const req = createRequest(headers);
  const res = createResponse();
  const next = vi.fn();

  middleware(req, res as unknown as express.Response, next);

  return { req, res, next };
}

function expectRejected(res: ResponseDouble, next: ReturnType<typeof vi.fn>): void {
  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(401);
  expect(res.headers['WWW-Authenticate']).toBe('Bearer');
  expect(res.body).toEqual({ error: 'invalid_token' });
}

describe('staticTokenAuthMiddleware', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    logMock.mockClear();
    stubDefaultEnvVars();
    vi.stubEnv('MCP_USERS', `reporting=${validToken},analytics=${secondToken}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when constructed without a configured client list', () => {
    vi.stubEnv('MCP_USERS', undefined);

    expect(() => staticTokenAuthMiddleware()).toThrow(
      'Static token authentication is not configured',
    );
  });

  it('rejects a request with no Authorization header', () => {
    const { res, next } = invoke({});
    expectRejected(res, next);
  });

  it('rejects a non-Bearer scheme carrying a valid token', () => {
    const { res, next } = invoke({ authorization: `Basic ${validToken}` });
    expectRejected(res, next);
  });

  it('rejects a Bearer header with no credential', () => {
    const { res, next } = invoke({ authorization: 'Bearer ' });
    expectRejected(res, next);
  });

  it('rejects a bare scheme with no separator', () => {
    const { res, next } = invoke({ authorization: 'Bearer' });
    expectRejected(res, next);
  });

  it('rejects an unknown token', () => {
    const { res, next } = invoke({ authorization: 'Bearer not-a-configured-token' });
    expectRejected(res, next);
  });

  it('rejects a wrong token of the same length as a configured one', () => {
    expect(validToken).toHaveLength('token-xxx'.length);

    const { res, next } = invoke({ authorization: 'Bearer token-xxx' });
    expectRejected(res, next);
  });

  it('rejects a token that is a prefix of a configured one', () => {
    const { res, next } = invoke({ authorization: 'Bearer token-on' });
    expectRejected(res, next);
  });

  it('never reveals why a request was rejected', () => {
    const missing = invoke({});
    const unknown = invoke({ authorization: 'Bearer not-a-configured-token' });

    expect(missing.res.body).toEqual(unknown.res.body);
  });

  it('accepts a configured token and attaches its client name', () => {
    const { req, res, next } = invoke({ authorization: `Bearer ${validToken}` });

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined();
    expect(req.staticAuthClientName).toBe('reporting');
  });

  it('resolves each configured client to its own name', () => {
    const { req } = invoke({ authorization: `Bearer ${secondToken}` });

    expect(req.staticAuthClientName).toBe('analytics');
  });

  it('accepts a token containing "=" and tolerates a case-insensitive scheme', () => {
    vi.stubEnv('MCP_USERS', 'reporting=dG9rZW4=');

    const { req, next } = invoke({ authorization: 'bearer dG9rZW4=' });

    expect(next).toHaveBeenCalled();
    expect(req.staticAuthClientName).toBe('reporting');
  });

  it('logs a rejection without disclosing the presented token', () => {
    invoke({ authorization: 'Bearer super-secret-value' });

    expect(logMock).toHaveBeenCalled();
    expect(JSON.stringify(logMock.mock.calls)).not.toContain('super-secret-value');
  });

  it('records the caller details a rejection needs to be actionable', () => {
    invoke({ 'x-forwarded-for': '198.51.100.7' });

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        logger: 'auth',
        data: expect.objectContaining({
          method: 'POST',
          path: '/tableau-mcp',
          sourceAddress: '203.0.113.5',
          forwardedFor: '198.51.100.7',
        }),
      }),
    );
  });

  it('does not log an accepted request', () => {
    invoke({ authorization: `Bearer ${validToken}` });

    expect(logMock).not.toHaveBeenCalled();
  });
});

describe('staticTokenAuthMiddleware wiring', () => {
  let server: http.Server | undefined;
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('MCP_USERS', `reporting=${validToken}`);

    ({ app, server } = await startExpressServer({
      basePath: 'tableau-mcp',
      config: new Config(),
      logLevel: 'info',
    }));
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  it('serves the health probe without a credential', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('rejects an unauthenticated ping, so authentication precedes the ping responder', async () => {
    const response = await request(app)
      .post('/tableau-mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('answers a ping once authenticated', async () => {
    const response = await request(app)
      .post('/tableau-mcp')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('rejects an unauthenticated GET, which opens the server-to-client stream', async () => {
    const response = await request(app).get('/tableau-mcp');

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects an unauthenticated DELETE, which terminates a session', async () => {
    const response = await request(app).delete('/tableau-mcp');

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects a valid token presented in the query string, which the MCP specification prohibits', async () => {
    const response = await request(app)
      .post(`/tableau-mcp?access_token=${validToken}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects an unauthenticated initialize request', async () => {
    const response = await request(app)
      .post('/tableau-mcp')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x' } },
      });

    expect(response.status).toBe(401);
    expect(response.headers['mcp-session-id']).toBeUndefined();
  });
});
