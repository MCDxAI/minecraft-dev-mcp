import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { handleReadResource, resourceTemplates, resources } from '../../src/server/resources.js';
import { getSearchIndexService } from '../../src/services/search-index-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * MCP Resources Tests
 *
 * Tests the MCP resource definitions and handlers for:
 * - Phase 1: Source code, mappings, registry, versions list
 * - Phase 2: Documentation, search index, topics
 */

describe('MCP Resources', () => {
  beforeAll(async () => {
    // Verify Java is available (required for some resources)
    await verifyJavaVersion(17);
  }, 30000);

  it('should have resource templates defined', () => {
    expect(resourceTemplates).toBeDefined();
    expect(Array.isArray(resourceTemplates)).toBe(true);
    // Phase 1: 4 templates, Phase 2: 4 templates = 8 total (Phase 3 has no resources)
    expect(resourceTemplates.length).toBe(8);

    // Check Phase 1 templates are present
    const templateUris = resourceTemplates.map((t) => t.uriTemplate);
    expect(templateUris).toContain('minecraft://source/{version}/{mapping}/{className}');
    expect(templateUris).toContain('minecraft://mappings/{version}/{mapping}');
    expect(templateUris).toContain('minecraft://registry/{version}/{registryType}');
    expect(templateUris).toContain('minecraft://versions/list');
  });

  it('should have static resources defined', () => {
    expect(resources).toBeDefined();
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
  });

  it('should read versions list resource', async () => {
    const result = await handleReadResource('minecraft://versions/list');

    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data.cached).toBeDefined();
    expect(data.available).toBeDefined();
    expect(data.total_available).toBeGreaterThan(0);
  }, 30000);

  it('should read source code resource', async () => {
    const result = await handleReadResource(
      `minecraft://source/${TEST_VERSION}/${TEST_MAPPING}/net.minecraft.entity.Entity`,
    );

    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe('text/x-java-source');
    expect(result.contents[0].text).toContain('class Entity');
  }, 600000);

  it('should read registry resource', async () => {
    const result = await handleReadResource(`minecraft://registry/${TEST_VERSION}/block`);

    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data).toBeDefined();
  }, 300000);
});

describe('Phase 2 Resources', () => {
  it('should have Phase 2 resource templates defined', async () => {
    const { resourceTemplates } = await import('../../src/server/resources.js');

    expect(resourceTemplates).toBeDefined();
    expect(resourceTemplates.length).toBe(8); // 4 Phase 1 + 4 Phase 2

    const templateUris = resourceTemplates.map((t) => t.uriTemplate);
    // Phase 2 templates
    expect(templateUris).toContain('minecraft://docs/{className}');
    expect(templateUris).toContain('minecraft://docs/topic/{topic}');
    expect(templateUris).toContain('minecraft://index/{version}/{mapping}');
    expect(templateUris).toContain('minecraft://index/list');
  });

  it('should have Phase 2 static resources defined', async () => {
    const { resources } = await import('../../src/server/resources.js');

    expect(resources).toBeDefined();
    expect(resources.length).toBe(4); // 1 Phase 1 + 3 Phase 2 (Phase 3 has no static resources)

    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('minecraft://index/list');
    expect(uris).toContain('minecraft://docs/topic/mixin');
    expect(uris).toContain('minecraft://docs/topic/accesswidener');
  });

  it('should read documentation resource', async () => {
    const { handleReadResource } = await import('../../src/server/resources.js');

    const result = await handleReadResource('minecraft://docs/net.minecraft.entity.Entity');

    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data.className).toBe('net.minecraft.entity.Entity');
    expect(data.documentation).toBeDefined();
  });

  it('should read mixin topic resource', async () => {
    const { handleReadResource } = await import('../../src/server/resources.js');

    const result = await handleReadResource('minecraft://docs/topic/mixin');

    expect(result).toBeDefined();
    expect(result.contents.length).toBe(1);

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data.name).toBe('Mixin');
    expect(data.description).toBeDefined();
  });

  it('should read access widener topic resource', async () => {
    const { handleReadResource } = await import('../../src/server/resources.js');

    const result = await handleReadResource('minecraft://docs/topic/accesswidener');

    expect(result).toBeDefined();
    expect(result.contents.length).toBe(1);

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data.name).toBe('Access Widener');
  });

  it('should read indexed versions list resource', async () => {
    const { handleReadResource } = await import('../../src/server/resources.js');

    const result = await handleReadResource('minecraft://index/list');

    expect(result).toBeDefined();
    expect(result.contents.length).toBe(1);

    const data = JSON.parse(result.contents[0].text ?? '{}');
    expect(data.indexedVersions).toBeDefined();
    expect(Array.isArray(data.indexedVersions)).toBe(true);
  });

  it('should read index status resource', async () => {
    const { handleReadResource } = await import('../../src/server/resources.js');
    const searchService = getSearchIndexService();

    // Only run if version is indexed
    if (searchService.isIndexed(TEST_VERSION, TEST_MAPPING)) {
      const result = await handleReadResource(`minecraft://index/${TEST_VERSION}/${TEST_MAPPING}`);

      expect(result).toBeDefined();
      expect(result.contents.length).toBe(1);

      const data = JSON.parse(result.contents[0].text ?? '{}');
      expect(data.isIndexed).toBe(true);
      expect(data.fileCount).toBeGreaterThan(0);
    }
  });
});
