import { describe, expect, it } from 'vitest';
import { handleAnalyzeModJar } from '../../src/server/tools.js';
import { METEOR_JAR_PATH } from '../test-constants.js';

/**
 * Mod Analysis MCP Tool Tests
 *
 * Tests the analyze_mod_jar MCP tool:
 * - Analyzes Fabric mod JARs
 * - Returns comprehensive mod information
 * - Handles various analysis options
 */

describe('MCP Tool: analyze_mod_jar', () => {
  it('should work via MCP tool handler', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
    });

    expect(response).toBeDefined();
    expect(response.isError).toBeUndefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBe(1);
    expect(response.content[0].type).toBe('text');

    // Parse the JSON response
    const result = JSON.parse(response.content[0].text);
    expect(result.loader).toBe('fabric');
    expect(result.metadata.id).toBe('meteor-client');
  }, 60000);

  it('should return error for non-existent JAR', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: '/nonexistent/path/to/mod.jar',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not found');
  }, 10000);

  it('should include all classes when flag is set', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
      includeAllClasses: true,
    });

    expect(response.isError).toBeUndefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.classes.allClasses).toBeDefined();
    expect(result.classes.allClasses.length).toBeGreaterThan(0);
  }, 120000);

  it('should include raw metadata when flag is set', async () => {
    const response = await handleAnalyzeModJar({
      jarPath: METEOR_JAR_PATH,
      includeRawMetadata: true,
    });

    expect(response.isError).toBeUndefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.rawMetadata).toBeDefined();
    expect(result.rawMetadata.fabricModJson).toBeDefined();
  }, 60000);
});
