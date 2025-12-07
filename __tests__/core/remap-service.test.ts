import { describe, it, expect, beforeAll } from 'vitest';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';
import { existsSync } from 'node:fs';

/**
 * JAR Remapping Tests
 *
 * Tests the remap service's ability to:
 * - Remap Minecraft JARs with Yarn mappings
 * - Use tiny-remapper for two-step remapping (official -> intermediary -> yarn)
 * - Cache remapped JARs
 */

describe('JAR Remapping', () => {
  beforeAll(async () => {
    // Verify Java is available (required for remapping)
    await verifyJavaVersion(17);
  }, 30000);

  it('should remap Minecraft JAR with Yarn mappings using tiny-remapper', async () => {
    const decompileService = getDecompileService();
    const cacheManager = getCacheManager();

    // This will download, remap, and decompile
    // Uses cache for any steps already completed
    // Yarn version is auto-resolved from Maven (e.g. 1.21.10 -> 1.21.10+build.4)
    const outputDir = await decompileService.decompileVersion(
      TEST_VERSION,
      TEST_MAPPING,
      (current, total) => {
        if (total > 0) {
          console.log(`Decompile progress: ${current}/${total} (${((current / total) * 100).toFixed(1)}%)`);
        }
      }
    );

    expect(outputDir).toBeDefined();
    expect(existsSync(outputDir)).toBe(true);
    expect(cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)).toBe(true);

    // Verify remapped JAR exists
    expect(cacheManager.hasRemappedJar(TEST_VERSION, TEST_MAPPING)).toBe(true);
    const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);
    expect(existsSync(remappedJarPath)).toBe(true);
  }, 600000); // 10 minutes timeout for first-time decompile
});
