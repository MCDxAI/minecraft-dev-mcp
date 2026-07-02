import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { getVersionManager } from '../../src/services/version-manager.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * JAR Download Tests
 *
 * Tests VersionManager's ability to (download + SHA verify + cache.db bookkeeping):
 * - Download Minecraft client JARs from Mojang
 * - Cache downloaded JARs
 * - Verify JAR integrity
 */

describe('JAR Download', () => {
  it(`should download Minecraft ${TEST_VERSION} client JAR`, async () => {
    const versionManager = getVersionManager();
    const cacheManager = getCacheManager();

    // Download the JAR via VersionManager: downloads + SHA-verifies the file AND
    // records it in cache.db. Using the raw downloader here would write the file
    // but leave cache.db empty, so hasVersionJar() (which checks cache.db) would
    // fail whenever the CI pre-decompile step was a cache-hit no-op.
    const jarPath = await versionManager.getVersionJar(TEST_VERSION, (downloaded, total) => {
      // Progress callback
      console.log(`Download progress: ${((downloaded / total) * 100).toFixed(1)}%`);
    });

    expect(jarPath).toBeDefined();
    expect(existsSync(jarPath)).toBe(true);
    expect(jarPath).toContain(TEST_VERSION);
    expect(jarPath).toContain('.jar');

    // Verify it's cached
    expect(cacheManager.hasVersionJar(TEST_VERSION)).toBe(true);
    expect(cacheManager.getVersionJarPath(TEST_VERSION)).toBe(jarPath);
  }, 300000); // 5 minutes timeout for download
});
