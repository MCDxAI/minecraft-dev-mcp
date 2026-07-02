import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleValidateAccessTransformer } from '../../src/server/tools.js';
import {
  detectAccessTransformerConflicts,
  getAccessTransformerService,
  validateEntryAgainstSource,
  validateEntryAgainstSymbols,
} from '../../src/services/access-transformer-service.js';
import type { AccessTransformer, AccessTransformerEntry } from '../../src/types/minecraft.js';
import { AccessTransformerParseError } from '../../src/utils/errors.js';
import { extractJavaSymbols } from '../../src/utils/java-symbols.js';
import { findSimilarClassFile } from '../../src/utils/suggestions.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * Build an AccessTransformerEntry with sensible defaults for the regression
 * tests below. The validation exercises go through the `validateEntryAgainstSource`
 * / `validateEntryAgainstSymbols` test seams (synthetic Java source, no decompiled
 * Minecraft tree required).
 */
function makeEntry(partial: Partial<AccessTransformerEntry>): AccessTransformerEntry {
  return {
    modifier: { access: 'public', final: 'none' },
    memberType: 'class',
    className: 'net.test.X',
    line: 1,
    ...partial,
  };
}

describe('Access Transformer Service', () => {
  it('parses the four line forms (class, field, method, constructor)', () => {
    const content = [
      'public net.mc.Foo',
      'public net.mc.Bar fieldName',
      'public net.mc.Baz m(I)V',
      'public net.mc.Baz <init>()V',
    ].join('\n');
    const at = getAccessTransformerService().parseAccessTransformer(content);

    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(4);

    const cls = at.entries[0];
    const field = at.entries[1];
    const method = at.entries[2];
    const ctor = at.entries[3];

    expect(cls?.memberType).toBe('class');
    expect(cls?.className).toBe('net.mc.Foo');
    expect(cls?.modifier).toEqual({ access: 'public', final: 'none' });
    expect(cls?.line).toBe(1);

    expect(field?.memberType).toBe('field');
    expect(field?.className).toBe('net.mc.Bar');
    expect(field?.memberName).toBe('fieldName');
    expect(field?.memberDescriptor).toBeUndefined();
    expect(field?.line).toBe(2);

    expect(method?.memberType).toBe('method');
    expect(method?.className).toBe('net.mc.Baz');
    expect(method?.memberName).toBe('m');
    expect(method?.memberDescriptor).toBe('(I)V');
    expect(method?.line).toBe(3);

    expect(ctor?.memberType).toBe('method');
    expect(ctor?.memberName).toBe('<init>');
    expect(ctor?.memberDescriptor).toBe('()V');
    expect(ctor?.line).toBe(4);
  });

  it('parses all 12 modifier forms (4 access keywords x none/-f/+f)', () => {
    const content = [
      'public net.mc.X',
      'public-f net.mc.X',
      'public+f net.mc.X',
      'protected net.mc.X',
      'protected-f net.mc.X',
      'protected+f net.mc.X',
      'default net.mc.X',
      'default-f net.mc.X',
      'default+f net.mc.X',
      'private net.mc.X',
      'private-f net.mc.X',
      'private+f net.mc.X',
    ].join('\n');
    const at = getAccessTransformerService().parseAccessTransformer(content);

    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(12);

    const expected = [
      { access: 'public', final: 'none' },
      { access: 'public', final: 'remove' },
      { access: 'public', final: 'add' },
      { access: 'protected', final: 'none' },
      { access: 'protected', final: 'remove' },
      { access: 'protected', final: 'add' },
      { access: 'default', final: 'none' },
      { access: 'default', final: 'remove' },
      { access: 'default', final: 'add' },
      { access: 'private', final: 'none' },
      { access: 'private', final: 'remove' },
      { access: 'private', final: 'add' },
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(at.entries[i]?.modifier).toEqual(expected[i]);
    }
  });

  it('normalizes slash separators to dots in class names', () => {
    const at = getAccessTransformerService().parseAccessTransformer('public net/mc/Foo');
    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(1);
    expect(at.entries[0]?.className).toBe('net.mc.Foo');
  });

  it('parses field (*) and method (*()) wildcards', () => {
    // `*()` is the bare 3rd token (the member position), not `name *()` — the
    // parser only recognizes it as a whole-token wildcard.
    const at = getAccessTransformerService().parseAccessTransformer(
      ['public net.mc.C *', 'public net.mc.C *()'].join('\n'),
    );
    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(2);

    const fieldWild = at.entries[0];
    const methodWild = at.entries[1];

    expect(fieldWild?.memberType).toBe('field');
    expect(fieldWild?.wildcard).toBe(true);
    expect(fieldWild?.memberName).toBe('*');

    expect(methodWild?.memberType).toBe('method');
    expect(methodWild?.wildcard).toBe(true);
    expect(methodWild?.memberName).toBe('*');
    expect(methodWild?.memberDescriptor).toBe('()');
  });

  it('strips inline # comments and skips comment-only and blank lines', () => {
    const content = [
      'public net.mc.Foo # comment', // line 1 -> entry
      '# only comment', // line 2 -> skip
      '', // line 3 -> skip
      'public net.mc.Bar field', // line 4 -> entry
    ].join('\n');
    const at = getAccessTransformerService().parseAccessTransformer(content);

    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(2);
    expect(at.entries[0]?.line).toBe(1);
    expect(at.entries[0]?.className).toBe('net.mc.Foo');
    expect(at.entries[1]?.line).toBe(4);
    expect(at.entries[1]?.memberName).toBe('field');
  });

  it('collects hard parse errors instead of throwing and keeps the good lines', () => {
    const content = [
      'public net.mc.Good', // line 1 -> entry
      'publik net.mc.X', // line 2 -> unknown modifier
      'foo', // line 3 -> 1 token
      'public -f net.mc.X field', // line 4 -> 4 tokens (too many)
      'public net.mc.X (I)V', // line 5 -> method missing name
      'public net.mc.X m(', // line 6 -> missing return descriptor
      'public net.mc.X Ljava/lang/String;', // line 7 -> field looks like descriptor
    ].join('\n');
    const at = getAccessTransformerService().parseAccessTransformer(content);

    // The one well-formed line still parses.
    expect(at.entries).toHaveLength(1);
    expect(at.entries[0]?.className).toBe('net.mc.Good');

    // Every bad line is collected with the right line number and message.
    expect(at.parseErrors).toHaveLength(6);
    const byLine = new Map(at.parseErrors.map((e) => [e.line, e.message]));
    expect(byLine.get(2)).toContain('Unknown modifier');
    expect(byLine.get(3)).toContain('expected 2 or 3 tokens, got 1');
    expect(byLine.get(4)).toContain('too many tokens');
    expect(byLine.get(5)).toContain("missing a name before '('");
    expect(byLine.get(6)).toContain('missing a return descriptor');
    expect(byLine.get(7)).toContain('looks like a JVM descriptor');
  });

  it('rejects a space-split final suffix (must attach to the modifier)', () => {
    // `public -f net.mc.X` is exactly 3 tokens: the bare `-f` must attach to the
    // modifier (`public-f`), not stand alone. Distinct from the 4-token case
    // above, which hits the token-count guard first.
    const at = getAccessTransformerService().parseAccessTransformer('public -f net.mc.X');
    expect(at.entries).toHaveLength(0);
    expect(at.parseErrors).toHaveLength(1);
    expect(at.parseErrors[0]?.message).toContain('must be attached to the modifier with no space');
  });

  it('parseAccessTransformerFile parses a real file from disk and sets sourcePath', () => {
    const svc = getAccessTransformerService();
    const filePath = join(tmpdir(), `at-${Date.now()}-${Math.random().toString(36).slice(2)}.cfg`);
    const content = [
      'public net.mc.block.Block',
      'public net.mc.block.Block getState(I)Lnet/mc/block/BlockState;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf8');

    try {
      const at = svc.parseAccessTransformerFile(filePath);
      expect(at.sourcePath).toBe(filePath);
      expect(at.entries).toHaveLength(2);
      expect(at.entries[0]?.className).toBe('net.mc.block.Block');
      expect(at.entries[1]?.memberName).toBe('getState');
      expect(at.entries[1]?.memberDescriptor).toBe('(I)Lnet/mc/block/BlockState;');
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it('parseAccessTransformerFile throws AccessTransformerParseError on a missing file', () => {
    const svc = getAccessTransformerService();
    const missing = join(tmpdir(), 'definitely-does-not-exist.cfg');
    expect(() => svc.parseAccessTransformerFile(missing)).toThrow(AccessTransformerParseError);
    expect(() => svc.parseAccessTransformerFile(missing)).toThrow(/File not found/);
  });

  it('descriptorToReadable decodes primitive, method, and object descriptors', () => {
    const svc = getAccessTransformerService();
    expect(svc.descriptorToReadable('I')).toBe('int');
    expect(svc.descriptorToReadable('(II)V')).toBe('void (int, int)');
    expect(svc.descriptorToReadable('Ljava/lang/String;')).toBe('java.lang.String');
  });

  it('returns zero entries and zero parse errors for empty content', () => {
    const at = getAccessTransformerService().parseAccessTransformer('');
    expect(at.entries).toEqual([]);
    expect(at.parseErrors).toEqual([]);
  });
});

describe('Access Transformer Validation (tree-sitter + descriptor matching)', () => {
  it('does NOT match a method that is only called (not declared)', () => {
    // `helper` is invoked inside doWork() but never declared. A name-only check
    // against call sites would false-positive; the AST walk only sees declared
    // members, so `helper` is correctly reported missing with no spurious suggestion.
    const src = `
package net.test;
public class Caller {
    public void doWork() {
        helper();
    }
}
`;
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.test.Caller',
      memberName: 'helper',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toBeUndefined();
  });

  it('validates <init> constructor descriptors (match vs arity mismatch)', () => {
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
    const matching = makeEntry({
      memberType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(II)V',
    });
    expect(validateEntryAgainstSource(matching, src).errors).toEqual([]);

    const wrongArity = makeEntry({
      memberType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(I)V',
    });
    expect(
      validateEntryAgainstSource(wrongArity, src).errors.some((e) =>
        e.includes('no overload matches'),
      ),
    ).toBe(true);
  });

  it('reports overload mismatch with the found overloads and matches a correct overload', () => {
    const src = `
package net.test;
public class Over {
    public void foo(int x) {}
    public void foo(String s) {}
}
`;
    const mismatch = makeEntry({
      memberType: 'method',
      className: 'net.test.Over',
      memberName: 'foo',
      memberDescriptor: '(II)V',
    });
    const res = validateEntryAgainstSource(mismatch, src);
    const err = res.errors.find((e) => e.includes('no overload matches'));
    expect(err).toBeDefined();
    // The actual overloads are reported (raw JVM descriptors) so the user can
    // pick the right one.
    expect(err).toContain('(I)V');
    expect(err).toContain('(Ljava/lang/String;)V');

    const ok = makeEntry({
      memberType: 'method',
      className: 'net.test.Over',
      memberName: 'foo',
      memberDescriptor: '(Ljava/lang/String;)V',
    });
    expect(validateEntryAgainstSource(ok, src).errors).toEqual([]);
  });

  it('checks field existence by name only and suggests a close name when missing', () => {
    const src = `
package net.test;
public class Box {
    public int counter;
}
`;
    // AT fields carry NO descriptor — name existence is the only check.
    const missing = makeEntry({
      memberType: 'field',
      className: 'net.test.Box',
      memberName: 'countre',
    });
    const res = validateEntryAgainstSource(missing, src);
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toContain('counter');

    const ok = makeEntry({
      memberType: 'field',
      className: 'net.test.Box',
      memberName: 'counter',
    });
    expect(validateEntryAgainstSource(ok, src).errors).toEqual([]);
  });

  it('warns (does not error) on <clinit> static initializers', () => {
    const src = `
package net.test;
public class WithStatic {
    static {
        System.out.println("init");
    }
}
`;
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.test.WithStatic',
      memberName: '<clinit>',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('<clinit>'))).toBe(true);
  });

  it('warns on override-narrowing for an overridable method but not a final one', () => {
    const overridableSrc = `
package net.test;
public class Base {
    public void tick() {}
}
`;
    const overridable = makeEntry({
      memberType: 'method',
      className: 'net.test.Base',
      memberName: 'tick',
      memberDescriptor: '()V',
    });
    const overridableRes = validateEntryAgainstSource(overridable, overridableSrc);
    expect(overridableRes.errors).toEqual([]);
    expect(overridableRes.warnings.some((w) => w.includes('overridable'))).toBe(true);

    const finalSrc = `
package net.test;
public class Locked {
    public final void tick() {}
}
`;
    const finalEntry = makeEntry({
      memberType: 'method',
      className: 'net.test.Locked',
      memberName: 'tick',
      memberDescriptor: '()V',
    });
    const finalRes = validateEntryAgainstSource(finalEntry, finalSrc);
    expect(finalRes.errors).toEqual([]);
    expect(finalRes.warnings.some((w) => w.includes('overridable'))).toBe(false);
  });
});

describe('Access Transformer cross-entry quirks', () => {
  // These checks need the full entry list (allEntries); validateEntryAgainstSource
  // omits it and skips them. Drive them through validateEntryAgainstSymbols with
  // extractJavaSymbols(src) and the full directive set.

  it('warns when a widened record has no matching canonical <init> directive', () => {
    const src = `
package net.test;
public record Point(int x, int y) {}
`;
    const classEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Point',
      line: 1,
    });
    const res = validateEntryAgainstSymbols(classEntry, extractJavaSymbols(src), [classEntry]);
    const warn = res.warnings.find((w) => w.includes('canonical constructor'));
    expect(warn).toBeDefined();
    expect(warn).toContain('crash');
    // The reconstructed canonical signature is rendered in the message.
    expect(warn).toContain('void (int, int)');
  });

  it('does not warn when a widened record has a matching <init> at equal-or-wider access', () => {
    const src = `
package net.test;
public record Point(int x, int y) {}
`;
    const classEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Point',
      line: 1,
    });
    const initEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'method',
      className: 'net.test.Point',
      memberName: '<init>',
      memberDescriptor: '(II)V',
      line: 2,
    });
    const res = validateEntryAgainstSymbols(classEntry, extractJavaSymbols(src), [
      classEntry,
      initEntry,
    ]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(false);
  });

  it('still warns when the record <init> directive is at narrower access than the class', () => {
    const src = `
package net.test;
public record Point(int x, int y) {}
`;
    const classEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Point',
      line: 1,
    });
    // private (level 0) < public (level 3): not equal-or-wider -> warning fires.
    const initEntry = makeEntry({
      modifier: { access: 'private', final: 'none' },
      memberType: 'method',
      className: 'net.test.Point',
      memberName: '<init>',
      memberDescriptor: '(II)V',
      line: 2,
    });
    const res = validateEntryAgainstSymbols(classEntry, extractJavaSymbols(src), [
      classEntry,
      initEntry,
    ]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(true);
  });

  it('does not emit a record warning for a widened non-record class', () => {
    const src = `
package net.test;
public class Plain {}
`;
    const classEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Plain',
      line: 1,
    });
    const res = validateEntryAgainstSymbols(classEntry, extractJavaSymbols(src), [classEntry]);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(false);
  });

  it('warns when an inner-class target has an inaccessible, un-widened enclosing class', () => {
    const src = `
package net.test;
class Outer {
    class Inner {}
}
`;
    const innerEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const res = validateEntryAgainstSymbols(innerEntry, extractJavaSymbols(src), [innerEntry]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(true);
  });

  it('does not warn when the inner-class enclosing class is already public in source', () => {
    const src = `
package net.test;
public class Outer {
    public class Inner {}
}
`;
    const innerEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const res = validateEntryAgainstSymbols(innerEntry, extractJavaSymbols(src), [innerEntry]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(false);
  });

  it('does not warn when the enclosing class is widened to public via a file directive', () => {
    const src = `
package net.test;
class Outer {
    class Inner {}
}
`;
    const innerEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const outerEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: 'net.test.Outer',
      line: 2,
    });
    const res = validateEntryAgainstSymbols(innerEntry, extractJavaSymbols(src), [
      innerEntry,
      outerEntry,
    ]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(false);
  });

  it('errors on a non-existent inner class but accepts a real one', () => {
    // Named nested classes are emitted by the AST walk (dot-qualified, matched
    // to the `$` form by classNamesMatch), so a bogus inner target is caught by
    // the class-existence check while the real sibling validates cleanly.
    const src = `
package net.test;
public class Outer {
    public static class Inner {}
}
`;
    const bogus = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer$NonExistent',
      line: 1,
    });
    const bogusRes = validateEntryAgainstSource(bogus, src);
    expect(bogusRes.errors.some((e) => e.includes('not found'))).toBe(true);

    const real = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    expect(validateEntryAgainstSource(real, src).errors).toEqual([]);
  });
});

describe('findSimilarClassFile (suggestion path)', () => {
  it('preserves the package when a segment equals the simple name', () => {
    // Package segment `Block` equals the simple name `Block`. A naive
    // string-replace would rewrite the first `Block` (the package), yielding
    // `com.Blocks.Block`; the substring-slice keeps the package intact.
    const base = mkdtempSync(join(tmpdir(), 'at-suggest-'));
    try {
      const pkgDir = join(base, 'com', 'Block');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'Blocks.java'), 'package com.Block; class Blocks {}', 'utf8');

      const suggestion = findSimilarClassFile('com.Block.Block', base);
      expect(suggestion).toBe('com.Block.Blocks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('Conflict detection', () => {
  // `detectAccessTransformerConflicts` is the pure conflict-detection helper
  // extracted from the service so it is unit-testable without a decompiled
  // Minecraft source tree (the full `validateAccessTransformer` flow only
  // reaches conflict detection after the decompiled-source check passes).
  const method = (over: Partial<AccessTransformerEntry>): AccessTransformerEntry =>
    makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'method',
      className: 'net.test.X',
      memberName: 'm',
      memberDescriptor: '(I)V',
      line: 1,
      ...over,
    });

  it('flags exact-duplicate modifiers as a redundant warning', () => {
    const { errors, warnings } = detectAccessTransformerConflicts([
      method({ line: 1 }),
      method({ line: 2 }),
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Duplicate');
  });

  it('errors on conflicting access levels for the same target', () => {
    const { errors, warnings } = detectAccessTransformerConflicts([
      method({ modifier: { access: 'public', final: 'none' }, line: 1 }),
      method({ modifier: { access: 'private', final: 'none' }, line: 2 }),
    ]);
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Conflicting');
    expect(errors[0]?.message).toContain("'public'");
    expect(errors[0]?.message).toContain("'private'");
  });

  it('errors on conflicting final intent (+f vs -f) even with matching access', () => {
    const { errors } = detectAccessTransformerConflicts([
      method({ modifier: { access: 'public', final: 'add' }, line: 1 }),
      method({ modifier: { access: 'public', final: 'remove' }, line: 2 }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("'public+f'");
    expect(errors[0]?.message).toContain("'public-f'");
  });

  it('flags a conflict between later entries, not just against the first (pairwise)', () => {
    // [public, public+f, public-f]: both +f and -f are compatible variations of
    // the leading `public`, so comparing only against group[0] silences the real
    // +f/-f conflict. Pairwise comparison catches it on the `public-f` entry.
    const { errors } = detectAccessTransformerConflicts([
      method({ modifier: { access: 'public', final: 'none' }, line: 1 }),
      method({ modifier: { access: 'public', final: 'add' }, line: 2 }),
      method({ modifier: { access: 'public', final: 'remove' }, line: 3 }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.entry.line).toBe(3);
    expect(errors[0]?.message).toContain("'public+f'");
    expect(errors[0]?.message).toContain("'public-f'");
  });

  it('treats a compatible variation (+f vs none, same access) as silent', () => {
    const { errors, warnings } = detectAccessTransformerConflicts([
      method({ modifier: { access: 'public', final: 'none' }, line: 1 }),
      method({ modifier: { access: 'public', final: 'add' }, line: 2 }),
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('groups by the full target key (different name/descriptor is not a conflict)', () => {
    const { errors, warnings } = detectAccessTransformerConflicts([
      method({ memberName: 'm', memberDescriptor: '(I)V', line: 1 }),
      method({ memberName: 'm', memberDescriptor: '(II)V', line: 2 }),
      method({ memberName: 'other', memberDescriptor: '(I)V', line: 3 }),
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('returns nothing for a single-entry file', () => {
    const { errors, warnings } = detectAccessTransformerConflicts([method({ line: 1 })]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('validateAccessTransformer short-circuits on a non-decompiled version', async () => {
    // Confirms the guard path: without a decompiled tree, the validator reports
    // the missing-source error and never reaches conflict detection.
    const svc = getAccessTransformerService();
    const at: AccessTransformer = {
      entries: [
        makeEntry({ className: 'net.test.Rec', line: 1 }),
        makeEntry({ className: 'net.test.Rec', line: 2 }),
      ],
      parseErrors: [],
    };
    const res = await svc.validateAccessTransformer(at, '0.0.0-conflict-test', 'mojmap');
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.message.includes('not decompiled'))).toBe(true);
  });
});

describe('validate_access_transformer tool', () => {
  it('returns a well-formed parse + validation envelope', async () => {
    const result = await handleValidateAccessTransformer({
      // Second line is a 3-token field directive (`exampleField`) so the file
      // parses to exactly 2 entries with no parse errors.
      content: 'public net.mc.Example\npublic net.mc.Example exampleField',
      mcVersion: TEST_VERSION,
    });
    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0]?.text ?? '');
    expect(data.accessTransformer.entryCount).toBe(2);
    expect(data.accessTransformer.parseErrorCount).toBe(0);
    expect(typeof data.validation.isValid).toBe('boolean');
    expect(Array.isArray(data.validation.errors)).toBe(true);
    expect(Array.isArray(data.validation.warnings)).toBe(true);
  }, 30000);

  it('collects bad lines instead of throwing on garbage content', async () => {
    const result = await handleValidateAccessTransformer({
      content: 'this is garbage\neven more garbage',
      mcVersion: TEST_VERSION,
    });
    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0]?.text ?? '');
    expect(data.accessTransformer.entryCount).toBe(0);
    expect(data.accessTransformer.parseErrorCount).toBeGreaterThan(0);
  }, 30000);
});
