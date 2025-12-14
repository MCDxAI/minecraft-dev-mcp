import { existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, it } from 'vitest';
import { getCacheManager } from '../../../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import { getDecompileService } from '../../../src/services/decompile-service.js';
import { getRemapService } from '../../../src/services/remap-service.js';
import { MOJMAP_TEST_VERSIONS, TEST_MAPPING } from './test-constants.js';

/**
 * Mojmap Remapping Tests for Multiple Versions
 *
 * These tests verify that Mojmap remapping works correctly across different
 * Minecraft versions using the mojang2tiny conversion pipeline:
 * 1. Download Mojang ProGuard mappings
 * 2. Download Intermediary mappings
 * 3. Convert ProGuard -> Tiny v2 using mojang2tiny
 * 4. Remap: official -> intermediary -> named (Mojmap)
 *
 * Run with: npm run test:manual:mojmap
 */

// Get version from environment or use default
const TEST_VERSION = process.env.MOJMAP_TEST_VERSION || '1.21.11';

describe(`Mojmap Remapping: ${TEST_VERSION}`, () => {
  beforeAll(async () => {
    // Verify Java is available (required for remapping)
    await verifyJavaVersion(17);
  }, 30000);

  describe('JAR Remapping', () => {
    it('should create remapped JAR with Mojmap mappings', async () => {
      const remapService = getRemapService();
      const cacheManager = getCacheManager();

      // Get or create remapped JAR
      const remappedJarPath = await remapService.getRemappedJar(TEST_VERSION, TEST_MAPPING);

      expect(remappedJarPath).toBeDefined();
      expect(existsSync(remappedJarPath)).toBe(true);
      expect(cacheManager.hasRemappedJar(TEST_VERSION, TEST_MAPPING)).toBe(true);
      expect(remappedJarPath).toContain('mojmap');
    }, 600000); // 10 minutes for first-time remap

    it('should contain official Mojang class names in remapped JAR', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

      expect(existsSync(remappedJarPath)).toBe(true);

      // Open the remapped JAR and verify class structure
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
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

      const zip = new AdmZip(remappedJarPath);
      const entries = zip.getEntries();

      // Count classes in net/minecraft/* (should be hundreds)
      const minecraftClasses = entries.filter(
        (e) => e.entryName.startsWith('net/minecraft/') && e.entryName.endsWith('.class'),
      );

      // Minecraft has thousands of classes, expect at least 1000
      expect(minecraftClasses.length).toBeGreaterThan(1000);

      // Verify Mojmap-specific packages exist (world.entity, world.item, world.level)
      const hasWorldEntityPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/entity/'),
      );
      const hasWorldItemPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/item/'),
      );
      const hasWorldLevelPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/world/level/'),
      );
      const hasServerPackage = minecraftClasses.some((e) =>
        e.entryName.startsWith('net/minecraft/server/'),
      );

      expect(hasWorldEntityPackage).toBe(true);
      expect(hasWorldItemPackage).toBe(true);
      expect(hasWorldLevelPackage).toBe(true);
      expect(hasServerPackage).toBe(true);
    }, 30000);

    it('should not have single-letter obfuscated package names', async () => {
      const cacheManager = getCacheManager();
      const remappedJarPath = cacheManager.getRemappedJarPath(TEST_VERSION, TEST_MAPPING);

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

  describe('Decompilation Integration', () => {
    it('should decompile Mojmap remapped JAR successfully', async () => {
      const decompileService = getDecompileService();
      const cacheManager = getCacheManager();

      // This triggers the full pipeline: download -> remap -> decompile
      const outputDir = await decompileService.decompileVersion(TEST_VERSION, TEST_MAPPING);

      expect(outputDir).toBeDefined();
      expect(existsSync(outputDir)).toBe(true);
      expect(cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)).toBe(true);
    }, 600000);

    it('should retrieve decompiled Entity class with Mojmap package', async () => {
      const decompileService = getDecompileService();

      // Mojmap uses net.minecraft.world.entity.Entity
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.world.entity.Entity',
        TEST_MAPPING,
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.world.entity');
      expect(source).toContain('class Entity');
    }, 30000);

    it('should retrieve decompiled Item class with Mojmap package', async () => {
      const decompileService = getDecompileService();

      // Mojmap uses net.minecraft.world.item.Item
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.world.item.Item',
        TEST_MAPPING,
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.world.item');
      expect(source).toContain('class Item');
    }, 30000);
  });

  describe('Caching', () => {
    it('should reuse cached remapped JARs', async () => {
      const remapService = getRemapService();
      const cacheManager = getCacheManager();

      // Ensure remapped JAR exists
      expect(cacheManager.hasRemappedJar(TEST_VERSION, TEST_MAPPING)).toBe(true);

      // Get remapped JAR - should return immediately from cache
      const startTime = Date.now();
      const remappedJarPath = await remapService.getRemappedJar(TEST_VERSION, TEST_MAPPING);
      const duration = Date.now() - startTime;

      expect(remappedJarPath).toBeDefined();
      expect(existsSync(remappedJarPath)).toBe(true);

      // Cached retrieval should be very fast (< 1 second)
      expect(duration).toBeLessThan(1000);
    }, 30000);
  });
});
