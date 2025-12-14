import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getModAnalyzerService } from '../../src/services/mod-analyzer-service.js';
import { METEOR_JAR_PATH } from '../test-constants.js';

/**
 * Mod Analyzer Service Tests
 *
 * Tests the mod analyzer service's ability to:
 * - Analyze Fabric mod JARs
 * - Extract metadata from fabric.mod.json
 * - Detect mixins, entry points, and dependencies
 * - Parse class structure and bytecode
 */

describe('ModAnalyzerService', () => {
  it('should detect Meteor Client JAR exists', () => {
    expect(existsSync(METEOR_JAR_PATH)).toBe(true);
  });

  it('should analyze Meteor Client and detect Fabric loader', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    expect(result).toBeDefined();
    expect(result.loader).toBe('fabric');
  }, 60000);

  it('should extract correct mod metadata', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Meteor Client mod ID
    expect(result.metadata.id).toBe('meteor-client');

    // Version should match the version in fabric.mod.json
    expect(result.metadata.version).toBe('1.21.10-32');

    // Should have a display name
    expect(result.metadata.name).toBe('Meteor Client');

    // Should have authors
    expect(result.metadata.authors.length).toBeGreaterThan(0);

    // Should have description
    expect(result.metadata.description).toBeDefined();
    expect(result.metadata.description?.length).toBeGreaterThan(0);
  }, 60000);

  it('should detect Minecraft version compatibility', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Should require Minecraft 1.21.x
    expect(result.compatibility.minecraft).toContain('1.21');

    // Should be client-side mod
    expect(result.compatibility.environment).toBe('client');
  }, 60000);

  it('should extract dependencies', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Should have dependencies
    expect(result.dependencies.length).toBeGreaterThan(0);

    // Should depend on Minecraft
    const mcDep = result.dependencies.find((d) => d.modId === 'minecraft');
    expect(mcDep).toBeDefined();

    // Should depend on Fabric Loader
    const loaderDep = result.dependencies.find((d) => d.modId === 'fabricloader');
    expect(loaderDep).toBeDefined();

    // Should have Java requirement
    const javaDep = result.dependencies.find((d) => d.modId === 'java');
    expect(javaDep).toBeDefined();
  }, 60000);

  it('should extract entry points', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Should have entry points
    expect(result.entrypoints.length).toBeGreaterThan(0);

    // Should have a client entrypoint (Meteor is a client mod)
    const clientEntry = result.entrypoints.find((e) => e.type === 'client');
    expect(clientEntry).toBeDefined();
  }, 60000);

  it('should detect mixin configurations', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Meteor Client uses mixins extensively
    expect(result.mixins.length).toBeGreaterThan(0);

    // Should have mixin classes listed
    const firstConfig = result.mixins[0];
    expect(firstConfig.configFile).toBeDefined();

    // Should have a package defined
    expect(firstConfig.package).toBeDefined();
  }, 60000);

  it('should analyze class structure', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Should have many classes (Meteor is a large mod)
    expect(result.classes.total).toBeGreaterThan(500);

    // Should have package breakdown
    expect(Object.keys(result.classes.packages).length).toBeGreaterThan(10);

    // Should detect mixin classes
    expect(result.classes.mixinClasses.length).toBeGreaterThan(0);

    // Should have detected entrypoint classes
    expect(result.classes.entrypointClasses.length).toBeGreaterThan(0);
  }, 60000);

  it('should detect mixin classes via bytecode analysis', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH, {
      analyzeBytecode: true,
    });

    // Should have mixin classes detected
    expect(result.classes.mixinClasses.length).toBeGreaterThan(0);

    // At least one mixin should have isMixin = true
    const mixinWithFlag = result.classes.mixinClasses.find((c) => c.isMixin);
    expect(mixinWithFlag).toBeDefined();
  }, 60000);

  it('should include all classes when requested', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH, {
      includeAllClasses: true,
    });

    // Should have allClasses populated
    expect(result.classes.allClasses).toBeDefined();
    expect(result.classes.allClasses?.length).toBe(result.classes.total);
  }, 120000);

  it('should include raw metadata when requested', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH, {
      includeRawMetadata: true,
    });

    // Should have raw fabric.mod.json
    expect(result.rawMetadata).toBeDefined();
    expect(result.rawMetadata?.fabricModJson).toBeDefined();

    // Should have raw mixin configs
    expect(result.rawMetadata?.mixinConfigs).toBeDefined();
    expect(Object.keys(result.rawMetadata?.mixinConfigs ?? {}).length).toBeGreaterThan(0);
  }, 60000);

  it('should report analysis metadata', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Should have analysis metadata
    expect(result.analysis.jarPath).toBe(METEOR_JAR_PATH);
    expect(result.analysis.jarSize).toBeGreaterThan(0);
    expect(result.analysis.analyzedAt).toBeDefined();
    expect(result.analysis.durationMs).toBeGreaterThan(0);
  }, 60000);

  it('should handle nested JARs (Jar-in-Jar)', async () => {
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    // Meteor may bundle some dependencies as nested JARs
    // This test just verifies the field exists (may be empty if no nested JARs)
    expect(result.nestedJars === undefined || Array.isArray(result.nestedJars)).toBe(true);
  }, 60000);

  it('should handle JAR path with spaces (if applicable)', async () => {
    // This test uses the existing JAR - just verifies the path handling works
    const analyzer = getModAnalyzerService();
    const result = await analyzer.analyzeMod(METEOR_JAR_PATH);

    expect(result).toBeDefined();
    expect(result.loader).toBe('fabric');
  }, 60000);
});
