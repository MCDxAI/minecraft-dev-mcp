import { describe, it, expect } from 'vitest';
import { MojangDownloader } from '../../src/downloaders/mojang-downloader.js';
import { getDecompileService } from '../../src/services/decompile-service.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';

/**
 * End-to-End Integration Tests
 *
 * Tests complete workflows and error handling scenarios:
 * - Invalid version handling
 * - Missing class handling
 * - Full pipeline smoke tests
 */

describe('Error Handling', () => {
  it('should handle invalid version gracefully', async () => {
    const downloader = new MojangDownloader();

    await expect(
      downloader.downloadClientJar('invalid.version.number')
    ).rejects.toThrow();
  }, 30000);

  it('should handle missing class gracefully', async () => {
    const decompileService = getDecompileService();

    await expect(
      decompileService.getClassSource(TEST_VERSION, 'does.not.Exist', TEST_MAPPING)
    ).rejects.toThrow();
  }, 30000);
});
