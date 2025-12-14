import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { MojangDownloader } from '../../src/downloaders/mojang-downloader.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * JAR Download Tests
 *
 * Tests the downloader's ability to:
 * - Download Minecraft client JARs from Mojang
 * - Cache downloaded JARs
 * - Verify JAR integrity
 */

describe('JAR Download', () => {
  it(`should download Minecraft ${TEST_VERSION} client JAR`, async () => {
    const downloader = new MojangDownloader();
    const cacheManager = getCacheManager();

    // Download the JAR (uses cache if already downloaded)
    const jarPath = await downloader.downloadClientJar(TEST_VERSION, (downloaded, total) => {
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
