import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAnalyzeMixin } from '../../src/server/tools.js';
import {
  getMixinService,
  validateAccessorAgainstSource,
  validateInjectionAgainstSource,
  validateShadowAgainstSource,
} from '../../src/services/mixin-service.js';
import type {
  MixinAccessor,
  MixinClass,
  MixinInjection,
  MixinInjectionType,
  MixinShadow,
} from '../../src/types/minecraft.js';
import { MixinParseError } from '../../src/utils/errors.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

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

    expect(mixin?.className).toBe('com.example.mixin.EntityMixin');
    expect(mixin?.targets).toContain('Entity');
    // Exactly one injection — a regression that captured garbage injections must fail.
    expect(mixin?.injections).toHaveLength(1);
    expect(mixin?.injections[0].type).toBe('inject');
    expect(mixin?.injections[0].targetMethod).toBe('tick');
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
    expect(mixin?.targets.length).toBe(2);
    expect(mixin?.targets).toContain('Entity');
    expect(mixin?.targets).toContain('LivingEntity');
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
    expect(mixin?.shadows.length).toBe(2);

    const fieldShadow = mixin?.shadows.find((s) => s.name === 'age');
    expect(fieldShadow).toBeDefined();
    expect(fieldShadow?.isMethod).toBe(false);

    const methodShadow = mixin?.shadows.find((s) => s.name === 'remove');
    expect(methodShadow).toBeDefined();
    expect(methodShadow?.isMethod).toBe(true);
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

    expect(result.content).toHaveLength(1);

    // The handler returns a JSON validation result: parse it and assert the parsed mixin
    // is echoed back (not just that "a response exists"). The className and target must
    // reflect the source we sent, whether or not the MC target resolves locally.
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mixin).toBeDefined();
    expect(parsed.mixin.className).toBe('com.example.mixin.TestMixin');
    expect(parsed.mixin.targets).toEqual(['Entity']);
    expect(typeof parsed.isValid).toBe('boolean');
    expect(Array.isArray(parsed.errors)).toBe(true);
  }, 30000);

  it('should handle invalid mixin source gracefully', async () => {
    const result = await handleAnalyzeMixin({
      source: 'not valid java code',
      mcVersion: TEST_VERSION,
    });

    expect(result).toBeDefined();
    // No @Mixin in source → an error response, not a parsed-mixin success shape.
    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('no @mixin');
  });
});

/**
 * Mixin fixture builders for the target-source validation regression tests.
 * These exercise the tree-sitter + descriptor-matching validators via the
 * `validate*AgainstSource` test seams (synthetic Java target source, no
 * decompiled Minecraft tree required) — mirroring the access-widener suite's
 * `validateEntryAgainstSource` pattern.
 */
function makeInjection(
  partial: Partial<MixinInjection> & { targetMethod: string },
): MixinInjection {
  return {
    type: 'inject' as MixinInjectionType,
    methodName: 'handler',
    targetMethod: '',
    line: 1,
    rawAnnotation: '',
    ...partial,
  };
}

function makeShadow(partial: Partial<MixinShadow> & { name: string }): MixinShadow {
  return { name: '', type: '', isMethod: false, line: 1, ...partial };
}

function makeAccessor(partial: Partial<MixinAccessor> & { target: string }): MixinAccessor {
  return { name: '', target: '', isInvoker: false, line: 1, ...partial };
}

describe('Mixin Validation (tree-sitter + descriptor matching)', () => {
  it('does NOT match an injection target method that is only called (not declared)', () => {
    // `helper` is invoked inside doWork() but never declared. The old regex
    // `\bhelper\s*\(` matched the call site and reported a false negative.
    const src = `
package net.test;
public class Caller {
    public void doWork() {
        helper();
    }
}
`;
    const injection = makeInjection({ targetMethod: 'helper', methodName: 'onHelper' });
    const res = validateInjectionAgainstSource(injection, src, 'Caller');
    expect(res.errors.some((e) => e.type === 'method_not_found')).toBe(true);
    expect(res.warnings).toEqual([]);
  });

  it('resolves by name only when no descriptor is present', () => {
    const src = `
package net.test;
public class Svc {
    public void tick() {}
}
`;
    const injection = makeInjection({ targetMethod: 'tick', methodName: 'onTick' });
    expect(validateInjectionAgainstSource(injection, src, 'Svc').errors).toEqual([]);
  });

  it('resolves an <init> injection to a real constructor (both forms)', () => {
    // Decompiled constructors are named after the class, so the old
    // `\b<init>\s*\(` regex NEVER matched and always reported method_not_found.
    const src = `
package net.test;
public class Thing {
    private int x;
    private int y;
    public Thing(int a, int b) {
        this.x = a;
        this.y = b;
    }
}
`;
    const byInit = makeInjection({
      targetMethod: '<init>(II)V',
      methodName: 'onInit',
      at: 'RETURN',
    });
    expect(validateInjectionAgainstSource(byInit, src, 'Thing').errors).toEqual([]);

    const byName = makeInjection({
      targetMethod: 'Thing(II)V',
      methodName: 'onInit',
      at: 'RETURN',
    });
    expect(validateInjectionAgainstSource(byName, src, 'Thing').errors).toEqual([]);

    // Wrong arity constructor descriptor → overload (signature) mismatch.
    const wrong = makeInjection({
      targetMethod: '<init>(I)V',
      methodName: 'onInit',
      at: 'RETURN',
    });
    const wrongRes = validateInjectionAgainstSource(wrong, src, 'Thing');
    expect(wrongRes.errors.some((e) => e.type === 'signature_mismatch')).toBe(true);
  });

  it('reports overload mismatch and lists the found overloads', () => {
    const src = `
package net.test;
public class Over {
    public void foo(int x) {}
    public void foo(String s) {}
}
`;
    // foo(int) and foo(String) are both 1-arg; the injection targets a 2-arg one.
    const injection = makeInjection({ targetMethod: 'foo(II)V', methodName: 'onFoo' });
    const res = validateInjectionAgainstSource(injection, src, 'Over');
    const err = res.errors.find((e) => e.message.includes('no overload matches'));
    expect(err).toBeDefined();
    expect(err?.type).toBe('signature_mismatch');
    // The actual overloads are reported so the user can pick the right one.
    expect(err?.message).toContain('(I)V');
    expect(err?.message).toContain('(Ljava/lang/String;)V');
  });

  it('resolves a correct overload by descriptor', () => {
    const src = `
package net.test;
public class Over {
    public void foo(int x) {}
    public void foo(String s) {}
}
`;
    const injection = makeInjection({
      targetMethod: 'foo(Ljava/lang/String;)V',
      methodName: 'onFoo',
    });
    expect(validateInjectionAgainstSource(injection, src, 'Over').errors).toEqual([]);
  });

  it('warns (does not error) on a <clinit> injection target', () => {
    // Static initializers are not emitted by the AST walk; unverifiable.
    const src = `
package net.test;
public class WithStatic {
    static {
        System.out.println("init");
    }
}
`;
    const injection = makeInjection({ targetMethod: '<clinit>', methodName: 'onClinit' });
    const res = validateInjectionAgainstSource(injection, src, 'WithStatic');
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.message.includes('<clinit>'))).toBe(true);
  });

  it('finds a @Shadow field whose type is fully-qualified / generic', () => {
    // The old `extractFieldNames` regex used a `\w` type class that stopped at
    // dots, so a qualified/generic-typed field was dropped from the suggestion
    // list. The AST path finds it regardless of type complexity.
    const src = `
package net.test;
import java.util.Map;
public class Holder {
    public java.util.Map<String, Integer> data;
}
`;
    const shadow = makeShadow({ name: 'data', type: 'java.util.Map', isMethod: false });
    expect(validateShadowAgainstSource(shadow, src, 'Holder').errors).toEqual([]);

    // Misspelled shadow now suggests the generic-typed field by name.
    const misspelled = makeShadow({ name: 'deta', type: 'Map', isMethod: false });
    const missRes = validateShadowAgainstSource(misspelled, src, 'Holder');
    expect(missRes.errors.some((e) => e.type === 'shadow_not_found')).toBe(true);
    expect(missRes.suggestions.some((s) => s.message.includes('data'))).toBe(true);
  });

  it('reports shadow methods/fields that are missing and suggests similar ones', () => {
    const src = `
package net.test;
public class Entity {
    public void remove() {}
    public int age;
}
`;
    const methodShadow = makeShadow({ name: 'remov', type: 'void', isMethod: true });
    const methodRes = validateShadowAgainstSource(methodShadow, src, 'Entity');
    expect(methodRes.errors.some((e) => e.type === 'shadow_not_found')).toBe(true);
    expect(methodRes.suggestions.some((s) => s.message.includes('remove'))).toBe(true);

    const okMethod = makeShadow({ name: 'remove', type: 'void', isMethod: true });
    expect(validateShadowAgainstSource(okMethod, src, 'Entity').errors).toEqual([]);
  });

  it('validates @Accessor (field) and @Invoker (method) targets', () => {
    const src = `
package net.test;
public class Box {
    private int size;
    private void compute() {}
}
`;
    // Accessor → field exists / missing.
    expect(
      validateAccessorAgainstSource(
        makeAccessor({ name: 'getSize', target: 'size', isInvoker: false }),
        src,
        'Box',
      ).errors,
    ).toEqual([]);
    expect(
      validateAccessorAgainstSource(
        makeAccessor({ name: 'getWeight', target: 'weight', isInvoker: false }),
        src,
        'Box',
      ).errors.some((e) => e.type === 'shadow_not_found'),
    ).toBe(true);

    // Invoker → method exists / missing.
    expect(
      validateAccessorAgainstSource(
        makeAccessor({ name: 'invokeCompute', target: 'compute', isInvoker: true }),
        src,
        'Box',
      ).errors,
    ).toEqual([]);
    expect(
      validateAccessorAgainstSource(
        makeAccessor({ name: 'invokeFoo', target: 'foo', isInvoker: true }),
        src,
        'Box',
      ).errors.some((e) => e.type === 'shadow_not_found'),
    ).toBe(true);
  });
});

/**
 * Mixin SOURCE parsing via the tree-sitter AST (Part 2 of the regex→AST
 * refactor). These cover every annotation form documented in
 * `docs/ref/mixin-annotation-ast.md`: @Mixin target forms, the injection
 * annotation family, @Shadow field/method detection (including the qualified /
 * generic-type regression), and @Accessor/@Invoker explicit-vs-inferred targets.
 */
describe('Mixin source parsing (tree-sitter AST)', () => {
  const parse = (body: string, pkg = 'com.example.mixin'): MixinClass | null =>
    getMixinService().parseMixinSource(`package ${pkg};\n${body}`);

  it('parses @Mixin(Entity.class) single target with default priority', () => {
    const m = parse('@Mixin(Entity.class) public class M {}');
    expect(m?.className).toBe('com.example.mixin.M');
    expect(m?.targets).toEqual(['Entity']);
    expect(m?.priority).toBe(1000);
  });

  it('parses @Mixin({A.class, B.class}) array target', () => {
    const m = parse('@Mixin({Entity.class, LivingEntity.class}) public class M {}');
    expect(m?.targets).toEqual(['Entity', 'LivingEntity']);
  });

  it('parses @Mixin with a qualified target name (dots preserved)', () => {
    const m = parse('@Mixin(net.minecraft.entity.Entity.class) public class M {}');
    expect(m?.targets).toEqual(['net.minecraft.entity.Entity']);
  });

  it('parses @Mixin(value = {A.class}, priority = 500) named-value form', () => {
    const m = parse('@Mixin(value = {Entity.class}, priority = 500) public class M {}');
    expect(m?.targets).toEqual(['Entity']);
    expect(m?.priority).toBe(500);
  });

  it('parses @Inject(method = "tick", at = @At("HEAD"))', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Inject(method = "tick", at = @At("HEAD"))
  private void onTick() {}
}`);
    expect(m?.injections).toHaveLength(1);
    const inj = m?.injections[0];
    expect(inj?.type).toBe('inject');
    expect(inj?.methodName).toBe('onTick');
    expect(inj?.targetMethod).toBe('tick');
    expect(inj?.at).toBe('HEAD');
  });

  it('parses a full @Inject form (INVOKE + target + cancellable)', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Inject(method = "tick", at = @At(value = "INVOKE", target = "Lx;y()V"), cancellable = true)
  private void onTick() {}
}`);
    const inj = m?.injections[0];
    expect(inj?.type).toBe('inject');
    expect(inj?.targetMethod).toBe('tick');
    expect(inj?.at).toBe('INVOKE');
    expect(inj?.atTarget).toBe('Lx;y()V');
    expect(inj?.cancellable).toBe(true);
  });

  it('takes the first element of a method array as targetMethod', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Inject(method = {"a", "b"})
  private void onInject() {}
}`);
    expect(m?.injections[0].targetMethod).toBe('a');
  });

  it.each([
    ['@Redirect', 'redirect'],
    ['@ModifyArg', 'modify_arg'],
    ['@ModifyVariable', 'modify_variable'],
    ['@ModifyConstant', 'modify_constant'],
    ['@ModifyReturnValue', 'modify_return_value'],
    ['@WrapOperation', 'wrap_operation'],
    ['@WrapMethod', 'wrap_method'],
  ] as const)('maps %s to the %s injection type', (anno, type) => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  ${anno}(method = "tick")
  private void handler() {}
}`);
    expect(m?.injections[0].type).toBe(type);
  });

  it('parses @Shadow on a simple-typed field', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Shadow
  private int age;
}`);
    const sh = m?.shadows[0];
    expect(sh?.name).toBe('age');
    expect(sh?.isMethod).toBe(false);
    expect(sh?.type).toBe('int');
  });

  it('parses @Shadow on a qualified+generic field (regression: dots dropped by old regex)', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Shadow
  private java.util.List<String> items;
}`);
    const sh = m?.shadows[0];
    expect(sh?.name).toBe('items');
    expect(sh?.isMethod).toBe(false);
    expect(sh?.type).toContain('java.util.List');
  });

  it('parses @Shadow on an abstract method', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Shadow
  public abstract void remove();
}`);
    const sh = m?.shadows[0];
    expect(sh?.name).toBe('remove');
    expect(sh?.isMethod).toBe(true);
    expect(sh?.type).toBe('void');
  });

  it('detects a shadow stacked with @Mutable', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Shadow @Mutable
  private int age;
}`);
    expect(m?.shadows).toHaveLength(1);
    expect(m?.shadows[0].name).toBe('age');
  });

  it('uses an explicit @Accessor target over inference', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Accessor("size")
  public int getSize() { return 0; }
}`);
    expect(m?.accessors[0].target).toBe('size');
    expect(m?.accessors[0].isInvoker).toBe(false);
  });

  it.each([
    ['getCount', 'count'],
    ['setSize', 'size'],
    ['isActive', 'active'],
  ] as const)('infers an @Accessor target from %s -> %s', (method, target) => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Accessor
  public void ${method}() {}
}`);
    expect(m?.accessors[0].target).toBe(target);
    expect(m?.accessors[0].isInvoker).toBe(false);
  });

  it('uses an explicit @Invoker target', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Invoker("create")
  public static Entity invokeCreate() { return null; }
}`);
    expect(m?.accessors[0].target).toBe('create');
    expect(m?.accessors[0].isInvoker).toBe(true);
  });

  it('infers an @Invoker target from invokeCreate -> create', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  @Invoker
  public static Entity invokeCreate() { return null; }
}`);
    expect(m?.accessors[0].target).toBe('create');
    expect(m?.accessors[0].isInvoker).toBe(true);
  });

  it('attributes members of a nested mixin class to the mixin', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {
  public class Inner {
    @Inject(method = "tick")
    private void onTick() {}
  }
}`);
    // The nested-class @Inject is collected because its declaringClass starts
    // with the mixin's className.
    expect(m?.injections.some((i) => i.methodName === 'onTick')).toBe(true);
  });

  it('does NOT attribute a sibling non-mixin class injections to the mixin', () => {
    const m = parse(`@Mixin(Entity.class)
public class M {}

public class Helper {
  @Inject(method = "tick")
  private void onTick() {}
}`);
    // Helper is a top-level sibling, not nested in M; its @Inject must not leak in.
    expect(m?.injections).toHaveLength(0);
  });

  it('returns null for a class with only @Override (no @Mixin)', () => {
    const m = parse(`public class M {
  @Override
  public String toString() { return ""; }
}`);
    expect(m).toBeNull();
  });
});

/**
 * parseMixinsFromDirectory / parseMixinsFromJar: the public file-walking and JAR-entry entry
 * points of MixinService. Built from synthetic temp fixtures so they exercise the real I/O
 * paths without depending on a decompiled Minecraft tree.
 */
describe('parseMixinsFromDirectory', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mixin-dir-'));

    // 1) A simple @Mixin with no injections.
    writeFileSync(
      join(tmpDir, 'SimpleMixin.java'),
      `package com.example.mixin;
import org.spongepowered.asm.mixin.Mixin;
@Mixin(Entity.class)
public class SimpleMixin {}
`,
    );

    // 2) A @Mixin carrying a single @Inject.
    writeFileSync(
      join(tmpDir, 'InjectMixin.java'),
      `package com.example.mixin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(Entity.class)
public class InjectMixin {
  @Inject(method = "tick", at = @At("HEAD"))
  private void onTick(CallbackInfo ci) {}
}
`,
    );

    // 3) A plain (non-mixin) class that must be excluded from the results.
    writeFileSync(
      join(tmpDir, 'PlainClass.java'),
      `package com.example;
public class PlainClass {
  public void doSomething() {}
}
`,
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses only the @Mixin files (excludes the plain class)', () => {
    const mixins = getMixinService().parseMixinsFromDirectory(tmpDir);

    expect(mixins).toHaveLength(2);
    expect(mixins.map((m) => m.className).sort()).toEqual([
      'com.example.mixin.InjectMixin',
      'com.example.mixin.SimpleMixin',
    ]);
  });

  it('captures targets and injections per parsed mixin', () => {
    const mixins = getMixinService().parseMixinsFromDirectory(tmpDir);
    const byName = new Map(mixins.map((m) => [m.className, m]));

    const simple = byName.get('com.example.mixin.SimpleMixin');
    expect(simple?.targets).toEqual(['Entity']);
    expect(simple?.injections).toHaveLength(0);

    const inject = byName.get('com.example.mixin.InjectMixin');
    expect(inject?.targets).toEqual(['Entity']);
    expect(inject?.injections).toHaveLength(1);
    expect(inject?.injections[0].targetMethod).toBe('tick');
    expect(inject?.injections[0].type).toBe('inject');
  });

  it('walks nested subdirectories (order-independent, own temp dir)', () => {
    // A self-contained temp dir so this test never perturbs the shared-fixture counts above.
    const dir = mkdtempSync(join(tmpdir(), 'mixin-nested-'));
    try {
      const nestedDir = join(dir, 'a', 'b');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(
        join(nestedDir, 'PlainHelper.java'),
        `package com.example;
public class PlainHelper {}
`,
      );
      writeFileSync(
        join(nestedDir, 'NestedMixin.java'),
        `package com.example;
import org.spongepowered.asm.mixin.Mixin;
@Mixin(World.class)
public class NestedMixin {}
`,
      );

      const mixins = getMixinService().parseMixinsFromDirectory(dir);
      expect(mixins).toHaveLength(1);
      expect(mixins[0].className).toBe('com.example.NestedMixin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws MixinParseError for a non-existent directory', () => {
    const missing = join(tmpdir(), 'definitely-does-not-exist-mixin-xyz');
    expect(() => getMixinService().parseMixinsFromDirectory(missing)).toThrow(MixinParseError);
  });
});

describe('parseMixinsFromJar', () => {
  let jarPath: string;

  beforeAll(() => {
    jarPath = join(mkdtempSync(join(tmpdir(), 'mixin-jar-')), 'fixture.jar');

    // Build a tiny JAR at test time via adm-zip (same library the service reads with).
    const zip = new AdmZip();
    zip.addFile(
      'com/example/mixin/SimpleMixin.java',
      `package com.example.mixin;
import org.spongepowered.asm.mixin.Mixin;
@Mixin(Entity.class)
public class SimpleMixin {}
`,
    );
    zip.addFile(
      'com/example/mixin/RedirectMixin.java',
      `package com.example.mixin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;
@Mixin(Entity.class)
public class RedirectMixin {
  @Redirect(method = "tick", at = @At(value = "INVOKE", target = "Lnet/minecraft/Entity;getId()I"))
  private int onGetId() { return 0; }
}
`,
    );
    zip.addFile(
      'com/example/PlainClass.java',
      `package com.example;
public class PlainClass {
  public void run() {}
}
`,
    );
    zip.writeZip(jarPath);
  });

  afterAll(() => {
    rmSync(dirname(jarPath), { recursive: true, force: true });
  });

  it('parses only the @Mixin entries (excludes the plain class)', async () => {
    const mixins = await getMixinService().parseMixinsFromJar(jarPath);

    expect(mixins).toHaveLength(2);
    expect(mixins.map((m) => m.className).sort()).toEqual([
      'com.example.mixin.RedirectMixin',
      'com.example.mixin.SimpleMixin',
    ]);
  });

  it('captures targets and the parsed injection shape, with sourcePath set', async () => {
    const mixins = await getMixinService().parseMixinsFromJar(jarPath);
    const byName = new Map(mixins.map((m) => [m.className, m]));

    const simple = byName.get('com.example.mixin.SimpleMixin');
    expect(simple?.targets).toEqual(['Entity']);
    expect(simple?.sourcePath).toBe('com/example/mixin/SimpleMixin.java');

    const redirect = byName.get('com.example.mixin.RedirectMixin');
    expect(redirect?.injections).toHaveLength(1);
    expect(redirect?.injections[0].type).toBe('redirect');
    expect(redirect?.injections[0].targetMethod).toBe('tick');
  });

  it('throws MixinParseError for a non-existent JAR', async () => {
    const missing = join(tmpdir(), 'definitely-missing-mixin.jar');
    await expect(getMixinService().parseMixinsFromJar(missing)).rejects.toThrow(MixinParseError);
  });
});
