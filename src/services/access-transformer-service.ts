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
 * Default mapping is `'mojmap'` (NOT `'yarn'` like the AW tool): Forge/NeoForge
 * dev toolchains are mojmap-only post-1.17 (spec 6.3).
 *
 * GROUND TRUTH IS BYTECODE, NOT DECOMPILED SOURCE. Validation runs against the
 * remapped Minecraft JAR via the ASM bytecode-dumper (see
 * `bytecode-index-service.ts`), NOT VineFlower `.java`. Decompiled source omits
 * compiler-generated members — a record's canonical constructor and its
 * component accessors (`value()`, `name()`, …) — so a source-based check reports
 * them as "not found" even though they exist in the class file the AT is
 * actually applied to. Bytecode has every member with its true access flags and
 * erased descriptors — the same facts `javap` shows — which eliminates that
 * whole class of false positives (issue #12).
 */

import { existsSync, readFileSync } from 'node:fs';
import { getCacheManager } from '../cache/cache-manager.js';
import type { BytecodeClass, BytecodeMethod } from '../java/bytecode-dumper.js';
import type {
  AccessTransformerParseError as ATParseError,
  AccessTransformer,
  AccessTransformerAccess,
  AccessTransformerEntry,
  AccessTransformerModifier,
  AccessTransformerValidation,
  MappingType,
} from '../types/minecraft.js';
import { descriptorToReadable as sharedDescriptorToReadable } from '../utils/descriptor-utils.js';
import { AccessTransformerParseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { findSimilarName } from '../utils/suggestions.js';
import { getBytecodeIndexService } from './bytecode-index-service.js';

/** A map of internal class name (slashes, `$`) → its authoritative bytecode metadata. */
export type ClassBytecodeMap = Map<string, BytecodeClass>;

// ---------------------------------------------------------------------------
// AT-local modifier + parsing helpers (module-internal)
// ---------------------------------------------------------------------------
//
// `parseModifier` / `looksLikeDescriptor` handle AT-file-format parsing.
// Member correlation is done directly against bytecode descriptors (erased,
// fully-qualified JVM form), so it is exact string comparison — no AST symbol
// reconstruction or simple-name fuzzy matching is needed. `descriptorToReadable`
// (descriptor decode) and the edit-distance suggestion helper live in
// `descriptor-utils.js` / `suggestions.js` respectively.

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
 * Render a parsed entry back to its one-line AT directive text (the same shape
 * the user wrote it as, e.g. `public net.mc.Foo value()Ljava/lang/String;`).
 * Used to keep tool output compact — a finding shows this string instead of the
 * full nested entry object.
 */
export function accessTransformerEntryToString(entry: AccessTransformerEntry): string {
  const mod = modifierToString(entry.modifier);
  if (entry.memberType === 'class' || !entry.memberName) {
    return `${mod} ${entry.className}`;
  }
  const member =
    entry.memberType === 'method'
      ? `${entry.memberName}${entry.memberDescriptor ?? ''}`
      : entry.memberName;
  return `${mod} ${entry.className} ${member}`;
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

/** Convert an AT dotted+`$` class name to an internal JVM name (slashes). */
function toInternalName(className: string): string {
  return className.replace(/\./g, '/');
}

/** Map a decoded JVM access-flag list to the AT visibility keyword. */
function accessFromFlags(flags: string[]): AccessTransformerAccess {
  if (flags.includes('public')) return 'public';
  if (flags.includes('protected')) return 'protected';
  if (flags.includes('private')) return 'private';
  return 'default';
}

/**
 * The effective visibility of a class. For a top-level class the class-file
 * access bits are authoritative; for a nested class the real visibility
 * (public/protected/private/package) lives in the enclosing `InnerClasses`
 * attribute — a class file records an `InnerClasses` entry for itself, so we
 * read the flags of the entry whose `name` equals the class's own name.
 */
function classVisibility(cls: BytecodeClass): AccessTransformerAccess {
  if (cls.name.includes('$')) {
    const self = cls.innerClasses.find((ic) => ic.name === cls.name);
    if (self) return accessFromFlags(self.flags);
  }
  return accessFromFlags(cls.flags);
}

/** Simple (last-segment) name of an internal class name, for suggestions. */
function simpleClassName(internal: string): string {
  const slash = internal.lastIndexOf('/');
  const tail = slash >= 0 ? internal.slice(slash + 1) : internal;
  const dollar = tail.lastIndexOf('$');
  return dollar >= 0 ? tail.slice(dollar + 1) : tail;
}

/** Package (path portion) of an internal class name, or '' for the default package. */
function packageOf(internal: string): string {
  const slash = internal.lastIndexOf('/');
  return slash >= 0 ? internal.slice(0, slash) : '';
}

/**
 * Pick the best "did you mean" class name for a missing target. Draws from
 * `pool` (JAR-wide internal names) restricted to the SAME package as the target,
 * so suggestions stay relevant and bounded — a typo'd package yields nothing
 * rather than a misleading match three packages away.
 */
function suggestClassName(targetInternal: string, pool: string[]): string | null {
  const pkg = packageOf(targetInternal);
  const samePackage = pool.filter((n) => packageOf(n) === pkg).map(simpleClassName);
  return findSimilarName(simpleClassName(targetInternal), samePackage);
}

/**
 * Is a method overridable (subject to the override-narrowing gotcha, quirk 6.3)?
 * Constructors and static initializers are NOT overridable — a constructor is
 * never inherited, so an AT on `<init>` can never be defeated by a subclass
 * override (the previous source-based check wrongly flagged constructors).
 * Overridable = instance method, not final/static/private, in a non-final class.
 */
function isMethodOverridable(method: BytecodeMethod, cls: BytecodeClass): boolean {
  if (method.name === '<init>' || method.name === '<clinit>') return false;
  if (
    method.flags.includes('final') ||
    method.flags.includes('static') ||
    method.flags.includes('private')
  ) {
    return false;
  }
  return !cls.isFinal;
}

// ---------------------------------------------------------------------------
// Core validation against authoritative bytecode
// ---------------------------------------------------------------------------

/**
 * Validate a single access-transformer entry against the bytecode metadata of
 * its class (and, for the cross-entry quirks, the whole file's classes). Pure:
 * no filesystem, no I/O.
 *
 * `classMap` is keyed by internal class name (slashes, `$`) and must already
 * contain the entry's class and — for nested targets — its enclosing classes.
 * Because bytecode carries every compiler-generated member (record canonical
 * constructors, component accessors) with true access flags and erased
 * descriptors, member existence is an exact lookup and descriptor matching is
 * exact string comparison — no source omissions to work around.
 *
 * `allEntries` (the full parsed file) enables the cross-entry quirk checks:
 * record canonical-constructor widening (6.2) and inner-class enclosing-class
 * accessibility (6.1). When omitted, those file-level checks are skipped.
 *
 * @internal
 */
export function validateEntryAgainstBytecode(
  entry: AccessTransformerEntry,
  classMap: ClassBytecodeMap,
  allEntries?: AccessTransformerEntry[],
  classSuggestionPool?: string[],
): { errors: string[]; warnings: string[]; suggestion?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestion: string | undefined;

  const internal = toInternalName(entry.className);
  const cls = classMap.get(internal);

  // The target class must exist in the JAR. Nested classes are separate class
  // files, so `Outer$NonExistent` simply has no entry and is caught here.
  if (!cls) {
    errors.push(`Class '${entry.className}' not found`);
    // Suggest from the JAR-wide class list (same package) when the caller
    // supplies it; fall back to the loaded classMap for pure/unit callers.
    const pool = classSuggestionPool ?? [...classMap.keys()];
    const similar = suggestClassName(internal, pool);
    if (similar) suggestion = `Did you mean a class named: ${similar}?`;
    return { errors, warnings, suggestion };
  }

  // --- Inner-class enclosing-class accessibility (quirk 6.1) ---
  // Reaching a nested type through an inaccessible enclosing type is a Java
  // access error. Check the IMMEDIATE enclosing class only; deeper nesting is
  // covered as each level is targeted by its own directive.
  if (allEntries && internal.includes('$')) {
    const enclosing = internal.slice(0, internal.lastIndexOf('$'));
    const enclosingCls = classMap.get(enclosing);
    const enclosingAccessible =
      !!enclosingCls &&
      (classVisibility(enclosingCls) === 'public' || classVisibility(enclosingCls) === 'protected');
    const widenedInFile = allEntries.some(
      (e) =>
        e.memberType === 'class' &&
        toInternalName(e.className) === enclosing &&
        (e.modifier.access === 'public' || e.modifier.access === 'protected'),
    );
    if (!enclosingAccessible && !widenedInFile) {
      warnings.push(
        `Inner class '${entry.className}' targets an enclosing class '${enclosing.replace(/\//g, '.')}' that is not public/protected and not widened in this file — Java requires the enclosing class to be accessible`,
      );
    }
  }

  // --- Class-level entry ---
  if (entry.memberType === 'class') {
    // Record canonical-constructor widening (quirk 6.2). A widened record whose
    // canonical constructor stays narrower cannot be INSTANTIATED at the widened
    // access — but reading its components or codec is fine (records don't need a
    // widened ctor for that). So this is an informational note, not a crash: we
    // only surface it when bytecode shows the canonical ctor is actually narrower
    // than the class's new access AND the file doesn't already widen it.
    if (
      allEntries &&
      cls.isRecord &&
      cls.canonicalConstructor &&
      (entry.modifier.access === 'public' || entry.modifier.access === 'protected')
    ) {
      const canonical = cls.canonicalConstructor;
      const ctor = cls.methods.find((m) => m.name === '<init>' && m.desc === canonical);
      const classLevel = ACCESS_LEVEL[entry.modifier.access];
      const ctorLevel = ctor ? ACCESS_LEVEL[accessFromFlags(ctor.flags)] : 0;
      const widenedInFile = allEntries.some(
        (e) =>
          e.memberType === 'method' &&
          e.memberName === '<init>' &&
          toInternalName(e.className) === internal &&
          e.memberDescriptor === canonical &&
          ACCESS_LEVEL[e.modifier.access] >= classLevel,
      );
      if (!widenedInFile && ctorLevel < classLevel) {
        warnings.push(
          `Record '${entry.className}' is widened to ${entry.modifier.access} but its canonical constructor ${sharedDescriptorToReadable(
            canonical,
          )} is not (currently ${ctor ? accessFromFlags(ctor.flags) : 'package-private'}). This only matters if you INSTANTIATE the record (e.g. 'new', or codec/network deserialization in your code); reading its components or codec needs no ctor widening. If you do construct it, also add: '${entry.modifier.access} ${entry.className} <init>${canonical}'.`,
        );
      }
    }
    return { errors, warnings, suggestion };
  }

  // --- Method entry ---
  if (entry.memberType === 'method' && entry.memberName) {
    if (entry.wildcard) {
      warnings.push(
        "Wildcard '*()' targets all members — discouraged and may be removed from the AT spec",
      );
      return { errors, warnings, suggestion };
    }

    const methodSyms = cls.methods.filter((m) => m.name === entry.memberName);

    if (methodSyms.length === 0) {
      errors.push(`Method '${entry.memberName}' not found in ${entry.className}`);
      // Suggest from real (non-synthetic, non-ctor) method names.
      const candidates = [
        ...new Set(
          cls.methods
            .filter((m) => m.name !== '<init>' && m.name !== '<clinit>')
            .map((m) => m.name),
        ),
      ];
      const similar = findSimilarName(entry.memberName, candidates);
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    // Descriptor check: AT and bytecode descriptors are both erased,
    // fully-qualified JVM form, so this is an exact match. The issue explicitly
    // asks to "check the signature".
    if (entry.memberDescriptor) {
      const matched = methodSyms.filter((m) => m.desc === entry.memberDescriptor);
      if (matched.length === 0) {
        const found = methodSyms.map((m) => m.desc).join(', ');
        errors.push(
          `Method '${entry.memberName}' exists but no overload matches descriptor ${entry.memberDescriptor} (found: ${found})`,
        );
        return { errors, warnings, suggestion };
      }

      // Override-narrowing warning (quirk 6.3): an AT transforms only the exact
      // targeted method; subclass overrides are untouched. Constructors are
      // excluded — they are never overridable.
      if (matched.some((m) => isMethodOverridable(m, cls))) {
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

    const fieldSyms = cls.fields.filter((f) => f.name === entry.memberName);

    if (fieldSyms.length === 0) {
      errors.push(`Field '${entry.memberName}' not found in ${entry.className}`);
      const similar = findSimilarName(
        entry.memberName,
        cls.fields.map((f) => f.name),
      );
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    // AT fields carry NO descriptor — name existence is the only check.
    return { errors, warnings, suggestion };
  }

  return { errors, warnings, suggestion };
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
   * Validate an access transformer against the remapped Minecraft JAR's
   * bytecode.
   *
   * Default mapping is `'mojmap'` (Forge/NeoForge dev toolchains are
   * mojmap-only post-1.17). Requires the version to have been decompiled (which
   * also produces the remapped JAR this reads). The needed classes — each
   * targeted class plus its enclosing classes, for the inner-class check — are
   * resolved from bytecode once (cached), then the pure per-entry validation
   * runs against `ClassBytecodeMap`. Cross-entry quirk checks (record ctor,
   * inner-class accessibility) and duplicate/conflict detection run after the
   * per-entry pass.
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

    const firstEntry = accessTransformer.entries[0] ?? syntheticEntry;

    // The remapped JAR (bytecode ground truth) is produced during decompilation.
    // Require it explicitly; guide the user to decompile if it is absent.
    if (!cacheManager.hasRemappedJar(mcVersion, mapping)) {
      errors.push({
        entry: firstEntry,
        message: `Minecraft ${mcVersion} (${mapping}) is not available locally. Run decompile_minecraft_version first.`,
      });
      return { isValid: false, errors, warnings };
    }

    // Resolve the set of internal class names to load: each targeted class plus
    // every enclosing prefix (needed for the inner-class accessibility check).
    const needed = new Set<string>();
    for (const entry of accessTransformer.entries) {
      const internal = entry.className.replace(/\./g, '/');
      needed.add(internal);
      // `idx > 0` (not `>= 0`): a leading `$` would slice to '' and add an empty
      // name. Normal `Outer$Inner` nesting has its `$` at a positive index.
      let idx = internal.lastIndexOf('$');
      while (idx > 0) {
        const enclosing = internal.slice(0, idx);
        needed.add(enclosing);
        idx = enclosing.lastIndexOf('$');
      }
    }

    let classMap: ClassBytecodeMap;
    try {
      classMap = await getBytecodeIndexService().getClassBytecode(mcVersion, mapping, [...needed]);
    } catch (error) {
      errors.push({
        entry: firstEntry,
        message: `Failed to read bytecode for Minecraft ${mcVersion} (${mapping}): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
      return { isValid: false, errors, warnings };
    }

    // JAR-wide class list for same-package "did you mean" suggestions on
    // class-not-found errors. Central-directory scan only — no bytecode dumped.
    const suggestionPool = getBytecodeIndexService().listClassNames(mcVersion, mapping);

    // Validate each entry against bytecode.
    for (const entry of accessTransformer.entries) {
      const validation = validateEntryAgainstBytecode(
        entry,
        classMap,
        accessTransformer.entries,
        suggestionPool,
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
