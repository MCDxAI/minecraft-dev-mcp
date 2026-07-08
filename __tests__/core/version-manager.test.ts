import { describe, expect, it } from 'vitest';
import { MojangDownloader } from '../../src/downloaders/mojang-downloader.js';
import { getVersionManager } from '../../src/services/version-manager.js';
import { TEST_VERSION, UNOBFUSCATED_TEST_VERSION } from '../test-constants.js';

/**
 * Version Management Tests
 *
 * Tests the version manager's ability to:
 * - List available Minecraft versions from Mojang
 * - Verify version existence
 * - Handle invalid versions
 */

describe('Version Management', () => {
  it('should list available Minecraft versions from Mojang', async () => {
    const versionManager = getVersionManager();
    const versions = await versionManager.listAvailableVersions();

    expect(versions).toBeDefined();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain(TEST_VERSION);
  }, 30000);

  it('should verify version exists on Mojang servers', async () => {
    const downloader = new MojangDownloader();
    const exists = await downloader.versionExists(TEST_VERSION);

    expect(exists).toBe(true);
  }, 30000);

  it('should return false for non-existent version', async () => {
    const downloader = new MojangDownloader();
    const exists = await downloader.versionExists('999.999.999');

    expect(exists).toBe(false);
  }, 30000);

  describe('Unobfuscated version detection', () => {
    it('should return false for obfuscated versions', async () => {
      const versionManager = getVersionManager();
      // TEST_VERSION (1.21.11) is an obfuscated release - client_mappings present
      const result = await versionManager.isVersionUnobfuscated(TEST_VERSION);
      expect(result).toBe(false);
    }, 30000);

    it('should return false for legacy obfuscated versions without client_mappings metadata', async () => {
      const versionManager = getVersionManager();
      // Early 1.14.x versions can omit client_mappings while still being obfuscated.
      const result = await versionManager.isVersionUnobfuscated('1.14.3');
      expect(result).toBe(false);
    }, 30000);

    it('should return true for unobfuscated versions (26.1+)', async () => {
      const versionManager = getVersionManager();
      // 26.1 snapshots ship without obfuscation - no client_mappings in version JSON
      const result = await versionManager.isVersionUnobfuscated(UNOBFUSCATED_TEST_VERSION);
      expect(result).toBe(true);
    }, 30000);

    it('should return true for first unobfuscated boundary version (26.1-snapshot-1)', async () => {
      const versionManager = getVersionManager();
      const result = await versionManager.isVersionUnobfuscated('26.1-snapshot-1');
      expect(result).toBe(true);
    }, 30000);

    it('should return true for newer unobfuscated snapshot versions (26.1-snapshot-9)', async () => {
      const versionManager = getVersionManager();
      const result = await versionManager.isVersionUnobfuscated('26.1-snapshot-9');
      expect(result).toBe(true);
    }, 30000);

    // Regression tests for https://github.com/MCDxAI/minecraft-dev-mcp/issues/5
    it.each(['26.1-snapshot-10', '26.1-snapshot-11', '26.1-rc-3'])(
      'should return true for %s (issue #5)',
      async (version) => {
        const versionManager = getVersionManager();
        const result = await versionManager.isVersionUnobfuscated(version);
        expect(result).toBe(true);
      },
      30000,
    );
  });
});
