/**
 * Access Widener Service
 *
 * Parses and validates Fabric Access Widener files.
 * Access wideners allow mods to change the access level of classes, methods, and fields.
 *
 * Validation is tree-sitter based: decompiled Java source is parsed once into an
 * AST (via `extractJavaSymbols`) and entries are correlated against the declared
 * symbols. Access-widener method/field `memberDescriptor`s (JVM form) are now
 * validated against the actual signatures, not just names. There is NO regex
 * Java-source inspection left; the only string-pattern operations remaining are
 * AW-file-format parsing (parseEntry), class-name/path conversion, and pure JVM
 * descriptor decode logic (shared via `descriptor-utils`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import type {
  AccessWidener,
  AccessWidenerEntry,
  AccessWidenerTarget,
  AccessWidenerType,
  AccessWidenerValidation,
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
import { AccessWidenerParseError } from '../utils/errors.js';
import { extractJavaSymbols } from '../utils/java-symbols.js';
import type { JavaSymbol } from '../utils/java-symbols.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';
import { findSimilarClassFile, findSimilarName } from '../utils/suggestions.js';

// ---------------------------------------------------------------------------
// AW-local descriptor helpers (module-internal)
// ---------------------------------------------------------------------------
//
// `buildMethodDescriptor` / `methodDescriptorMatches` / `fieldDescriptorMatches`
// are AW-validation-shaped (they take a `JavaSymbol`) and live here. The
// generic primitives they build on — `javaTypeToDescriptor`, `paramToDescriptor`,
// `parseParamDescriptors`, `descriptorsCompatible`, `classNamesMatch` — now
// live in `../utils/descriptor-utils.js` (shared with the mixin + AT validators).
// `descriptorToReadable` (descriptor decode) and the edit-distance suggestion
// helpers live in `descriptor-utils.js` / `suggestions.js` respectively.

/** Build the JVM descriptor string for an AST method/constructor symbol. */
function buildMethodDescriptor(method: JavaSymbol): string {
  const params = method.parameters ?? [];
  return `(${params.map(paramToDescriptor).join('')})${javaTypeToDescriptor(method.returnType ?? 'void')}`;
}

/** Compare an AST method/constructor against an AW method descriptor. */
function methodDescriptorMatches(
  method: JavaSymbol,
  awDescriptor: string,
): { match: boolean; reason?: string } {
  const open = awDescriptor.indexOf('(');
  const close = awDescriptor.indexOf(')');
  if (open < 0 || close < 0 || close <= open) {
    return { match: false, reason: `Malformed method descriptor: ${awDescriptor}` };
  }

  const awParams = parseParamDescriptors(awDescriptor.slice(open + 1, close));
  const awReturn = awDescriptor.slice(close + 1);

  const params = method.parameters ?? [];
  const astParams = params.map(paramToDescriptor);
  const astReturn = javaTypeToDescriptor(method.returnType ?? 'void');

  if (astParams.length !== awParams.length) {
    return { match: false, reason: `arity ${astParams.length} vs ${awParams.length}` };
  }
  for (let i = 0; i < astParams.length; i++) {
    if (!descriptorsCompatible(astParams[i], awParams[i])) {
      return { match: false, reason: `param ${i}: ${astParams[i]} vs ${awParams[i]}` };
    }
  }
  if (!descriptorsCompatible(astReturn, awReturn)) {
    return { match: false, reason: `return: ${astReturn} vs ${awReturn}` };
  }
  return { match: true };
}

/** Compare an AST field against an AW field descriptor. */
function fieldDescriptorMatches(
  field: JavaSymbol,
  awDescriptor: string,
): { match: boolean; reason?: string } {
  const astDesc = javaTypeToDescriptor(field.fieldType ?? '');
  return descriptorsCompatible(astDesc, awDescriptor)
    ? { match: true }
    : { match: false, reason: `${astDesc} vs ${awDescriptor}` };
}

// ---------------------------------------------------------------------------
// Pure helpers: member-name correlation (module-internal)
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

// ---------------------------------------------------------------------------
// Core validation against extracted symbols (module-internal)
// ---------------------------------------------------------------------------

/**
 * Validate a single access-widener entry against the AST symbols of its class.
 * Pure: no filesystem, no I/O. This is the heart of the validator.
 */
function validateEntryAgainstSymbols(
  entry: AccessWidenerEntry,
  symbols: JavaSymbol[],
): { errors: string[]; warnings: string[]; suggestion?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestion: string | undefined;

  // Symbols declared by the entry's class. `classNamesMatch` reconciles JVM
  // inner-class `$` separators with the AST's dotted declaringClass.
  const classSymbols = symbols.filter((s) => classNamesMatch(entry.className, s.declaringClass));

  // --- Class-level entry ---
  if (entry.targetType === 'class') {
    if (entry.accessType === 'extendable') {
      const classSym = classSymbols.find((s) => s.entryType === 'class');
      // Tied to the SPECIFIC entry.className via classNamesMatch above — the
      // old whole-file `source.includes('final class')` substring check is
      // gone (it matched inner classes and comments).
      if (classSym && (classSym.isFinal || classSym.modifiers?.includes('final'))) {
        warnings.push(`Class ${entry.className} is final - extendable may not work as expected`);
      }
    }
    return { errors, warnings, suggestion };
  }

  // --- Method entry ---
  if (entry.targetType === 'method' && entry.memberName) {
    // Static initializers are intentionally not emitted by the AST walk. They
    // are rare and genuinely unverifiable from decompiled source.
    if (entry.memberName === '<clinit>') {
      warnings.push(
        "'<clinit>' (static initializer) cannot be validated from decompiled source — verify manually",
      );
      return { errors, warnings, suggestion };
    }

    const isCtor = entry.memberName === '<init>';
    // Only DECLARED members are seen here — call sites and comments are not,
    // so a method that is merely called (but not declared) is correctly
    // reported as missing.
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

    // Validate the JVM descriptor against the actual signature.
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
    }
    return { errors, warnings, suggestion };
  }

  // --- Field entry ---
  if (entry.targetType === 'field' && entry.memberName) {
    const fieldSyms = classSymbols.filter(
      (s) => s.entryType === 'field' && s.symbol === entry.memberName,
    );

    if (fieldSyms.length === 0) {
      errors.push(`Field '${entry.memberName}' not found in ${entry.className}`);
      const similar = findSimilarName(entry.memberName, uniqueFieldNames(classSymbols));
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    const fieldSym = fieldSyms[0];

    if (entry.memberDescriptor) {
      if (!fieldDescriptorMatches(fieldSym, entry.memberDescriptor).match) {
        const astDesc = javaTypeToDescriptor(fieldSym.fieldType ?? '');
        errors.push(
          `Field '${entry.memberName}' descriptor mismatch: access widener says ${entry.memberDescriptor} but source declares ${fieldSym.fieldType ?? '?'} (${astDesc})`,
        );
        return { errors, warnings, suggestion };
      }
    }

    // `mutable` on a field that is already non-final is a no-op → warn. Uses
    // the AST modifier flag, replacing the fragile `(?!final)` regex (which
    // silently missed generic-typed fields like `List<String> items`).
    if (entry.accessType === 'mutable') {
      const isFinal = fieldSym.isFinal || fieldSym.modifiers?.includes('final') === true;
      if (!isFinal) {
        warnings.push(`Field '${entry.memberName}' appears to already be mutable`);
      }
    }
    return { errors, warnings, suggestion };
  }

  return { errors, warnings, suggestion };
}

/**
 * Validate a single access-widener entry against a synthetic Java source
 * string. Test seam for the descriptor-matching logic — it lets unit tests
 * exercise validation without a decompiled Minecraft source tree. Production
 * validation reads the class file, extracts symbols once (cached), and
 * delegates to `validateEntryAgainstSymbols`.
 *
 * @internal
 */
export function validateEntryAgainstSource(
  entry: AccessWidenerEntry,
  source: string,
): { errors: string[]; warnings: string[]; suggestion?: string } {
  return validateEntryAgainstSymbols(entry, extractJavaSymbols(source));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Access Widener Service
 */
export class AccessWidenerService {
  /**
   * Parse an access widener file
   */
  parseAccessWidener(content: string, sourcePath?: string): AccessWidener {
    const lines = content.split('\n');
    const entries: AccessWidenerEntry[] = [];
    let namespace = 'named';
    let version = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Parse header
      if (line.startsWith('accessWidener')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          version = Number.parseInt(parts[1].replace('v', ''), 10) || 1;
          namespace = parts[2];
        }
        continue;
      }

      // Parse entry
      const entry = this.parseEntry(line, lineNum);
      if (entry) {
        entries.push(entry);
      } else {
        logger.warn(`Failed to parse access widener line ${lineNum}: ${line}`);
      }
    }

    return {
      namespace,
      version,
      entries,
      sourcePath,
    };
  }

  /**
   * Parse a single access widener entry
   */
  private parseEntry(line: string, lineNum: number): AccessWidenerEntry | null {
    const parts = line.split(/\s+/);

    if (parts.length < 2) {
      return null;
    }

    const accessType = parts[0] as AccessWidenerType;
    const targetType = parts[1] as AccessWidenerTarget;

    // Validate access type
    if (!['accessible', 'extendable', 'mutable'].includes(accessType)) {
      return null;
    }

    // Validate target type
    if (!['class', 'method', 'field'].includes(targetType)) {
      return null;
    }

    // Parse based on target type
    if (targetType === 'class') {
      // Format: accessible class net/minecraft/entity/Entity
      if (parts.length < 3) return null;
      return {
        accessType,
        targetType,
        className: parts[2].replace(/\//g, '.'),
        line: lineNum,
      };
    }

    if (targetType === 'method') {
      // Format: accessible method net/minecraft/entity/Entity someMethod (Lnet/minecraft/util/Identifier;)V
      if (parts.length < 5) return null;
      return {
        accessType,
        targetType,
        className: parts[2].replace(/\//g, '.'),
        memberName: parts[3],
        memberDescriptor: parts[4],
        line: lineNum,
      };
    }

    if (targetType === 'field') {
      // Format: accessible field net/minecraft/entity/Entity someField Lnet/minecraft/util/Identifier;
      if (parts.length < 5) return null;
      return {
        accessType,
        targetType,
        className: parts[2].replace(/\//g, '.'),
        memberName: parts[3],
        memberDescriptor: parts[4],
        line: lineNum,
      };
    }

    return null;
  }

  /**
   * Parse access widener from file path
   */
  parseAccessWidenerFile(filePath: string): AccessWidener {
    if (!existsSync(filePath)) {
      throw new AccessWidenerParseError(filePath, undefined, `File not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf8');
    return this.parseAccessWidener(content, filePath);
  }

  /**
   * Validate access widener against Minecraft source
   */
  async validateAccessWidener(
    accessWidener: AccessWidener,
    mcVersion: string,
    mapping: MappingType = 'yarn',
  ): Promise<AccessWidenerValidation> {
    const errors: AccessWidenerValidation['errors'] = [];
    const warnings: AccessWidenerValidation['warnings'] = [];

    const cacheManager = getCacheManager();

    // Check if decompiled source exists
    if (!cacheManager.hasDecompiledSource(mcVersion, mapping)) {
      errors.push({
        entry: accessWidener.entries[0] || {
          accessType: 'accessible',
          targetType: 'class',
          className: '',
          line: 0,
        },
        message: `Minecraft ${mcVersion} source not decompiled. Run decompile_minecraft_version first.`,
      });
      return { isValid: false, errors, warnings };
    }

    const decompiledPath = getDecompiledPath(mcVersion, mapping);

    // Validate namespace matches
    if (accessWidener.namespace !== mapping && accessWidener.namespace !== 'named') {
      warnings.push({
        entry: accessWidener.entries[0] || {
          accessType: 'accessible',
          targetType: 'class',
          className: '',
          line: 0,
        },
        message: `Access widener namespace '${accessWidener.namespace}' may not match mapping '${mapping}'`,
      });
    }

    // Cache extracted symbols per source file for the duration of this call.
    // Multiple entries targeting the same class parse the file only once.
    const symbolsCache = new Map<string, JavaSymbol[]>();

    // Validate each entry
    for (const entry of accessWidener.entries) {
      const validation = this.validateEntry(entry, decompiledPath, symbolsCache);
      errors.push(
        ...validation.errors.map((e) => ({ entry, message: e, suggestion: validation.suggestion })),
      );
      warnings.push(...validation.warnings.map((w) => ({ entry, message: w })));
    }

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
   * `validateAccessWidener` call) and delegates the pure symbol-based
   * validation to `validateEntryAgainstSymbols`.
   */
  private validateEntry(
    entry: AccessWidenerEntry,
    decompiledPath: string,
    symbolsCache: Map<string, JavaSymbol[]>,
  ): { errors: string[]; warnings: string[]; suggestion?: string } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let suggestion: string | undefined;

    // JVM inner classes nest with `$`; the source lives in the outer class's
    // .java file, so resolve the file path from the top-level class segment.
    // (Class names literally containing `$` are an unresolved edge case; the
    // ASM bytecode stage will make this authoritative.)
    const outerClassName = entry.className.split('$')[0];
    const classPath = join(decompiledPath, `${outerClassName.replace(/\./g, '/')}.java`);

    if (!existsSync(classPath)) {
      errors.push(`Class not found: ${entry.className}`);

      // Try to find similar classes (filesystem-based suggestion).
      const similar = findSimilarClassFile(outerClassName, decompiledPath);
      if (similar) {
        suggestion = `Did you mean: ${similar}?`;
      }
      return { errors, warnings, suggestion };
    }

    let symbols = symbolsCache.get(classPath);
    if (!symbols) {
      const source = readFileSync(classPath, 'utf8');
      symbols = extractJavaSymbols(source);
      symbolsCache.set(classPath, symbols);
    }

    return validateEntryAgainstSymbols(entry, symbols);
  }

  /**
   * Generate an access widener file for common operations
   */
  generateAccessWidener(
    entries: Array<{
      accessType: AccessWidenerType;
      targetType: AccessWidenerTarget;
      className: string;
      memberName?: string;
      memberDescriptor?: string;
    }>,
    namespace: MappingType = 'yarn',
  ): string {
    const lines: string[] = [`accessWidener v2 ${namespace === 'yarn' ? 'named' : namespace}`, ''];

    for (const entry of entries) {
      const classPath = entry.className.replace(/\./g, '/');

      if (entry.targetType === 'class') {
        lines.push(`${entry.accessType} class ${classPath}`);
      } else if (entry.targetType === 'method' && entry.memberName && entry.memberDescriptor) {
        lines.push(
          `${entry.accessType} method ${classPath} ${entry.memberName} ${entry.memberDescriptor}`,
        );
      } else if (entry.targetType === 'field' && entry.memberName && entry.memberDescriptor) {
        lines.push(
          `${entry.accessType} field ${classPath} ${entry.memberName} ${entry.memberDescriptor}`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert descriptor to human-readable format.
   *
   * Thin delegate over the shared `descriptorToReadable` in
   * `descriptor-utils.ts` — kept on the service to preserve the public API
   * (the descriptor-decode regression tests exercise this method). The decode
   * logic (incl. the malformed-input termination guards) lives in one place.
   */
  descriptorToReadable(descriptor: string): string {
    return sharedDescriptorToReadable(descriptor);
  }
}

// Singleton instance
let accessWidenerServiceInstance: AccessWidenerService | undefined;

export function getAccessWidenerService(): AccessWidenerService {
  if (!accessWidenerServiceInstance) {
    accessWidenerServiceInstance = new AccessWidenerService();
  }
  return accessWidenerServiceInstance;
}
