/**
 * Shared JVM-descriptor helpers (pure, side-effect free).
 *
 * These convert Java SOURCE types (as emitted by the AST walker in
 * `java-symbols.ts`) into JVM descriptors and compare them. They were
 * originally inlined in `access-widener-service.ts` (Stage 3) and are now
 * extracted so the mixin validator (Stage 4) reuses the exact same logic.
 *
 * IMPORTANT limitation: decompiled VineFlower source uses simple class names +
 * imports (e.g. `World`, `String`), and without an import table we can only
 * resolve the well-known `java.lang.*` set to its package. Every other simple
 * name becomes a best-effort placeholder descriptor (`L<Name>;`). To stay
 * robust under this ambiguity, descriptor *matching* compares object types by
 * SIMPLE class name rather than by fully-qualified descriptor. A future ASM
 * bytecode stage will read real descriptors from `.class` files and make this
 * authoritative.
 *
 * Nothing here performs I/O, logging, or filesystem access.
 */

import type { JavaParameter } from '../types/minecraft.js';

/**
 * Primitive / void source names mapped to their single-character JVM
 * descriptor. Shared by every SOURCE→descriptor conversion.
 */
export const PRIMITIVE_DESCRIPTORS: Record<string, string> = {
  int: 'I',
  boolean: 'Z',
  byte: 'B',
  char: 'C',
  short: 'S',
  long: 'J',
  float: 'F',
  double: 'D',
  void: 'V',
};

/**
 * Well-known `java.lang.*` types resolvable from a simple name. VineFlower
 * output usually imports these, so they appear as simple names in source. Any
 * simple name not in this set is treated as an unresolved placeholder.
 */
export const JAVA_LANG_TYPES = new Set([
  'String',
  'StringBuilder',
  'StringBuffer',
  'Object',
  'Class',
  'Number',
  'Integer',
  'Long',
  'Short',
  'Byte',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'Void',
  'Thread',
  'Runnable',
  'Throwable',
  'Exception',
  'RuntimeException',
  'Error',
  'StackTraceElement',
  'Math',
  'System',
  'Process',
  'Enum',
  'Record',
  'Iterable',
  'Comparable',
  'ClassLoader',
  'Module',
  'Package',
]);

/**
 * Convert a Java SOURCE type (from the AST) into a JVM descriptor, best-effort.
 *
 * - Primitives map to their single-char descriptor.
 * - Arrays: each trailing `[]` (or `...`, defensively) prepends a `[`.
 * - Generics are erased (`<...>` stripped) before conversion.
 * - Qualified names (`java.util.List`) become `Ljava/util/List;`.
 * - Well-known `java.lang` simple names become `Ljava/lang/<Name>;`.
 * - Any other simple name becomes an unresolved `L<Name>;` placeholder. This is
 *   fine for matching (compared by simple name) but slightly imprecise for
 *   human-readable messages. ASM extraction will resolve packages authoritatively.
 */
export function javaTypeToDescriptor(type: string): string {
  let t = type.trim();

  // Erase generic type arguments — JVM descriptors are non-generic.
  const gen = t.indexOf('<');
  if (gen >= 0) t = t.slice(0, gen).trim();

  // Array dimensions from trailing source markers.
  let dims = 0;
  while (t.endsWith('[]')) {
    dims++;
    t = t.slice(0, -2).trim();
  }
  while (t.endsWith('...')) {
    // Defensive: varargs usually arrive via `isVarArgs`, not in the type text.
    dims++;
    t = t.slice(0, -3).trim();
  }

  let base: string;
  const prim = PRIMITIVE_DESCRIPTORS[t];
  if (prim) {
    base = prim;
  } else if (t.includes('.')) {
    // Qualified name: dots → slashes (best-effort; nested classes flatten).
    base = `L${t.replace(/\./g, '/')};`;
  } else if (JAVA_LANG_TYPES.has(t)) {
    base = `Ljava/lang/${t};`;
  } else {
    // Unresolved simple name → placeholder. Matched by simple name downstream.
    base = `L${t};`;
  }

  return `${'['.repeat(dims)}${base}`;
}

/**
 * Map a structured AST parameter to a descriptor, turning a varargs parameter
 * into an array descriptor (e.g. `String...` → `[Ljava/lang/String;`).
 */
export function paramToDescriptor(param: JavaParameter): string {
  const base = javaTypeToDescriptor(param.type);
  return param.isVarArgs ? `[${base}` : base;
}

/**
 * Greedily split a run of JVM parameter descriptors into individual descriptors.
 * Each parameter is one-or-more `[` followed by either a primitive char or an
 * `L...;` object reference.
 */
export function parseParamDescriptors(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    const start = i;
    while (i < content.length && content[i] === '[') i++;
    if (i < content.length && content[i] === 'L') {
      const semi = content.indexOf(';', i);
      if (semi < 0) break; // malformed; bail
      i = semi + 1;
    } else {
      i++; // primitive element
    }
    out.push(content.slice(start, i));
  }
  return out;
}

/** Extract the simple class name from an object descriptor `L...;`. */
export function descriptorSimpleName(desc: string): string {
  const inner = desc.startsWith('L') ? desc.slice(1, -1) : desc;
  const slash = inner.lastIndexOf('/');
  return slash >= 0 ? inner.slice(slash + 1) : inner;
}

/**
 * Compare two single JVM descriptors for compatibility.
 *
 * - Primitives/void require exact equality.
 * - Arrays recurse into their element types.
 * - Object types match by SIMPLE class name, sidestepping the unresolved
 *   package limitation of source-based descriptor conversion.
 */
export function descriptorsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith('[') && b.startsWith('[')) {
    return descriptorsCompatible(a.slice(1), b.slice(1));
  }
  const aObj = a.startsWith('L') && a.endsWith(';');
  const bObj = b.startsWith('L') && b.endsWith(';');
  if (aObj && bObj) {
    return descriptorSimpleName(a) === descriptorSimpleName(b);
  }
  return false;
}

/**
 * Reconcile a JVM/qualified class name (inner-class `$` separators; slash→dot
 * already applied by callers) with the AST's dotted `declaringClass`. Both are
 * split on `.` and `$` into segment arrays and compared EXACTLY, element-wise.
 *
 * Used by the access-widener validator where class names arrive fully-qualified
 * from the JVM. For correlating possibly-SIMPLE source names (e.g. Mixin
 * targets), prefer a suffix-tolerant matcher instead.
 *
 * Edge case: a class name that literally contains `$` cannot be disambiguated
 * from a nesting separator this way. Acceptable for source-based validation;
 * the ASM bytecode stage will make this authoritative.
 */
export function classNamesMatch(qualifiedClassName: string, astDeclaringClass: string): boolean {
  const left = qualifiedClassName.split(/[.$]/);
  const right = astDeclaringClass.split(/[.$]/);
  if (left.length !== right.length) return false;
  return left.every((seg, i) => seg === right[i]);
}

/**
 * Convert a JVM descriptor to a human-readable Java type string.
 *
 * - Field descriptors: `I` → `int`, `Ljava/lang/String;` → `java.lang.String`,
 *   `[[I` → `int[][]`.
 * - Method descriptors: `(II)V` → `void (int, int)`.
 *
 * Robust against malformed input: a missing closing `;` consumes the rest of
 * the string instead of rewinding the cursor, and unrecognized characters
 * advance the cursor so the caller's loop always makes forward progress
 * (never infinite-loops). Originally in `access-widener-service.ts`; extracted
 * so the Access Transformer validator reuses the exact same decoder + output
 * strings (which are pinned by timeout regression tests).
 */
export function descriptorToReadable(descriptor: string): string {
  const typeMap: Record<string, string> = {
    Z: 'boolean',
    B: 'byte',
    C: 'char',
    S: 'short',
    I: 'int',
    J: 'long',
    F: 'float',
    D: 'double',
    V: 'void',
  };

  let i = 0;

  const parseType = (): string => {
    if (i >= descriptor.length) return '';

    const c = descriptor[i];

    if (typeMap[c]) {
      i++;
      return typeMap[c];
    }

    if (c === 'L') {
      const end = descriptor.indexOf(';', i);
      if (end < 0) {
        // No closing ';' — consume the rest instead of rewinding to index 0.
        const rest = descriptor.substring(i + 1).replace(/\//g, '.');
        i = descriptor.length;
        return rest;
      }
      const className = descriptor.substring(i + 1, end).replace(/\//g, '.');
      i = end + 1;
      return className;
    }

    if (c === '[') {
      i++;
      return `${parseType()}[]`;
    }

    // Unrecognized char — advance so the caller's loop always makes progress.
    i++;
    return '';
  };

  // Method descriptor: (params)returnType
  if (descriptor.startsWith('(')) {
    i = 1;
    const params: string[] = [];

    while (i < descriptor.length && descriptor[i] !== ')') {
      params.push(parseType());
    }

    i++;
    const returnType = parseType();

    return `${returnType} (${params.join(', ')})`;
  }

  // Field descriptor
  return parseType();
}
