import { describe, it, expect, beforeAll } from 'vitest';
import { getDecompileService } from '../src/services/decompile-service.js';
import { getVersionManager } from '../src/services/version-manager.js';
import { getRegistryService } from '../src/services/registry-service.js';
import { getMappingService } from '../src/services/mapping-service.js';
import { MojangDownloader } from '../src/downloaders/mojang-downloader.js';
import { FabricMavenClient } from '../src/downloaders/fabric-maven.js';
import { getCacheManager } from '../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../src/java/java-process.js';
import { existsSync } from 'node:fs';

/**
 * Integration tests for Minecraft Dev MCP Server
 *
 * These tests use REAL data - NO MOCKING:
 * - Downloads actual Minecraft 1.21.10 JAR from Mojang
 * - Downloads real Yarn mappings from Fabric Maven
 * - Runs real tiny-remapper Java process
 * - Runs real Vineflower decompiler
 * - Tests with actual decompiled source code
 *
 * First run will take ~5-10 minutes. Subsequent runs use cache.
 */

const TEST_VERSION = '1.21.10';
const TEST_MAPPING = 'yarn'; // Using Yarn mappings (will auto-resolve to latest build)

describe('Minecraft Dev MCP - Integration Tests', () => {
  beforeAll(async () => {
    // Verify Java is available (required for decompilation)
    await verifyJavaVersion(17);
  }, 30000);

  describe('Version Management', () => {
    it('should list available Minecraft versions from Mojang', async () => {
      const versionManager = getVersionManager();
      const versions = await versionManager.listAvailableVersions();

      expect(versions).toBeDefined();
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain(TEST_VERSION);
    }, 30000);

    it('should verify version exists on Mojang servers', async () => {
      const downloader = new MojangDownloader();
      const exists = await downloader.versionExists(TEST_VERSION);

      expect(exists).toBe(true);
    }, 30000);

    it('should return false for non-existent version', async () => {
      const downloader = new MojangDownloader();
      const exists = await downloader.versionExists('999.999.999');

      expect(exists).toBe(false);
    }, 30000);
  });

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

  describe('Mapping Download', () => {
    it('should download and extract Yarn mappings for 1.21.10', async () => {
      const mappingService = getMappingService();

      // MappingService will auto-resolve 1.21.10 -> 1.21.10+build.X
      // and extract the .tiny file from the JAR
      const mappingPath = await mappingService.getMappings(TEST_VERSION, TEST_MAPPING);

      expect(mappingPath).toBeDefined();
      expect(existsSync(mappingPath)).toBe(true);
      expect(mappingPath).toContain('yarn');
      expect(mappingPath).toContain('1.21.10');

      // Verify it's an extracted .tiny file (not JAR)
      expect(mappingPath).toMatch(/\.tiny$/);
    }, 120000); // 2 minutes timeout
  });

  describe('JAR Remapping', () => {
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

  describe('Source Code Retrieval', () => {
    it('should get decompiled source for Entity class', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.entity.Entity',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(typeof source).toBe('string');
      expect(source.length).toBeGreaterThan(0);

      // Verify it's actual Java source code
      expect(source).toContain('package net.minecraft.entity');
      expect(source).toContain('class Entity');
      expect(source).toContain('public');
    }, 600000);

    it('should get decompiled source for Vec3d class', async () => {
      const decompileService = getDecompileService();

      const source = await decompileService.getClassSource(
        TEST_VERSION,
        'net.minecraft.util.math.Vec3d',
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.util.math');
      expect(source).toContain('Vec3d');

      // Vec3d should have x, y, z fields
      expect(source).toContain('x');
      expect(source).toContain('y');
      expect(source).toContain('z');
    }, 600000);

    it('should throw error for non-existent class', async () => {
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

  describe('Registry Data Extraction', () => {
    it('should extract registry data from Minecraft', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION);

      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    }, 300000); // 5 minutes timeout

    it('should contain blocks registry', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION, 'block');

      expect(data).toBeDefined();

      // Should have common blocks
      const dataStr = JSON.stringify(data);
      expect(dataStr).toContain('stone');
      expect(dataStr).toContain('dirt');
    }, 300000);

    it('should contain items registry', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION, 'item');

      expect(data).toBeDefined();

      // Should have common items
      const dataStr = JSON.stringify(data);
      expect(dataStr).toContain('diamond');
      expect(dataStr).toContain('stick');
    }, 300000);
  });

  describe('MCP Tools Integration', () => {
    it('should execute get_minecraft_source tool workflow', async () => {
      const decompileService = getDecompileService();

      // This simulates the full MCP tool workflow
      const className = 'net.minecraft.item.Item';
      const source = await decompileService.getClassSource(
        TEST_VERSION,
        className,
        TEST_MAPPING
      );

      expect(source).toBeDefined();
      expect(source).toContain('package net.minecraft.item');
      expect(source).toContain('class Item');
    }, 600000);

    it('should handle multiple class requests efficiently (using cache)', async () => {
      const decompileService = getDecompileService();

      const classes = [
        'net.minecraft.block.Block',
        'net.minecraft.world.World',
        'net.minecraft.entity.player.PlayerEntity',
      ];

      const startTime = Date.now();

      for (const className of classes) {
        const source = await decompileService.getClassSource(
          TEST_VERSION,
          className,
          TEST_MAPPING
        );

        expect(source).toBeDefined();
        expect(source.length).toBeGreaterThan(0);
      }

      const duration = Date.now() - startTime;

      // All 3 classes should be read from cache, should take < 5 seconds
      expect(duration).toBeLessThan(5000);
    }, 30000);
  });

  describe('Cache Functionality', () => {
    it('should list cached versions', () => {
      const cacheManager = getCacheManager();
      const cached = cacheManager.listCachedVersions();

      expect(Array.isArray(cached)).toBe(true);
      expect(cached).toContain(TEST_VERSION);
    });

    it('should verify all components are cached', () => {
      const cacheManager = getCacheManager();

      // JAR should be cached
      expect(cacheManager.hasVersionJar(TEST_VERSION)).toBe(true);

      // Mappings should be cached
      expect(cacheManager.hasMappings(TEST_VERSION, TEST_MAPPING)).toBe(true);

      // Remapped JAR should be cached
      expect(cacheManager.hasRemappedJar(TEST_VERSION, TEST_MAPPING)).toBe(true);

      // Decompiled source should be cached
      expect(cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid version gracefully', async () => {
      const downloader = new MojangDownloader();

      await expect(
        downloader.downloadClientJar('invalid.version.number')
      ).rejects.toThrow();
    }, 30000);

    it('should handle missing class gracefully', async () => {
      const decompileService = getDecompileService();

      await expect(
        decompileService.getClassSource(TEST_VERSION, 'does.not.Exist', TEST_MAPPING)
      ).rejects.toThrow();
    }, 30000);
  });
});
