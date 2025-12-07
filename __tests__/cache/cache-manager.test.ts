import { describe, it, expect } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';

/**
 * Cache Functionality Tests
 *
 * Tests the cache manager's ability to:
 * - Track cached versions
 * - Verify component caching (JARs, mappings, remapped JARs, decompiled source)
 * - Provide cache status information
 */

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
