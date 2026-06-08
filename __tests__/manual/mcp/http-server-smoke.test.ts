import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HttpMcpServer, startHttpMcpServer } from '../../helpers/mcp-http.js';

/**
 * True MCP HTTP transport E2E tests.
 *
 * Starts the actual server in HTTP mode (`--http`) on an ephemeral port and
 * drives it through the MCP Streamable HTTP client transport. Verifies tool
 * listing, resource reads, per-session isolation, and the bad-request path.
 *
 * Lives in the manual suite (alongside the stdio smoke) because it spawns the
 * real Java-gated server and reads the live Mojang version manifest.
 */
describe('MCP HTTP Server Smoke', () => {
  let server: HttpMcpServer;

  beforeAll(async () => {
    server = await startHttpMcpServer();
  }, 60000);

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  }, 30000);

  it('lists tools over the HTTP transport', async () => {
    const { client, close } = await server.connectClient('http-smoke-tools');
    try {
      const result = await client.listTools();
      expect(result.tools.length).toBe(20);
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('get_minecraft_source');
      expect(names).toContain('decompile_minecraft_version');
      expect(names).toContain('get_registry_data');
    } finally {
      await close();
    }
  }, 30000);

  it('reads the versions resource over the HTTP transport', async () => {
    const { client, close } = await server.connectClient('http-smoke-resource');
    try {
      const result = await client.readResource({ uri: 'minecraft://versions/list' });
      expect(result.contents.length).toBe(1);
      const first = result.contents[0];
      expect(typeof first.text).toBe('string');

      const data = JSON.parse(first.text ?? '{}');
      expect(Array.isArray(data.available)).toBe(true);
      expect(data.total_available).toBeGreaterThan(0);
    } finally {
      await close();
    }
  }, 30000);

  it('isolates concurrent client sessions', async () => {
    const a = await server.connectClient('http-smoke-session-a');
    const b = await server.connectClient('http-smoke-session-b');
    try {
      // Both independent sessions must work against the same server process.
      const [ra, rb] = await Promise.all([a.client.listTools(), b.client.listTools()]);
      expect(ra.tools.length).toBe(20);
      expect(rb.tools.length).toBe(20);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }, 30000);

  it('accepts the session id via ?sessionId= query param (browser EventSource fallback)', async () => {
    const accept = 'application/json, text/event-stream';

    // 1. Initialize to obtain a session id (returned in the response header).
    const initRes = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: accept },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'query-smoke', version: '0.0.0' },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const sid = initRes.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    await initRes.text();

    // 2. Complete the handshake using ONLY the query param (no header).
    const notifyRes = await fetch(`${server.url}?sessionId=${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: accept },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notifyRes.status).toBeLessThan(300);
    await notifyRes.text();

    // 3. tools/list using ONLY the query param must be accepted.
    const listRes = await fetch(`${server.url}?sessionId=${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: accept },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(listRes.status).toBe(200);

    const text = await listRes.text();
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    expect(dataLine).toBeTruthy();
    const payload = JSON.parse((dataLine as string).slice('data:'.length).trim());
    expect(payload.result.tools.length).toBe(20);
  }, 30000);

  it('rejects a POST without a session id that is not an initialize request', async () => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe(-32000);
    expect(body.error?.message).toMatch(/no valid session id/i);
  }, 15000);

  it('rejects a GET without a valid session id', async () => {
    const res = await fetch(server.url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    expect(res.status).toBe(400);
  }, 15000);
});
