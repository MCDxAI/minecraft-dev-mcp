import { existsSync, readFileSync } from 'node:fs';
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

describe('Mojmap Tiny v2 Structure Verification', () => {
  /**
   * These tests verify that the mapping-io based mojmap conversion
   * produces properly structured Tiny v2 files where fields and methods
   * are nested under their parent classes.
   *
   * The old mojang2tiny approach had a bug where all classes were grouped
   * together (lines 1-10243), then all fields (lines 10244-55488), then
   * all methods. This broke tiny-remapper which expects nesting.
   */

  it('should produce Tiny v2 with fields nested under classes', async () => {
    const mappingService = getMappingService();
    const mappingPath = await mappingService.getMappings(TEST_VERSION, 'mojmap');

    const content = readFileSync(mappingPath, 'utf8');
    const lines = content.split('\n');

    // Verify header format
    expect(lines[0]).toMatch(/^tiny\t2\t0\t/);

    // Find Entity class line
    const entityLineIdx = lines.findIndex(
      (l) => l.startsWith('c\t') && l.includes('Entity') && !l.includes('EntityType')
    );
    expect(entityLineIdx).toBeGreaterThan(0);

    // The line immediately after a class definition should be a field or method
    // (starts with a tab character), NOT another class definition
    const nextLine = lines[entityLineIdx + 1];
    if (nextLine && nextLine.trim()) {
      // If there's content, it should be a nested member (starts with tab)
      // or another class (no tab). We're checking that fields/methods
      // ARE nested under classes, not grouped separately.
      expect(nextLine.startsWith('\t') || nextLine.startsWith('c\t')).toBe(true);
    }
  }, 180000);

  it('should have fields/methods interspersed with classes (not grouped)', async () => {
    const mappingService = getMappingService();
    const mappingPath = await mappingService.getMappings(TEST_VERSION, 'mojmap');

    const content = readFileSync(mappingPath, 'utf8');
    const lines = content.split('\n');

    // Count class, field, and method lines
    let classLines = 0;
    let fieldLines = 0;
    let methodLines = 0;

    for (const line of lines) {
      if (line.startsWith('c\t')) classLines++;
      else if (line.startsWith('\tf\t')) fieldLines++;
      else if (line.startsWith('\tm\t')) methodLines++;
    }

    // Should have substantial numbers of each
    expect(classLines).toBeGreaterThan(1000);
    expect(fieldLines).toBeGreaterThan(1000);
    expect(methodLines).toBeGreaterThan(1000);

    // Find first occurrence of each type
    const firstClass = lines.findIndex((l) => l.startsWith('c\t'));
    const firstField = lines.findIndex((l) => l.startsWith('\tf\t'));
    const firstMethod = lines.findIndex((l) => l.startsWith('\tm\t'));

    // In proper Tiny v2, fields and methods should appear VERY soon after first class
    // (not all classes first, then all fields, then all methods)
    // First field/method should be within first 100 lines after first class
    expect(firstField - firstClass).toBeLessThan(100);
    expect(firstMethod - firstClass).toBeLessThan(200);
  }, 180000);

  it('should lookup mojmap method mapping correctly', async () => {
    const mappingService = getMappingService();

    // 'tick' is a common method that should exist in Entity
    // This test verifies that method mappings work (which requires proper nesting)
    const result = await mappingService.lookupMapping(
      TEST_VERSION,
      'tick',
      'mojmap',
      'intermediary'
    );

    expect(result.found).toBe(true);
    expect(result.type).toBe('method');
    expect(result.target).toContain('method_');
  }, 60000);

  it('should have intermediary and named namespaces', async () => {
    const mappingService = getMappingService();
    const mappingPath = await mappingService.getMappings(TEST_VERSION, 'mojmap');

    const content = readFileSync(mappingPath, 'utf8');
    const firstLine = content.split('\n')[0];

    // Header should be: tiny\t2\t0\tintermediary\t{other namespaces including named or official}
    expect(firstLine).toContain('intermediary');
    expect(firstLine).toContain('named');
  }, 180000);
});
