import { describe, it, expect, beforeAll } from 'vitest';
import { getRegistryService } from '../../src/services/registry-service.js';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * Registry Data Extraction Tests
 *
 * Tests the registry service's ability to:
 * - Extract registry data from Minecraft server JAR
 * - Parse blocks, items, and other game registries
 * - Handle version-specific registry formats
 */

describe('Registry Data Extraction', () => {
  beforeAll(async () => {
    // Verify Java is available (required for registry extraction)
    await verifyJavaVersion(17);
  }, 30000);

  it('should extract registry data from Minecraft', async () => {
    const registryService = getRegistryService();

    const data = await registryService.getRegistryData(TEST_VERSION);

    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  }, 300000); // 5 minutes timeout

  it('should contain blocks registry', async () => {
    const registryService = getRegistryService();

    const data = await registryService.getRegistryData(TEST_VERSION, 'block');

    expect(data).toBeDefined();

    // Should have common blocks
    const dataStr = JSON.stringify(data);
    expect(dataStr).toContain('stone');
    expect(dataStr).toContain('dirt');
  }, 300000);

  it('should contain items registry', async () => {
    const registryService = getRegistryService();

    const data = await registryService.getRegistryData(TEST_VERSION, 'item');

    expect(data).toBeDefined();

    // Should have common items
    const dataStr = JSON.stringify(data);
    expect(dataStr).toContain('diamond');
    expect(dataStr).toContain('stick');
  }, 300000);
});
