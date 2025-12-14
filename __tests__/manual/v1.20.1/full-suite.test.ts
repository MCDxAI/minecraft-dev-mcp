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
 * Integration Test Suite for Minecraft 1.20.1
 *
 * Verifies legacy version support (pre-1.21.x era)
 * Tests core functionality: download, remap (with direct JAR verification), decompile, registry extraction
 *
 * Run manually with: npm run test:manual:1.20.1
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

      // Count classes in net/minecraft/*
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

    it('should decompile and get Entity class', async () => {
      const decompileService = getDecompileService();
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        TEST_MAPPING,
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
