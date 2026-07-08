import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getVersionManager } from '../../../src/services/version-manager.js';
import {
  type McpTestSession,
  createMcpSession,
  extractFirstText,
} from '../../helpers/mcp-stdio.js';
import { parseMatrixVersionsFromEnv } from './test-constants.js';

const matrixVersions = parseMatrixVersionsFromEnv();
const unobfuscatedCache = new Map<string, boolean>();

async function isUnobfuscatedVersion(version: string): Promise<boolean> {
  const cached = unobfuscatedCache.get(version);
  if (cached !== undefined) {
    return cached;
  }

  const versionManager = getVersionManager();
  const result = await versionManager.isVersionUnobfuscated(version);
  unobfuscatedCache.set(version, result);
  return result;
}

/**
 * Manual matrix for true MCP stdio E2E validation.
 *
 * This suite starts the real MCP server and calls tools over transport across
 * multiple Minecraft versions.
 *
 * Run all defaults:
 *   npm run test:manual:mcp
 *
 * Run a subset:
 *   MCP_E2E_VERSIONS=1.21.11,26.1-snapshot-1,26.1-snapshot-9 npm run test:manual:mcp
 */
describe('Manual MCP Stdio Matrix', () => {
  let session: McpTestSession;
  const longRequest = {
    timeout: 900000,
    maxTotalTimeout: 900000,
  };

  beforeAll(async () => {
    session = await createMcpSession('mcp-stdio-manual-matrix');
  }, 120000);

  afterAll(async () => {
    if (session) {
      await session.close();
    }
  }, 30000);

  it('should list tools and resources over stdio transport', async () => {
    const tools = await session.client.listTools();
    const resources = await session.client.listResources();

    expect(tools.tools.length).toBe(20);
    expect(resources.resources.length).toBeGreaterThan(0);
  }, 30000);

  for (const version of matrixVersions) {
    it(`should enforce expected yarn behavior for ${version} over stdio`, async () => {
      const unobfuscated = await isUnobfuscatedVersion(version);

      const result = await session.client.callTool(
        {
          name: 'decompile_minecraft_version',
          arguments: {
            version,
            mapping: 'yarn',
            force: false,
          },
        },
        undefined,
        longRequest,
      );

      const text = extractFirstText(result.content);
      if (unobfuscated) {
        expect(result.isError).toBe(true);
        expect(text).toContain('mojmap');
        expect(text).toMatch(/use ['"]mojmap['"] mapping/i);
      } else {
        expect(result.isError).not.toBe(true);
        expect(text).toContain(version);
        expect(text).toContain('yarn');
        expect(text).toMatch(/completed|classes/i);
      }
    }, 900000);

    it(`should return MinecraftServer source for ${version} using the expected mapping over stdio`, async () => {
      const unobfuscated = await isUnobfuscatedVersion(version);
      const mapping = unobfuscated ? 'mojmap' : 'yarn';
      const className = 'net.minecraft.server.MinecraftServer';

      const result = await session.client.callTool(
        {
          name: 'get_minecraft_source',
          arguments: {
            version,
            className,
            mapping,
          },
        },
        undefined,
        longRequest,
      );

      expect(result.isError).not.toBe(true);
      const text = extractFirstText(result.content);
      expect(text).toContain('class MinecraftServer');
    }, 600000);
  }
});
