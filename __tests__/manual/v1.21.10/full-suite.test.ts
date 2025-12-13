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
 * Comprehensive Integration Test Suite for Minecraft 1.21.10
 *
 * This test suite verifies the ENTIRE pipeline works for this specific version:
 * - JAR download
 * - Mapping download
 * - JAR remapping (2-step for Yarn)
 * - Full decompilation
 * - Registry data extraction
 * - Source code retrieval
 *
 * Run manually with: npm run test:manual:1.21.10
 */

describe(`Manual: Minecraft ${TEST_VERSION} Full Pipeline`, () => {
  beforeAll(async () => {
    // Verify Java is available
    await verifyJavaVersion(17);
  }, 30000);

  describe('JAR Download', () => {
    it('should download client JAR', async () => {
      const downloader = new MojangDownloader();
      const jarPath = await downloader.downloadClientJar(TEST_VERSION);

      expect(jarPath).toBeDefined();
      expect(existsSync(jarPath)).toBe(true);
      expect(jarPath).toContain(TEST_VERSION);
    }, 120000);

    it('should download server JAR', async () => {
      const downloader = new MojangDownloader();
      const jarPath = await downloader.downloadServerJar(TEST_VERSION);

      expect(jarPath).toBeDefined();
      expect(existsSync(jarPath)).toBe(true);
      expect(jarPath).toContain(TEST_VERSION);
    }, 120000);
  });

  describe('Mapping Download', () => {
    it('should download and extract Yarn mappings', async () => {
      const mappingService = getMappingService();
      const mappingPath = await mappingService.getMappings(TEST_VERSION, TEST_MAPPING);

      expect(mappingPath).toBeDefined();
      expect(existsSync(mappingPath)).toBe(true);
      expect(mappingPath).toContain('yarn');
      expect(mappingPath).toMatch(/\.tiny$/);
    }, 120000);
  });

  describe('JAR Remapping', () => {
    it('should remap JAR with Yarn mappings', async () => {
      const remapService = getRemapService();
      const remappedPath = await remapService.getRemappedJar(TEST_VERSION, TEST_MAPPING);

      expect(remappedPath).toBeDefined();
      expect(existsSync(remappedPath)).toBe(true);
      expect(remappedPath).toContain('yarn');
    }, 300000);
  });

  describe('Decompilation', () => {
    it('should decompile Minecraft to source code', async () => {
      const decompileService = getDecompileService();
      const decompilePath = await decompileService.decompileVersion(TEST_VERSION, TEST_MAPPING);

      expect(decompilePath).toBeDefined();
      expect(existsSync(decompilePath)).toBe(true);
    }, 600000);
  });

  describe('Source Code Retrieval', () => {
    it('should get Entity class source', async () => {
      const decompileService = getDecompileService();
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.entity');
      expect(source).toContain('class Entity');
    }, 600000);

    it('should get Item class source', async () => {
      const decompileService = getDecompileService();
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.item.Item',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.item');
      expect(source).toContain('class Item');
    }, 600000);

    it('should get Vec3d class source', async () => {
      const decompileService = getDecompileService();
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.util.math.Vec3d',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('Vec3d');
      expect(source).toContain('x');
      expect(source).toContain('y');
      expect(source).toContain('z');
    }, 600000);
  });

  describe('Registry Data', () => {
    it('should extract block registry', async () => {
      const registryService = getRegistryService();
      const blocks = await registryService.getRegistryData(TEST_VERSION, 'block');

      expect(blocks).toBeDefined();
      expect(blocks.entries).toBeDefined();
      expect(Object.keys(blocks.entries).length).toBeGreaterThan(0);
      expect(blocks.entries['minecraft:stone']).toBeDefined();
    }, 300000);

    it('should extract item registry', async () => {
      const registryService = getRegistryService();
      const items = await registryService.getRegistryData(TEST_VERSION, 'item');

      expect(items).toBeDefined();
      expect(items.entries).toBeDefined();
      expect(Object.keys(items.entries).length).toBeGreaterThan(0);
      expect(items.entries['minecraft:diamond']).toBeDefined();
    }, 300000);
  });

  describe('Error Handling', () => {
    it('should handle non-existent class gracefully', async () => {
      const decompileService = getDecompileService();

      await expect(
        decompileService.getClassSource(
          TEST_VERSION,
          'net.minecraft.NonExistentClass',
          TEST_MAPPING
        )
      ).rejects.toThrow();
    }, 30000);
  });
});
