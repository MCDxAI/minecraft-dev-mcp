/**
 * Access Widener Service
 *
 * Parses and validates Fabric Access Widener files. Access wideners let mods
 * change the access level of classes, methods, and fields at load time.
 *
 * GROUND TRUTH IS BYTECODE, NOT DECOMPILED SOURCE. Validation runs against the
 * remapped Minecraft JAR via the ASM bytecode-dumper (see
 * `bytecode-index-service.ts`), NOT VineFlower `.java`. Decompiled source omits
 * compiler-generated members — a record's canonical constructor and its
 * component accessors — so a source-based check reports them as "not found"
 * even though they exist in the class file (the same issue-#12 class of false
 * positive fixed for the access-transformer tool; both validators now share the
 * bytecode path so they cannot diverge). Bytecode carries every member with its
 * true access flags and erased descriptors, so member existence is an exact
 * lookup and descriptor matching is exact string comparison.
 *
 * Default mapping is `'yarn'` (Fabric's toolchain).
 */

import { existsSync, readFileSync } from 'node:fs';
import { getCacheManager } from '../cache/cache-manager.js';
import type { BytecodeClass } from '../java/bytecode-dumper.js';
import type {
  AccessWidener,
  AccessWidenerEntry,
  AccessWidenerTarget,
  AccessWidenerType,
  AccessWidenerValidation,
  MappingType,
} from '../types/minecraft.js';
import { descriptorToReadable as sharedDescriptorToReadable } from '../utils/descriptor-utils.js';
import { AccessWidenerParseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { findSimilarName } from '../utils/suggestions.js';
import { getBytecodeIndexService } from './bytecode-index-service.js';

/** A map of internal class name (slashes, `$`) → its authoritative bytecode metadata. */
type ClassBytecodeMap = Map<string, BytecodeClass>;

/** Convert an AW dotted+`$` class name to an internal JVM name (slashes). */
function toInternalName(className: string): string {
  return className.replace(/\./g, '/');
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
 * Pick the best "did you mean" class name for a missing target, drawn from
 * `pool` (JAR-wide internal names) restricted to the target's own package so
 * suggestions stay relevant and bounded.
 */
function suggestClassName(targetInternal: string, pool: string[]): string | null {
  const pkg = packageOf(targetInternal);
  const samePackage = pool.filter((n) => packageOf(n) === pkg).map(simpleClassName);
  return findSimilarName(simpleClassName(targetInternal), samePackage);
}

/**
 * Render a parsed entry back to its one-line AW directive text (e.g.
 * `accessible method net/minecraft/Foo tick ()V`). Used to keep tool output
 * compact — a finding shows this string instead of the full nested entry object.
 */
export function accessWidenerEntryToString(entry: AccessWidenerEntry): string {
  const head = `${entry.accessType} ${entry.targetType} ${entry.className}`;
  if (entry.targetType === 'class' || !entry.memberName) return head;
  const desc = entry.memberDescriptor ? ` ${entry.memberDescriptor}` : '';
  return `${head} ${entry.memberName}${desc}`;
}

// ---------------------------------------------------------------------------
// Core validation against authoritative bytecode
// ---------------------------------------------------------------------------

/**
 * Validate a single access-widener entry against the bytecode metadata of its
 * class. Pure: no filesystem, no I/O. `classMap` is keyed by internal class name
 * (slashes, `$`) and must contain the entry's class.
 *
 * @internal
 */
export function validateEntryAgainstBytecode(
  entry: AccessWidenerEntry,
  classMap: ClassBytecodeMap,
  classSuggestionPool?: string[],
): { errors: string[]; warnings: string[]; suggestion?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestion: string | undefined;

  const internal = toInternalName(entry.className);
  const cls = classMap.get(internal);
  if (!cls) {
    errors.push(`Class not found: ${entry.className}`);
    // Suggest from the JAR-wide class list (same package) when the caller
    // supplies it; fall back to the loaded classMap for pure/unit callers.
    const pool = classSuggestionPool ?? [...classMap.keys()];
    const similar = suggestClassName(internal, pool);
    if (similar) suggestion = `Did you mean a class named: ${similar}?`;
    return { errors, warnings, suggestion };
  }

  // --- Class entry ---
  if (entry.targetType === 'class') {
    // `extendable` on a final class won't let you subclass it. Uses the real
    // ACC_FINAL flag from bytecode.
    if (entry.accessType === 'extendable' && cls.isFinal) {
      warnings.push(`Class ${entry.className} is final - extendable may not work as expected`);
    }
    return { errors, warnings, suggestion };
  }

  // --- Method entry ---
  if (entry.targetType === 'method' && entry.memberName) {
    const methods = cls.methods.filter((m) => m.name === entry.memberName);
    if (methods.length === 0) {
      errors.push(`Method '${entry.memberName}' not found in ${entry.className}`);
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

    // AW and bytecode descriptors are both erased, fully-qualified JVM form →
    // exact match.
    if (entry.memberDescriptor) {
      const matched = methods.filter((m) => m.desc === entry.memberDescriptor);
      if (matched.length === 0) {
        const found = methods.map((m) => m.desc).join(', ');
        errors.push(
          `Method '${entry.memberName}' exists but no overload matches descriptor ${entry.memberDescriptor} (found: ${found})`,
        );
        return { errors, warnings, suggestion };
      }
    }
    return { errors, warnings, suggestion };
  }

  // --- Field entry ---
  if (entry.targetType === 'field' && entry.memberName) {
    const field = cls.fields.find((f) => f.name === entry.memberName);
    if (!field) {
      errors.push(`Field '${entry.memberName}' not found in ${entry.className}`);
      const similar = findSimilarName(
        entry.memberName,
        cls.fields.map((f) => f.name),
      );
      if (similar) suggestion = `Did you mean: ${similar}?`;
      return { errors, warnings, suggestion };
    }

    if (entry.memberDescriptor && field.desc !== entry.memberDescriptor) {
      errors.push(
        `Field '${entry.memberName}' descriptor mismatch: access widener says ${entry.memberDescriptor} but bytecode declares ${field.desc}`,
      );
      return { errors, warnings, suggestion };
    }

    // `mutable` on a field that is already non-final is a no-op → warn.
    if (entry.accessType === 'mutable' && !field.flags.includes('final')) {
      warnings.push(`Field '${entry.memberName}' appears to already be mutable`);
    }
    return { errors, warnings, suggestion };
  }

  return { errors, warnings, suggestion };
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
   * Validate an access widener against the remapped Minecraft JAR's bytecode.
   *
   * Requires the version to have been decompiled (which also produces the
   * remapped JAR this reads). The needed classes are resolved from bytecode once
   * (cached), then the pure per-entry validation runs against `ClassBytecodeMap`.
   */
  async validateAccessWidener(
    accessWidener: AccessWidener,
    mcVersion: string,
    mapping: MappingType = 'yarn',
  ): Promise<AccessWidenerValidation> {
    const errors: AccessWidenerValidation['errors'] = [];
    const warnings: AccessWidenerValidation['warnings'] = [];

    const cacheManager = getCacheManager();

    const fallbackEntry: AccessWidenerEntry = {
      accessType: 'accessible',
      targetType: 'class',
      className: '',
      line: 0,
    };
    const firstEntry = accessWidener.entries[0] ?? fallbackEntry;

    // The remapped JAR (bytecode ground truth) is produced during decompilation.
    if (!cacheManager.hasRemappedJar(mcVersion, mapping)) {
      errors.push({
        entry: firstEntry,
        message: `Minecraft ${mcVersion} (${mapping}) is not available locally. Run decompile_minecraft_version first.`,
      });
      return { isValid: false, errors, warnings };
    }

    // Validate namespace matches
    if (accessWidener.namespace !== mapping && accessWidener.namespace !== 'named') {
      warnings.push({
        entry: firstEntry,
        message: `Access widener namespace '${accessWidener.namespace}' may not match mapping '${mapping}'`,
      });
    }

    const needed = new Set<string>();
    for (const entry of accessWidener.entries) {
      needed.add(toInternalName(entry.className));
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

    for (const entry of accessWidener.entries) {
      const validation = validateEntryAgainstBytecode(entry, classMap, suggestionPool);
      errors.push(
        ...validation.errors.map((message) => ({
          entry,
          message,
          suggestion: validation.suggestion,
        })),
      );
      warnings.push(...validation.warnings.map((message) => ({ entry, message })));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
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
