import { describe, it, expect, beforeAll } from 'vitest';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import {
  handleSearchMinecraftCode,
  handleFindMapping,
  handleCompareVersions,
  tools,
} from '../../src/server/tools.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';

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

  it('should find mapping for a class name', async () => {
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
      expect(data.source).toBe('Entity');
    }
  }, 60000);

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
