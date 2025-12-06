import { describe, it, expect, beforeAll } from 'vitest';
import { getMixinService } from '../src/services/mixin-service.js';
import { getAccessWidenerService } from '../src/services/access-widener-service.js';
import { getAstDiffService } from '../src/services/ast-diff-service.js';
import { getSearchIndexService } from '../src/services/search-index-service.js';
import { getDocumentationService } from '../src/services/documentation-service.js';
import { getCacheManager } from '../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../src/java/java-process.js';
import {
  handleAnalyzeMixin,
  handleValidateAccessWidener,
  handleCompareVersionsDetailed,
  handleIndexVersion,
  handleSearchIndexed,
  handleGetDocumentation,
  handleSearchDocumentation,
  tools,
} from '../src/server/tools.js';

/**
 * Phase 2 Integration Tests
 *
 * Tests all Phase 2 features:
 * - Mixin analysis and validation
 * - Access Widener parsing and validation
 * - AST-based version diffing
 * - Full-text search indexing
 * - Documentation integration
 *
 * These tests require that Phase 1 has been run at least once
 * (to have 1.21.10 decompiled with yarn mappings).
 */

const TEST_VERSION = '1.21.10';
const TEST_MAPPING = 'yarn';

describe('Phase 2 - Integration Tests', () => {
  beforeAll(async () => {
    // Verify Java is available
    await verifyJavaVersion(17);
  }, 30000);

  describe('Tool Definitions', () => {
    it('should have all 15 tools defined (8 Phase 1 + 7 Phase 2)', () => {
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(15);

      const toolNames = tools.map((t) => t.name);

      // Phase 1 tools
      expect(toolNames).toContain('get_minecraft_source');
      expect(toolNames).toContain('decompile_minecraft_version');
      expect(toolNames).toContain('list_minecraft_versions');
      expect(toolNames).toContain('get_registry_data');
      expect(toolNames).toContain('remap_mod_jar');
      expect(toolNames).toContain('find_mapping');
      expect(toolNames).toContain('search_minecraft_code');
      expect(toolNames).toContain('compare_versions');

      // Phase 2 tools
      expect(toolNames).toContain('analyze_mixin');
      expect(toolNames).toContain('validate_access_widener');
      expect(toolNames).toContain('compare_versions_detailed');
      expect(toolNames).toContain('index_minecraft_version');
      expect(toolNames).toContain('search_indexed');
      expect(toolNames).toContain('get_documentation');
      expect(toolNames).toContain('search_documentation');
    });
  });

  describe('Mixin Service', () => {
    it('should parse a simple mixin source', () => {
      const mixinService = getMixinService();

      const source = `
package com.example.mixin;

import net.minecraft.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Entity.class)
public class EntityMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void onTick(CallbackInfo ci) {
        // Custom tick logic
    }
}
`;

      const mixin = mixinService.parseMixinSource(source);

      expect(mixin).toBeDefined();
      expect(mixin).not.toBeNull();
      expect(mixin!.className).toBe('com.example.mixin.EntityMixin');
      expect(mixin!.targets).toContain('Entity');
      expect(mixin!.injections.length).toBeGreaterThan(0);
      expect(mixin!.injections[0].type).toBe('inject');
      expect(mixin!.injections[0].targetMethod).toBe('tick');
    });

    it('should parse mixin with multiple targets', () => {
      const mixinService = getMixinService();

      const source = `
package com.example.mixin;

import org.spongepowered.asm.mixin.Mixin;

@Mixin({Entity.class, LivingEntity.class})
public class MultiTargetMixin {
}
`;

      const mixin = mixinService.parseMixinSource(source);

      expect(mixin).toBeDefined();
      expect(mixin!.targets.length).toBe(2);
      expect(mixin!.targets).toContain('Entity');
      expect(mixin!.targets).toContain('LivingEntity');
    });

    it('should parse @Shadow annotations', () => {
      const mixinService = getMixinService();

      const source = `
package com.example.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;

@Mixin(Entity.class)
public class EntityMixin {
    @Shadow
    private int age;

    @Shadow
    public abstract void remove();
}
`;

      const mixin = mixinService.parseMixinSource(source);

      expect(mixin).toBeDefined();
      expect(mixin!.shadows.length).toBe(2);

      const fieldShadow = mixin!.shadows.find(s => s.name === 'age');
      expect(fieldShadow).toBeDefined();
      expect(fieldShadow!.isMethod).toBe(false);

      const methodShadow = mixin!.shadows.find(s => s.name === 'remove');
      expect(methodShadow).toBeDefined();
      expect(methodShadow!.isMethod).toBe(true);
    });

    it('should return null for non-mixin source', () => {
      const mixinService = getMixinService();

      const source = `
package com.example;

public class NotAMixin {
    public void doSomething() {}
}
`;

      const mixin = mixinService.parseMixinSource(source);
      expect(mixin).toBeNull();
    });

    it('should handle analyze_mixin tool with source code', async () => {
      const source = `
package com.example.mixin;

import org.spongepowered.asm.mixin.Mixin;

@Mixin(Entity.class)
public class TestMixin {
}
`;

      const result = await handleAnalyzeMixin({
        source,
        mcVersion: TEST_VERSION,
        mapping: TEST_MAPPING,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);

      // Should return validation result (may have errors if Entity not found by simple name)
      const text = result.content[0].text;
      expect(text).toBeDefined();
    }, 30000);
  });

  describe('Access Widener Service', () => {
    it('should parse a simple access widener', () => {
      const awService = getAccessWidenerService();

      const content = `
accessWidener v2 named

accessible class net/minecraft/entity/Entity
accessible method net/minecraft/entity/Entity tick ()V
accessible field net/minecraft/entity/Entity age I
mutable field net/minecraft/entity/Entity age I
`;

      const aw = awService.parseAccessWidener(content);

      expect(aw).toBeDefined();
      expect(aw.namespace).toBe('named');
      expect(aw.version).toBe(2);
      expect(aw.entries.length).toBe(4);

      const classEntry = aw.entries.find(e => e.targetType === 'class');
      expect(classEntry).toBeDefined();
      expect(classEntry!.className).toBe('net.minecraft.entity.Entity');

      const methodEntry = aw.entries.find(e => e.targetType === 'method');
      expect(methodEntry).toBeDefined();
      expect(methodEntry!.memberName).toBe('tick');

      const mutableEntry = aw.entries.find(e => e.accessType === 'mutable');
      expect(mutableEntry).toBeDefined();
    });

    it('should skip comments and empty lines', () => {
      const awService = getAccessWidenerService();

      const content = `
accessWidener v2 named

# This is a comment
accessible class net/minecraft/entity/Entity

# Another comment
accessible field net/minecraft/entity/Entity age I
`;

      const aw = awService.parseAccessWidener(content);

      expect(aw.entries.length).toBe(2);
    });

    it('should convert descriptors to readable format', () => {
      const awService = getAccessWidenerService();

      expect(awService.descriptorToReadable('I')).toBe('int');
      expect(awService.descriptorToReadable('Z')).toBe('boolean');
      expect(awService.descriptorToReadable('Ljava/lang/String;')).toBe('java.lang.String');
      expect(awService.descriptorToReadable('[I')).toBe('int[]');
      expect(awService.descriptorToReadable('(II)V')).toBe('void (int, int)');
    });

    it('should handle validate_access_widener tool', async () => {
      const content = `
accessWidener v2 named

accessible class net/minecraft/entity/Entity
`;

      const result = await handleValidateAccessWidener({
        content,
        mcVersion: TEST_VERSION,
        mapping: TEST_MAPPING,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);

      const data = JSON.parse(result.content[0].text);
      expect(data.accessWidener).toBeDefined();
      expect(data.accessWidener.namespace).toBe('named');
      expect(data.validation).toBeDefined();
    }, 30000);
  });

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
  });

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

  describe('Error Handling', () => {
    it('should handle invalid mixin source gracefully', async () => {
      const result = await handleAnalyzeMixin({
        source: 'not valid java code',
        mcVersion: TEST_VERSION,
      });

      expect(result).toBeDefined();
      // Should return error or "no mixin found"
      expect(result.content[0].text).toBeDefined();
    });

    it('should handle invalid access widener gracefully', async () => {
      const result = await handleValidateAccessWidener({
        content: 'not valid access widener',
        mcVersion: TEST_VERSION,
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toBeDefined();
    });

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

  describe('Phase 2 Resources', () => {
    it('should have Phase 2 resource templates defined', async () => {
      const { resourceTemplates } = await import('../src/server/resources.js');

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
      const { resources } = await import('../src/server/resources.js');

      expect(resources).toBeDefined();
      expect(resources.length).toBe(4); // 1 Phase 1 + 3 Phase 2

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('minecraft://index/list');
      expect(uris).toContain('minecraft://docs/topic/mixin');
      expect(uris).toContain('minecraft://docs/topic/accesswidener');
    });

    it('should read documentation resource', async () => {
      const { handleReadResource } = await import('../src/server/resources.js');

      const result = await handleReadResource('minecraft://docs/net.minecraft.entity.Entity');

      expect(result).toBeDefined();
      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBe(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const data = JSON.parse(result.contents[0].text!);
      expect(data.className).toBe('net.minecraft.entity.Entity');
      expect(data.documentation).toBeDefined();
    });

    it('should read mixin topic resource', async () => {
      const { handleReadResource } = await import('../src/server/resources.js');

      const result = await handleReadResource('minecraft://docs/topic/mixin');

      expect(result).toBeDefined();
      expect(result.contents.length).toBe(1);

      const data = JSON.parse(result.contents[0].text!);
      expect(data.name).toBe('Mixin');
      expect(data.description).toBeDefined();
    });

    it('should read access widener topic resource', async () => {
      const { handleReadResource } = await import('../src/server/resources.js');

      const result = await handleReadResource('minecraft://docs/topic/accesswidener');

      expect(result).toBeDefined();
      expect(result.contents.length).toBe(1);

      const data = JSON.parse(result.contents[0].text!);
      expect(data.name).toBe('Access Widener');
    });

    it('should read indexed versions list resource', async () => {
      const { handleReadResource } = await import('../src/server/resources.js');

      const result = await handleReadResource('minecraft://index/list');

      expect(result).toBeDefined();
      expect(result.contents.length).toBe(1);

      const data = JSON.parse(result.contents[0].text!);
      expect(data.indexedVersions).toBeDefined();
      expect(Array.isArray(data.indexedVersions)).toBe(true);
    });

    it('should read index status resource', async () => {
      const { handleReadResource } = await import('../src/server/resources.js');
      const searchService = getSearchIndexService();

      // Only run if version is indexed
      if (searchService.isIndexed(TEST_VERSION, TEST_MAPPING)) {
        const result = await handleReadResource(`minecraft://index/${TEST_VERSION}/${TEST_MAPPING}`);

        expect(result).toBeDefined();
        expect(result.contents.length).toBe(1);

        const data = JSON.parse(result.contents[0].text!);
        expect(data.isIndexed).toBe(true);
        expect(data.fileCount).toBeGreaterThan(0);
      }
    });
  });
});
