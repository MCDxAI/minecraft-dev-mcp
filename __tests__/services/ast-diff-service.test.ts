import { describe, expect, it } from 'vitest';
import { getCacheManager } from '../../src/cache/cache-manager.js';
import { handleCompareVersionsDetailed } from '../../src/server/tools.js';
import { getAstDiffService, isBreakingChange } from '../../src/services/ast-diff-service.js';
import type {
  ClassModification,
  ClassSignature,
  FieldSignature,
  MethodSignature,
} from '../../src/types/minecraft.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * AST Diff Service Tests
 *
 * Tests the AST diff service's ability to:
 * - Parse class signatures from source code
 * - Detect API changes between versions
 * - Compare methods, fields, and class structure
 */

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

    // Exactly 2 fields: age (int) and x (double) — tightened from >= 2.
    expect(signature.fields).toHaveLength(2);
    expect(signature.fields.map((f) => f.name)).toEqual(['age', 'x']);
    expect(signature.fields.find((f) => f.name === 'age')?.type).toBe('int');
    expect(signature.fields.find((f) => f.name === 'x')?.type).toBe('double');

    // Exactly 3 methods: tick(), remove(), staticMethod(int) — tightened from >= 3.
    expect(signature.methods).toHaveLength(3);
    expect(signature.methods.map((m) => m.name)).toEqual(['tick', 'remove', 'staticMethod']);
    expect(signature.methods.find((m) => m.name === 'staticMethod')?.parameters).toEqual(['int']);
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

  // --- Regression tests: previously-broken cases now fixed via tree-sitter ---
  // These pin the bugs the legacy regex exhibited so they cannot return.

  it('captures methods with a fully-qualified return type (regression)', () => {
    const astDiffService = getAstDiffService();

    // The old regex's return-type character class excluded '.', so this whole
    // declaration was silently dropped.
    const source = `
package net.example;

public class Repo {
    public java.util.List<String> items() { return null; }
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Repo.java');

    const method = signature.methods.find((m) => m.name === 'items');
    expect(method).toBeDefined();
    expect(method?.returnType).toContain('.');
    expect(method?.returnType).toBe('java.util.List<String>');
  });

  it('captures both superclass and generic interfaces (regression)', () => {
    const astDiffService = getAstDiffService();

    // The old regex's greedy `extends` capture swallowed the implements clause,
    // and the generic interface was split on its internal comma.
    const source = `
package net.example;

public class Foo extends Base implements Runnable, java.util.Comparator<Foo> {
    public void run() {}
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Foo.java');

    expect(signature.superclass).toBe('Base');
    expect(signature.interfaces).toEqual(['Runnable', 'java.util.Comparator<Foo>']);
  });

  it('captures default interface methods (regression)', () => {
    const astDiffService = getAstDiffService();

    // The old regex did not recognize `default` as a modifier and dropped
    // every default interface method.
    const source = `
package net.example;

public interface Runner {
    void run();
    default boolean isEnabled() { return true; }
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Runner.java');

    expect(signature.isInterface).toBe(true);
    expect(signature.methods.some((m) => m.name === 'isEnabled')).toBe(true);
  });

  it('expands multi-declarator fields (regression)', () => {
    const astDiffService = getAstDiffService();

    // The old regex matched only `Type name` and dropped the entire
    // `int a, b, c;` declaration (all three declarators lost).
    const source = `
package net.example;

public class Cfg {
    int a, b, c;
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Cfg.java');

    const names = signature.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(signature.fields).toHaveLength(3);
    expect(signature.fields.every((f) => f.type === 'int')).toBe(true);
  });

  it('captures constructors with an empty return type (regression)', () => {
    const astDiffService = getAstDiffService();

    // The old regex explicitly skipped constructors (no return type), so a
    // removed/changed constructor was never reported as a breaking change.
    const source = `
package net.example;

public class Vec {
    public Vec(int x, int y) {}
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Vec.java');

    const ctor = signature.methods.find((m) => m.name === 'Vec');
    expect(ctor).toBeDefined();
    expect(ctor?.returnType).toBe('');
    expect(ctor?.parameters).toEqual(['int', 'int']);
  });

  it('detects inner classes correctly despite braces in string literals (regression)', () => {
    const astDiffService = getAstDiffService();

    // The string literal contains text that looks like a class declaration
    // with braces. The old brace-counting heuristic parsed through the string,
    // invented a phantom "Fake" inner class, and missed the real RealInner.
    const source = `
package net.example;

public class Outer {
    public String desc() { return "class Fake {}"; }

    public class RealInner {}
}
`;

    const signature = astDiffService.parseClassSignature(source, 'net/example/Outer.java');

    expect(signature.innerClasses).toEqual(['net.example.Outer$RealInner']);
  });
});

// ===== Comparison / diffing logic (deterministic — no files, no MC cache) =====
// The refactor pinned the parsing half (parseClassSignature); these tests pin
// the diff half by constructing ClassSignature pairs directly and calling the
// comparison entry point `AstDiffService.compareClasses`.

/** Build a MethodSignature concisely; sensible defaults for unspecified keys. */
function makeMethod(
  partial: Partial<MethodSignature> & Pick<MethodSignature, 'name'>,
): MethodSignature {
  return { returnType: 'void', parameters: [], modifiers: [], throws: [], ...partial };
}

/** Build a FieldSignature concisely; sensible defaults for unspecified keys. */
function makeField(
  partial: Partial<FieldSignature> & Pick<FieldSignature, 'name'>,
): FieldSignature {
  return { type: 'int', modifiers: [], ...partial };
}

/** Build a ClassSignature concisely; derives package/simpleName from `name`. */
function makeClass(partial: Partial<ClassSignature> = {}): ClassSignature {
  const name = partial.name ?? 'net.example.Test';
  const lastDot = name.lastIndexOf('.');
  return {
    name,
    package: lastDot >= 0 ? name.slice(0, lastDot) : '',
    simpleName: lastDot >= 0 ? name.slice(lastDot + 1) : name,
    isInterface: false,
    isEnum: false,
    isAbstract: false,
    interfaces: [],
    methods: [],
    fields: [],
    innerClasses: [],
    ...partial,
  };
}

// isBreakingChange is now imported directly from src/services/ast-diff-service.js
// (see import above), so the filter contract of getBreakingChanges is tested
// against the real predicate rather than a hand-maintained mirror.

describe('AST Diff Service — comparison logic', () => {
  const service = getAstDiffService();

  /** compareClasses returns null when unchanged; this asserts + narrows. */
  function expectModification(from: ClassSignature, to: ClassSignature): ClassModification {
    const diff = service.compareClasses(from, to);
    if (diff === null) throw new Error('expected a non-null ClassModification');
    return diff;
  }

  describe('no-op / happy path', () => {
    it('returns null when both classes are identical', () => {
      const cls = makeClass({
        methods: [makeMethod({ name: 'tick', parameters: ['int'] })],
        fields: [makeField({ name: 'age' })],
        superclass: 'net.example.Base',
        interfaces: ['Runnable'],
      });
      expect(service.compareClasses(cls, cls)).toBeNull();
    });
  });

  describe('method add / remove', () => {
    it('detects an added method', () => {
      const from = makeClass({ methods: [] });
      const to = makeClass({ methods: [makeMethod({ name: 'newMethod' })] });
      const diff = expectModification(from, to);
      expect(diff.addedMethods.map((m) => m.name)).toEqual(['newMethod']);
      expect(diff.removedMethods).toHaveLength(0);
      expect(diff.modifiedMethods).toHaveLength(0);
    });

    it('detects a removed method', () => {
      const from = makeClass({ methods: [makeMethod({ name: 'oldMethod' })] });
      const to = makeClass({ methods: [] });
      const diff = expectModification(from, to);
      expect(diff.removedMethods.map((m) => m.name)).toEqual(['oldMethod']);
      expect(diff.addedMethods).toHaveLength(0);
    });
  });

  describe('method rename detection (findSimilarMethod)', () => {
    it('same params + return type, different name => rename (NOT add+remove)', () => {
      const oldMethod = makeMethod({ name: 'oldName', parameters: ['int'] });
      const newMethod = makeMethod({ name: 'newName', parameters: ['int'] });
      const from = makeClass({ methods: [oldMethod] });
      const to = makeClass({ methods: [newMethod] });

      // Direct seam check: the rename heuristic finds the old method.
      expect(service.findSimilarMethod(newMethod, [oldMethod])?.name).toBe('oldName');
      // It must NOT fire when the name is identical or the params differ.
      expect(service.findSimilarMethod(oldMethod, [oldMethod])).toBeNull();
      expect(
        service.findSimilarMethod(makeMethod({ name: 'newName', parameters: ['int', 'int'] }), [
          oldMethod,
        ]),
      ).toBeNull();

      const diff = expectModification(from, to);
      expect(diff.modifiedMethods).toHaveLength(1);
      expect(diff.modifiedMethods[0].old.name).toBe('oldName');
      expect(diff.modifiedMethods[0].new.name).toBe('newName');
      expect(diff.modifiedMethods[0].changes).toContain('Method renamed');
      // Critical: a rename must NOT also surface as add+remove.
      expect(diff.addedMethods).toHaveLength(0);
      expect(diff.removedMethods).toHaveLength(0);
    });
  });

  describe('method signature changes', () => {
    it('return-type change => modified method, and is breaking', () => {
      const oldMethod = makeMethod({ name: 'getValue', returnType: 'void' });
      const newMethod = makeMethod({ name: 'getValue', returnType: 'String' });

      const changes = service.compareMethodSignatures(oldMethod, newMethod);
      expect(changes).toContain('Return type changed: void -> String');
      expect(changes.some(isBreakingChange)).toBe(true);

      const diff = expectModification(
        makeClass({ methods: [oldMethod] }),
        makeClass({ methods: [newMethod] }),
      );
      expect(diff.modifiedMethods).toHaveLength(1);
      expect(diff.modifiedMethods[0].changes.some(isBreakingChange)).toBe(true);
    });

    it('parameter change => add+remove (NOT modified) — actual behavior', () => {
      // compareMethodSignatures never emits a "Parameter" change: parameters
      // are part of the method key, so a changed arity/type yields a distinct
      // key => old removed + new added, not a modifiedMethods entry. Thus a
      // parameter change surfaces in getBreakingChanges via removedMethods, not
      // signatureChanges. This pins that non-obvious behavior.
      const oldMethod = makeMethod({ name: 'foo', parameters: ['int'] });
      const newMethod = makeMethod({ name: 'foo', parameters: ['int', 'String'] });

      // findSimilarMethod cannot match (param arity differs) => no rename.
      expect(service.findSimilarMethod(newMethod, [oldMethod])).toBeNull();

      const diff = expectModification(
        makeClass({ methods: [oldMethod] }),
        makeClass({ methods: [newMethod] }),
      );
      expect(diff.removedMethods.map((m) => m.name)).toEqual(['foo']);
      expect(diff.addedMethods.map((m) => m.name)).toEqual(['foo']);
      expect(diff.modifiedMethods).toHaveLength(0);
    });

    it('throws-clause change => modified method, non-breaking', () => {
      const oldMethod = makeMethod({ name: 'doWork', throws: ['IOException'] });
      const newMethod = makeMethod({ name: 'doWork', throws: ['SQLException'] });

      const changes = service.compareMethodSignatures(oldMethod, newMethod);
      expect(changes.some((c) => c.startsWith('Throws changed'))).toBe(true);
      expect(changes.some(isBreakingChange)).toBe(false);
    });

    it('modifier-only change (add `final`) => modified, NON-breaking', () => {
      const oldMethod = makeMethod({ name: 'foo', modifiers: ['public'] });
      const newMethod = makeMethod({ name: 'foo', modifiers: ['public', 'final'] });

      const changes = service.compareMethodSignatures(oldMethod, newMethod);
      expect(changes).toEqual(['Added modifier: final']);
      expect(changes.some(isBreakingChange)).toBe(false);

      const diff = expectModification(
        makeClass({ methods: [oldMethod] }),
        makeClass({ methods: [newMethod] }),
      );
      expect(diff.modifiedMethods).toHaveLength(1);
      const breaking = diff.modifiedMethods.flatMap((m) => m.changes.filter(isBreakingChange));
      expect(breaking).toHaveLength(0);
    });
  });

  describe('field add / remove', () => {
    it('detects an added field', () => {
      const diff = expectModification(
        makeClass({ fields: [] }),
        makeClass({ fields: [makeField({ name: 'count', type: 'int' })] }),
      );
      expect(diff.addedFields.map((f) => f.name)).toEqual(['count']);
      expect(diff.removedFields).toHaveLength(0);
    });

    it('detects a removed field', () => {
      const diff = expectModification(
        makeClass({ fields: [makeField({ name: 'count', type: 'int' })] }),
        makeClass({ fields: [] }),
      );
      expect(diff.removedFields.map((f) => f.name)).toEqual(['count']);
      expect(diff.addedFields).toHaveLength(0);
    });
  });

  describe('hierarchy changes', () => {
    it('detects a superclass change (extends A -> extends B)', () => {
      const diff = expectModification(
        makeClass({ superclass: 'net.example.A' }),
        makeClass({ superclass: 'net.example.B' }),
      );
      expect(diff.superclassChange).toEqual({ old: 'net.example.A', new: 'net.example.B' });
    });

    it('detects an added interface (implements A -> implements A, B)', () => {
      const diff = expectModification(
        makeClass({ interfaces: ['Runnable'] }),
        makeClass({ interfaces: ['Runnable', 'Comparable'] }),
      );
      expect(diff.interfaceChanges).toEqual({ added: ['Comparable'], removed: [] });
    });

    it('detects a removed interface', () => {
      const diff = expectModification(
        makeClass({ interfaces: ['Runnable', 'Comparable'] }),
        makeClass({ interfaces: ['Runnable'] }),
      );
      expect(diff.interfaceChanges).toEqual({ added: [], removed: ['Comparable'] });
    });
  });

  describe('getBreakingChanges filter contract', () => {
    // getBreakingChanges() itself requires a decompiled MC tree on disk (the
    // same-version tool test above skips without one), so it cannot be exercised
    // deterministically here. Instead we pin its *filter contract*: the change
    // strings produced by compareMethodSignatures, categorized by the same
    // prefix predicate getBreakingChanges uses.
    it('return-type change is breaking; modifier-only and throws are not', () => {
      const base = makeMethod({ name: 'm' });
      const cases: Array<{ from: MethodSignature; to: MethodSignature; breaking: boolean }> = [
        {
          from: { ...base, returnType: 'void' },
          to: { ...base, returnType: 'int' },
          breaking: true,
        },
        {
          from: { ...base, modifiers: ['public'] },
          to: { ...base, modifiers: ['public', 'final'] },
          breaking: false,
        },
        {
          from: { ...base, throws: ['IOException'] },
          to: { ...base, throws: ['SQLException'] },
          breaking: false,
        },
      ];
      for (const { from, to, breaking } of cases) {
        const changes = service.compareMethodSignatures(from, to);
        expect(
          changes.some(isBreakingChange),
          `breaking=${breaking} for ${JSON.stringify(changes)}`,
        ).toBe(breaking);
      }
    });
  });

  describe('isBreakingChange predicate (exported)', () => {
    it('flags return-type and parameter changes as breaking', () => {
      expect(isBreakingChange('Return type changed: void -> int')).toBe(true);
      expect(isBreakingChange('Parameter added: int')).toBe(true);
      expect(isBreakingChange('Parameter removed: int')).toBe(true);
    });

    it('does not flag modifier, throws, rename, or unknown changes as breaking', () => {
      expect(isBreakingChange('Added modifier: final')).toBe(false);
      expect(isBreakingChange('Removed modifier: final')).toBe(false);
      expect(isBreakingChange('Throws changed: [IOException] -> [SQLException]')).toBe(false);
      expect(isBreakingChange('Method renamed')).toBe(false);
      expect(isBreakingChange('')).toBe(false);
    });
  });
});
