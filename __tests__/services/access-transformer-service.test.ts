import {
  mkdirSync,
  mkdtempSync,
  existsSync as nodeExistsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BytecodeClass,
  BytecodeField,
  BytecodeInnerClass,
  BytecodeMethod,
} from '../../src/java/bytecode-dumper.js';
import { getBytecodeDumper } from '../../src/java/bytecode-dumper.js';
import { handleValidateAccessTransformer } from '../../src/server/tools.js';
import {
  type ClassBytecodeMap,
  detectAccessTransformerConflicts,
  getAccessTransformerService,
  validateEntryAgainstBytecode,
} from '../../src/services/access-transformer-service.js';
import type { AccessTransformer, AccessTransformerEntry } from '../../src/types/minecraft.js';
import { AccessTransformerParseError } from '../../src/utils/errors.js';
import { findSimilarClassFile } from '../../src/utils/suggestions.js';
import { TEST_VERSION } from '../test-constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_JAR = join(__dirname, '..', 'fixtures', 'summoningrituals-mc-stubs.jar');
const FIXTURE_AT = join(__dirname, '..', 'fixtures', 'summoningrituals.accesstransformer.cfg');
const DUMPER_JAR = join(
  __dirname,
  '..',
  '..',
  'tools',
  'bytecode-dumper',
  'build',
  'libs',
  'bytecode-dumper-1.0.0.jar',
);

/**
 * Build an AccessTransformerEntry with sensible defaults for the regression
 * tests below. Validation exercises go through the `validateEntryAgainstBytecode`
 * test seam, driven by hand-built {@link BytecodeClass} fixtures — bytecode is
 * the same ground truth the production path reads from the remapped JAR.
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

// --- Bytecode fixture builders (mirror the ASM dumper's JSON shape) ---------

function bcMethod(name: string, desc: string, flags: string[] = ['public']): BytecodeMethod {
  return { name, desc, access: 0, flags, signature: null, exceptions: [] };
}

function bcField(name: string, desc = 'I', flags: string[] = ['private']): BytecodeField {
  return { name, desc, access: 0, flags, signature: null, value: null };
}

function bcInner(name: string, flags: string[]): BytecodeInnerClass {
  return { name, outerName: null, innerName: null, access: 0, flags };
}

function bcClass(partial: Partial<BytecodeClass> & { name: string }): BytecodeClass {
  return {
    access: 0,
    flags: ['public'],
    superName: 'java/lang/Object',
    interfaces: [],
    signature: null,
    isInterface: false,
    isEnum: false,
    isRecord: false,
    isAnnotation: false,
    isAbstract: false,
    isFinal: false,
    isSealed: false,
    nestHost: null,
    nestMembers: null,
    permittedSubclasses: null,
    recordComponents: null,
    canonicalConstructor: null,
    innerClasses: [],
    fields: [],
    methods: [],
    ...partial,
  };
}

function mapOf(...classes: BytecodeClass[]): ClassBytecodeMap {
  return new Map(classes.map((c) => [c.name, c]));
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

describe('Access Transformer Validation (bytecode + descriptor matching)', () => {
  it('reports a method that is not declared in the class', () => {
    const cls = bcClass({
      name: 'net/test/Caller',
      methods: [bcMethod('doWork', '()V')],
    });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.test.Caller',
      memberName: 'helper',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(cls));
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toBeUndefined();
  });

  it('validates <init> constructor descriptors (match vs arity mismatch)', () => {
    const cls = bcClass({
      name: 'net/test/Thing',
      methods: [bcMethod('<init>', '(II)V')],
    });
    const matching = makeEntry({
      memberType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(II)V',
    });
    expect(validateEntryAgainstBytecode(matching, mapOf(cls)).errors).toEqual([]);

    const wrongArity = makeEntry({
      memberType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(I)V',
    });
    expect(
      validateEntryAgainstBytecode(wrongArity, mapOf(cls)).errors.some((e) =>
        e.includes('no overload matches'),
      ),
    ).toBe(true);
  });

  it('reports overload mismatch with the found overloads and matches a correct overload', () => {
    const cls = bcClass({
      name: 'net/test/Over',
      methods: [bcMethod('foo', '(I)V'), bcMethod('foo', '(Ljava/lang/String;)V')],
    });
    const mismatch = makeEntry({
      memberType: 'method',
      className: 'net.test.Over',
      memberName: 'foo',
      memberDescriptor: '(II)V',
    });
    const res = validateEntryAgainstBytecode(mismatch, mapOf(cls));
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
    expect(validateEntryAgainstBytecode(ok, mapOf(cls)).errors).toEqual([]);
  });

  it('checks field existence by name only and suggests a close name when missing', () => {
    const cls = bcClass({
      name: 'net/test/Box',
      fields: [bcField('counter')],
    });
    // AT fields carry NO descriptor — name existence is the only check.
    const missing = makeEntry({
      memberType: 'field',
      className: 'net.test.Box',
      memberName: 'countre',
    });
    const res = validateEntryAgainstBytecode(missing, mapOf(cls));
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toContain('counter');

    const ok = makeEntry({
      memberType: 'field',
      className: 'net.test.Box',
      memberName: 'counter',
    });
    expect(validateEntryAgainstBytecode(ok, mapOf(cls)).errors).toEqual([]);
  });

  it('errors on a class that is absent from the JAR', () => {
    const res = validateEntryAgainstBytecode(
      makeEntry({ memberType: 'class', className: 'net.test.Ghost' }),
      mapOf(bcClass({ name: 'net/test/Real' })),
    );
    expect(res.errors.some((e) => e.includes("Class 'net.test.Ghost' not found"))).toBe(true);
  });

  it('warns on override-narrowing for an overridable method but not a final one', () => {
    const base = bcClass({
      name: 'net/test/Base',
      methods: [bcMethod('tick', '()V', ['public'])],
    });
    const overridable = makeEntry({
      memberType: 'method',
      className: 'net.test.Base',
      memberName: 'tick',
      memberDescriptor: '()V',
    });
    const overridableRes = validateEntryAgainstBytecode(overridable, mapOf(base));
    expect(overridableRes.errors).toEqual([]);
    expect(overridableRes.warnings.some((w) => w.includes('overridable'))).toBe(true);

    // Final method -> not overridable.
    const lockedFinal = bcClass({
      name: 'net/test/LockedMethod',
      methods: [bcMethod('tick', '()V', ['public', 'final'])],
    });
    const finalEntry = makeEntry({
      memberType: 'method',
      className: 'net.test.LockedMethod',
      memberName: 'tick',
      memberDescriptor: '()V',
    });
    const finalRes = validateEntryAgainstBytecode(finalEntry, mapOf(lockedFinal));
    expect(finalRes.errors).toEqual([]);
    expect(finalRes.warnings.some((w) => w.includes('overridable'))).toBe(false);

    // Method in a final class -> not overridable.
    const finalClass = bcClass({
      name: 'net/test/FinalClass',
      isFinal: true,
      methods: [bcMethod('tick', '()V', ['public'])],
    });
    const inFinalClass = makeEntry({
      memberType: 'method',
      className: 'net.test.FinalClass',
      memberName: 'tick',
      memberDescriptor: '()V',
    });
    expect(
      validateEntryAgainstBytecode(inFinalClass, mapOf(finalClass)).warnings.some((w) =>
        w.includes('overridable'),
      ),
    ).toBe(false);
  });

  it('suggests a close method name when the targeted method is missing', () => {
    const cls = bcClass({
      name: 'net/test/Ticker',
      methods: [bcMethod('onTick', '()V')],
    });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.test.Ticker',
      memberName: 'onTikc',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(cls));
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toContain('onTick');
  });

  it('warns (does not error) on a method wildcard *() against an existing class', () => {
    const cls = bcClass({ name: 'net/test/Widget', methods: [bcMethod('go', '()V')] });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.test.Widget',
      memberName: '*',
      memberDescriptor: '()',
      wildcard: true,
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(cls));
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('targets all members'))).toBe(true);
  });

  it('warns (does not error) on a field wildcard * against an existing class', () => {
    const cls = bcClass({ name: 'net/test/Widget', fields: [bcField('count')] });
    const entry = makeEntry({
      memberType: 'field',
      className: 'net.test.Widget',
      memberName: '*',
      wildcard: true,
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(cls));
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('targets all members'))).toBe(true);
  });
});

describe('Access Transformer regression: issue #12 false positives', () => {
  // These are the exact cases the reporter hit: bytecode HAS the implicit record
  // members that decompiled source omits, and a constructor is never overridable.

  it('finds an implicit record component accessor (no false "not found")', () => {
    // ExactMatcher(String value): the `value()` accessor is compiler-generated
    // and absent from decompiled source, but present in bytecode.
    const rec = bcClass({
      name: 'net/mc/StatePropertiesPredicate$ExactMatcher',
      isRecord: true,
      recordComponents: [{ name: 'value', descriptor: 'Ljava/lang/String;', signature: null }],
      canonicalConstructor: '(Ljava/lang/String;)V',
      methods: [
        bcMethod('<init>', '(Ljava/lang/String;)V', []),
        bcMethod('value', '()Ljava/lang/String;'),
      ],
    });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.mc.StatePropertiesPredicate$ExactMatcher',
      memberName: 'value',
      memberDescriptor: '()Ljava/lang/String;',
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(rec));
    expect(res.errors).toEqual([]);
  });

  it('finds an implicit record canonical constructor (no false "not found")', () => {
    const rec = bcClass({
      name: 'net/mc/PositionPredicate',
      isRecord: true,
      recordComponents: [{ name: 'x', descriptor: 'D', signature: null }],
      canonicalConstructor: '(D)V',
      methods: [bcMethod('<init>', '(D)V', [])],
    });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.mc.PositionPredicate',
      memberName: '<init>',
      memberDescriptor: '(D)V',
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(rec));
    expect(res.errors).toEqual([]);
  });

  it('does NOT warn that a widened constructor is "overridable" (constructors never are)', () => {
    // AnyOfCondition <init>(List): a package-private ctor widened to public. The
    // old source-based check wrongly flagged it as overridable.
    const cls = bcClass({
      name: 'net/mc/AnyOfCondition',
      methods: [bcMethod('<init>', '(Ljava/util/List;)V', [])],
    });
    const entry = makeEntry({
      memberType: 'method',
      className: 'net.mc.AnyOfCondition',
      memberName: '<init>',
      memberDescriptor: '(Ljava/util/List;)V',
    });
    const res = validateEntryAgainstBytecode(entry, mapOf(cls));
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('overridable'))).toBe(false);
  });

  it('the record-widening note is informational, not a "will crash" claim', () => {
    const rec = bcClass({
      name: 'net/mc/Rec',
      isRecord: true,
      recordComponents: [{ name: 'value', descriptor: 'Ljava/lang/String;', signature: null }],
      canonicalConstructor: '(Ljava/lang/String;)V',
      // Canonical ctor is package-private (not widened).
      methods: [bcMethod('<init>', '(Ljava/lang/String;)V', [])],
    });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.mc.Rec' });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(rec), [classEntry]);
    const warn = res.warnings.find((w) => w.includes('canonical constructor'));
    expect(warn).toBeDefined();
    expect(warn).not.toMatch(/crash/i);
    expect(warn).toMatch(/INSTANTIATE/);
  });
});

describe('Access Transformer cross-entry quirks', () => {
  // These checks need the full entry list (allEntries) to see sibling directives.

  it('warns when a widened record has no matching canonical <init> directive', () => {
    const rec = bcClass({
      name: 'net/test/Point',
      isRecord: true,
      recordComponents: [
        { name: 'x', descriptor: 'I', signature: null },
        { name: 'y', descriptor: 'I', signature: null },
      ],
      canonicalConstructor: '(II)V',
      methods: [bcMethod('<init>', '(II)V', [])],
    });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.test.Point', line: 1 });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(rec), [classEntry]);
    const warn = res.warnings.find((w) => w.includes('canonical constructor'));
    expect(warn).toBeDefined();
    // The reconstructed canonical signature is rendered in the message.
    expect(warn).toContain('void (int, int)');
    // ... but it is NOT presented as a guaranteed crash (issue #12 correction).
    expect(warn).not.toMatch(/crash/i);
  });

  it('does not warn when a widened record has a matching <init> at equal-or-wider access', () => {
    const rec = bcClass({
      name: 'net/test/Point',
      isRecord: true,
      recordComponents: [
        { name: 'x', descriptor: 'I', signature: null },
        { name: 'y', descriptor: 'I', signature: null },
      ],
      canonicalConstructor: '(II)V',
      methods: [bcMethod('<init>', '(II)V', [])],
    });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.test.Point', line: 1 });
    const initEntry = makeEntry({
      modifier: { access: 'public', final: 'none' },
      memberType: 'method',
      className: 'net.test.Point',
      memberName: '<init>',
      memberDescriptor: '(II)V',
      line: 2,
    });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(rec), [classEntry, initEntry]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(false);
  });

  it('still warns when the record <init> directive is at narrower access than the class', () => {
    const rec = bcClass({
      name: 'net/test/Point',
      isRecord: true,
      recordComponents: [
        { name: 'x', descriptor: 'I', signature: null },
        { name: 'y', descriptor: 'I', signature: null },
      ],
      canonicalConstructor: '(II)V',
      methods: [bcMethod('<init>', '(II)V', [])],
    });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.test.Point', line: 1 });
    // private (level 0) < public (level 3): not equal-or-wider -> warning fires.
    const initEntry = makeEntry({
      modifier: { access: 'private', final: 'none' },
      memberType: 'method',
      className: 'net.test.Point',
      memberName: '<init>',
      memberDescriptor: '(II)V',
      line: 2,
    });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(rec), [classEntry, initEntry]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(true);
  });

  it('does not warn when the record canonical constructor is already public in bytecode', () => {
    // If the record's ctor is already public, widening the class needs no extra
    // ctor directive — so no note at all.
    const rec = bcClass({
      name: 'net/test/Open',
      isRecord: true,
      recordComponents: [{ name: 'x', descriptor: 'I', signature: null }],
      canonicalConstructor: '(I)V',
      methods: [bcMethod('<init>', '(I)V', ['public'])],
    });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.test.Open', line: 1 });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(rec), [classEntry]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(false);
  });

  it('does not emit a record warning for a widened non-record class', () => {
    const plain = bcClass({ name: 'net/test/Plain' });
    const classEntry = makeEntry({ memberType: 'class', className: 'net.test.Plain', line: 1 });
    const res = validateEntryAgainstBytecode(classEntry, mapOf(plain), [classEntry]);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('canonical constructor'))).toBe(false);
  });

  it('warns when an inner-class target has an inaccessible, un-widened enclosing class', () => {
    const outer = bcClass({ name: 'net/test/Outer', flags: [] }); // package-private
    const inner = bcClass({
      name: 'net/test/Outer$Inner',
      innerClasses: [bcInner('net/test/Outer$Inner', [])],
    });
    const innerEntry = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const res = validateEntryAgainstBytecode(innerEntry, mapOf(outer, inner), [innerEntry]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(true);
  });

  it('does not warn when the inner-class enclosing class is already public', () => {
    const outer = bcClass({ name: 'net/test/Outer', flags: ['public'] });
    const inner = bcClass({ name: 'net/test/Outer$Inner' });
    const innerEntry = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const res = validateEntryAgainstBytecode(innerEntry, mapOf(outer, inner), [innerEntry]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(false);
  });

  it('does not warn when the enclosing class is widened to public via a file directive', () => {
    const outer = bcClass({ name: 'net/test/Outer', flags: [] });
    const inner = bcClass({ name: 'net/test/Outer$Inner' });
    const innerEntry = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer$Inner',
      line: 1,
    });
    const outerEntry = makeEntry({
      memberType: 'class',
      className: 'net.test.Outer',
      line: 2,
    });
    const res = validateEntryAgainstBytecode(innerEntry, mapOf(outer, inner), [
      innerEntry,
      outerEntry,
    ]);
    expect(res.warnings.some((w) => w.includes('enclosing class'))).toBe(false);
  });

  it('errors on a non-existent inner class but accepts a real one', () => {
    const outer = bcClass({ name: 'net/test/Outer', flags: ['public'] });
    const inner = bcClass({ name: 'net/test/Outer$Inner' });
    const map = mapOf(outer, inner);

    const bogus = makeEntry({ memberType: 'class', className: 'net.test.Outer$NonExistent' });
    expect(
      validateEntryAgainstBytecode(bogus, map).errors.some((e) => e.includes('not found')),
    ).toBe(true);

    const real = makeEntry({ memberType: 'class', className: 'net.test.Outer$Inner' });
    expect(validateEntryAgainstBytecode(real, map).errors).toEqual([]);
  });
});

// --- End-to-end: the reporter's real AT against a compiled fixture JAR -------
//
// Reproduces the exact issue-#12 scenario. `summoningrituals-mc-stubs.jar` is a
// committed fixture whose classes recreate the vanilla 1.21.1 bytecode shapes
// the Summoning Rituals AT targets (records with implicit accessors + canonical
// constructors, a package-private constructor, a protected static method). We
// dump it with the real ASM dumper and validate the mod's verbatim
// `accesstransformer.cfg` — proving ZERO false-positive errors. Skips when the
// bundled dumper jar isn't built (dev/CI prerequisite, like bytecode-dumper.test).
const describeE2E = nodeExistsSync(DUMPER_JAR) ? describe : describe.skip;

describeE2E('Access Transformer end-to-end (Summoning Rituals fixture, issue #12)', () => {
  async function loadFixtureMap(): Promise<ClassBytecodeMap> {
    const dump = await getBytecodeDumper().dump(FIXTURE_JAR);
    return new Map(dump.classes.map((c) => [c.name, c]));
  }

  it('validates the real Summoning Rituals AT with zero errors', async () => {
    const svc = getAccessTransformerService();
    const at = svc.parseAccessTransformerFile(FIXTURE_AT);
    expect(at.parseErrors).toEqual([]);
    expect(at.entries).toHaveLength(19);

    const map = await loadFixtureMap();

    const errors: string[] = [];
    const warnings: string[] = [];
    for (const entry of at.entries) {
      const r = validateEntryAgainstBytecode(entry, map, at.entries);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }

    // The mod compiles and runs — there must be NO validation errors. Every
    // former error (record accessors / canonical ctors "not found", the
    // constructor "overridable" warning) is gone.
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('overridable'))).toBe(false);
  }, 60000);

  it('only surfaces informational record-widening notes for un-widened record ctors', async () => {
    const svc = getAccessTransformerService();
    const at = svc.parseAccessTransformerFile(FIXTURE_AT);
    const map = await loadFixtureMap();

    const recordNotes: string[] = [];
    for (const entry of at.entries) {
      const r = validateEntryAgainstBytecode(entry, map, at.entries);
      recordNotes.push(...r.warnings.filter((w) => w.includes('canonical constructor')));
    }

    // Exactly the three records whose canonical ctor the AT does NOT widen:
    // ExactMatcher, PropertyMatcher, RangedMatcher. PositionPredicate is exempt
    // because line 2 of the AT widens its constructor.
    expect(recordNotes).toHaveLength(3);
    expect(recordNotes.every((w) => /INSTANTIATE/.test(w))).toBe(true);
    expect(recordNotes.some((w) => /crash/i.test(w))).toBe(false);
    expect(recordNotes.some((w) => w.includes('ExactMatcher'))).toBe(true);
    expect(recordNotes.some((w) => w.includes('PropertyMatcher'))).toBe(true);
    expect(recordNotes.some((w) => w.includes('RangedMatcher'))).toBe(true);
    expect(recordNotes.some((w) => w.includes('PositionPredicate'))).toBe(false);
  }, 60000);
});

// --- Drift guard: the stub must keep reproducing real 1.21.1 shapes ----------
//
// The committed stub can only diverge from vanilla if someone edits its sources
// (1.21.1 itself is a frozen release). This pins the stub's bytecode to the
// exact facts the validator relies on — every number below is the real 1.21.1
// mojmap value (verified against `javap` on the remapped JAR, see issue #12's
// log). Any edit that drops an accessor, flips a record to a class, or changes a
// targeted descriptor fails here. The manual real-MC test additionally asserts
// stub == freshly-downloaded vanilla (belt and suspenders).
describeE2E('Access Transformer fixture fidelity (issue #12 drift guard)', () => {
  const vis = (flags: string[]): string =>
    flags.includes('public')
      ? 'public'
      : flags.includes('protected')
        ? 'protected'
        : flags.includes('private')
          ? 'private'
          : 'package';

  let byName: Map<string, BytecodeClass>;

  beforeAll(async () => {
    const dump = await getBytecodeDumper().dump(FIXTURE_JAR);
    byName = new Map(dump.classes.map((c) => [c.name, c]));
  }, 60000);

  const P = 'net/minecraft/advancements/critereon';
  const L = 'net/minecraft/world/level/storage/loot';

  // Each record: isRecord + exact canonical-ctor descriptor + the implicit
  // accessors the AT targets (name -> descriptor). These accessors are the exact
  // members that decompiled source omits and that the pre-fix validator wrongly
  // reported "not found".
  const records: Array<{
    name: string;
    canon: string;
    accessors: Record<string, string>;
  }> = [
    {
      name: `${P}/LocationPredicate$PositionPredicate`,
      canon: `(L${P}/MinMaxBounds$Doubles;L${P}/MinMaxBounds$Doubles;L${P}/MinMaxBounds$Doubles;)V`,
      accessors: {
        x: `()L${P}/MinMaxBounds$Doubles;`,
        y: `()L${P}/MinMaxBounds$Doubles;`,
        z: `()L${P}/MinMaxBounds$Doubles;`,
      },
    },
    {
      name: `${P}/StatePropertiesPredicate$ExactMatcher`,
      canon: '(Ljava/lang/String;)V',
      accessors: { value: '()Ljava/lang/String;' },
    },
    {
      name: `${P}/StatePropertiesPredicate$PropertyMatcher`,
      canon: `(Ljava/lang/String;L${P}/StatePropertiesPredicate$ValueMatcher;)V`,
      accessors: {
        name: '()Ljava/lang/String;',
        valueMatcher: `()L${P}/StatePropertiesPredicate$ValueMatcher;`,
      },
    },
    {
      name: `${P}/StatePropertiesPredicate$RangedMatcher`,
      canon: '(Ljava/util/Optional;Ljava/util/Optional;)V',
      accessors: { minValue: '()Ljava/util/Optional;', maxValue: '()Ljava/util/Optional;' },
    },
  ];

  it.each(records)('record $name reproduces its 1.21.1 shape', ({ name, canon, accessors }) => {
    const cls = byName.get(name);
    expect(cls, `${name} missing from fixture`).toBeDefined();
    if (!cls) return;
    // The record + its compiler-generated canonical constructor.
    expect(cls.isRecord).toBe(true);
    expect(cls.canonicalConstructor).toBe(canon);
    const ctor = cls.methods.find((m) => m.name === '<init>' && m.desc === canon);
    expect(ctor, `${name} canonical <init> ${canon} missing`).toBeDefined();
    // Real 1.21.1: these canonical ctors are non-public (the record-widening note
    // hinges on this). javac emits package-private where Mojang emits private —
    // both non-public, so the note behaves identically.
    expect(vis(ctor?.flags ?? [])).not.toBe('public');
    // The implicit component accessors — present in bytecode, absent from source.
    for (const [accName, accDesc] of Object.entries(accessors)) {
      const acc = cls.methods.find((m) => m.name === accName && m.desc === accDesc);
      expect(acc, `${name}#${accName}${accDesc} missing`).toBeDefined();
    }
  });

  it('IntRange is a plain class with the private (NumberProvider, NumberProvider) ctor + min/max', () => {
    const cls = byName.get(`${L}/IntRange`);
    expect(cls?.isRecord).toBe(false);
    const ctorDesc = `(L${L}/providers/number/NumberProvider;L${L}/providers/number/NumberProvider;)V`;
    expect(cls?.methods.some((m) => m.name === '<init>' && m.desc === ctorDesc)).toBe(true);
    expect(cls?.fields.some((f) => f.name === 'min')).toBe(true);
    expect(cls?.fields.some((f) => f.name === 'max')).toBe(true);
  });

  it('AnyOfCondition <init>(List) is a non-public CONSTRUCTOR (never "overridable")', () => {
    const cls = byName.get(`${L}/predicates/AnyOfCondition`);
    expect(cls?.isRecord).toBe(false);
    const ctor = cls?.methods.find((m) => m.name === '<init>' && m.desc === '(Ljava/util/List;)V');
    expect(ctor, 'AnyOfCondition <init>(List)V missing').toBeDefined();
    expect(vis(ctor?.flags ?? [])).not.toBe('public');
  });

  it('CompositeLootItemCondition.createInlineCodec is protected+static; terms field present', () => {
    const cls = byName.get(`${L}/predicates/CompositeLootItemCondition`);
    const m = cls?.methods.find(
      (mm) =>
        mm.name === 'createInlineCodec' &&
        mm.desc === '(Ljava/util/function/Function;)Lcom/mojang/serialization/Codec;',
    );
    expect(m, 'createInlineCodec missing').toBeDefined();
    expect(m?.flags).toContain('static');
    expect(vis(m?.flags ?? [])).toBe('protected');
    expect(cls?.fields.some((f) => f.name === 'terms')).toBe(true);
  });

  it('ClientTextTooltip.text and WitherBoss.yRotHeads/yRotOHeads fields exist', () => {
    const tip = byName.get('net/minecraft/client/gui/screens/inventory/tooltip/ClientTextTooltip');
    expect(tip?.fields.some((f) => f.name === 'text')).toBe(true);
    const wither = byName.get('net/minecraft/world/entity/boss/wither/WitherBoss');
    expect(wither?.fields.some((f) => f.name === 'yRotHeads')).toBe(true);
    expect(wither?.fields.some((f) => f.name === 'yRotOHeads')).toBe(true);
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
  // reaches conflict detection after the source-availability check passes).
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
    // Confirms the guard path: without a remapped JAR (produced by decompiling),
    // the validator reports the missing-source error and never reaches conflict
    // detection.
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
    expect(res.errors.some((e) => e.message.includes('not available'))).toBe(true);
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
