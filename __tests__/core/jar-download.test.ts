import { describe, it, expect } from 'vitest';
import { MojangDownloader } from '../../src/downloaders/mojang-downloader.js';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { TEST_VERSION } from '../test-constants.js';
import { existsSync } from 'node:fs';

/**
 * JAR Download Tests
 *
 * Tests the downloader's ability to:
 * - Download Minecraft client JARs from Mojang
 * - Cache downloaded JARs
 * - Verify JAR integrity
 */

describe('JAR Download', () => {
  it('should download Minecraft 1.21.10 client JAR', async () => {
    const downloader = new MojangDownloader();
    const cacheManager = getCacheManager();

    // Download the JAR (uses cache if already downloaded)
    const jarPath = await downloader.downloadClientJar(TEST_VERSION, (downloaded, total) => {
      // Progress callback
      console.log(`Download progress: ${((downloaded / total) * 100).toFixed(1)}%`);
    });

    expect(jarPath).toBeDefined();
    expect(existsSync(jarPath)).toBe(true);
    expect(jarPath).toContain('1.21.10');
    expect(jarPath).toContain('.jar');

    // Verify it's cached
    expect(cacheManager.hasVersionJar(TEST_VERSION)).toBe(true);
    expect(cacheManager.getVersionJarPath(TEST_VERSION)).toBe(jarPath);
  }, 300000); // 5 minutes timeout for download
});
