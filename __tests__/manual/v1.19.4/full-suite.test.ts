import { describe, it, expect, beforeAll } from 'vitest';
import { MojangDownloader } from '../../../src/downloaders/mojang-downloader.js';
import { getMappingService } from '../../../src/services/mapping-service.js';
import { getRemapService } from '../../../src/services/remap-service.js';
import { getDecompileService } from '../../../src/services/decompile-service.js';
import { getRegistryService } from '../../../src/services/registry-service.js';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import { TEST_VERSION, TEST_MAPPING } from './test-constants.js';
import { existsSync } from 'node:fs';

/**
 * Integration Test Suite for Minecraft 1.19.4
 *
 * Verifies older version support (1.19.x era)
 * Tests core functionality: download, decompile, registry extraction
 *
 * Run manually with: npm run test:manual:1.19.4
 */

describe(`Manual: Minecraft ${TEST_VERSION} Legacy Support`, () => {
  beforeAll(async () => {
    await verifyJavaVersion(17);
  }, 30000);

  describe('Core Pipeline', () => {
    it('should download client JAR', async () => {
      const downloader = new MojangDownloader();
      const jarPath = await downloader.downloadClientJar(TEST_VERSION);

      expect(jarPath).toBeDefined();
      expect(existsSync(jarPath)).toBe(true);
    }, 120000);

    it('should download Yarn mappings', async () => {
      const mappingService = getMappingService();
      const mappingPath = await mappingService.getMappings(TEST_VERSION, TEST_MAPPING);

      expect(mappingPath).toBeDefined();
      expect(existsSync(mappingPath)).toBe(true);
    }, 120000);

    it('should remap JAR with Yarn mappings', async () => {
      const remapService = getRemapService();
      const remappedPath = await remapService.getRemappedJar(TEST_VERSION, TEST_MAPPING);

      expect(remappedPath).toBeDefined();
      expect(existsSync(remappedPath)).toBe(true);
      expect(remappedPath).toContain('yarn');
    }, 300000);

    it('should decompile and get Entity class', async () => {
      const decompileService = getDecompileService();
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('class Entity');
    }, 600000);

    it('should extract block registry', async () => {
      const registryService = getRegistryService();
      const blocks = await registryService.getRegistryData(TEST_VERSION, 'block');

      expect(blocks).toBeDefined();
      expect(blocks.entries).toBeDefined();
      expect(blocks.entries['minecraft:stone']).toBeDefined();
    }, 300000);
  });
});
