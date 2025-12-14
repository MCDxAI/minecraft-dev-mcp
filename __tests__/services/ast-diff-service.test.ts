import { describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { handleCompareVersionsDetailed } from '../../src/server/tools.js';
import { getAstDiffService } from '../../src/services/ast-diff-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * AST Diff Service Tests
 *
 * Tests the AST diff service's ability to:
 * - Parse class signatures from source code
 * - Detect API changes between versions
 * - Compare methods, fields, and class structure
 */

describe('AST Diff Service', () => {
  it('should parse class signature from source', () => {
    const astDiffService = getAstDiffService();

    const source = `
package net.minecraft.entity;

public abstract class Entity implements Nameable, EntityAccess {
    private int age;
    public final double x;

    public void tick() {}
    public abstract void remove();
    private static void staticMethod(int param) {}
}
`;

    const signature = astDiffService.parseClassSignature(source);

    expect(signature).toBeDefined();
    expect(signature.name).toBe('net.minecraft.entity.Entity');
    expect(signature.package).toBe('net.minecraft.entity');
    expect(signature.simpleName).toBe('Entity');
    expect(signature.isAbstract).toBe(true);
    expect(signature.isInterface).toBe(false);
    expect(signature.interfaces).toContain('Nameable');
    expect(signature.interfaces).toContain('EntityAccess');

    expect(signature.fields.length).toBeGreaterThanOrEqual(2);
    expect(signature.methods.length).toBeGreaterThanOrEqual(3);
  });

  it('should parse interface signature', () => {
    const astDiffService = getAstDiffService();

    const source = `
package net.minecraft.entity;

public interface Nameable {
    String getName();
    default boolean hasCustomName() { return false; }
}
`;

    const signature = astDiffService.parseClassSignature(source);

    expect(signature).toBeDefined();
    expect(signature.isInterface).toBe(true);
  });

  it('should handle compare_versions_detailed tool (same version)', async () => {
    const cacheManager = getCacheManager();

    // Skip if not decompiled
    if (!cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)) {
      console.log('Skipping - source not decompiled');
      return;
    }

    const result = await handleCompareVersionsDetailed({
      fromVersion: TEST_VERSION,
      toVersion: TEST_VERSION,
      mapping: TEST_MAPPING,
      packages: ['net.minecraft.entity'],
      maxClasses: 10,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.fromVersion).toBe(TEST_VERSION);
    expect(data.toVersion).toBe(TEST_VERSION);

    // Same version should have no changes
    expect(data.summary.classesAdded).toBe(0);
    expect(data.summary.classesRemoved).toBe(0);
  }, 60000);
});
