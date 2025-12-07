import { describe, it, expect } from 'vitest';
import { getMixinService } from '../../src/services/mixin-service.js';
import { handleAnalyzeMixin } from '../../src/server/tools.js';
import { TEST_VERSION, TEST_MAPPING } from '../test-constants.js';

/**
 * Mixin Service Tests
 *
 * Tests the mixin service's ability to:
 * - Parse Mixin source code
 * - Detect @Inject, @Shadow, and other annotations
 * - Validate mixin targets against Minecraft source
 */

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

  it('should handle invalid mixin source gracefully', async () => {
    const result = await handleAnalyzeMixin({
      source: 'not valid java code',
      mcVersion: TEST_VERSION,
    });

    expect(result).toBeDefined();
    // Should return error or "no mixin found"
    expect(result.content[0].text).toBeDefined();
  });
});
