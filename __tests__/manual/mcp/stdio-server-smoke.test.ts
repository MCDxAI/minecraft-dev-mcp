import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpTestSession, createMcpSession, extractFirstText } from '../../helpers/mcp-stdio.js';
import { TEST_MAPPING, TEST_VERSION, UNOBFUSCATED_TEST_VERSION } from '../../test-constants.js';

/**
 * True MCP transport E2E tests.
 *
 * These tests start the actual stdio server process (src/dist index entrypoint)
 * and call tools/resources through an MCP client.
 */
describe('MCP Stdio Server Smoke', () => {
  let session: McpTestSession;
  const longRequest = {
    timeout: 900000,
    maxTotalTimeout: 900000,
  };

  beforeAll(async () => {
    session = await createMcpSession('mcp-stdio-smoke-tests');
  }, 120000);

  afterAll(async () => {
    if (session) {
      await session.close();
    }
  }, 30000);

  it('should list tools over stdio transport', async () => {
    const result = await session.client.listTools();

    expect(result.tools.length).toBe(20);
    const toolNames = result.tools.map((tool) => tool.name);
    expect(toolNames).toContain('decompile_minecraft_version');
    expect(toolNames).toContain('get_minecraft_source');
    expect(toolNames).toContain('get_registry_data');
  }, 30000);

  it('should read versions resource over stdio transport', async () => {
    const result = await session.client.readResource({
      uri: 'minecraft://versions/list',
    });

    expect(result.contents.length).toBe(1);
    const first = result.contents[0];
    expect('text' in first).toBe(true);
    expect(typeof first.text).toBe('string');

    const data = JSON.parse(first.text ?? '{}');
    expect(Array.isArray(data.available)).toBe(true);
    expect(data.total_available).toBeGreaterThan(0);
  }, 30000);

  it('should decompile obfuscated version via stdio tool call', async () => {
    const result = await session.client.callTool(
      {
        name: 'decompile_minecraft_version',
        arguments: {
          version: TEST_VERSION,
          mapping: TEST_MAPPING,
          force: false,
        },
      },
      undefined,
      longRequest,
    );

    expect(result.isError).not.toBe(true);
    const text = extractFirstText(result.content);
    expect(text).toContain(TEST_VERSION);
    expect(text).toContain(TEST_MAPPING);
    expect(text).toMatch(/completed|classes/i);
  }, 600000);

  it('should fail with actionable message for unobfuscated yarn via stdio tool call', async () => {
    const result = await session.client.callTool(
      {
        name: 'decompile_minecraft_version',
        arguments: {
          version: UNOBFUSCATED_TEST_VERSION,
          mapping: 'yarn',
          force: false,
        },
      },
      undefined,
      longRequest,
    );

    expect(result.isError).toBe(true);
    const text = extractFirstText(result.content);
    expect(text).toContain('Decompilation failed:');
    expect(text).toContain('mojmap');
    expect(text).toMatch(/use ['"]mojmap['"] mapping/i);
  }, 120000);

  it('should decompile unobfuscated version with mojmap via stdio tool call', async () => {
    const result = await session.client.callTool(
      {
        name: 'decompile_minecraft_version',
        arguments: {
          version: UNOBFUSCATED_TEST_VERSION,
          mapping: 'mojmap',
          force: false,
        },
      },
      undefined,
      longRequest,
    );

    expect(result.isError).not.toBe(true);
    const text = extractFirstText(result.content);
    expect(text).toContain(UNOBFUSCATED_TEST_VERSION);
    expect(text).toContain('mojmap');
    expect(text).toMatch(/completed|classes/i);
  }, 900000);
});
