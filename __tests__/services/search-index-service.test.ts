import { describe, it, expect } from 'vitest';
import { getSearchIndexService } from '../../src/services/search-index-service.js';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { handleIndexVersion, handleSearchIndexed } from '../../src/server/tools.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';

/**
 * Search Index Service Tests
 *
 * Tests the search index service's ability to:
 * - Index decompiled Minecraft source code
 * - Perform fast full-text searches
 * - Search for classes, methods, fields
 */

describe('Search Index Service', () => {
  it('should index and search version', async () => {
    const cacheManager = getCacheManager();

    // Skip if not decompiled
    if (!cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)) {
      console.log('Skipping - source not decompiled');
      return;
    }

    const searchService = getSearchIndexService();

    // Index (or use existing)
    if (!searchService.isIndexed(TEST_VERSION, TEST_MAPPING)) {
      console.log('Indexing for search tests...');
      await searchService.indexVersion(TEST_VERSION, TEST_MAPPING);
    }

    // Verify indexed
    expect(searchService.isIndexed(TEST_VERSION, TEST_MAPPING)).toBe(true);

    // Get stats
    const stats = searchService.getStats(TEST_VERSION, TEST_MAPPING);
    expect(stats.isIndexed).toBe(true);
    expect(stats.fileCount).toBeGreaterThan(0);
    expect(stats.classCount).toBeGreaterThan(0);
  }, 300000); // 5 minutes for indexing

  it('should search for classes', async () => {
    const cacheManager = getCacheManager();
    const searchService = getSearchIndexService();

    if (!cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING) ||
        !searchService.isIndexed(TEST_VERSION, TEST_MAPPING)) {
      console.log('Skipping - not indexed');
      return;
    }

    const results = searchService.searchClasses('Entity', TEST_VERSION, TEST_MAPPING, 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entryType).toBe('class');
  }, 30000);

  it('should handle index_minecraft_version tool', async () => {
    const cacheManager = getCacheManager();

    if (!cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING)) {
      console.log('Skipping - source not decompiled');
      return;
    }

    const result = await handleIndexVersion({
      version: TEST_VERSION,
      mapping: TEST_MAPPING,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);
    // Should either say already indexed or complete indexing
    expect(result.content[0].text).toMatch(/indexed|complete/i);
  }, 300000);

  it('should handle search_indexed tool', async () => {
    const cacheManager = getCacheManager();
    const searchService = getSearchIndexService();

    if (!cacheManager.hasDecompiledSource(TEST_VERSION, TEST_MAPPING) ||
        !searchService.isIndexed(TEST_VERSION, TEST_MAPPING)) {
      console.log('Skipping - not indexed');
      return;
    }

    const result = await handleSearchIndexed({
      query: 'Entity',
      version: TEST_VERSION,
      mapping: TEST_MAPPING,
      types: ['class'],
      limit: 5,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.query).toBe('Entity');
    expect(data.results).toBeDefined();
  }, 30000);

  it('should handle search on non-indexed version gracefully', async () => {
    const result = await handleSearchIndexed({
      query: 'test',
      version: '999.999.999',
      mapping: TEST_MAPPING,
    });

    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
  });
});
