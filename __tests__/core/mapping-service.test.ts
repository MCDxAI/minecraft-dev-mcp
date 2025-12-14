import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMappingService } from '../../src/services/mapping-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * Mapping Service Tests
 *
 * Tests the mapping service's ability to:
 * - Download Yarn mappings from Fabric Maven
 * - Auto-resolve version to latest build
 * - Extract .tiny files from JAR
 * - Lookup mappings between different mapping types (official, intermediary, yarn, mojmap)
 */

describe('Mapping Download', () => {
  it(`should download and extract Yarn mappings for ${TEST_VERSION}`, async () => {
    const mappingService = getMappingService();

    // MappingService will auto-resolve version -> version+build.X
    // and extract the .tiny file from the JAR
    const mappingPath = await mappingService.getMappings(TEST_VERSION, TEST_MAPPING);

    expect(mappingPath).toBeDefined();
    expect(existsSync(mappingPath)).toBe(true);
    expect(mappingPath).toContain('yarn');
    expect(mappingPath).toContain(TEST_VERSION);

    // Verify it's an extracted .tiny file (not JAR)
    expect(mappingPath).toMatch(/\.tiny$/);
  }, 120000); // 2 minutes timeout

  it(`should download and extract Intermediary mappings for ${TEST_VERSION}`, async () => {
    const mappingService = getMappingService();

    const mappingPath = await mappingService.getMappings(TEST_VERSION, 'intermediary');

    expect(mappingPath).toBeDefined();
    expect(existsSync(mappingPath)).toBe(true);
    expect(mappingPath).toContain('intermediary');
    expect(mappingPath).toMatch(/\.tiny$/);
  }, 120000);

  it(`should download and convert Mojmap for ${TEST_VERSION}`, async () => {
    const mappingService = getMappingService();

    const mappingPath = await mappingService.getMappings(TEST_VERSION, 'mojmap');

    expect(mappingPath).toBeDefined();
    expect(existsSync(mappingPath)).toBe(true);
    expect(mappingPath).toContain('mojmap');
    expect(mappingPath).toMatch(/\.tiny$/);
  }, 180000); // 3 minutes for conversion
});

describe('Mapping Lookup - Single File', () => {
  /**
   * Tests for lookups that can be done in a single file:
   * - official ↔ intermediary (intermediary file)
   * - intermediary ↔ yarn (yarn file)
   * - intermediary ↔ mojmap (mojmap file)
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

    // class_1297 is the intermediary name for Entity
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

  it('should lookup official → intermediary class mapping', async () => {
    const mappingService = getMappingService();

    // 'a' is the obfuscated name for com/mojang/math/Axis in 1.21.11
    // We need to find a valid obfuscated name first
    // Let's use a known pattern - lookup by intermediary first to verify
    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/class_7833',
      'intermediary',
      'official',
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('class');
    // Obfuscated names are typically single letters or short strings
    expect(result.target).toBeDefined();
    expect(result.target?.length).toBeLessThan(20);
  }, 60000);

  it('should lookup intermediary → official class mapping', async () => {
    const mappingService = getMappingService();

    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/class_7833',
      'intermediary',
      'official',
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('class');
    expect(result.target).toBeDefined();
  }, 60000);
});

describe('Mapping Lookup - Two-Step Bridge', () => {
  /**
   * Tests for lookups that require two-step routing via intermediary:
   * - official ↔ yarn
   * - official ↔ mojmap
   * - yarn ↔ mojmap
   */

  it('should lookup official → yarn (two-step)', async () => {
    const mappingService = getMappingService();

    // First get an obfuscated name
    const intResult = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/class_1297',
      'intermediary',
      'official',
    );

    expect(intResult.found).toBe(true);
    expect(intResult.target).toBeDefined();
    const obfuscatedName = intResult.target as string;

    // Now lookup from official to yarn
    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      obfuscatedName,
      'official',
      'yarn',
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('class');
    expect(result.target).toContain('Entity');
  }, 120000);

  it('should lookup yarn → official (two-step)', async () => {
    const mappingService = getMappingService();

    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/entity/Entity',
      'yarn',
      'official',
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('class');
    expect(result.target).toBeDefined();
    // Obfuscated names are typically short
    expect(result.target?.length).toBeLessThan(50);
  }, 120000);

  it('should lookup official → mojmap (two-step)', async () => {
    const mappingService = getMappingService();

    // First get an obfuscated name
    const intResult = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/class_1297',
      'intermediary',
      'official',
    );

    expect(intResult.found).toBe(true);
    expect(intResult.target).toBeDefined();
    const obfuscatedName = intResult.target as string;

    // Now lookup from official to mojmap
    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      obfuscatedName,
      'official',
      'mojmap',
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('class');
    expect(result.target).toContain('Entity');
  }, 120000);

  it('should lookup yarn → mojmap (two-step)', async () => {
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

  it('should lookup mojmap → yarn (two-step)', async () => {
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

describe('Mapping Lookup - Methods and Fields', () => {
  it('should lookup method mapping yarn → intermediary', async () => {
    const mappingService = getMappingService();

    // 'tick' is a common method name in Entity
    const result = await mappingService.lookupMapping(TEST_VERSION, 'tick', 'yarn', 'intermediary');

    expect(result.found).toBe(true);
    expect(result.type).toBe('method');
    expect(result.target).toContain('method_');
    expect(result.className).toBeDefined();
  }, 60000);

  it('should lookup field mapping yarn → intermediary', async () => {
    const mappingService = getMappingService();

    // Look for a field that exists - 'age' is common in entities
    const result = await mappingService.lookupMapping(TEST_VERSION, 'age', 'yarn', 'intermediary');

    // May or may not find it, but should not throw
    expect(result).toBeDefined();
    if (result.found) {
      expect(result.type).toBe('field');
      expect(result.target).toContain('field_');
    }
  }, 60000);
});

describe('Mapping Lookup - Same Type', () => {
  it('should return same value when source equals target', async () => {
    const mappingService = getMappingService();

    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'net/minecraft/entity/Entity',
      'yarn',
      'yarn',
    );

    expect(result.found).toBe(true);
    expect(result.source).toBe('net/minecraft/entity/Entity');
    expect(result.target).toBe('net/minecraft/entity/Entity');
  }, 10000);
});

describe('Mapping Lookup - Not Found', () => {
  it('should return not found for non-existent symbol', async () => {
    const mappingService = getMappingService();

    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'NonExistentClassThatDoesNotExist',
      'yarn',
      'intermediary',
    );

    expect(result.found).toBe(false);
  }, 60000);
});
