import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleValidateAccessWidener } from '../../src/server/tools.js';
import {
  getAccessWidenerService,
  validateEntryAgainstSource,
} from '../../src/services/access-widener-service.js';
import type { AccessWidenerEntry } from '../../src/types/minecraft.js';
import { AccessWidenerParseError } from '../../src/utils/errors.js';
import { TEST_MAPPING, TEST_VERSION } from '../test-constants.js';

/**
 * Build an AccessWidenerEntry with sensible defaults for the regression
 * tests below. These exercise the tree-sitter + descriptor-matching validator
 * via the `validateEntryAgainstSource` test seam (synthetic Java source, no
 * decompiled Minecraft tree required).
 */
function makeEntry(
  partial: Partial<AccessWidenerEntry> & { className: string },
): AccessWidenerEntry {
  return {
    accessType: 'accessible',
    targetType: 'class',
    line: 1,
    ...partial,
  };
}

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
    expect(result.content).toHaveLength(1);

    const data = JSON.parse(result.content[0].text);
    // The single parsed class entry flows into the response verbatim.
    expect(data.accessWidener.namespace).toBe('named');
    expect(data.accessWidener.version).toBe(2);
    expect(data.accessWidener.entryCount).toBe(1);
    // Validation ran against that entry and returned a well-formed result.
    expect(data.validation).toBeDefined();
    expect(typeof data.validation.isValid).toBe('boolean');
    expect(Array.isArray(data.validation.errors)).toBe(true);
    expect(Array.isArray(data.validation.warnings)).toBe(true);
  }, 30000);

  it('should handle invalid access widener gracefully', async () => {
    const result = await handleValidateAccessWidener({
      content: 'not valid access widener',
      mcVersion: TEST_VERSION,
    });

    expect(result).toBeDefined();
    expect(result.content).toHaveLength(1);

    // The garbage content is not a file path and matches no valid access/target
    // type, so the parser rejects every line — zero entries — rather than
    // producing a bogus parsed-success shape. (No throw: bad lines are skipped,
    // not fatal.) This is stronger than merely "a response exists."
    const data = JSON.parse(result.content[0].text);
    expect(data.accessWidener.entryCount).toBe(0);
    expect(data.accessWidener.namespace).toBe('named');
    expect(data.accessWidener.version).toBe(1);
  });

  it('generateAccessWidener produces the exact expected text and round-trips', () => {
    const awService = getAccessWidenerService();
    const entries = [
      {
        accessType: 'accessible' as const,
        targetType: 'class' as const,
        className: 'net.minecraft.entity.Entity',
      },
      {
        accessType: 'extendable' as const,
        targetType: 'method' as const,
        className: 'net.minecraft.entity.Entity',
        memberName: 'tick',
        memberDescriptor: '()V',
      },
      {
        accessType: 'mutable' as const,
        targetType: 'field' as const,
        className: 'net.minecraft.entity.Entity',
        memberName: 'age',
        memberDescriptor: 'I',
      },
    ];

    const generated = awService.generateAccessWidener(entries, 'yarn');

    // Exact output: header line + blank line + one line per entry, class paths
    // slash-separated.
    expect(generated).toBe(
      [
        'accessWidener v2 named',
        '',
        'accessible class net/minecraft/entity/Entity',
        'extendable method net/minecraft/entity/Entity tick ()V',
        'mutable field net/minecraft/entity/Entity age I',
      ].join('\n'),
    );

    // Round-trip: parsing the generated text yields the same entries (ignoring
    // the parse-added `line` field). Covers class/method/field targets and
    // accessible/extendable/mutable access types.
    const parsed = awService.parseAccessWidener(generated);
    expect(parsed.namespace).toBe('named');
    expect(parsed.version).toBe(2);
    expect(parsed.entries).toHaveLength(3);
    expect(
      parsed.entries.map((e) => ({
        accessType: e.accessType,
        targetType: e.targetType,
        className: e.className,
        memberName: e.memberName,
        memberDescriptor: e.memberDescriptor,
      })),
    ).toEqual(entries);
  });

  it('generateAccessWidener writes the mapping namespace in the header for non-yarn', () => {
    const awService = getAccessWidenerService();
    const mojmap = awService.generateAccessWidener(
      [
        {
          accessType: 'accessible' as const,
          targetType: 'class' as const,
          className: 'net.minecraft.Foo',
        },
      ],
      'mojmap',
    );
    expect(mojmap.split('\n')[0]).toBe('accessWidener v2 mojmap');
  });

  it('parseAccessWidenerFile parses a real file from disk and surfaces sourcePath', () => {
    const awService = getAccessWidenerService();
    const filePath = join(
      tmpdir(),
      `aw-${Date.now()}-${Math.random().toString(36).slice(2)}.accesswidener`,
    );
    const content = [
      'accessWidener v2 named',
      '',
      'accessible class net/minecraft/block/Block',
      'accessible method net/minecraft/block/Block getState (I)Lnet/minecraft/block/BlockState;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf8');

    try {
      const aw = awService.parseAccessWidenerFile(filePath);
      expect(aw.sourcePath).toBe(filePath);
      expect(aw.namespace).toBe('named');
      expect(aw.version).toBe(2);
      expect(aw.entries).toHaveLength(2);
      expect(aw.entries[0]?.className).toBe('net.minecraft.block.Block');
      expect(aw.entries[1]?.memberName).toBe('getState');
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it('parseAccessWidenerFile throws AccessWidenerParseError on a missing file', () => {
    const awService = getAccessWidenerService();
    const missing = join(tmpdir(), 'definitely-does-not-exist.accesswidener');
    expect(() => awService.parseAccessWidenerFile(missing)).toThrow(AccessWidenerParseError);
    expect(() => awService.parseAccessWidenerFile(missing)).toThrow(/File not found/);
  });

  it('descriptorToReadable handles mixed object/primitive params and object returns', () => {
    const awService = getAccessWidenerService();
    expect(awService.descriptorToReadable('(Ljava/lang/String;I)V')).toBe(
      'void (java.lang.String, int)',
    );
    expect(awService.descriptorToReadable('(Ljava/lang/String;)Ljava/lang/String;')).toBe(
      'java.lang.String (java.lang.String)',
    );
    expect(awService.descriptorToReadable('[[I')).toBe('int[][]');
  });

  it('descriptorToReadable terminates on malformed input (no infinite loop)', () => {
    const awService = getAccessWidenerService();
    // Each case previously could hang parseType (a missing ';' rewound `i` to 0,
    // or an unrecognized char never advanced the cursor). The 2s per-test
    // timeout pins the regression: any hang fails this test rather than the
    // suite. All must return a string without throwing.
    const malformed = [
      '(Ljava/lang/String', // method, object param with no closing ';'
      'Lnet/mc/X', // bare object type, no ';'
      '(X)V', // stray unrecognized char inside params
      '', // empty string
      '(', // lone open paren
      '[Lnet/mc/X', // array of unterminated object type
      '(II', // params with no closing ')'
    ];
    for (const desc of malformed) {
      const out = awService.descriptorToReadable(desc);
      expect(typeof out).toBe('string');
    }
  }, 2000);
});

describe('Access Widener Validation (tree-sitter + descriptor matching)', () => {
  it('does NOT match a method that is only called (not declared)', () => {
    // `helper` is invoked inside doWork() but never declared. The old regex
    // `\bhelper\s*\(` matched the call site and reported a false positive.
    const src = `
package net.test;
public class Caller {
    public void doWork() {
        helper();
    }
}
`;
    const entry = makeEntry({
      targetType: 'method',
      className: 'net.test.Caller',
      memberName: 'helper',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    // No spurious suggestion for an undeclared name.
    expect(res.suggestion).toBeUndefined();
  });

  it('validates <init> constructor descriptors against the real constructor', () => {
    // The old code returned `source.includes('public ')` which is ALWAYS true.
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
      targetType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(II)V',
    });
    expect(validateEntryAgainstSource(matching, src).errors).toEqual([]);

    const wrongArity = makeEntry({
      targetType: 'method',
      className: 'net.test.Thing',
      memberName: '<init>',
      memberDescriptor: '(I)V',
    });
    const res = validateEntryAgainstSource(wrongArity, src);
    expect(res.errors.some((e) => e.includes('no overload matches'))).toBe(true);
  });

  it('reports overload mismatch and lists the found overloads', () => {
    const src = `
package net.test;
public class Over {
    public void foo(int x) {}
    public void foo(String s) {}
}
`;
    // foo(int) and foo(String) both take 1 arg; AW targets a 2-arg overload.
    const entry = makeEntry({
      targetType: 'method',
      className: 'net.test.Over',
      memberName: 'foo',
      memberDescriptor: '(II)V',
    });
    const res = validateEntryAgainstSource(entry, src);
    const err = res.errors.find((e) => e.includes('no overload matches'));
    expect(err).toBeDefined();
    // The actual overloads are reported so the user can pick the right one.
    expect(err).toContain('(I)V');
    expect(err).toContain('(Ljava/lang/String;)V');
  });

  it('matches a correct overload by descriptor', () => {
    const src = `
package net.test;
public class Over {
    public void foo(int x) {}
    public void foo(String s) {}
}
`;
    const entry = makeEntry({
      targetType: 'method',
      className: 'net.test.Over',
      memberName: 'foo',
      memberDescriptor: '(Ljava/lang/String;)V',
    });
    expect(validateEntryAgainstSource(entry, src).errors).toEqual([]);
  });

  it('validates field descriptors (mismatch vs match)', () => {
    const src = `
package net.test;
public class Person {
    public int age;
}
`;
    const mismatch = makeEntry({
      targetType: 'field',
      className: 'net.test.Person',
      memberName: 'age',
      memberDescriptor: 'Ljava/lang/String;',
    });
    expect(
      validateEntryAgainstSource(mismatch, src).errors.some((e) =>
        e.includes('descriptor mismatch'),
      ),
    ).toBe(true);

    const ok = makeEntry({
      targetType: 'field',
      className: 'net.test.Person',
      memberName: 'age',
      memberDescriptor: 'I',
    });
    expect(validateEntryAgainstSource(ok, src).errors).toEqual([]);
  });

  it('warns on mutable for an already-non-final (incl. generic) field', () => {
    // The old `(?!final)\w+` regex silently missed `List<String> items`
    // because `\w+` stopped at the `<`.
    const src = `
package net.test;
import java.util.List;
public class Holder {
    public List<String> items;
    public int counter;
}
`;
    const items = makeEntry({
      accessType: 'mutable',
      targetType: 'field',
      className: 'net.test.Holder',
      memberName: 'items',
      memberDescriptor: 'Ljava/util/List;',
    });
    const itemsRes = validateEntryAgainstSource(items, src);
    expect(itemsRes.errors).toEqual([]);
    expect(itemsRes.warnings.some((w) => w.includes('already be mutable'))).toBe(true);

    const counter = makeEntry({
      accessType: 'mutable',
      targetType: 'field',
      className: 'net.test.Holder',
      memberName: 'counter',
      memberDescriptor: 'I',
    });
    expect(
      validateEntryAgainstSource(counter, src).warnings.some((w) =>
        w.includes('already be mutable'),
      ),
    ).toBe(true);
  });

  it('does not warn on mutable for a final field', () => {
    const src = `
package net.test;
public class Fixed {
    public final int locked = 1;
}
`;
    const entry = makeEntry({
      accessType: 'mutable',
      targetType: 'field',
      className: 'net.test.Fixed',
      memberName: 'locked',
      memberDescriptor: 'I',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('already be mutable'))).toBe(false);
  });

  it('warns on extendable for a final class but not for a non-final one', () => {
    const finalSrc = `
package net.test;
public final class Locked {}
`;
    const finalEntry = makeEntry({
      accessType: 'extendable',
      targetType: 'class',
      className: 'net.test.Locked',
    });
    expect(
      validateEntryAgainstSource(finalEntry, finalSrc).warnings.some((w) => w.includes('is final')),
    ).toBe(true);

    // The old `source.includes('final class')` substring matched the inner
    // final class AND the comment, producing a false warning for `Open`.
    const trickySrc = `
package net.test;
// this comment mentions final class on purpose
public class Open {
    public static final class Inner {}
}
`;
    const openEntry = makeEntry({
      accessType: 'extendable',
      targetType: 'class',
      className: 'net.test.Open',
    });
    expect(
      validateEntryAgainstSource(openEntry, trickySrc).warnings.some((w) => w.includes('is final')),
    ).toBe(false);
  });

  it('suggests a similar field name when the target is missing', () => {
    const src = `
package net.test;
public class Box {
    public int counter;
}
`;
    const entry = makeEntry({
      accessType: 'mutable',
      targetType: 'field',
      className: 'net.test.Box',
      memberName: 'countre',
      memberDescriptor: 'I',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors.some((e) => e.includes('not found'))).toBe(true);
    expect(res.suggestion).toContain('counter');
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
      targetType: 'method',
      className: 'net.test.WithStatic',
      memberName: '<clinit>',
      memberDescriptor: '()V',
    });
    const res = validateEntryAgainstSource(entry, src);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes('<clinit>'))).toBe(true);
  });
});
