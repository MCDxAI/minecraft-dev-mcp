import { describe, expect, it } from 'vitest';
import {
  JAVA_LANG_TYPES,
  PRIMITIVE_DESCRIPTORS,
  classNamesMatch,
  descriptorSimpleName,
  descriptorsCompatible,
  javaTypeToDescriptor,
  paramToDescriptor,
  parseParamDescriptors,
} from '../../src/utils/descriptor-utils.js';

/**
 * Focused unit tests for the shared JVM-descriptor helpers in
 * `src/utils/descriptor-utils.ts`.
 *
 * This module is the foundation for signature validation in BOTH
 * `access-widener-service.ts` and `mixin-service.ts` (the target-source
 * validators). A silent regression here would break descriptor matching in
 * both services, so these pin every export's pure behavior directly.
 *
 * IMPORTANT: decompiled VineFlower source uses simple class names + imports,
 * so non-`java.lang` simple names cannot be package-resolved and become a
 * best-effort `L<Name>;` placeholder. Several tests below assert that
 * documented limitation rather than papering over it.
 */

describe('PRIMITIVE_DESCRIPTORS', () => {
  // Every primitive + void maps to its single-character JVM descriptor.
  it.each([
    ['int', 'I'],
    ['boolean', 'Z'],
    ['byte', 'B'],
    ['char', 'C'],
    ['short', 'S'],
    ['long', 'J'],
    ['float', 'F'],
    ['double', 'D'],
    ['void', 'V'],
  ])('maps %s → %s', (source, descriptor) => {
    expect(PRIMITIVE_DESCRIPTORS[source]).toBe(descriptor);
  });

  it('contains exactly the 9 primitive/void entries', () => {
    expect(Object.keys(PRIMITIVE_DESCRIPTORS).sort()).toEqual(
      ['boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'void'].sort(),
    );
  });
});

describe('JAVA_LANG_TYPES', () => {
  it.each([
    'String',
    'Object',
    'Integer',
    'Long',
    'Boolean',
    'Exception',
    'Runnable',
    'Enum',
    'Record',
  ])('includes well-known java.lang type %s', (name) => {
    expect(JAVA_LANG_TYPES.has(name)).toBe(true);
  });

  // The set is deliberately restricted to java.lang: collection types,
  // game types, etc. are NOT resolvable from a bare simple name and must
  // become placeholders downstream.
  it.each(['List', 'Map', 'ArrayList', 'HashMap', 'Entity', 'BlockPos', 'Collection'])(
    'does NOT include non-java.lang type %s',
    (name) => {
      expect(JAVA_LANG_TYPES.has(name)).toBe(false);
    },
  );
});

describe('javaTypeToDescriptor', () => {
  it.each([
    ['int', 'I'],
    ['boolean', 'Z'],
    ['byte', 'B'],
    ['char', 'C'],
    ['short', 'S'],
    ['long', 'J'],
    ['float', 'F'],
    ['double', 'D'],
    ['void', 'V'],
  ])('converts primitive %s → %s', (source, descriptor) => {
    expect(javaTypeToDescriptor(source)).toBe(descriptor);
  });

  it.each([
    ['int[]', '[I'],
    ['byte[]', '[B'],
    ['boolean[]', '[Z'],
    ['String[][]', '[[Ljava/lang/String;'],
    ['Object[]', '[Ljava/lang/Object;'],
    ['int[][]', '[[I'],
  ])('converts array %s → %s', (source, descriptor) => {
    expect(javaTypeToDescriptor(source)).toBe(descriptor);
  });

  it.each([
    // java.lang simple names resolve to their package.
    ['String', 'Ljava/lang/String;'],
    ['Object', 'Ljava/lang/Object;'],
    ['Integer', 'Ljava/lang/Integer;'],
    ['Throwable', 'Ljava/lang/Throwable;'],
    // Fully-qualified names: dots → slashes.
    ['java.util.List', 'Ljava/util/List;'],
    ['java.util.Map', 'Ljava/util/Map;'],
    ['net.minecraft.Entity', 'Lnet/minecraft/Entity;'],
    ['com.example.Outer.Inner', 'Lcom/example/Outer/Inner;'],
  ])('converts reference type %s → %s', (source, descriptor) => {
    expect(javaTypeToDescriptor(source)).toBe(descriptor);
  });

  it.each([
    // Generics are erased: `<...>` stripped before resolution.
    ['Map<String,Integer>', 'LMap;'],
    ['List<List<String>>', 'LList;'],
    ['java.util.Map<String, Integer>', 'Ljava/util/Map;'],
    ['String[][]<X>', '[[Ljava/lang/String;'],
  ])('erases generics in %s → %s', (source, descriptor) => {
    expect(javaTypeToDescriptor(source)).toBe(descriptor);
  });

  it('produces an unresolved placeholder for a non-java.lang simple name', () => {
    // Documented limitation: `World`/`Entity` are simple names whose package
    // cannot be resolved without an import table → best-effort placeholder.
    // Matching still works because descriptorsCompatible compares by simple name.
    expect(javaTypeToDescriptor('World')).toBe('LWorld;');
    expect(javaTypeToDescriptor('Entity')).toBe('LEntity;');
  });

  it('treats defensive trailing varargs marker (int...) as an array dimension', () => {
    // Varargs normally arrive via JavaParameter.isVarArgs, but the converter
    // defensively treats a trailing `...` in the type text as one dimension.
    expect(javaTypeToDescriptor('int...')).toBe('[I');
  });

  it('trims surrounding whitespace', () => {
    expect(javaTypeToDescriptor('  int  ')).toBe('I');
    expect(javaTypeToDescriptor('\tString[]\n')).toBe('[Ljava/lang/String;');
  });

  it('returns L; for an empty string (no resolvable base)', () => {
    // Not a primitive, has no dot, and is not a java.lang type, so the
    // placeholder branch produces an empty object reference `L;`.
    expect(javaTypeToDescriptor('')).toBe('L;');
  });
});

describe('paramToDescriptor', () => {
  it('maps a plain parameter via javaTypeToDescriptor', () => {
    expect(paramToDescriptor({ type: 'int' })).toBe('I');
    expect(paramToDescriptor({ type: 'String' })).toBe('Ljava/lang/String;');
    expect(paramToDescriptor({ type: 'String[]' })).toBe('[Ljava/lang/String;');
  });

  it('turns a varargs parameter into an array descriptor', () => {
    // `String... keys` → one array dimension wrapping the base type.
    expect(paramToDescriptor({ name: 'keys', type: 'String', isVarArgs: true })).toBe(
      '[Ljava/lang/String;',
    );
    // Varargs on a primitive prepends a single `[`.
    expect(paramToDescriptor({ type: 'int', isVarArgs: true })).toBe('[I');
  });

  it('does NOT double-wrap an already-arrayed varargs parameter', () => {
    // isVarArgs simply prepends one `[` to whatever javaTypeToDescriptor yields.
    // A declared `String[]...` is an edge case that produces `[[Ljava/lang/String;`.
    expect(paramToDescriptor({ type: 'String[]', isVarArgs: true })).toBe('[[Ljava/lang/String;');
  });
});

describe('parseParamDescriptors', () => {
  it('returns an empty list for empty input', () => {
    expect(parseParamDescriptors('')).toEqual([]);
  });

  it.each([
    ['II', ['I', 'I']],
    ['IJZ', ['I', 'J', 'Z']],
    ['Ljava/lang/String;I', ['Ljava/lang/String;', 'I']],
    ['[I', ['[I']],
    ['[[I', ['[[I']],
    ['Ljava/util/Map;[Ljava/lang/String;', ['Ljava/util/Map;', '[Ljava/lang/String;']],
    ['I', ['I']],
  ])('splits %j into %j', (input, expected) => {
    expect(parseParamDescriptors(input)).toEqual(expected);
  });

  it('bails gracefully on malformed trailing object reference (no closing ;)', () => {
    // `IL` → parses `I`, then hits `L` with no `;` and bails, dropping the `L`.
    expect(parseParamDescriptors('IL')).toEqual(['I']);
    // A lone `L` with no terminator yields nothing.
    expect(parseParamDescriptors('L')).toEqual([]);
    // An object reference missing its `;` yields nothing.
    expect(parseParamDescriptors('Ljava/lang/String')).toEqual([]);
  });
});

describe('descriptorSimpleName', () => {
  it.each([
    ['Ljava/lang/String;', 'String'],
    ['Ljava/lang/Object;', 'Object'],
    ['Lnet/minecraft/Entity;', 'Entity'],
    // NOTE: descriptorSimpleName splits only on `/`, NOT on `$`. An inner-class
    // JVM name like `Map$Entry` is returned verbatim (unlike classNamesMatch,
    // which does split on `$`). Asserting the actual behavior.
    ['Ljava/util/Map$Entry;', 'Map$Entry'],
    // Placeholder descriptors keep their simple name (no slash present).
    ['LWorld;', 'World'],
  ])('extracts simple name from %s → %s', (desc, expected) => {
    expect(descriptorSimpleName(desc)).toBe(expected);
  });

  it('passes primitive/void descriptors through unchanged', () => {
    // Non-`L` inputs are returned as-is (lastIndexOf('/') === -1).
    expect(descriptorSimpleName('I')).toBe('I');
    expect(descriptorSimpleName('V')).toBe('V');
    expect(descriptorSimpleName('[I')).toBe('[I');
  });

  it('does not strip the array prefix on a bare L...; input mismatch (contract: only called with L...;)', () => {
    // descriptorSimpleName is contractually called on bare `L...;` object
    // descriptors — descriptorsCompatible strips array dimensions first via
    // recursion. For a raw array descriptor it does NOT drop the leading `[`
    // or trailing `;`; it returns the element name plus the trailing `;`.
    // We assert the ACTUAL behavior so a future change is detected.
    expect(descriptorSimpleName('[Ljava/lang/Object;')).toBe('Object;');
  });
});

describe('descriptorsCompatible', () => {
  it.each([
    ['I', 'I', true],
    ['J', 'J', true],
    ['V', 'V', true],
    ['I', 'J', false],
    ['I', 'Z', false],
    ['V', 'I', false],
  ])('treats primitives/void by exact equality: %s vs %s → %s', (a, b, expected) => {
    expect(descriptorsCompatible(a, b)).toBe(expected);
  });

  it.each([
    ['[I', '[I', true],
    ['[I', '[J', false],
    ['[[I', '[[I', true],
    ['[[I', '[I', false],
  ])('recurses into array element types: %s vs %s → %s', (a, b, expected) => {
    expect(descriptorsCompatible(a, b)).toBe(expected);
  });

  it.each([
    // Same simple name matches despite the unresolved-package placeholder.
    ['Ljava/lang/String;', 'LString;', true],
    ['Ljava/lang/String;', 'Ljava/lang/String;', true],
    ['Ljava/lang/String;', 'Ljava/lang/Integer;', false],
    ['Lnet/minecraft/Entity;', 'LEntity;', true],
    // Array-wrapped objects still match by simple name after stripping `[`.
    ['[Ljava/lang/String;', '[LString;', true],
    ['[Ljava/lang/String;', '[Ljava/lang/Integer;', false],
  ])('compares object types by simple name: %s vs %s → %s', (a, b, expected) => {
    expect(descriptorsCompatible(a, b)).toBe(expected);
  });

  it('rejects mismatched descriptor categories', () => {
    // primitive vs object reference → false.
    expect(descriptorsCompatible('I', 'Ljava/lang/String;')).toBe(false);
    expect(descriptorsCompatible('Ljava/lang/String;', 'I')).toBe(false);
    // object vs array-of-primitive → false.
    expect(descriptorsCompatible('Ljava/lang/String;', '[I')).toBe(false);
  });
});

describe('classNamesMatch', () => {
  it.each([
    ['net.mc.Entity', 'net.mc.Entity', true],
    // JVM/inner-class `$` form reconciles with the AST's dotted form.
    ['net.mc.Outer$Inner', 'net.mc.Outer.Inner', true],
    ['net.mc.Outer$Inner$Deep', 'net.mc.Outer.Inner.Deep', true],
    // Both sides using `$` is fine too.
    ['net.mc.Outer$Inner', 'net.mc.Outer$Inner', true],
  ])('matches correlated names: %s vs %s → %s', (left, right, expected) => {
    expect(classNamesMatch(left, right)).toBe(expected);
  });

  it.each([
    ['net.mc.Foo', 'net.mc.Bar', false],
    // Same simple name, different package → false.
    ['a.X', 'b.X', false],
    // Different nesting depth → false.
    ['net.mc.Entity', 'net.mc.Entity.Inner', false],
    ['net.mc.Outer$Inner$Deep', 'net.mc.Outer.Inner', false],
  ])('rejects non-correlated names: %s vs %s → %s', (left, right, expected) => {
    expect(classNamesMatch(left, right)).toBe(expected);
  });
});
