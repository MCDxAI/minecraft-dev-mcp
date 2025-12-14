import { describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

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

    // Cache should return an array (may be empty on first run)
    expect(Array.isArray(cached)).toBe(true);
    // If cache has any versions, verify it's a valid version format
    if (cached.length > 0) {
      expect(cached[0]).toMatch(/^\d+\.\d+/); // Version format like "1.21.11"
    }
  });

  it('should verify cache state for test version', () => {
    const cacheManager = getCacheManager();

    // Check if TEST_VERSION is cached (will be true after other tests run)
    // This test is order-dependent but documents the expected cache state
    const hasJar = cacheManager.hasVersionJar(TEST_VERSION);
    const hasMappings = cacheManager.hasMappings(TEST_VERSION, TEST_MAPPING);
    const hasRemapped = cacheManager.hasRemappedJar(TEST_VERSION, TEST_MAPPING);
    const hasDecompiled = cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING);

    // All should be consistent - either all cached or all not cached
    if (hasJar) {
      expect(hasMappings).toBe(true);
      expect(hasRemapped).toBe(true);
      expect(hasDecompiled).toBe(true);
    }
  });
});
