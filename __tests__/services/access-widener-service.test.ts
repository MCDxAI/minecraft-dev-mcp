import { describe, expect, it } from 'vitest';
import { handleValidateAccessWidener } from '../../src/server/tools.js';
import { getAccessWidenerService } from '../../src/services/access-widener-service.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * Access Widener Service Tests
 *
 * Tests the access widener service's ability to:
 * - Parse Access Widener files
 * - Validate entries against Minecraft source
 * - Convert Java descriptors to readable format
 */

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

    const classEntry = aw.entries.find((e) => e.targetType === 'class');
    expect(classEntry).toBeDefined();
    expect(classEntry?.className).toBe('net.minecraft.entity.Entity');

    const methodEntry = aw.entries.find((e) => e.targetType === 'method');
    expect(methodEntry).toBeDefined();
    expect(methodEntry?.memberName).toBe('tick');

    const mutableEntry = aw.entries.find((e) => e.accessType === 'mutable');
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

  it('should handle invalid access widener gracefully', async () => {
    const result = await handleValidateAccessWidener({
      content: 'not valid access widener',
      mcVersion: TEST_VERSION,
    });

    expect(result).toBeDefined();
    expect(result.content[0].text).toBeDefined();
  });
});
