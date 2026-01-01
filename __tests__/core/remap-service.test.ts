import { existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { getRemapService } from '../../src/services/remap-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * JAR Remapping Tests
 *
 * Comprehensive tests for the remap service's ability to:
 * - Remap Minecraft JARs with Yarn mappings (2-step: official -> intermediary -> named)
 * - Remap Minecraft JARs with Mojmap mappings (1-step: official -> named)
 * - Produce JARs with human-readable class names
 * - Maintain correct package structure (net.minecraft.*)
 * - Cache remapped JARs properly
 */

describe('JAR Remapping', () => {
  beforeAll(async () => {
    // Verify Java is available (required for remapping)
    await verifyJavaVersion(17);
  }, 30000);

  describe('Yarn Remapping (2-step process)', () => {
    it('should create remapped JAR with Yarn mappings', async () => {
      const remapService = getRemapService();
      const cacheManager = getCacheManager();

      // Get or create remapped JAR
      const remappedJarPath = await remapService.getRemappedJar(TEST_VERSION, 'yarn');

      expect(remappedJarPath).toBeDefined();
      expect(existsSync(remappedJarPath)).toBe(true);
      expect(cacheManager.hasRemappedJar(TEST_VERSION, 'yarn')).toBe(true);
      expect(remappedJarPath).toContain('yarn');
    }, 600000); // 10 minutes for first-time remap

    it('should contain human-readable class names in remapped JAR', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'yarn');

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

    it('should have net.minecraft package structure', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'yarn');

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Count classes in net/minecraft/* (should be hundreds)
      const minecraftClasses = entries.filter(
        (e) => e.entryName.startsWith('net/minecraft/') && e.entryName.endsWith('.class'),
      );

      // Minecraft has thousands of classes, expect at least 1000
      expect(minecraftClasses.length).toBeGreaterThan(1000);

      // Verify some known packages exist
      const hasEntityPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/entity/'),
      );
      const hasItemPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/item/'),
      );
      const hasBlockPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/block/'),
      );
      const hasWorldPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/'),
      );

      expect(hasEntityPackage).toBe(true);
      expect(hasItemPackage).toBe(true);
      expect(hasBlockPackage).toBe(true);
      expect(hasWorldPackage).toBe(true);
    }, 30000);

    it('should not have single-letter obfuscated package names', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'yarn');

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Get all .class files
      const classFiles = entries.filter((e) => e.entryName.endsWith('.class'));

      // Check for obfuscated single-letter top-level packages (a/, b/, c/, etc.)
      // These would indicate remapping failed
      const obfuscatedClasses = classFiles.filter((e) => {
        const parts = e.entryName.split('/');
        // Check if first directory is a single lowercase letter (obfuscated)
        return parts[0].length === 1 && /^[a-z]$/.test(parts[0]);
      });

      // Should have very few or no obfuscated classes remaining
      // Some inner classes or special cases might slip through, allow small number
      expect(obfuscatedClasses.length).toBeLessThan(10);
    }, 30000);
  });

  describe('Mojmap Remapping (2-step process via mojang2tiny)', () => {
    it('should create remapped JAR with Mojmap mappings', async () => {
      const remapService = getRemapService();
      const cacheManager = getCacheManager();

      // Get or create remapped JAR with Mojmap
      const remappedJarPath = await remapService.getRemappedJar(TEST_VERSION, 'mojmap');

      expect(remappedJarPath).toBeDefined();
      expect(existsSync(remappedJarPath)).toBe(true);
      expect(cacheManager.hasRemappedJar(TEST_VERSION, 'mojmap')).toBe(true);
      expect(remappedJarPath).toContain('mojmap');
    }, 600000); // 10 minutes for first-time remap

    it('should contain official Mojang class names in Mojmap JAR', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'mojmap');

      expect(existsSync(remappedJarPath)).toBe(true);

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Mojmap uses net.minecraft.world.entity.Entity (note: world.entity not just entity)
      const entityClass = entries.find(
        (e) => e.entryName === 'net/minecraft/world/entity/Entity.class',
      );
      expect(entityClass).toBeDefined();

      // Mojmap uses net.minecraft.world.item.Item
      const itemClass = entries.find((e) => e.entryName === 'net/minecraft/world/item/Item.class');
      expect(itemClass).toBeDefined();

      // MinecraftServer should still be in server package
      const serverClass = entries.find(
        (e) => e.entryName === 'net/minecraft/server/MinecraftServer.class',
      );
      expect(serverClass).toBeDefined();
    }, 30000);

    it('should have correct Mojmap package structure', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'mojmap');

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Count classes in net/minecraft/*
      const minecraftClasses = entries.filter(
        (e) => e.entryName.startsWith('net/minecraft/') && e.entryName.endsWith('.class'),
      );

      expect(minecraftClasses.length).toBeGreaterThan(1000);

      // Verify Mojmap-specific packages (uses world.entity, world.item instead of just entity, item)
      const hasWorldEntityPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/entity/'),
      );
      const hasWorldItemPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/item/'),
      );
      const hasWorldLevelPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/level/'),
      );

      expect(hasWorldEntityPackage).toBe(true);
      expect(hasWorldItemPackage).toBe(true);
      expect(hasWorldLevelPackage).toBe(true);
    }, 30000);

    it('should not have single-letter obfuscated package names', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, 'mojmap');

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

  describe('Decompilation Integration', () => {
    it('should decompile remapped JAR successfully', async () => {
      const decompileService = getDecompileService();
      const cacheManager = getCacheManager();

      // This triggers the full pipeline: download -> remap -> decompile
      const outputDir = await decompileService.decompileVersion(TEST_VERSION, TEST_MAPPING);

      expect(outputDir).toBeDefined();
      expect(existsSync(outputDir)).toBe(true);
      expect(cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)).toBe(true);
    }, 600000);

    it('should retrieve decompiled Entity class with correct package', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        'yarn',
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.entity');
      expect(source).toContain('class Entity');
    }, 30000);
  });

  describe('Caching', () => {
    it('should reuse cached remapped JARs', async () => {
      const remapService = getRemapService();
      const cacheManager = getCacheManager();

      // Ensure remapped JAR exists
      expect(cacheManager.hasRemappedJar(TEST_VERSION, 'yarn')).toBe(true);

      // Get remapped JAR - should return immediately from cache
      const startTime = Date.now();
      const remappedJarPath = await remapService.getRemappedJar(TEST_VERSION, 'yarn');
      const duration = Date.now() - startTime;

      expect(remappedJarPath).toBeDefined();
      expect(existsSync(remappedJarPath)).toBe(true);

      // Cached retrieval should be very fast (< 1 second)
      expect(duration).toBeLessThan(1000);
    }, 30000);
  });

  describe('Mojmap Method/Field Name Verification', () => {
    /**
     * These tests verify that the mapping-io based mojmap conversion
     * properly remaps method and field names (not just class names).
     *
     * The old mojang2tiny approach had a bug where the Tiny v2 output
     * had fields/methods not nested under their parent classes, causing
     * tiny-remapper to only remap class names while leaving methods/fields
     * as intermediary names (method_XXXXX, field_XXXXX).
     */

    it('should have human-readable method names in decompiled mojmap source', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.world.entity.Entity',
        'mojmap'
      );

      expect(source).toBeDefined();

      // Verify mojmap method names exist (common Entity methods)
      // These should be human-readable, NOT intermediary names like method_XXXXX
      expect(source).toContain('tick(');
      expect(source).toContain('isAlive(');

      // Ensure NO intermediary method names leaked through
      // If remapping failed, we'd see method_XXXXX patterns
      const methodMatch = source.match(/method_\d+/g);
      expect(methodMatch).toBeNull();
    }, 180000); // 3 minutes - mojmap decompilation can take time on first run

    it('should have human-readable field names in decompiled mojmap source', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.world.entity.Entity',
        'mojmap'
      );

      expect(source).toBeDefined();

      // Ensure NO intermediary field names leaked through
      // If remapping failed, we'd see field_XXXXX patterns
      const fieldMatch = source.match(/field_\d+/g);
      expect(fieldMatch).toBeNull();
    }, 180000); // 3 minutes

    it('should have human-readable names in MinecraftServer class', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.server.MinecraftServer',
        'mojmap'
      );

      expect(source).toBeDefined();

      // Ensure no intermediary names leaked through
      const methodMatch = source.match(/method_\d+/g);
      const fieldMatch = source.match(/field_\d+/g);

      expect(methodMatch).toBeNull();
      expect(fieldMatch).toBeNull();

      // Verify some expected human-readable names exist
      expect(source).toContain('runServer');
    }, 180000); // 3 minutes
  });

  describe('Yarn Method/Field Name Verification', () => {
    it('should have human-readable method names in decompiled yarn source', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        'yarn'
      );

      expect(source).toBeDefined();

      // Verify yarn method names (tick is a common method)
      expect(source).toContain('tick(');

      // Ensure NO intermediary method names leaked through
      const methodMatch = source.match(/method_\d+/g);
      expect(methodMatch).toBeNull();
    }, 60000);

    it('should have mostly human-readable field names in decompiled yarn source', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        'yarn'
      );

      expect(source).toBeDefined();

      // Yarn doesn't name every field - some fields genuinely have intermediary names
      // because the Yarn community hasn't assigned human-readable names to them yet.
      // We allow up to 20 intermediary field names (typically there are ~5-10 unnamed).
      const fieldMatch = source.match(/field_\d+/g);
      const intermediaryFieldCount = fieldMatch ? fieldMatch.length : 0;
      expect(intermediaryFieldCount).toBeLessThan(20);
    }, 60000);
  });
});
