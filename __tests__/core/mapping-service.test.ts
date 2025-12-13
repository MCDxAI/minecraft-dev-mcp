import { describe, it, expect } from 'vitest';
import { getMappingService } from '../../src/services/mapping-service.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';
import { existsSync } from 'node:fs';

/**
 * Mapping Service Tests
 *
 * Tests the mapping service's ability to:
 * - Download Yarn mappings from Fabric Maven
 * - Auto-resolve version to latest build
 * - Extract .tiny files from JAR
 */

describe('Mapping Download', () => {
  it(`should download and extract Yarn mappings for ${TEST_VERSION}`, async () => {
    const mappingService = getMappingService();

    // MappingService will auto-resolve version -> version+build.X
    // and extract the .tiny file from the JAR
    const mappingPath = await mappingService.getMappings(TEST_VERSION, TEST_MAPPING);

    expect(mappingPath).toBeDefined();
    expect(existsSync(mappingPath)).toBe(true);
    expect(mappingPath).toContain('yarn');
    expect(mappingPath).toContain(TEST_VERSION);

    // Verify it's an extracted .tiny file (not JAR)
    expect(mappingPath).toMatch(/\.tiny$/);
  }, 120000); // 2 minutes timeout
});
