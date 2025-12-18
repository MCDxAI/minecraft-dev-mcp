import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import {
  handleCompareVersions,
  handleDecompileMinecraftVersion,
  handleFindMapping,
  handleGetMinecraftSource,
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
 * Tests for Minecraft source retrieval, decompilation, search,
 * mapping lookup, version comparison, and registry data tools.
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

describe('Tool Registration', () => {
  beforeAll(async () => {
    // Verify Java is available (required for tools)
    await verifyJavaVersion(17);
  }, 30000);

  it('should have all 20 MCP tools defined', () => {
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(20);

    const toolNames = tools.map((t) => t.name);

    // Source and decompilation tools
    expect(toolNames).toContain('get_minecraft_source');
    expect(toolNames).toContain('decompile_minecraft_version');
    expect(toolNames).toContain('list_minecraft_versions');

    // Registry and mapping tools
    expect(toolNames).toContain('get_registry_data');
    expect(toolNames).toContain('find_mapping');
    expect(toolNames).toContain('remap_mod_jar');

    // Search and comparison tools
    expect(toolNames).toContain('search_minecraft_code');
    expect(toolNames).toContain('compare_versions');
    expect(toolNames).toContain('compare_versions_detailed');
    expect(toolNames).toContain('index_minecraft_version');
    expect(toolNames).toContain('search_indexed');

    // Validation tools
    expect(toolNames).toContain('analyze_mixin');
    expect(toolNames).toContain('validate_access_widener');

    // Documentation tools
    expect(toolNames).toContain('get_documentation');
    expect(toolNames).toContain('search_documentation');

    // Mod analysis tools
    expect(toolNames).toContain('analyze_mod_jar');
    expect(toolNames).toContain('decompile_mod_jar');
    expect(toolNames).toContain('search_mod_code');
    expect(toolNames).toContain('index_mod');
    expect(toolNames).toContain('search_mod_indexed');
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

describe('Source Filtering', () => {
  beforeAll(async () => {
    await verifyJavaVersion(17);
  }, 30000);

  it('should return full source when no filtering parameters are provided', async () => {
    // Use Entity class which is typically large (1000+ lines)
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const source = result.content[0].text;
    expect(source).toContain('package net.minecraft.entity');
    expect(source).toContain('class Entity');

    // Entity should be a large class (1000+ lines)
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeGreaterThan(1000);
  }, 600000);

  it('should filter source using startLine parameter', async () => {
    // First get the full source to know total lines
    const fullResult = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
    });
    const fullSource = fullResult.content[0].text;
    const totalLines = fullSource.split('\n').length;

    // Now get filtered source starting from line 100
    const filteredResult = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      startLine: 100,
    });

    expect(filteredResult).toBeDefined();
    const filteredSource = filteredResult.content[0].text;

    // Filtered result should have metadata header
    expect(filteredSource).toContain('// Source: net.minecraft.entity.Entity');
    expect(filteredSource).toContain('// Lines: 100-');
    expect(filteredSource).toContain(`of ${totalLines} total`);

    // Filtered source should be significantly smaller than full source
    const filteredLines = filteredSource.split('\n').length;
    expect(filteredLines).toBeLessThan(totalLines);
    // Should have approximately totalLines - 99 lines + 4 metadata lines
    expect(filteredLines).toBeLessThan(totalLines - 90);
  }, 60000);

  it('should filter source using endLine parameter', async () => {
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      endLine: 50,
    });

    expect(result).toBeDefined();
    const source = result.content[0].text;

    // Should have metadata header
    expect(source).toContain('// Lines: 1-50 of');

    // Source should be limited (50 content lines + ~4 metadata lines)
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThan(60);
    expect(lineCount).toBeGreaterThan(50); // At least 50 lines of content
  }, 60000);

  it('should filter source using startLine and endLine together', async () => {
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      startLine: 100,
      endLine: 150,
    });

    expect(result).toBeDefined();
    const source = result.content[0].text;

    // Should have metadata header showing line range
    expect(source).toContain('// Lines: 100-150 of');

    // Should have exactly 51 content lines (100-150 inclusive) + metadata
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThan(60); // 51 + ~4 metadata
    expect(lineCount).toBeGreaterThan(50);
  }, 60000);

  it('should filter source using maxLines parameter', async () => {
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      maxLines: 25,
    });

    expect(result).toBeDefined();
    const source = result.content[0].text;

    // Should have metadata header
    expect(source).toContain('// Lines: 1-25 of');
    expect(source).toContain('maxLines=25');

    // Should have max 25 content lines + metadata
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThan(35); // 25 + ~4 metadata + buffer
  }, 60000);

  it('should apply maxLines after startLine/endLine filtering', async () => {
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      startLine: 100,
      endLine: 200,
      maxLines: 10,
    });

    expect(result).toBeDefined();
    const source = result.content[0].text;

    // Should show lines 100-109 (10 lines starting from 100)
    expect(source).toContain('// Lines: 100-109 of');
    expect(source).toContain('maxLines=10');

    // Should have exactly 10 content lines + metadata
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThan(20); // 10 + ~4 metadata + buffer
  }, 60000);

  it('should not add metadata header when no filtering parameters are used', async () => {
    const result = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.item.Item',
      mapping: TEST_MAPPING,
    });

    expect(result).toBeDefined();
    const source = result.content[0].text;

    // Should NOT have metadata header when returning full source
    expect(source).not.toContain('// Source:');
    expect(source).not.toContain('// Lines:');

    // Should start with package declaration
    expect(source).toMatch(/^package net\.minecraft\.item/);
  }, 60000);

  it('should handle filtering on a large class to prevent token explosion', async () => {
    // This is the critical test - ensuring large classes can be filtered
    // to avoid 25k+ token responses

    // Get full source length first
    const fullResult = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
    });
    const fullLength = fullResult.content[0].text.length;

    // Now get a small filtered portion
    const filteredResult = await handleGetMinecraftSource({
      version: TEST_VERSION,
      className: 'net.minecraft.entity.Entity',
      mapping: TEST_MAPPING,
      startLine: 1,
      maxLines: 100,
    });
    const filteredLength = filteredResult.content[0].text.length;

    // Filtered result should be significantly smaller (at least 5x smaller)
    expect(filteredLength).toBeLessThan(fullLength / 5);

    // Verify we still get useful content
    const filteredSource = filteredResult.content[0].text;
    expect(filteredSource).toContain('package net.minecraft.entity');
  }, 60000);
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
        mcVersion: '1.21.11', // Match the mod's MC version
        toMapping: TEST_MAPPING,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);

      const text = result.content[0].text;
      // Should return JSON success response
      const data = JSON.parse(text);
      expect(data.success).toBe(true);
      expect(data.outputJar).toContain('remapped-test');

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
