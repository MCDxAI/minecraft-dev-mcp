import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * Source Code Retrieval Tests
 *
 * Tests the decompile service's ability to:
 * - Decompile Minecraft classes to Java source
 * - Retrieve specific class source code
 * - Handle missing classes gracefully
 */

describe('Source Code Retrieval', () => {
  beforeAll(async () => {
    // Verify Java is available (required for decompilation)
    await verifyJavaVersion(17);
  }, 30000);

  it('should get decompiled source for Entity class', async () => {
    const decompileService = getDecompileService();

    const source = await decompileService.getClassSource(
      TEST_VERSION,
      'net.minecraft.entity.Entity',
      TEST_MAPPING,
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
      TEST_MAPPING,
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
      decompileService.getClassSource(TEST_VERSION, 'net.minecraft.NonExistentClass', TEST_MAPPING),
    ).rejects.toThrow();
  }, 30000);
});
