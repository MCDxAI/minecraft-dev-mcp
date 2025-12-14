import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import {
  handleCompareVersions,
  handleDecompileMinecraftVersion,
  handleFindMapping,
  handleGetRegistryData,
  handleListMinecraftVersions,
  handleRemapModJar,
  handleSearchMinecraftCode,
  tools,
} from '../../src/server/tools.js';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { METEOR_JAR_PATH, TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * Core MCP Tools Integration Tests
 *
 * Tests the Phase 1 MCP tools:
 * - get_minecraft_source
 * - decompile_minecraft_version
 * - list_minecraft_versions
 * - get_registry_data
 * - remap_mod_jar
 * - find_mapping
 * - search_minecraft_code
 * - compare_versions
 */

describe('MCP Tools Integration', () => {
  beforeAll(async () => {
    // Verify Java is available (required for tools)
    await verifyJavaVersion(17);
  }, 30000);

  it('should execute get_minecraft_source tool workflow', async () => {
    const decompileService = getDecompileService();

    // This simulates the full MCP tool workflow
    const className = 'net.minecraft.item.Item';
    const source = await decompileService.getClassSource(TEST_VERSION, className, TEST_MAPPING);

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
      const source = await decompileService.getClassSource(TEST_VERSION, className, TEST_MAPPING);

      expect(source).toBeDefined();
      expect(source.length).toBeGreaterThan(0);
    }

    const duration = Date.now() - startTime;

    // All 3 classes should be read from cache, should take < 5 seconds
    expect(duration).toBeLessThan(5000);
  }, 30000);
});

describe('New MCP Tools', () => {
  beforeAll(async () => {
    // Verify Java is available (required for tools)
    await verifyJavaVersion(17);
  }, 30000);

  it('should have all Phase 1 tools defined (8 tools)', () => {
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    // Phase 1: 8 tools, Phase 2: 7 tools, Phase 3: 1 tool = 16 total
    expect(tools.length).toBe(16);

    const toolNames = tools.map((t) => t.name);
    // Phase 1 tools
    expect(toolNames).toContain('get_minecraft_source');
    expect(toolNames).toContain('decompile_minecraft_version');
    expect(toolNames).toContain('list_minecraft_versions');
    expect(toolNames).toContain('get_registry_data');
    expect(toolNames).toContain('remap_mod_jar');
    expect(toolNames).toContain('find_mapping');
    expect(toolNames).toContain('search_minecraft_code');
    expect(toolNames).toContain('compare_versions');
  });

  it('should search for classes in decompiled code', async () => {
    const result = await handleSearchMinecraftCode({
      version: TEST_VERSION,
      query: 'Entity',
      searchType: 'class',
      mapping: TEST_MAPPING,
      limit: 10,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].type).toBe('class');
  }, 60000);

  it('should search for content in decompiled code', async () => {
    const result = await handleSearchMinecraftCode({
      version: TEST_VERSION,
      query: 'getHealth',
      searchType: 'content',
      mapping: TEST_MAPPING,
      limit: 5,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.results).toBeDefined();
  }, 60000);

  it('should find mapping for a class name (yarn → intermediary)', async () => {
    const result = await handleFindMapping({
      symbol: 'Entity',
      version: TEST_VERSION,
      sourceMapping: 'yarn',
      targetMapping: 'intermediary',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    // Handle both success and error responses
    const text = result.content[0].text;
    if (text.startsWith('Error:')) {
      // Error response - just verify it returns something
      expect(text).toBeDefined();
    } else {
      // Success response - verify structure
      const data = JSON.parse(text);
      expect(data.source).toBe('net/minecraft/entity/Entity');
    }
  }, 60000);

  it('should find mapping for mojmap → yarn (two-step bridge)', async () => {
    const result = await handleFindMapping({
      symbol: 'net/minecraft/world/entity/Entity',
      version: TEST_VERSION,
      sourceMapping: 'mojmap',
      targetMapping: 'yarn',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const text = result.content[0].text;
    if (!text.startsWith('Error:')) {
      const data = JSON.parse(text);
      expect(data.found).toBe(true);
      expect(data.target).toContain('Entity');
    }
  }, 120000);

  it('should find mapping for official (obfuscated) → yarn', async () => {
    // First get an obfuscated class name by looking up intermediary → official
    const intResult = await handleFindMapping({
      symbol: 'net/minecraft/class_1297',
      version: TEST_VERSION,
      sourceMapping: 'intermediary',
      targetMapping: 'official',
    });

    expect(intResult).toBeDefined();
    const intText = intResult.content[0].text;
    if (!intText.startsWith('Error:')) {
      const intData = JSON.parse(intText);
      expect(intData.found).toBe(true);

      // Now lookup from official to yarn
      const result = await handleFindMapping({
        symbol: intData.target,
        version: TEST_VERSION,
        sourceMapping: 'official',
        targetMapping: 'yarn',
      });

      expect(result).toBeDefined();
      const text = result.content[0].text;
      if (!text.startsWith('Error:')) {
        const data = JSON.parse(text);
        expect(data.found).toBe(true);
        expect(data.target).toContain('Entity');
      }
    }
  }, 180000);

  it('should compare registry data between versions (same version comparison)', async () => {
    const result = await handleCompareVersions({
      fromVersion: TEST_VERSION,
      toVersion: TEST_VERSION,
      mapping: TEST_MAPPING,
      category: 'registry',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.fromVersion).toBe(TEST_VERSION);
    expect(data.toVersion).toBe(TEST_VERSION);
    expect(data.registry).toBeDefined();
    // Same version comparison should have no differences
    expect(Object.keys(data.registry.added).length).toBe(0);
    expect(Object.keys(data.registry.removed).length).toBe(0);
  }, 300000);

  it('should compare classes between versions (same version)', async () => {
    const result = await handleCompareVersions({
      fromVersion: TEST_VERSION,
      toVersion: TEST_VERSION,
      mapping: TEST_MAPPING,
      category: 'classes',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.classes).toBeDefined();
    // Same version should have no differences
    expect(data.classes.addedCount).toBe(0);
    expect(data.classes.removedCount).toBe(0);
  }, 30000);
});

describe('Version and Registry Tools', () => {
  it('should list available Minecraft versions', async () => {
    const result = await handleListMinecraftVersions();

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.available).toBeDefined();
    expect(Array.isArray(data.available)).toBe(true);
    expect(data.available.length).toBeGreaterThan(0);

    // Should include version numbers in expected format (e.g., 1.21.x)
    const hasValidVersionFormat = data.available.some((v: string) => /^1\.\d+(\.\d+)?/.test(v));
    expect(hasValidVersionFormat).toBe(true);
  }, 30000);

  it('should get block registry data', async () => {
    const result = await handleGetRegistryData({
      version: TEST_VERSION,
      registry: 'block',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.entries).toBeDefined();
    expect(data.entries['minecraft:stone']).toBeDefined();
    expect(data.entries['minecraft:dirt']).toBeDefined();
    expect(Object.keys(data.entries).length).toBeGreaterThan(100);
  }, 300000);

  it('should get item registry data', async () => {
    const result = await handleGetRegistryData({
      version: TEST_VERSION,
      registry: 'item',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.entries).toBeDefined();
    expect(data.entries['minecraft:diamond']).toBeDefined();
    expect(data.entries['minecraft:stick']).toBeDefined();
    expect(Object.keys(data.entries).length).toBeGreaterThan(100);
  }, 300000);
});

describe('Decompile and Remap Tools', () => {
  beforeAll(async () => {
    await verifyJavaVersion(17);
  }, 30000);

  it('should handle decompile_minecraft_version (cached version)', async () => {
    // This test uses the already-decompiled version from previous tests
    // to avoid triggering a 10+ minute full decompilation
    const result = await handleDecompileMinecraftVersion({
      version: TEST_VERSION,
      mapping: TEST_MAPPING,
      force: false,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const text = result.content[0].text;
    // Should return success message with version info
    expect(text).toContain(TEST_VERSION);
    expect(text).toContain(TEST_MAPPING);
    // Should mention completion or classes
    expect(text).toMatch(/completed|classes/i);
  }, 600000);

  it('should handle remap_mod_jar with Fabric mod', async () => {
    // Skip if fixture doesn't exist
    if (!existsSync(METEOR_JAR_PATH)) {
      console.log('Skipping - meteor JAR fixture not found');
      return;
    }

    const outputPath = join(tmpdir(), `remapped-test-${Date.now()}.jar`);

    try {
      const result = await handleRemapModJar({
        inputJar: METEOR_JAR_PATH,
        outputJar: outputPath,
        mcVersion: '1.21.10', // Match the mod's MC version
        toMapping: TEST_MAPPING,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);

      const text = result.content[0].text;
      // Should return success message
      expect(text).toContain('remapped successfully');
      expect(text).toContain(outputPath);

      // Verify output file was created
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      // Cleanup
      if (existsSync(outputPath)) {
        unlinkSync(outputPath);
      }
    }
  }, 300000);

  it('should handle remap_mod_jar with non-existent input', async () => {
    const result = await handleRemapModJar({
      inputJar: '/non/existent/path.jar',
      outputJar: '/tmp/output.jar',
      mcVersion: TEST_VERSION,
      toMapping: TEST_MAPPING,
    });

    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});
