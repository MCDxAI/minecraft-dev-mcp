/**
 * Access Transformer Service
 *
 * Parses and validates Forge/NeoForge Access Transformer (AT) files. ATs are the
 * Forge/NeoForge counterpart to Fabric's Access Widener: they widen (or narrow)
 * the visibility of classes, methods, and fields at build+load time.
 *
 * The grammar is DISTINCT from the Access Widener (see
 * `docs/specs/access-transformer-support.md`): raw JVM visibility keywords
 * (`public`/`protected`/`default`/`private`) optionally suffixed with `-f`/`+f`,
 * an *implicit* member kind inferred from the token shape (no
 * `class`/`method`/`field` keyword), a method descriptor attached to the name
 * with no spaces, and first-class final control.
 *
 * Validation is tree-sitter based: decompiled Java source is parsed once into an
 * AST (via `extractJavaSymbols`) and entries are correlated against the declared
 * symbols. There is NO regex Java-source inspection — the only string-pattern
 * operations are AT-file-format parsing (`parseEntry`), class-name/path
 * conversion, and JVM descriptor decode (shared via `descriptor-utils`). This is
 * required by the spec (section 9).
 *
 * Default mapping is `'mojmap'` (NOT `'yarn'` like the AW tool): Forge/NeoForge
 * dev toolchains are mojmap-only post-1.17 (spec 6.3).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import type {
  AccessTransformerParseError as ATParseError,
  AccessTransformer,
  AccessTransformerAccess,
  AccessTransformerEntry,
  AccessTransformerModifier,
  AccessTransformerValidation,
  MappingType,
} from '../types/minecraft.js';
import {
  classNamesMatch,
  descriptorsCompatible,
  javaTypeToDescriptor,
  paramToDescriptor,
  parseParamDescriptors,
  descriptorToReadable as sharedDescriptorToReadable,
} from '../utils/descriptor-utils.js';
import { AccessTransformerParseError } from '../utils/errors.js';
import { extractJavaSymbols } from '../utils/java-symbols.js';
import type { JavaSymbol } from '../utils/java-symbols.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';
import { findSimilarClassFile, findSimilarName } from '../utils/suggestions.js';

// ---------------------------------------------------------------------------
// AT-local modifier + descriptor helpers (module-internal)
// ---------------------------------------------------------------------------
//
// `parseModifier` / `looksLikeDescriptor` / `buildMethodDescriptor` /
// `methodDescriptorMatches` / `methodDescriptorsMatch` are AT-validation-shaped.
// The generic primitives they build on — `javaTypeToDescriptor`,
// `paramToDescriptor`, `parseParamDescriptors`, `descriptorsCompatible`,
// `classNamesMatch` — live in `../utils/descriptor-utils.js` (shared with the
// AW + mixin validators). `descriptorToReadable` (descriptor decode) and the
// edit-distance suggestion helpers live in `descriptor-utils.js` /
// `suggestions.js` respectively.

/** The four raw JVM visibility keywords an AT entry may use. */
const ACCESS_KEYWORDS = new Set<string>(['public', 'protected', 'default', 'private']);

/**
 * Numeric access-level ordering used for "equal-or-wider" comparisons
 * (record canonical-constructor check, quirk 6.2).
 * private(0) < default(1) < protected(2) < public(3).
 */
const ACCESS_LEVEL: Record<AccessTransformerAccess, number> = {
  private: 0,
  default: 1,
  protected: 2,
  public: 3,
};

/**
 * Parse a leading AT modifier token into `{ access, final }`.
 *
 * Accepts the 12 legal forms: `public|protected|default|private`, each
 * optionally suffixed (no space) with `-f` (remove ACC_FINAL) or `+f`
 * (add ACC_FINAL). Returns `null` for an unknown keyword or bad suffix.
 */
function parseModifier(token: string): AccessTransformerModifier | null {
  if (token.endsWith('-f')) {
    const access = token.slice(0, -2);
    return ACCESS_KEYWORDS.has(access)
      ? { access: access as AccessTransformerAccess, final: 'remove' }
      : null;
  }
  if (token.endsWith('+f')) {
    const access = token.slice(0, -2);
    return ACCESS_KEYWORDS.has(access)
      ? { access: access as AccessTransformerAccess, final: 'add' }
      : null;
  }
  return ACCESS_KEYWORDS.has(token)
    ? { access: token as AccessTransformerAccess, final: 'none' }
    : null;
}

/** Render a parsed modifier back to its AT token form (e.g. `public-f`). */
function modifierToString(modifier: AccessTransformerModifier): string {
  const suffix = modifier.final === 'add' ? '+f' : modifier.final === 'remove' ? '-f' : '';
  return `${modifier.access}${suffix}`;
}

/** Two modifiers are "the same" when both access and final intent match. */
function sameModifier(a: AccessTransformerModifier, b: AccessTransformerModifier): boolean {
  return a.access === b.access && a.final === b.final;
}

/**
 * Two modifiers are "incompatible" (Forge fails the build —
 * "Invalid AT final conflicts") when the access levels differ OR one wants
 * `+f` while the other wants `-f`. `+f` vs none is a compatible variation.
 */
function incompatibleModifiers(
  a: AccessTransformerModifier,
  b: AccessTransformerModifier,
): boolean {
  if (a.access !== b.access) return true;
  return (a.final === 'add' && b.final === 'remove') || (a.final === 'remove' && b.final === 'add');
}

/**
 * Heuristic: does this bare token (sitting in the field position) look like a
 * JVM descriptor rather than a field name? Catches the common AW-style mistake
 * of putting a descriptor where a bare field name belongs. AT fields carry NO
 * descriptor. Flags object descriptors (`L...;`), array descriptors (`[...`),
 * and single-character primitive/void descriptors.
 */
function looksLikeDescriptor(token: string): boolean {
  if (token.startsWith('[')) return true;
  if (token.length >= 2 && token.startsWith('L') && token.endsWith(';')) return true;
  if (token.length === 1 && 'BCDFIJSZV'.includes(token)) return true;
  return false;
}

/** Build the JVM descriptor string for an AST method/constructor symbol. */
function buildMethodDescriptor(method: JavaSymbol): string {
  const params = method.parameters ?? [];
  return `(${params.map(paramToDescriptor).join('')})${javaTypeToDescriptor(method.returnType ?? 'void')}`;
}

/** Compare an AST method/constructor against a raw JVM method descriptor. */
function methodDescriptorMatches(
  method: JavaSymbol,
  descriptor: string,
): { match: boolean; reason?: string } {
  const open = descriptor.indexOf('(');
  const close = descriptor.indexOf(')');
  if (open < 0 || close < 0 || close <= open) {
    return { match: false, reason: `Malformed method descriptor: ${descriptor}` };
  }

  const descParams = parseParamDescriptors(descriptor.slice(open + 1, close));
  const descReturn = descriptor.slice(close + 1);

  const params = method.parameters ?? [];
  const astParams = params.map(paramToDescriptor);
  const astReturn = javaTypeToDescriptor(method.returnType ?? 'void');

  if (astParams.length !== descParams.length) {
    return { match: false, reason: `arity ${astParams.length} vs ${descParams.length}` };
  }
  for (let i = 0; i < astParams.length; i++) {
    if (!descriptorsCompatible(astParams[i], descParams[i])) {
      return { match: false, reason: `param ${i}: ${astParams[i]} vs ${descParams[i]}` };
    }
  }
  if (!descriptorsCompatible(astReturn, descReturn)) {
    return { match: false, reason: `return: ${astReturn} vs ${descReturn}` };
  }
  return { match: true };
}

/**
 * Compare two RAW JVM method descriptors for parameter/return compatibility
 * (simple-name based, like the AST comparison). Used by the record
 * canonical-constructor check (quirk 6.2) to match a reconstructed canonical
 * descriptor against an `<init>` directive written in the file.
 */
function methodDescriptorsMatch(a: string, b: string): boolean {
  const openA = a.indexOf('(');
  const closeA = a.indexOf(')');
  const openB = b.indexOf('(');
  const closeB = b.indexOf(')');
  if (openA < 0 || closeA < 0 || openB < 0 || closeB < 0) return a === b;

  const paramsA = parseParamDescriptors(a.slice(openA + 1, closeA));
  const paramsB = parseParamDescriptors(b.slice(openB + 1, closeB));
  const returnA = a.slice(closeA + 1);
  const returnB = b.slice(closeB + 1);

  if (paramsA.length !== paramsB.length) return false;
  for (let i = 0; i < paramsA.length; i++) {
    if (!descriptorsCompatible(paramsA[i], paramsB[i])) return false;
  }
  return descriptorsCompatible(returnA, returnB);
}

// ---------------------------------------------------------------------------
// Pure helpers: member-name correlation + overridability (module-internal)
// ---------------------------------------------------------------------------

/** Unique regular (non-constructor) method names declared by the given class symbols. */
function uniqueMethodNames(classSymbols: JavaSymbol[]): string[] {
  const set = new Set<string>();
  for (const s of classSymbols) {
    if (s.entryType === 'method' && s.isConstructor !== true && s.symbol) set.add(s.symbol);
  }
  return [...set];
}

/** Unique field names declared by the given class symbols. */
function uniqueFieldNames(classSymbols: JavaSymbol[]): string[] {
  const set = new Set<string>();
  for (const s of classSymbols) {
    if (s.entryType === 'field' && s.symbol) set.add(s.symbol);
  }
  return [...set];
}

/**
 * Is a method symbol overridable (and thus subject to the override-narrowing
 * gotcha, quirk 6.3)? Overridable = not final, not static, not private, and
 * declared in a non-final class.
 */
function isOverridable(method: JavaSymbol, classFinal: boolean): boolean {
  const mods = method.modifiers ?? [];
  if (method.isFinal === true || mods.includes('final')) return false;
  if (method.isStatic === true || mods.includes('static')) return false;
  if (mods.includes('private')) return false;
  if (classFinal) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Core validation against extracted symbols
// ---------------------------------------------------------------------------

/**
 * Validate a single access-transformer entry against the AST symbols of its
 * class. Pure: no filesystem, no I/O. This is the heart of the validator.
 *
 * `allEntries` (the full parsed file) enables the cross-entry quirk checks:
 * record canonical-constructor widening (6.2) and inner-class enclosing-class
 * accessibility (6.1). When omitted (e.g. via the `validateEntryAgainstSource`
 * test seam) those file-level checks are skipped and only per-member existence
 * and signature checks run.
 *
 * @internal
 */
export function validateEntryAgainstSymbols(
  entry: AccessTransformerEntry,
  symbols: JavaSymbol[],
  allEntries?: AccessTransformerEntry[],
): { errors: string[]; warnings: string[]; suggestion?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestion: string | undefined;

  // Symbols declared by the entry's class. `classNamesMatch` reconciles JVM
  // inner-class `$` separators with the AST's dotted declaringClass. Inner
  // classes share their enclosing class's `.java` file, so the enclosing type's
  // symbols are present in this same `symbols` array.
  const classSymbols = symbols.filter((s) => classNamesMatch(entry.className, s.declaringClass));

  // The target class must actually be declared. Named nested classes (regular,
  // record, enum) are emitted by the AST walk with dot-qualified names, which
  // `classNamesMatch` reconciles with the JVM `$` form — so a non-existent inner
  // class (e.g. `Outer$NonExistent`) resolves to no class symbol and is caught
  // here rather than silently passing. `classSym` is then reused below for the
  // record and final-modifier checks.
  const classSym = classSymbols.find((s) => s.entryType === 'class');
  if (!classSym) {
    errors.push(`Class '${entry.className}' not found`);
    return { errors, warnings, suggestion };
  }

  // --- Inner-class enclosing-class accessibility (quirk 6.1) ---
  // Runs for ANY entry whose class is nested (`$` present): reaching a nested
  // type through an inaccessible enclosing type is a Java access error. Per the
  // issue, check the IMMEDIATE enclosing class only; transitive coverage emerges
  // as each nesting level is targeted by its own directive.
  if (allEntries && entry.className.includes('$')) {
    const enclosing = entry.className.split('$').slice(0, -1).join('$');
    const enclosingSym = symbols.find(
      (s) => s.entryType === 'class' && classNamesMatch(enclosing, s.declaringClass),
    );
    const enclosingAlreadyAccessible =
      !!enclosingSym &&
      (enclosingSym.modifiers?.includes('public') === true ||
        enclosingSym.modifiers?.includes('protected') === true);
    const widenedInFile = allEntries.some(
      (e) =>
        e.memberType === 'class' &&
        classNamesMatch(e.className, enclosing) &&
        (e.modifier.access === 'public' || e.modifier.access === 'protected'),
    );
    if (!enclosingAlreadyAccessible && !widenedInFile) {
      warnings.push(
        `Inner class '${entry.className}' targets an enclosing class '${enclosing}' that is not public/protected and not widened in this file — Java requires the enclosing class to be accessible`,
      );
    }
  }

  // --- Class-level entry ---
  if (entry.memberType === 'class') {
    // Record canonical-constructor widening (quirk 6.2). Widening a record to
    // public/protected does NOT widen its canonical <init> (component accessors
    // do widen), violating record semantics and crashing at runtime. Reconstruct
    // the canonical-ctor descriptor from the record components in order and
    // require a matching <init> directive at equal-or-wider access.
    if (
      allEntries &&
      (entry.modifier.access === 'public' || entry.modifier.access === 'protected')
    ) {
      if (classSym.kind === 'record') {
        const components = classSym.recordComponents ?? [];
        const canonicalDesc = `(${components.map(paramToDescriptor).join('')})V`;
        const classLevel = ACCESS_LEVEL[entry.modifier.access];
        const hasMatchingInit = allEntries.some(
          (e) =>
            e.memberType === 'method' &&
            e.memberName === '<init>' &&
            classNamesMatch(e.className, entry.className) &&
            ACCESS_LEVEL[e.modifier.access] >= classLevel &&
            methodDescriptorsMatch(e.memberDescriptor ?? '', canonicalDesc),
        );
        if (!hasMatchingInit) {
          warnings.push(
            `Record '${entry.className}' is widened but its canonical constructor ${sharedDescriptorToReadable(
              canonicalDesc,
            )} is not widened to equal-or-wider access — the game will crash at runtime`,
          );
        }
      }
    }
    return { errors, warnings, suggestion };
  }

  // --- Method entry ---
  if (entry.memberType === 'method' && entry.memberName) {
    // Static initializers are intentionally not emitted by the AST walk. They
    // are rare and genuinely unverifiable from decompiled source.
    if (entry.memberName === '<clinit>') {
      warnings.push(
        "'<clinit>' (static initializer) cannot be validated from decompiled source — verify manually",
      );
      return { errors, warnings, suggestion };
    }

    if (entry.wildcard) {
      warnings.push(
        "Wildcard '*()' targets all members — discouraged and may be removed from the AT spec",
      );
      return { errors, warnings, suggestion };
    }

    const isCtor = entry.memberName === '<init>';
    // Only DECLARED members are seen here — call sites and comments are not, so
    // a method that is merely called (but not declared) is correctly reported
    // as missing.
    const methodSyms = classSymbols.filter((s) =>
      isCtor
        ? s.entryType === 'method' && s.isConstructor === true
        : s.entryType === 'method' && s.isConstructor !== true && s.symbol === entry.memberName,
    );

    if (methodSyms.length === 0) {
      errors.push(`Method '${entry.memberName}' not found in ${entry.className}`);
      const similar = findSimilarName(entry.memberName, uniqueMethodNames(classSymbols));
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    // Validate the JVM descriptor against the actual signature. The issue
    // explicitly asks to "check the signature" — stricter than the name-only AW
    // field check.
    if (entry.memberDescriptor) {
      const descriptor = entry.memberDescriptor;
      const matched = methodSyms.filter((m) => methodDescriptorMatches(m, descriptor).match);
      if (matched.length === 0) {
        const found = methodSyms.map((m) => buildMethodDescriptor(m)).join(', ');
        errors.push(
          `Method '${entry.memberName}' exists but no overload matches descriptor ${descriptor} (found: ${found})`,
        );
        return { errors, warnings, suggestion };
      }

      // Override-narrowing warning (quirk 6.3): an AT only transforms the exact
      // targeted method; subclass overrides are untouched, risking JVM
      // link/verify errors if an override narrows visibility. Warn when the
      // targeted overload is overridable.
      const classFinal =
        classSym.isFinal === true || classSym.modifiers?.includes('final') === true;
      if (matched.some((m) => isOverridable(m, classFinal))) {
        warnings.push(
          `Method '${entry.memberName}' is overridable — subclass overrides are not transformed by this AT and may cause JVM link/verify errors`,
        );
      }
    }
    return { errors, warnings, suggestion };
  }

  // --- Field entry ---
  if (entry.memberType === 'field' && entry.memberName) {
    if (entry.wildcard) {
      warnings.push(
        "Wildcard '*' targets all members — discouraged and may be removed from the AT spec",
      );
      return { errors, warnings, suggestion };
    }

    const fieldSyms = classSymbols.filter(
      (s) => s.entryType === 'field' && s.symbol === entry.memberName,
    );

    if (fieldSyms.length === 0) {
      errors.push(`Field '${entry.memberName}' not found in ${entry.className}`);
      const similar = findSimilarName(entry.memberName, uniqueFieldNames(classSymbols));
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    // AT fields carry NO descriptor — name existence is the only check.
    return { errors, warnings, suggestion };
  }

  return { errors, warnings, suggestion };
}

/**
 * Validate a single access-transformer entry against a synthetic Java source
 * string. Test seam for the existence/signature logic — it lets unit tests
 * exercise validation without a decompiled Minecraft source tree. Production
 * validation reads the class file, extracts symbols once (cached), and delegates
 * to `validateEntryAgainstSymbols` (passing the full entry list so the
 * cross-entry quirk checks also run).
 *
 * @internal
 */
export function validateEntryAgainstSource(
  entry: AccessTransformerEntry,
  source: string,
): { errors: string[]; warnings: string[]; suggestion?: string } {
  return validateEntryAgainstSymbols(entry, extractJavaSymbols(source));
}

/**
 * Detect duplicate and conflicting targets across a whole AT file. Pure: no
 * filesystem, no I/O. Exported so the conflict logic is unit-testable without
 * a decompiled Minecraft source tree (`validateAccessTransformer` only reaches
 * this after the decompiled-source check passes).
 *
 * Targets are grouped by `memberType:className:memberName:memberDescriptor`.
 * Within a group: exact-duplicate modifiers are redundant (warning); a later
 * entry whose modifier is incompatible with an earlier one is a hard conflict
 * (Forge fails the build with "Invalid AT final conflicts" — error). A
 * compatible variation (same access, `+f` vs none) emits nothing.
 *
 * @internal
 */
export function detectAccessTransformerConflicts(entries: AccessTransformerEntry[]): {
  errors: Array<{ entry: AccessTransformerEntry; message: string }>;
  warnings: Array<{ entry: AccessTransformerEntry; message: string }>;
} {
  const errors: Array<{ entry: AccessTransformerEntry; message: string }> = [];
  const warnings: Array<{ entry: AccessTransformerEntry; message: string }> = [];

  const groups = new Map<string, AccessTransformerEntry[]>();
  for (const e of entries) {
    const key = `${e.memberType}:${e.className}:${e.memberName ?? ''}:${e.memberDescriptor ?? ''}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // Compare each entry against ALL preceding entries in the group, not just
    // the first. Comparing only against group[0] silently drops conflicts
    // between later entries — e.g. [public, public+f, public-f] hides the
    // +f/-f conflict because both are compatible variations of `public`.
    for (let i = 0; i < group.length; i++) {
      const curr = group[i];
      if (!curr) continue;
      let isDuplicate = false;
      let conflictWith: AccessTransformerEntry | null = null;
      for (let j = 0; j < i; j++) {
        const prev = group[j];
        if (!prev) continue;
        if (sameModifier(prev.modifier, curr.modifier)) {
          isDuplicate = true;
          break;
        }
        if (incompatibleModifiers(prev.modifier, curr.modifier)) {
          conflictWith = prev;
          break;
        }
        // else: compatible variation (e.g. same access, +f vs none) — keep looking.
      }
      if (isDuplicate) {
        warnings.push({ entry: curr, message: `Duplicate access transformer entry for ${key}` });
      } else if (conflictWith) {
        errors.push({
          entry: curr,
          message: `Conflicting access transformer for ${key}: '${modifierToString(
            conflictWith.modifier,
          )}' vs '${modifierToString(curr.modifier)}'`,
        });
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Access Transformer Service
 */
export class AccessTransformerService {
  /**
   * Parse an access transformer file.
   *
   * AT files have NO header (unlike access wideners). `#` starts a comment to
   * end-of-line (inline comments after an entry are allowed); blank lines are
   * ignored. Each remaining line is whitespace-split into exactly 2 or 3 tokens.
   * Lines that cannot be parsed are collected into `parseErrors` (not thrown):
   * the parser never aborts the whole file on a single bad line.
   */
  parseAccessTransformer(content: string, sourcePath?: string): AccessTransformer {
    const entries: AccessTransformerEntry[] = [];
    const parseErrors: ATParseError[] = [];
    const lines = content.split('\n');

    const addParseError = (line: number, message: string, raw: string): void => {
      parseErrors.push({ line, message, raw });
      logger.warn(`Access transformer parse error (line ${line}): ${message}`);
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const lineNum = i + 1;

      // Strip `#` comments to end-of-line (inline comments allowed after an
      // entry). AT class/member names and descriptors never contain `#`, so the
      // first `#` reliably starts a comment.
      const hashIdx = rawLine.indexOf('#');
      const decommented = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
      if (!decommented) continue; // blank or comment-only line

      const tokens = decommented.split(/\s+/);

      // Accept exactly 2 or 3 tokens.
      if (tokens.length < 2 || tokens.length > 3) {
        const reason =
          tokens.length > 3
            ? `too many tokens (${tokens.length}) — a JVM method descriptor must be attached to the name with no spaces`
            : `expected 2 or 3 tokens, got ${tokens.length}`;
        addParseError(lineNum, reason, decommented);
        continue;
      }

      const modifier = parseModifier(tokens[0]);
      if (!modifier) {
        addParseError(
          lineNum,
          `Unknown modifier '${tokens[0]}' (expected public/protected/default/private, optionally suffixed with -f or +f)`,
          decommented,
        );
        continue;
      }

      // Reject a final suffix split across tokens (e.g. "public -f"). Only fires
      // when the modifier was parsed as a bare keyword (no suffix) yet the next
      // token is a bare `-f`/`+f`.
      if (modifier.final === 'none' && (tokens[1] === '-f' || tokens[1] === '+f')) {
        addParseError(
          lineNum,
          `Final suffix '${tokens[1]}' must be attached to the modifier with no space (e.g. '${tokens[0]}${tokens[1]}')`,
          decommented,
        );
        continue;
      }

      // CLASS — slash separators normalized to dots; inner classes via `$`.
      const className = tokens[1].replace(/\//g, '.');

      // 2 tokens → class entry (member type inferred from token shape).
      if (tokens.length === 2) {
        entries.push({ modifier, memberType: 'class', className, line: lineNum });
        continue;
      }

      // 3 tokens → method if the 3rd token contains '(', otherwise field.
      const memberToken = tokens[2];
      if (memberToken.includes('(')) {
        if (memberToken === '*()') {
          entries.push({
            modifier,
            memberType: 'method',
            className,
            memberName: '*',
            memberDescriptor: '()',
            wildcard: true,
            line: lineNum,
          });
          continue;
        }
        const parenIdx = memberToken.indexOf('(');
        const memberName = memberToken.slice(0, parenIdx);
        const memberDescriptor = memberToken.slice(parenIdx);
        if (!memberName) {
          addParseError(lineNum, "Method entry is missing a name before '('", decommented);
          continue;
        }
        // Return descriptor is mandatory (even V). Missing ')' or nothing after
        // ')' both mean the return descriptor is absent.
        const closeIdx = memberDescriptor.indexOf(')');
        if (closeIdx < 0 || closeIdx === memberDescriptor.length - 1) {
          addParseError(
            lineNum,
            `Method '${memberName}' is missing a return descriptor (a return type is mandatory, even V)`,
            decommented,
          );
          continue;
        }
        entries.push({
          modifier,
          memberType: 'method',
          className,
          memberName,
          memberDescriptor,
          line: lineNum,
        });
      } else {
        // Field — bare name, NO descriptor.
        if (memberToken === '*') {
          entries.push({
            modifier,
            memberType: 'field',
            className,
            memberName: '*',
            wildcard: true,
            line: lineNum,
          });
          continue;
        }
        if (looksLikeDescriptor(memberToken)) {
          addParseError(
            lineNum,
            `Field entry '${memberToken}' looks like a JVM descriptor — AT fields use a bare name with no descriptor`,
            decommented,
          );
          continue;
        }
        entries.push({
          modifier,
          memberType: 'field',
          className,
          memberName: memberToken,
          line: lineNum,
        });
      }
    }

    return { entries, parseErrors, sourcePath };
  }

  /**
   * Parse an access transformer from a file path. Throws
   * `AccessTransformerParseError` if the file is missing.
   */
  parseAccessTransformerFile(filePath: string): AccessTransformer {
    if (!existsSync(filePath)) {
      throw new AccessTransformerParseError(filePath, undefined, `File not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf8');
    return this.parseAccessTransformer(content, filePath);
  }

  /**
   * Validate an access transformer against decompiled Minecraft source.
   *
   * Default mapping is `'mojmap'` (Forge/NeoForge dev toolchains are
   * mojmap-only post-1.17). Mirrors the access-widener flow: short-circuit when
   * the source tree is absent, cache extracted symbols per class file, and
   * delegate the pure per-entry validation to `validateEntryAgainstSymbols`.
   * Cross-entry quirk checks (record ctor, inner-class accessibility) and
   * duplicate/conflict detection run after the per-entry pass.
   */
  async validateAccessTransformer(
    accessTransformer: AccessTransformer,
    mcVersion: string,
    mapping: MappingType = 'mojmap',
  ): Promise<AccessTransformerValidation> {
    const errors: AccessTransformerValidation['errors'] = [];
    const warnings: AccessTransformerValidation['warnings'] = [];

    const cacheManager = getCacheManager();

    // Synthetic entry used when the file has no entries to attach a message to.
    const syntheticEntry: AccessTransformerEntry = {
      modifier: { access: 'public', final: 'none' },
      memberType: 'class',
      className: '',
      line: 0,
    };

    // Check if decompiled source exists.
    if (!cacheManager.hasDecompiledSource(mcVersion, mapping)) {
      errors.push({
        entry: accessTransformer.entries[0] ?? syntheticEntry,
        message: `Minecraft ${mcVersion} source not decompiled. Run decompile_minecraft_version first.`,
      });
      return { isValid: false, errors, warnings };
    }

    const decompiledPath = getDecompiledPath(mcVersion, mapping);

    // Cache extracted symbols per source file for the duration of this call.
    // Multiple entries targeting the same class parse the file only once.
    const symbolsCache = new Map<string, JavaSymbol[]>();

    // Validate each entry.
    for (const entry of accessTransformer.entries) {
      const validation = this.validateEntry(
        entry,
        decompiledPath,
        symbolsCache,
        accessTransformer.entries,
      );
      errors.push(
        ...validation.errors.map((message) => ({
          entry,
          message,
          suggestion: validation.suggestion,
        })),
      );
      warnings.push(...validation.warnings.map((message) => ({ entry, message })));
    }

    // Duplicate / conflicting target detection (must-do #5).
    this.detectConflicts(accessTransformer.entries, errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single entry against the decompiled source tree.
   *
   * Reads the class file once (symbols cached per path within a single
   * `validateAccessTransformer` call) and delegates the pure symbol-based
   * validation to `validateEntryAgainstSymbols`, passing the full entry list so
   * the cross-entry quirk checks run.
   */
  private validateEntry(
    entry: AccessTransformerEntry,
    decompiledPath: string,
    symbolsCache: Map<string, JavaSymbol[]>,
    allEntries: AccessTransformerEntry[],
  ): { errors: string[]; warnings: string[]; suggestion?: string } {
    // JVM inner classes nest with `$`; the source lives in the outer class's
    // .java file, so resolve the file path from the top-level class segment.
    const outerClassName = entry.className.split('$')[0];
    const classPath = join(decompiledPath, `${outerClassName.replace(/\./g, '/')}.java`);

    if (!existsSync(classPath)) {
      const errors = [`Class not found: ${entry.className}`];
      let suggestion: string | undefined;
      const similar = findSimilarClassFile(outerClassName, decompiledPath);
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings: [], suggestion };
    }

    let symbols = symbolsCache.get(classPath);
    if (!symbols) {
      const source = readFileSync(classPath, 'utf8');
      symbols = extractJavaSymbols(source);
      symbolsCache.set(classPath, symbols);
    }

    return validateEntryAgainstSymbols(entry, symbols, allEntries);
  }

  /**
   * Detect duplicate and conflicting targets across the whole file. Delegates
   * to the pure `detectAccessTransformerConflicts` helper so the logic is
   * unit-testable without a decompiled source tree.
   */
  private detectConflicts(
    entries: AccessTransformerEntry[],
    errors: AccessTransformerValidation['errors'],
    warnings: AccessTransformerValidation['warnings'],
  ): void {
    const result = detectAccessTransformerConflicts(entries);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  /**
   * Convert a descriptor to human-readable format.
   *
   * Thin delegate over the shared `descriptorToReadable` in
   * `descriptor-utils.ts` — kept on the service for API parity with the
   * access-widener service. The decode logic lives in one place.
   */
  descriptorToReadable(descriptor: string): string {
    return sharedDescriptorToReadable(descriptor);
  }
}

// Singleton instance
let accessTransformerServiceInstance: AccessTransformerService | undefined;

export function getAccessTransformerService(): AccessTransformerService {
  if (!accessTransformerServiceInstance) {
    accessTransformerServiceInstance = new AccessTransformerService();
  }
  return accessTransformerServiceInstance;
}
