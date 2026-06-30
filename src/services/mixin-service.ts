/**
 * Mixin Analysis Service
 *
 * Parses, validates, and provides suggestions for Mixin classes.
 * Supports full validation against Minecraft target classes with fix suggestions.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import AdmZip from 'adm-zip';
import { getCacheManager } from '../cache/cache-manager.js';
import type {
  MappingType,
  MixinAccessor,
  MixinClass,
  MixinInjection,
  MixinInjectionType,
  MixinShadow,
  MixinSuggestion,
  MixinValidationError,
  MixinValidationResult,
  MixinValidationWarning,
} from '../types/minecraft.js';
import {
  descriptorsCompatible,
  javaTypeToDescriptor,
  paramToDescriptor,
  parseParamDescriptors,
} from '../utils/descriptor-utils.js';
import { MixinParseError } from '../utils/errors.js';
import { extractJavaSymbols } from '../utils/java-symbols.js';
import type {
  AnnotationValue,
  JavaAnnotation,
  JavaSymbol,
  StructuredAnnotation,
} from '../utils/java-symbols.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';
import { getDecompileService } from './decompile-service.js';

// ---------------------------------------------------------------------------
// Module-internal helpers: class correlation, descriptor matching, suggestions
// ---------------------------------------------------------------------------
//
// The TARGET-source (decompiled Minecraft class) validation is tree-sitter
// based: the target source is parsed ONCE into `JavaSymbol[]` (via
// `extractJavaSymbols`) and injections/shadows/accessors are correlated
// against the declared symbols. There is NO regex Java-source inspection left
// for the target — the only string-pattern operations remaining are the
// mixin-SOURCE annotation parsing (parseInjections/parseShadows/parseAccessors,
// a separate follow-on) and pure JVM descriptor decode logic shared from
// `descriptor-utils.js`.

/** Shape returned by the target-source validators (errors/warnings/suggestions). */
interface ValidationParts {
  errors: MixinValidationError[];
  warnings: MixinValidationWarning[];
  suggestions: MixinSuggestion[];
}

/** Last segment (simple name) of a dot/`$`-separated class name. */
function simpleClassName(name: string): string {
  const parts = name.split(/[.$]/);
  return parts[parts.length - 1] ?? name;
}

/**
 * Correlate a (often simple-named) Mixin target class with a fully-qualified
 * AST `declaringClass`. @Mixin targets are frequently simple names (e.g.
 * `Entity`) resolved from a single .java file whose package makes the symbol's
 * declaringClass fully qualified (`net.minecraft.entity.Entity`). We therefore
 * match on a SUFFIX of dot/`$` segments, which is more lenient than AW's exact
 * `classNamesMatch` (AW names arrive fully-qualified from the JVM). A future
 * ASM bytecode stage will make this authoritative.
 */
function classMatchesTarget(target: string, declaringClass: string): boolean {
  const t = target.split(/[.$]/);
  const d = declaringClass.split(/[.$]/);
  if (t.length > d.length) return false;
  const offset = d.length - t.length;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== d[offset + i]) return false;
  }
  return true;
}

/** Build the JVM method descriptor string for an AST method/constructor symbol. */
function buildMethodDescriptor(sym: JavaSymbol): string {
  const params = sym.parameters ?? [];
  return `(${params.map(paramToDescriptor).join('')})${javaTypeToDescriptor(sym.returnType ?? 'void')}`;
}

/** Compare an AST method/constructor signature against a target JVM method descriptor. */
function methodMatchesDescriptor(sym: JavaSymbol, targetDescriptor: string): boolean {
  const open = targetDescriptor.indexOf('(');
  const close = targetDescriptor.indexOf(')');
  if (open < 0 || close < 0 || close <= open) return false;
  const targetParams = parseParamDescriptors(targetDescriptor.slice(open + 1, close));
  const targetReturn = targetDescriptor.slice(close + 1);
  const params = sym.parameters ?? [];
  const astParams = params.map(paramToDescriptor);
  if (astParams.length !== targetParams.length) return false;
  for (let i = 0; i < astParams.length; i++) {
    if (!descriptorsCompatible(astParams[i], targetParams[i])) return false;
  }
  return descriptorsCompatible(javaTypeToDescriptor(sym.returnType ?? 'void'), targetReturn);
}

/** Distinct non-constructor method names declared by the target class. */
function methodNamesForClass(symbols: JavaSymbol[], targetClass: string): string[] {
  const set = new Set<string>();
  for (const s of symbols) {
    if (
      s.entryType === 'method' &&
      s.isConstructor !== true &&
      s.symbol &&
      classMatchesTarget(targetClass, s.declaringClass)
    ) {
      set.add(s.symbol);
    }
  }
  return [...set];
}

/** Distinct field names declared by the target class. */
function fieldNamesForClass(symbols: JavaSymbol[], targetClass: string): string[] {
  const set = new Set<string>();
  for (const s of symbols) {
    if (s.entryType === 'field' && s.symbol && classMatchesTarget(targetClass, s.declaringClass)) {
      set.add(s.symbol);
    }
  }
  return [...set];
}

/** Calculate Levenshtein distance between two strings. */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/** Check if two strings are similar (used for class-name suggestions). */
function isSimilar(a: string, b: string): boolean {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return (
    distance <= 3 ||
    b.toLowerCase().includes(a.toLowerCase()) ||
    a.toLowerCase().includes(b.toLowerCase())
  );
}

/** Find similar strings using Levenshtein distance (used for member suggestions). */
function findSimilar(target: string, candidates: string[], maxDistance = 3): string[] {
  return candidates
    .map((c) => ({
      name: c,
      distance: levenshteinDistance(target.toLowerCase(), c.toLowerCase()),
    }))
    .filter((c) => c.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map((c) => c.name);
}

/**
 * Validate an injection against the target class's AST symbols. Pure: no I/O.
 *
 * Resolves the injection target by name (and, when a JVM descriptor is present,
 * by overload), including `<init>`/class-name constructors which the old
 * `\b<init>\s*\(` regex could never match in decompiled source (where ctors
 * are named after the class). Only DECLARED members are seen here — call sites
 * and comments are not, so a method that is merely called (but not declared)
 * is correctly reported as missing.
 */
function validateInjectionAgainstSymbols(
  injection: MixinInjection,
  symbols: JavaSymbol[],
  targetClass: string,
): ValidationParts {
  const errors: MixinValidationError[] = [];
  const warnings: MixinValidationWarning[] = [];
  const suggestions: MixinSuggestion[] = [];

  if (!injection.targetMethod) {
    return { errors, warnings, suggestions };
  }

  // Method name + optional JVM descriptor: "foo", "foo(II)V", "<init>(II)V".
  const openParen = injection.targetMethod.indexOf('(');
  const methodName =
    openParen >= 0 ? injection.targetMethod.slice(0, openParen) : injection.targetMethod;
  const descriptor = openParen >= 0 ? injection.targetMethod.slice(openParen) : null;

  // Static initializer is not emitted by the AST walk — warn instead of erroring.
  if (methodName === '<clinit>') {
    warnings.push({
      type: 'fragile_injection',
      message:
        "'<clinit>' (static initializer) cannot be validated from decompiled source — verify manually",
      element: injection,
      line: injection.line,
    });
    return { errors, warnings, suggestions };
  }

  const targetSimple = simpleClassName(targetClass);
  // Mixin constructors are referenced as "<init>" or by the class simple name.
  const isCtor = methodName === '<init>' || methodName === targetSimple;

  const candidates = isCtor
    ? symbols.filter(
        (s) =>
          s.entryType === 'method' &&
          s.isConstructor === true &&
          classMatchesTarget(targetClass, s.declaringClass),
      )
    : symbols.filter(
        (s) =>
          s.entryType === 'method' &&
          s.isConstructor !== true &&
          s.symbol === methodName &&
          classMatchesTarget(targetClass, s.declaringClass),
      );

  if (candidates.length === 0) {
    errors.push({
      type: 'method_not_found',
      message: `Target ${isCtor ? 'constructor' : 'method'} '${methodName}' not found in ${targetClass}`,
      element: injection,
      line: injection.line,
    });
    const pool = isCtor
      ? [...methodNamesForClass(symbols, targetClass), targetSimple]
      : methodNamesForClass(symbols, targetClass);
    const similar = findSimilar(methodName, pool);
    if (similar.length > 0) {
      suggestions.push({
        type: 'fix_method',
        message: `Similar methods in target: ${similar.slice(0, 3).join(', ')}`,
        element: injection,
        line: injection.line,
      });
    }
    return { errors, warnings, suggestions };
  }

  // Overload resolution when a descriptor is present. Note: the error type is
  // `signature_mismatch` because `method_overload_not_found` is not part of the
  // (locked) MixinValidationError union — `signature_mismatch` is the closest
  // existing type for "method exists but descriptor disagrees".
  if (descriptor) {
    const matched = candidates.filter((c) => methodMatchesDescriptor(c, descriptor));
    if (matched.length === 0) {
      const found = candidates.map(buildMethodDescriptor).join(', ');
      errors.push({
        type: 'signature_mismatch',
        message: `Target method '${methodName}' exists but no overload matches descriptor ${descriptor} (found: ${found})`,
        element: injection,
        line: injection.line,
      });
      return { errors, warnings, suggestions };
    }
  }

  // Warn about HEAD injections in constructors (kept from the original logic).
  if (injection.at === 'HEAD' && methodName === '<init>') {
    warnings.push({
      type: 'fragile_injection',
      message:
        'Injecting at HEAD of constructor is fragile - consider using @Inject with at = @At(value = "INVOKE", target = "super()")',
      element: injection,
      line: injection.line,
    });
  }

  return { errors, warnings, suggestions };
}

/**
 * Validate a @Shadow against the target class's AST symbols. Pure: no I/O.
 * Method shadows resolve by name; field shadows resolve by name. Shadow `type`
 * is loosely populated by the mixin-source parser, so name-match is the
 * baseline and any descriptor it carries is not strictly enforced.
 */
function validateShadowAgainstSymbols(
  shadow: MixinShadow,
  symbols: JavaSymbol[],
  targetClass: string,
): ValidationParts {
  const errors: MixinValidationError[] = [];
  const warnings: MixinValidationWarning[] = [];
  const suggestions: MixinSuggestion[] = [];

  const targetSimple = simpleClassName(targetClass);
  const isCtor = shadow.name === '<init>' || shadow.name === targetSimple;

  if (shadow.isMethod || isCtor) {
    const candidates = isCtor
      ? symbols.filter(
          (s) =>
            s.entryType === 'method' &&
            s.isConstructor === true &&
            classMatchesTarget(targetClass, s.declaringClass),
        )
      : symbols.filter(
          (s) =>
            s.entryType === 'method' &&
            s.isConstructor !== true &&
            s.symbol === shadow.name &&
            classMatchesTarget(targetClass, s.declaringClass),
        );

    if (candidates.length === 0) {
      errors.push({
        type: 'shadow_not_found',
        message: `Shadow ${isCtor ? 'constructor' : 'method'} '${shadow.name}' not found in ${targetClass}`,
        element: shadow,
        line: shadow.line,
      });
      const similar = findSimilar(shadow.name, methodNamesForClass(symbols, targetClass));
      if (similar.length > 0) {
        suggestions.push({
          type: 'fix_method',
          message: `Similar methods: ${similar.slice(0, 3).join(', ')}`,
          element: shadow,
          line: shadow.line,
        });
      }
    }
  } else {
    const candidates = symbols.filter(
      (s) =>
        s.entryType === 'field' &&
        s.symbol === shadow.name &&
        classMatchesTarget(targetClass, s.declaringClass),
    );

    if (candidates.length === 0) {
      errors.push({
        type: 'shadow_not_found',
        message: `Shadow field '${shadow.name}' not found in ${targetClass}`,
        element: shadow,
        line: shadow.line,
      });
      const similar = findSimilar(shadow.name, fieldNamesForClass(symbols, targetClass));
      if (similar.length > 0) {
        suggestions.push({
          type: 'fix_method',
          message: `Similar fields: ${similar.slice(0, 3).join(', ')}`,
          element: shadow,
          line: shadow.line,
        });
      }
    }
  }

  return { errors, warnings, suggestions };
}

/**
 * Validate a @Accessor/@Invoker against the target class's AST symbols. Pure.
 * Invokers target methods; accessors target fields.
 */
function validateAccessorAgainstSymbols(
  accessor: MixinAccessor,
  symbols: JavaSymbol[],
  targetClass: string,
): ValidationParts {
  const errors: MixinValidationError[] = [];
  const warnings: MixinValidationWarning[] = [];
  const suggestions: MixinSuggestion[] = [];

  const targetSimple = simpleClassName(targetClass);
  const isCtor = accessor.target === '<init>' || accessor.target === targetSimple;

  if (accessor.isInvoker || isCtor) {
    const candidates = isCtor
      ? symbols.filter(
          (s) =>
            s.entryType === 'method' &&
            s.isConstructor === true &&
            classMatchesTarget(targetClass, s.declaringClass),
        )
      : symbols.filter(
          (s) =>
            s.entryType === 'method' &&
            s.isConstructor !== true &&
            s.symbol === accessor.target &&
            classMatchesTarget(targetClass, s.declaringClass),
        );

    if (candidates.length === 0) {
      errors.push({
        type: 'shadow_not_found',
        message: `Invoker target '${accessor.target}' not found in ${targetClass}`,
        element: accessor,
        line: accessor.line,
      });
    }
  } else {
    const candidates = symbols.filter(
      (s) =>
        s.entryType === 'field' &&
        s.symbol === accessor.target &&
        classMatchesTarget(targetClass, s.declaringClass),
    );

    if (candidates.length === 0) {
      errors.push({
        type: 'shadow_not_found',
        message: `Accessor target '${accessor.target}' not found in ${targetClass}`,
        element: accessor,
        line: accessor.line,
      });
    }
  }

  return { errors, warnings, suggestions };
}

/**
 * Validate an injection against a synthetic Java source string. Test seam for
 * the tree-sitter + descriptor-matching validator — lets unit tests exercise
 * validation without a decompiled Minecraft source tree. Production validation
 * reads the target class file, extracts symbols once, and delegates to
 * `validateInjectionAgainstSymbols`.
 *
 * @internal
 */
export function validateInjectionAgainstSource(
  injection: MixinInjection,
  targetSource: string,
  targetClass: string,
): ValidationParts {
  return validateInjectionAgainstSymbols(injection, extractJavaSymbols(targetSource), targetClass);
}

/** @internal */
export function validateShadowAgainstSource(
  shadow: MixinShadow,
  targetSource: string,
  targetClass: string,
): ValidationParts {
  return validateShadowAgainstSymbols(shadow, extractJavaSymbols(targetSource), targetClass);
}

/** @internal */
export function validateAccessorAgainstSource(
  accessor: MixinAccessor,
  targetSource: string,
  targetClass: string,
): ValidationParts {
  return validateAccessorAgainstSymbols(accessor, extractJavaSymbols(targetSource), targetClass);
}

// ---------------------------------------------------------------------------
// Module-internal helpers: mixin-SOURCE annotation parsing
// ---------------------------------------------------------------------------
//
// These operate on the structured annotation model produced by
// `extractJavaSymbols` (see `src/utils/java-symbols.ts` and
// `docs/ref/mixin-annotation-ast.md`). They contain NO regex — every
// annotation argument (method, at, cancellable, priority, class targets, ...)
// is read from the typed `AnnotationValue` discriminated union.

/** Simple name (last dotted segment) of an annotation descriptor. */
function annotationSimpleName(descriptor: string): string {
  const idx = descriptor.lastIndexOf('.');
  return idx >= 0 ? descriptor.slice(idx + 1) : descriptor;
}

/**
 * Collect @Mixin target class names from every argument form the structured
 * annotation model exposes: the bare single-arg shorthand (@Mixin(Entity.class),
 * @Mixin({A.class, B.class})) and the named-value form (@Mixin(value = X.class),
 * @Mixin(value = {A.class}, priority = 500)). Names are returned AS WRITTEN
 * (simple `Entity` or qualified `net.minecraft.entity.LivingEntity`).
 */
function collectClassTargets(parsed: StructuredAnnotation): string[] {
  const out: string[] = [];
  const collect = (v: AnnotationValue): void => {
    if (v.kind === 'class') {
      out.push(v.value);
    } else if (v.kind === 'array') {
      for (const item of v.value) collect(item);
    }
  };
  if (parsed.elementValue) collect(parsed.elementValue);
  const valuePair = parsed.elementValuePairs.value;
  if (valuePair) collect(valuePair);
  return out;
}

/**
 * Read a string value from a nested annotation, accepting either the bare
 * single-arg form (@At("HEAD") -> elementValue) or the named form
 * (@At(value = "INVOKE")) -> elementValuePairs.value).
 */
function nestedAnnoStringValue(nested: StructuredAnnotation, key: string): string | undefined {
  const pairVal = nested.elementValuePairs[key];
  if (pairVal?.kind === 'string') return pairVal.value;
  if (key === 'value' && nested.elementValue?.kind === 'string') {
    return nested.elementValue.value;
  }
  return undefined;
}

/**
 * Infer an @Accessor/@Invoker target name from the accessor/invoker method
 * name: strip the get/set/is (accessor) or invoke/call (invoker) prefix and
 * lowercase the first remaining char.
 */
function inferAccessorTarget(methodName: string, isInvoker: boolean): string {
  // Strip the accessor/invoker name prefix by plain string matching (no regex):
  // get/set/is for accessors, invoke/call for invokers — first matching prefix wins.
  const prefixes = isInvoker ? ['invoke', 'call'] : ['get', 'set', 'is'];
  for (const prefix of prefixes) {
    if (methodName.startsWith(prefix)) {
      const rest = methodName.slice(prefix.length);
      return rest ? `${rest.charAt(0).toLowerCase()}${rest.slice(1)}` : methodName;
    }
  }
  return methodName;
}

/**
 * Serialize a structured annotation value back to a readable source-ish form,
 * used to populate `MixinInjection.rawAnnotation` for diagnostics. Best-effort:
 * the structured model is authoritative, this string is just for human display.
 */
function serializeAnnotationValue(v: AnnotationValue): string {
  switch (v.kind) {
    case 'string':
      return `"${v.value}"`;
    case 'class':
      return `${v.value}.class`;
    case 'boolean':
    case 'number':
      return String(v.value);
    case 'array':
      return `{${v.value.map(serializeAnnotationValue).join(', ')}}`;
    case 'annotation':
      return reconstructAnnotation(annotationSimpleName(v.value.name), v.value);
  }
}

/** Reconstruct a readable `@Name(...)` form from a parsed annotation. */
function reconstructAnnotation(
  simpleName: string,
  parsed: StructuredAnnotation | undefined,
): string {
  if (!parsed) return `@${simpleName}`;
  const parts: string[] = [];
  if (parsed.elementValue) parts.push(serializeAnnotationValue(parsed.elementValue));
  for (const [k, val] of Object.entries(parsed.elementValuePairs)) {
    parts.push(`${k} = ${serializeAnnotationValue(val)}`);
  }
  return parts.length > 0 ? `@${simpleName}(${parts.join(', ')})` : `@${simpleName}`;
}

/**
 * Mixin Analysis Service
 */
export class MixinService {
  /**
   * Parse a single mixin Java source file via the tree-sitter AST.
   *
   * Replaces the legacy line-scanning regex pipeline. The source is parsed once
   * into `JavaSymbol[]`; the first class carrying an `@Mixin` annotation drives
   * target/priority extraction (from the structured annotation model), and this
   * mixin's direct + nested-class members feed the injection/shadow/accessor
   * parsers. Returns `null` when no `@Mixin` class (with resolvable targets) is
   * found.
   */
  parseMixinSource(source: string, sourcePath?: string): MixinClass | null {
    const symbols = extractJavaSymbols(source);

    // Find the first @Mixin class.
    let mixinClass: JavaSymbol | undefined;
    let mixinAnno: JavaAnnotation | undefined;
    for (const s of symbols) {
      if (s.entryType !== 'class') continue;
      const anno = s.annotations?.find((a) => annotationSimpleName(a.descriptor) === 'Mixin');
      if (anno) {
        mixinClass = s;
        mixinAnno = anno;
        break;
      }
    }

    if (!mixinClass || !mixinAnno?.parsed) {
      return null; // Not a mixin file
    }

    const parsed = mixinAnno.parsed;
    const targets = collectClassTargets(parsed);
    if (targets.length === 0) {
      return null; // @Mixin with no resolvable target classes
    }

    const priority =
      parsed.elementValuePairs.priority?.kind === 'number'
        ? parsed.elementValuePairs.priority.value
        : 1000; // Default priority

    // Fully-qualified mixin class name (replaces the old package + class regex).
    const mixinClassName = mixinClass.declaringClass;

    // Collect this mixin's members: direct members plus members of nested mixin
    // classes (whose declaringClass is `mixinClassName.<Nested>`).
    const members = symbols.filter(
      (s) =>
        s.declaringClass === mixinClassName || s.declaringClass.startsWith(`${mixinClassName}.`),
    );

    // Parse injections
    const injections = this.parseInjections(members);

    // Parse shadows
    const shadows = this.parseShadows(members);

    // Parse accessors
    const accessors = this.parseAccessors(members);

    return {
      className: mixinClassName,
      targets,
      priority,
      injections,
      shadows,
      accessors,
      sourcePath,
    };
  }

  /**
   * Parse @Inject, @Redirect, @ModifyArg, etc. annotations from the mixin's
   * method members via the structured annotation model. Each injection is read
   * from its annotation's typed arguments (method, at, cancellable) — no regex,
   * no paren/brace counting.
   */
  private parseInjections(members: JavaSymbol[]): MixinInjection[] {
    const injections: MixinInjection[] = [];

    const injectionTypes: Record<string, MixinInjectionType> = {
      Inject: 'inject',
      Redirect: 'redirect',
      ModifyArg: 'modify_arg',
      ModifyVariable: 'modify_variable',
      ModifyConstant: 'modify_constant',
      ModifyReturnValue: 'modify_return_value',
      WrapOperation: 'wrap_operation',
      WrapMethod: 'wrap_method',
    };

    for (const member of members) {
      if (member.entryType !== 'method') continue;
      for (const anno of member.annotations ?? []) {
        const simple = annotationSimpleName(anno.descriptor);
        const type = injectionTypes[simple];
        if (!type) continue;

        const parsed = anno.parsed;
        const pairs = parsed?.elementValuePairs ?? {};

        // method target: single string, or first string of an array (legacy
        // first-match behavior; the descriptor validator resolves one at a time).
        let targetMethod = '';
        const methodArg = pairs.method;
        if (methodArg?.kind === 'string') {
          targetMethod = methodArg.value;
        } else if (methodArg?.kind === 'array') {
          const first = methodArg.value.find((v) => v.kind === 'string');
          if (first?.kind === 'string') targetMethod = first.value;
        }

        // @At nested annotation: bare value (@At("HEAD")) or value=...
        // (@At(value="INVOKE", target="...")).
        let at: string | undefined;
        let atTarget: string | undefined;
        const atArg = pairs.at;
        if (atArg?.kind === 'annotation') {
          const nested = atArg.value;
          at = nestedAnnoStringValue(nested, 'value');
          const atTargetVal = nested.elementValuePairs.target;
          if (atTargetVal?.kind === 'string') atTarget = atTargetVal.value;
        }

        // cancellable boolean (meaningful for @Inject, harmless to read for all).
        let cancellable: boolean | undefined;
        if (pairs.cancellable?.kind === 'boolean') cancellable = pairs.cancellable.value;

        injections.push({
          type,
          methodName: member.symbol,
          targetMethod,
          at,
          atTarget,
          cancellable,
          line: member.line,
          rawAnnotation: reconstructAnnotation(simple, parsed),
        });
      }
    }

    return injections;
  }

  /**
   * Parse @Shadow annotations from the mixin's field/method members via the
   * structured annotation model. Detects both field and method shadows and
   * carries the declared type (returnType for methods, fieldType for fields) —
   * which the AST captures correctly even when the type is qualified or generic
   * (the legacy regex's `[\w<>,\[\]]+` class dropped dots, so e.g.
   * `java.util.List<String>` was silently mis-parsed).
   */
  private parseShadows(members: JavaSymbol[]): MixinShadow[] {
    const shadows: MixinShadow[] = [];

    for (const member of members) {
      const hasShadow = member.annotations?.some(
        (a) => annotationSimpleName(a.descriptor) === 'Shadow',
      );
      if (!hasShadow) continue;
      const isMethod = member.entryType === 'method';
      shadows.push({
        name: member.symbol,
        type: isMethod ? (member.returnType ?? '') : (member.fieldType ?? ''),
        isMethod,
        line: member.line,
      });
    }

    return shadows;
  }

  /**
   * Parse @Accessor and @Invoker annotations from the mixin's method members
   * via the structured annotation model. An explicit bare-arg target
   * (@Accessor("size")) wins; otherwise the target is inferred from the accessor
   * method name (strip get/set/is or invoke/call, lowercase the first char).
   */
  private parseAccessors(members: JavaSymbol[]): MixinAccessor[] {
    const accessors: MixinAccessor[] = [];

    for (const member of members) {
      if (member.entryType !== 'method') continue;
      const anno = member.annotations?.find(
        (a) =>
          annotationSimpleName(a.descriptor) === 'Accessor' ||
          annotationSimpleName(a.descriptor) === 'Invoker',
      );
      if (!anno) continue;
      const simple = annotationSimpleName(anno.descriptor);
      const isInvoker = simple === 'Invoker';

      // Explicit target from the bare single-arg shorthand: @Accessor("size").
      let target = '';
      const ev = anno.parsed?.elementValue;
      if (ev?.kind === 'string') target = ev.value;

      // Infer from the accessor method name when no explicit target is given.
      if (!target) {
        target = inferAccessorTarget(member.symbol, isInvoker);
      }

      accessors.push({
        name: member.symbol,
        target,
        isInvoker,
        line: member.line,
      });
    }

    return accessors;
  }

  /**
   * Parse all mixins from a mod JAR file
   */
  async parseMixinsFromJar(jarPath: string): Promise<MixinClass[]> {
    if (!existsSync(jarPath)) {
      throw new MixinParseError(jarPath, `JAR file not found: ${jarPath}`);
    }

    const mixins: MixinClass[] = [];
    const zip = new AdmZip(jarPath);
    const entries = zip.getEntries();

    // Look for fabric.mod.json to find mixin configs (for future use)
    const fabricModJson = entries.find((e) => e.entryName === 'fabric.mod.json');
    if (fabricModJson) {
      try {
        const content = JSON.parse(fabricModJson.getData().toString('utf8'));
        if (content.mixins) {
          // Mixin configs found - could be used for targeted parsing
          logger.debug(`Found mixin configs in fabric.mod.json: ${JSON.stringify(content.mixins)}`);
        }
      } catch {
        logger.warn('Failed to parse fabric.mod.json');
      }
    }

    // Parse all Java files looking for @Mixin
    for (const entry of entries) {
      if (entry.entryName.endsWith('.java')) {
        try {
          const source = entry.getData().toString('utf8');
          const mixin = this.parseMixinSource(source, entry.entryName);
          if (mixin) {
            mixins.push(mixin);
          }
        } catch (error) {
          logger.warn(`Failed to parse mixin from ${entry.entryName}:`, error);
        }
      }
    }

    return mixins;
  }

  /**
   * Parse mixins from a directory of source files
   */
  parseMixinsFromDirectory(dirPath: string): MixinClass[] {
    if (!existsSync(dirPath)) {
      throw new MixinParseError(dirPath, `Directory not found: ${dirPath}`);
    }

    const mixins: MixinClass[] = [];

    const walkDir = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.java')) {
          try {
            const source = readFileSync(fullPath, 'utf8');
            const mixin = this.parseMixinSource(source, relative(dirPath, fullPath));
            if (mixin) {
              mixins.push(mixin);
            }
          } catch (error) {
            logger.warn(`Failed to parse ${fullPath}:`, error);
          }
        }
      }
    };

    walkDir(dirPath);
    return mixins;
  }

  /**
   * Validate a mixin against Minecraft source code
   */
  async validateMixin(
    mixin: MixinClass,
    mcVersion: string,
    mapping: MappingType = 'yarn',
  ): Promise<MixinValidationResult> {
    const errors: MixinValidationError[] = [];
    const warnings: MixinValidationWarning[] = [];
    const suggestions: MixinSuggestion[] = [];

    const cacheManager = getCacheManager();
    const decompileService = getDecompileService();

    // Check if decompiled source exists
    const hasDecompiled = cacheManager.hasDecompiledSource(mcVersion, mapping);
    if (!hasDecompiled) {
      // Try to decompile if not available
      try {
        await decompileService.decompileVersion(mcVersion, mapping);
      } catch (error) {
        errors.push({
          type: 'target_not_found',
          message: `Cannot validate: Minecraft ${mcVersion} source not available. Run decompile_minecraft_version first.`,
        });
        return { mixin, isValid: false, errors, warnings, suggestions };
      }
    }

    const decompiledPath = getDecompiledPath(mcVersion, mapping);

    // Validate target classes exist
    for (const target of mixin.targets) {
      const targetPath = this.classNameToPath(target, decompiledPath);

      if (!existsSync(targetPath)) {
        errors.push({
          type: 'target_not_found',
          message: `Target class not found: ${target}`,
        });

        // Suggest similar class names
        const similarClasses = this.findSimilarClasses(target, decompiledPath);
        if (similarClasses.length > 0) {
          suggestions.push({
            type: 'fix_target',
            message: `Did you mean one of these classes? ${similarClasses.slice(0, 3).join(', ')}`,
          });
        }
      } else {
        // Target exists — parse its source ONCE into AST symbols and validate
        // every injection/shadow/accessor against those declared symbols.
        const targetSource = readFileSync(targetPath, 'utf8');
        const symbols = extractJavaSymbols(targetSource);

        // Validate each injection
        for (const injection of mixin.injections) {
          const validationResult = validateInjectionAgainstSymbols(injection, symbols, target);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          suggestions.push(...validationResult.suggestions);
        }

        // Validate shadows
        for (const shadow of mixin.shadows) {
          const validationResult = validateShadowAgainstSymbols(shadow, symbols, target);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          suggestions.push(...validationResult.suggestions);
        }

        // Validate accessors
        for (const accessor of mixin.accessors) {
          const validationResult = validateAccessorAgainstSymbols(accessor, symbols, target);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          suggestions.push(...validationResult.suggestions);
        }
      }
    }

    // Add general warnings
    if (mixin.priority !== 1000) {
      warnings.push({
        type: 'compatibility',
        message: `Non-default priority (${mixin.priority}) may cause conflicts with other mods`,
      });
    }

    // Check for fragile injections
    for (const injection of mixin.injections) {
      if (injection.at === 'INVOKE' && !injection.atTarget) {
        warnings.push({
          type: 'fragile_injection',
          message: '@Inject at INVOKE without specific target is fragile',
          element: injection,
          line: injection.line,
        });
      }
    }

    return {
      mixin,
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Convert class name to file path
   */
  private classNameToPath(className: string, basePath: string): string {
    // Handle simple class names (need to search)
    if (!className.includes('.')) {
      // Search for the class
      const found = this.findClassFile(className, basePath);
      if (found) return found;
    }

    // Convert fully qualified name to path
    const relativePath = `${className.replace(/\./g, '/')}.java`;
    return join(basePath, relativePath);
  }

  /**
   * Find a class file by simple name
   */
  private findClassFile(simpleName: string, basePath: string): string | null {
    const fileName = `${simpleName}.java`;

    const search = (dir: string): string | null => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = search(fullPath);
            if (found) return found;
          } else if (entry.name === fileName) {
            return fullPath;
          }
        }
      } catch (err) {
        logger.debug(
          `findClassFile: error reading directory: ${err instanceof Error ? err.message : err}`,
        );
      }
      return null;
    };

    return search(basePath);
  }

  /**
   * Find similar class names
   */
  private findSimilarClasses(className: string, basePath: string, limit = 5): string[] {
    const simpleName = className.includes('.')
      ? (className.split('.').pop() ?? className)
      : className;
    const similar: string[] = [];

    const search = (dir: string, prefix: string) => {
      if (similar.length >= limit * 2) return;

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (similar.length >= limit * 2) break;

          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            search(fullPath, prefix ? `${prefix}.${entry.name}` : entry.name);
          } else if (entry.name.endsWith('.java')) {
            const name = entry.name.replace('.java', '');
            if (isSimilar(simpleName, name)) {
              similar.push(prefix ? `${prefix}.${name}` : name);
            }
          }
        }
      } catch (err) {
        logger.debug(
          `findSimilarClasses: error walking directory: ${err instanceof Error ? err.message : err}`,
        );
      }
    };

    search(basePath, '');
    return similar.slice(0, limit);
  }

  /**
   * Get suggestions for fixing mixin issues
   */
  async getSuggestionsForMixin(
    mixin: MixinClass,
    mcVersion: string,
    mapping: MappingType = 'yarn',
  ): Promise<MixinSuggestion[]> {
    const validation = await this.validateMixin(mixin, mcVersion, mapping);
    return validation.suggestions;
  }

  /**
   * Analyze all mixins in a mod and provide a summary
   */
  async analyzeModMixins(
    jarPath: string,
    mcVersion: string,
    mapping: MappingType = 'yarn',
  ): Promise<{
    totalMixins: number;
    validMixins: number;
    invalidMixins: number;
    results: MixinValidationResult[];
  }> {
    const mixins = await this.parseMixinsFromJar(jarPath);

    const results: MixinValidationResult[] = [];
    for (const mixin of mixins) {
      const result = await this.validateMixin(mixin, mcVersion, mapping);
      results.push(result);
    }

    return {
      totalMixins: mixins.length,
      validMixins: results.filter((r) => r.isValid).length,
      invalidMixins: results.filter((r) => !r.isValid).length,
      results,
    };
  }
}

// Singleton instance
let mixinServiceInstance: MixinService | undefined;

export function getMixinService(): MixinService {
  if (!mixinServiceInstance) {
    mixinServiceInstance = new MixinService();
  }
  return mixinServiceInstance;
}
