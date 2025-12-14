import { existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, it } from 'vitest';
import { getCacheManager } from '../../../src/cache/cache-manager.js';
import { MojangDownloader } from '../../../src/downloaders/mojang-downloader.js';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import { getDecompileService } from '../../../src/services/decompile-service.js';
import { getMappingService } from '../../../src/services/mapping-service.js';
import { getRegistryService } from '../../../src/services/registry-service.js';
import { getRemapService } from '../../../src/services/remap-service.js';
import { TEST_MAPPING, TEST_VERSION } from './test-constants.js';

/**
 * Comprehensive Integration Test Suite for Minecraft 1.21.10
 *
 * This test suite verifies the ENTIRE pipeline works for this specific version:
 * - JAR download
 * - Mapping download
 * - JAR remapping (2-step for Yarn) with direct JAR verification
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

    it('should contain human-readable class names in remapped JAR', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

      expect(existsSync(remappedJarPath)).toBe(true);

      // Open the remapped JAR and verify class structure
      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Find Entity class - should be in net/minecraft/entity/Entity.class (Yarn naming)
      const entityClass = entries.find((e) => e.entryName === 'net/minecraft/entity/Entity.class');
      expect(entityClass).toBeDefined();

      // Find Item class
      const itemClass = entries.find((e) => e.entryName === 'net/minecraft/item/Item.class');
      expect(itemClass).toBeDefined();

      // Find MinecraftServer class
      const serverClass = entries.find(
        (e) => e.entryName === 'net/minecraft/server/MinecraftServer.class',
      );
      expect(serverClass).toBeDefined();
    }, 30000);

    it('should have correct net.minecraft package structure', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Count classes in net/minecraft/* (should be hundreds)
      const minecraftClasses = entries.filter(
        (e) => e.entryName.startsWith('net/minecraft/') && e.entryName.endsWith('.class'),
      );

      // Minecraft has thousands of classes
      expect(minecraftClasses.length).toBeGreaterThan(1000);

      // Verify known packages exist
      const hasEntityPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/entity/'),
      );
      const hasItemPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/item/'),
      );
      const hasBlockPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/block/'),
      );

      expect(hasEntityPackage).toBe(true);
      expect(hasItemPackage).toBe(true);
      expect(hasBlockPackage).toBe(true);
    }, 30000);

    it('should not have single-letter obfuscated packages', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Get all .class files
      const classFiles = entries.filter((e) => e.entryName.endsWith('.class'));

      // Check for obfuscated single-letter top-level packages (a/, b/, c/, etc.)
      const obfuscatedClasses = classFiles.filter((e) => {
        const parts = e.entryName.split('/');
        return parts[0].length === 1 && /^[a-z]$/.test(parts[0]);
      });

      // Should have very few or no obfuscated classes remaining
      expect(obfuscatedClasses.length).toBeLessThan(10);
    }, 30000);
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
        TEST_MAPPING,
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
        TEST_MAPPING,
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
        TEST_MAPPING,
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

  describe('Mapping Lookups', () => {
    /**
     * Tests mapping lookup functionality for this version.
     * Covers single-file lookups and two-step bridge lookups.
     */

    it('should lookup intermediary → yarn class mapping', async () => {
      const mappingService = getMappingService();

      // class_1297 is the intermediary name for Entity
      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/class_1297',
        'intermediary',
        'yarn',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('Entity');
    }, 60000);

    it('should lookup yarn → intermediary class mapping', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/entity/Entity',
        'yarn',
        'intermediary',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('class_');
    }, 60000);

    it('should lookup intermediary → mojmap class mapping', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/class_1297',
        'intermediary',
        'mojmap',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('Entity');
    }, 60000);

    it('should lookup mojmap → intermediary class mapping', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/world/entity/Entity',
        'mojmap',
        'intermediary',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('class_');
    }, 60000);

    it('should lookup intermediary → official class mapping', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/class_1297',
        'intermediary',
        'official',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toBeDefined();
      // Obfuscated names are typically short
      expect(result.target?.length).toBeLessThan(50);
    }, 60000);

    it('should lookup official → intermediary class mapping', async () => {
      const mappingService = getMappingService();

      // First get an obfuscated name
      const intResult = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/class_1297',
        'intermediary',
        'official',
      );

      expect(intResult.found).toBe(true);
      const obfuscatedName = intResult.target as string;

      // Now lookup back to intermediary
      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        obfuscatedName,
        'official',
        'intermediary',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('class_1297');
    }, 60000);

    it('should lookup yarn → mojmap (two-step bridge)', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/entity/Entity',
        'yarn',
        'mojmap',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      // Mojmap uses net/minecraft/world/entity/Entity
      expect(result.target).toContain('Entity');
    }, 120000);

    it('should lookup mojmap → yarn (two-step bridge)', async () => {
      const mappingService = getMappingService();

      const result = await mappingService.lookupMapping(
        TEST_VERSION,
        'net/minecraft/world/entity/Entity',
        'mojmap',
        'yarn',
      );

      expect(result.found).toBe(true);
      expect(result.type).toBe('class');
      expect(result.target).toContain('Entity');
    }, 120000);
  });

  describe('Error Handling', () => {
    it('should handle non-existent class gracefully', async () => {
      const decompileService = getDecompileService();

      await expect(
        decompileService.getClassSource(
          TEST_VERSION,
          'net.minecraft.NonExistentClass',
          TEST_MAPPING,
        ),
      ).rejects.toThrow();
    }, 30000);
  });
});
