import { describe, it, expect, beforeAll } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { tools } from '../../src/server/tools.js';

/**
 * Phase 2 Analysis Tools Tests
 *
 * Tests the Phase 2 MCP tools:
 * - analyze_mixin
 * - validate_access_widener
 * - compare_versions_detailed
 * - index_minecraft_version
 * - search_indexed
 * - get_documentation
 * - search_documentation
 */

describe('Tool Definitions', () => {
  beforeAll(async () => {
    // Verify Java is available
    await verifyJavaVersion(17);
  }, 30000);

  it('should have all 16 tools defined (8 Phase 1 + 7 Phase 2 + 1 Phase 3)', () => {
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(16);

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
