import { describe, it, expect } from 'vitest';
import { getDocumentationService } from '../../src/services/documentation-service.js';
import { handleGetDocumentation, handleSearchDocumentation } from '../../src/server/tools.js';

/**
 * Documentation Service Tests
 *
 * Tests the documentation service's ability to:
 * - Retrieve documentation for Minecraft classes
 * - Search documentation by topic
 * - Provide mixin and access widener reference docs
 */

describe('Documentation Service', () => {
  it('should get documentation for known classes', async () => {
    const docService = getDocumentationService();

    const doc = await docService.getDocumentation('net.minecraft.entity.Entity');

    expect(doc).toBeDefined();
    expect(doc!.name).toBe('net.minecraft.entity.Entity');
    expect(doc!.source).toBe('fabric_wiki');
    expect(doc!.url).toBeDefined();
    expect(doc!.summary).toBeDefined();
  });

  it('should infer documentation for entity subclasses', async () => {
    const docService = getDocumentationService();

    const doc = await docService.getDocumentation('net.minecraft.entity.mob.ZombieEntity');

    expect(doc).toBeDefined();
    expect(doc!.url).toContain('entity');
  });

  it('should infer documentation for blocks', async () => {
    const docService = getDocumentationService();

    const doc = await docService.getDocumentation('net.minecraft.block.StoneBlock');

    expect(doc).toBeDefined();
    expect(doc!.url).toContain('block');
  });

  it('should get topic documentation', async () => {
    const docService = getDocumentationService();

    const doc = await docService.getTopicDocumentation('mixin');

    expect(doc).toBeDefined();
    expect(doc!.url).toContain('mixin');
  });

  it('should search documentation', () => {
    const docService = getDocumentationService();

    const results = docService.searchDocumentation('entity');

    expect(results.length).toBeGreaterThan(0);
  });

  it('should get mixin documentation', () => {
    const docService = getDocumentationService();

    const doc = docService.getMixinDocumentation();

    expect(doc).toBeDefined();
    expect(doc.name).toBe('Mixin');
    expect(doc.description).toBeDefined();
    expect(doc.description).toContain('@Inject');
  });

  it('should get access widener documentation', () => {
    const docService = getDocumentationService();

    const doc = docService.getAccessWidenerDocumentation();

    expect(doc).toBeDefined();
    expect(doc.name).toBe('Access Widener');
    expect(doc.description).toBeDefined();
    expect(doc.description).toContain('accessible');
  });

  it('should handle get_documentation tool', async () => {
    const result = await handleGetDocumentation({
      className: 'net.minecraft.entity.Entity',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);

    const docs = JSON.parse(result.content[0].text);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
  });

  it('should handle search_documentation tool', async () => {
    const result = await handleSearchDocumentation({
      query: 'block',
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.query).toBe('block');
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);
  });
});
