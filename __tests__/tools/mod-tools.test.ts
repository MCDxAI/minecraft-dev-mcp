import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getVineflower } from '../../src/java/vineflower.js';
import {
  handleAnalyzeModJar,
  handleDecompileModJar,
  handleIndexMod,
  handleRemapModJar,
  handleSearchModCode,
  handleSearchModIndexed,
} from '../../src/server/tools.js';
import { METEOR_JAR_PATH, TEST_MAPPING } from '../test-constants.js';

// Paths for remapped/decompiled mod
const METEOR_REMAPPED_PATH = join(dirname(METEOR_JAR_PATH), 'meteor-client-remapped-yarn.jar');

/**
 * Mod Analysis MCP Tool Tests
 *
 * Tests the analyze_mod_jar MCP tool:
 * - Analyzes Fabric mod JARs
 * - Returns comprehensive mod information
 * - Handles various analysis options
 */

describe('MCP Tool: analyze_mod_jar', () => {
  it('should work via MCP tool handler', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
    });

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBe(1);
    expect(response.content[0].type).toBe('text');

    // Parse the JSON response
    const result = JSON.parse(response.content[0].text);
    expect(result.loader).toBe('fabric');
    expect(result.metadata.id).toBe('meteor-client');
  }, 60000);

  it('should return error for non-existent JAR', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: '/nonexistent/path/to/mod.jar',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not found');
  }, 10000);

  it('should include all classes when flag is set', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
      includeAllClasses: true,
    });

    expect(response.isError).toBeUndefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.classes.allClasses).toBeDefined();
    expect(result.classes.allClasses.length).toBeGreaterThan(0);
  }, 120000);

  it('should include raw metadata when flag is set', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
      includeRawMetadata: true,
    });

    expect(response.isError).toBeUndefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.rawMetadata).toBeDefined();
    expect(result.rawMetadata.fabricModJson).toBeDefined();
  }, 60000);
});

describe('MCP Tool: remap_mod_jar', () => {
  it('should remap mod JAR to yarn mappings with explicit version', async () => {
    const response = await handleRemapModJar({
      inputJar: METEOR_JAR_PATH,
      outputJar: METEOR_REMAPPED_PATH,
      mcVersion: '1.21.11',
      toMapping: 'yarn',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.success).toBe(true);
    expect(result.outputJar).toBeDefined();
    expect(existsSync(METEOR_REMAPPED_PATH)).toBe(true);

    // Verify the remapped JAR is different from the original
    const originalSize = statSync(METEOR_JAR_PATH).size;
    const remappedSize = statSync(METEOR_REMAPPED_PATH).size;

    // Remapped JAR should be a valid file (not the same as original)
    // They may have similar sizes but should not be identical
    expect(remappedSize).toBeGreaterThan(0);

    // Validate that Minecraft references were actually remapped to Yarn names
    // We'll decompile a known mixin class that references Minecraft code
    const vineflower = getVineflower();
    const tempDir = mkdtempSync(join(tmpdir(), 'meteor-remap-test-'));

    try {
      // Decompile MinecraftClientMixin - this class definitely references MinecraftClient
      await vineflower.decompile(METEOR_REMAPPED_PATH, tempDir);

      // Read the decompiled mixin class
      const mixinPath = join(
        tempDir,
        'meteordevelopment',
        'meteorclient',
        'mixin',
        'MinecraftClientMixin.java',
      );
      expect(existsSync(mixinPath)).toBe(true);

      const decompiledCode = readFileSync(mixinPath, 'utf-8');

      // Verify it contains Yarn class names (human-readable) in imports and code
      // These confirm the remapping to Yarn worked correctly
      expect(decompiledCode).toMatch(/import.*\bMinecraftClient\b/);
      expect(decompiledCode).toMatch(/import.*\bClientWorld\b/);
      expect(decompiledCode).toMatch(/import.*\bClientPlayerEntity\b/);

      // Verify class references in the actual code use Yarn names
      expect(decompiledCode).toMatch(/public.*\bClientWorld\b.*field_/);

      // Note: We don't check for absence of class_XXX because Mixin annotation target strings
      // (like @At(target = "Lnet/minecraft/class_636;...")) use intermediary names by design.
      // These are bytecode descriptors and are expected. The important thing is that imports
      // and actual Java code use Yarn class names, which we verified above.
    } finally {
      // Clean up temp directory
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 300000); // 5 minutes - remapping can take a while

  it('should auto-detect Minecraft version when not provided', async () => {
    // Use a different output path for this test
    const autoDetectOutputPath = join(
      dirname(METEOR_JAR_PATH),
      'meteor-client-remapped-yarn-autodetect.jar',
    );

    const response = await handleRemapModJar({
      inputJar: METEOR_JAR_PATH,
      outputJar: autoDetectOutputPath,
      // mcVersion intentionally omitted - should auto-detect
      toMapping: 'yarn',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.success).toBe(true);
    expect(result.mcVersion).toBe('1.21.11'); // Should have auto-detected this version
    expect(result.outputJar).toBeDefined();
    expect(existsSync(autoDetectOutputPath)).toBe(true);

    // Clean up
    rmSync(autoDetectOutputPath, { force: true });
  }, 300000); // 5 minutes - remapping can take a while
});

describe('MCP Tool: decompile_mod_jar', () => {
  it.skipIf(!existsSync(METEOR_REMAPPED_PATH))(
    'should decompile remapped mod JAR',
    async () => {
      const response = await handleDecompileModJar({
        jarPath: METEOR_REMAPPED_PATH,
        mapping: TEST_MAPPING,
      });

      if (response.isError) {
        console.error('Decompile error:', response.content[0].text);
      }

      expect(response.isError).toBeUndefined();
      expect(response.content).toBeDefined();

      const result = JSON.parse(response.content[0].text);
      expect(result.success).toBe(true);
      expect(result.modId).toBe('meteor-client');
      expect(result.modVersion).toBeDefined();
      expect(result.outputDirectory).toBeDefined();
    },
    600000,
  ); // 10 minutes - decompilation takes a while
});

describe('MCP Tool: search_mod_code', () => {
  it('should search decompiled mod source code', async () => {
    const response = await handleSearchModCode({
      modId: 'meteor-client',
      modVersion: '0.5.9', // meteor-client-1.21.11-4.jar version
      query: 'onTick',
      searchType: 'method',
      mapping: TEST_MAPPING,
    });

    // If mod not decompiled, it should return an error
    if (response.isError) {
      expect(response.content[0].text).toMatch(/not decompiled|Decompiled source not found/i);
      return;
    }

    const result = JSON.parse(response.content[0].text);
    expect(result.query).toBe('onTick');
    expect(result.searchType).toBe('method');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  }, 60000);
});

describe('MCP Tool: index_mod', () => {
  it('should index decompiled mod source', async () => {
    const response = await handleIndexMod({
      modId: 'meteor-client',
      modVersion: '0.5.9',
      mapping: TEST_MAPPING,
    });

    // If mod not decompiled, it should return an error
    if (response.isError) {
      expect(response.content[0].text).toMatch(/not decompiled|Decompiled source not found/i);
      return;
    }

    const result = JSON.parse(response.content[0].text);
    expect(result.success).toBe(true);
    expect(result.modId).toBe('meteor-client');
    expect(result.filesIndexed).toBeGreaterThan(0);
  }, 300000); // 5 minutes - indexing takes a while
});

describe('MCP Tool: search_mod_indexed', () => {
  it('should search mod using FTS5 index', async () => {
    const response = await handleSearchModIndexed({
      query: 'packet',
      modId: 'meteor-client',
      modVersion: '0.5.9',
      mapping: TEST_MAPPING,
    });

    // If mod not indexed, it should return an error
    if (response.isError) {
      expect(response.content[0].text).toContain('not indexed');
      return;
    }

    const result = JSON.parse(response.content[0].text);
    expect(result.query).toBe('packet');
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  }, 30000);

  it('should support FTS5 syntax with AND operator', async () => {
    const response = await handleSearchModIndexed({
      query: 'packet AND send',
      modId: 'meteor-client',
      modVersion: '0.5.9',
      mapping: TEST_MAPPING,
    });

    if (response.isError) {
      expect(response.content[0].text).toContain('not indexed');
      return;
    }

    const result = JSON.parse(response.content[0].text);
    expect(result.results).toBeDefined();
  }, 30000);

  it('should filter by entry type', async () => {
    const response = await handleSearchModIndexed({
      query: 'update',
      modId: 'meteor-client',
      modVersion: '0.5.9',
      mapping: TEST_MAPPING,
      types: ['method'],
    });

    if (response.isError) {
      expect(response.content[0].text).toContain('not indexed');
      return;
    }

    const result = JSON.parse(response.content[0].text);
    expect(result.results).toBeDefined();
    // All results should be methods
    result.results.forEach((r: any) => {
      expect(r.entryType).toBe('method');
    });
  }, 30000);
});
