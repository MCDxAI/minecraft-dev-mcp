/**
 * AST-Based Version Diffing Service
 *
 * Provides detailed comparison of Minecraft versions at the API level.
 * Parses Java source into structural signatures and compares methods,
 * fields, and class hierarchies between versions.
 *
 * Source parsing delegates to `extractJavaSignatures` (tree-sitter) from
 * `src/utils/java-symbols.ts`. This correctly captures constructors (emitted
 * as methods with an empty return type), records and record components,
 * sealed types, annotation-type elements, multi-declarator fields, and
 * qualified / generic types — all of which the legacy regex extractor
 * silently dropped. The comparison logic (signatures → diffs) is unchanged.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import type {
  ClassModification,
  ClassSignature,
  DetailedVersionDiff,
  FieldSignature,
  MappingType,
  MethodSignature,
} from '../types/minecraft.js';
import { AstParseError } from '../utils/errors.js';
import { extractJavaSignatures } from '../utils/java-symbols.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';

/**
 * Whether a single {@link AstDiffService.compareMethodSignatures} change string
 * counts as a breaking change.
 *
 * Exported (pure) so the filter contract of {@link AstDiffService.getBreakingChanges}
 * can be unit-tested directly without a decompiled Minecraft tree on disk.
 *
 * NOTE: in practice parameter changes surface via `removedMethods` (a method whose
 * params change gets a different `methodKey` and is treated as removed+added),
 * not via `signatureChanges`. This predicate therefore flags return-type changes
 * in practice; the `Parameter` prefix branch is kept to pin the documented
 * contract and for forward-compatibility. Do not change the filter behavior.
 */
export function isBreakingChange(change: string): boolean {
  return change.startsWith('Return type changed') || change.startsWith('Parameter');
}

/**
 * AST Diff Service for detailed version comparison
 */
export class AstDiffService {
  /**
   * Parse a Java source file into a ClassSignature.
   *
   * Delegates structural extraction to `extractJavaSignatures` (tree-sitter),
   * which returns one ClassSignature per named type (including nested types).
   * A decompiled `.java` file normally declares a single top-level class whose
   * simple name matches the file name; nested types also appear as separate
   * entries in the result. We prefer the signature whose simple name matches
   * the file name and fall back to the first (top-level) signature. If the
   * source cannot be parsed, a minimal name-only signature is derived from the
   * file path so the class remains discoverable in the diff map.
   */
  parseClassSignature(source: string, filePath?: string): ClassSignature {
    const signatures = extractJavaSignatures(source);

    if (signatures.length > 0) {
      // A decompiled .java file has one top-level class (matching the file
      // name); any nested types appear as separate entries in `signatures` AND
      // are listed in the top-level signature's `innerClasses` field. Prefer
      // the signature whose simpleName matches the file name; else take the
      // first (top-level).
      let chosen: ClassSignature | undefined;
      if (filePath) {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
        const fileSimple = fileName.replace(/\.java$/, '');
        chosen = signatures.find((s) => s.simpleName === fileSimple);
      }
      return chosen ?? signatures[0];
    }

    // Fallback for unparseable source: emit a minimal signature derived from
    // the file path (preserves the legacy fallback behavior so the class is
    // still discoverable by name in the diff map).
    let simpleName = '';
    if (filePath) {
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
      simpleName = fileName.replace(/\.java$/, '');
    }
    const pkg = ''; // cannot determine without parsing
    const name = simpleName;
    return {
      name,
      package: pkg,
      simpleName,
      isInterface: false,
      isEnum: false,
      isAbstract: false,
      interfaces: [],
      methods: [],
      fields: [],
      innerClasses: [],
    };
  }

  /**
   * Get all class signatures from a decompiled version
   */
  async getVersionSignatures(
    version: string,
    mapping: MappingType,
    filter?: (className: string) => boolean,
  ): Promise<Map<string, ClassSignature>> {
    const cacheManager = getCacheManager();

    if (!cacheManager.hasDecompiledSource(version, mapping)) {
      throw new AstParseError(
        version,
        `Minecraft ${version} not decompiled with ${mapping} mappings`,
      );
    }

    const decompiledPath = getDecompiledPath(version, mapping);
    const signatures = new Map<string, ClassSignature>();

    const walkDir = (dir: string, packagePrefix: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            const newPrefix = packagePrefix ? `${packagePrefix}.${entry.name}` : entry.name;
            walkDir(fullPath, newPrefix);
          } else if (entry.name.endsWith('.java')) {
            const className = packagePrefix
              ? `${packagePrefix}.${entry.name.replace('.java', '')}`
              : entry.name.replace('.java', '');

            // Apply filter if provided
            if (filter && !filter(className)) {
              continue;
            }

            try {
              const source = readFileSync(fullPath, 'utf8');
              const signature = this.parseClassSignature(source, fullPath);
              signatures.set(className, signature);
            } catch (error) {
              logger.warn(`Failed to parse ${fullPath}:`, error);
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to read directory ${dir}:`, error);
      }
    };

    walkDir(decompiledPath, '');
    return signatures;
  }

  /**
   * Compare two versions and produce a detailed diff
   */
  async compareVersionsDetailed(
    fromVersion: string,
    toVersion: string,
    mapping: MappingType,
    options: {
      /** Only compare specific packages */
      packages?: string[];
      /** Limit number of classes to compare (for performance) */
      maxClasses?: number;
      /** Include unchanged classes in output */
      includeUnchanged?: boolean;
    } = {},
  ): Promise<DetailedVersionDiff> {
    logger.info(`Comparing ${fromVersion} vs ${toVersion} (${mapping})`);

    const { packages, maxClasses = 1000 } = options;

    // Create filter based on packages
    const filter = packages
      ? (className: string) => packages.some((pkg) => className.startsWith(pkg))
      : undefined;

    // Get signatures for both versions
    const fromSignatures = await this.getVersionSignatures(fromVersion, mapping, filter);
    const toSignatures = await this.getVersionSignatures(toVersion, mapping, filter);

    // Limit to maxClasses if needed
    const fromClasses = [...fromSignatures.keys()].slice(0, maxClasses);
    const toClasses = [...toSignatures.keys()].slice(0, maxClasses);

    const fromSet = new Set(fromClasses);
    const toSet = new Set(toClasses);

    // Find added, removed, and common classes
    const addedClassNames = toClasses.filter((c) => !fromSet.has(c));
    const removedClassNames = fromClasses.filter((c) => !toSet.has(c));
    const commonClassNames = fromClasses.filter((c) => toSet.has(c));

    // Get full signatures for added/removed
    const addedClasses = addedClassNames
      .map((name) => toSignatures.get(name))
      .filter((c): c is ClassSignature => c !== undefined);

    const removedClasses = removedClassNames
      .map((name) => fromSignatures.get(name))
      .filter((c): c is ClassSignature => c !== undefined);

    // Compare common classes for modifications
    const modifiedClasses: ClassModification[] = [];
    let methodsAdded = 0;
    let methodsRemoved = 0;
    let methodsModified = 0;
    let fieldsAdded = 0;
    let fieldsRemoved = 0;

    for (const className of commonClassNames) {
      const fromClass = fromSignatures.get(className);
      const toClass = toSignatures.get(className);
      if (!fromClass || !toClass) continue;

      const modification = this.compareClasses(fromClass, toClass);

      if (modification) {
        modifiedClasses.push(modification);

        methodsAdded += modification.addedMethods.length;
        methodsRemoved += modification.removedMethods.length;
        methodsModified += modification.modifiedMethods.length;
        fieldsAdded += modification.addedFields.length;
        fieldsRemoved += modification.removedFields.length;
      }
    }

    // Count methods/fields in added/removed classes
    for (const cls of addedClasses) {
      methodsAdded += cls.methods.length;
      fieldsAdded += cls.fields.length;
    }
    for (const cls of removedClasses) {
      methodsRemoved += cls.methods.length;
      fieldsRemoved += cls.fields.length;
    }

    return {
      fromVersion,
      toVersion,
      mapping,
      addedClasses,
      removedClasses,
      modifiedClasses,
      summary: {
        classesAdded: addedClasses.length,
        classesRemoved: removedClasses.length,
        classesModified: modifiedClasses.length,
        methodsAdded,
        methodsRemoved,
        methodsModified,
        fieldsAdded,
        fieldsRemoved,
      },
    };
  }

  /**
   * Compare two class signatures
   */
  public compareClasses(from: ClassSignature, to: ClassSignature): ClassModification | null {
    const addedMethods: MethodSignature[] = [];
    const removedMethods: MethodSignature[] = [];
    const modifiedMethods: ClassModification['modifiedMethods'] = [];
    const addedFields: FieldSignature[] = [];
    const removedFields: FieldSignature[] = [];

    // Compare methods
    const fromMethodKeys = new Map(from.methods.map((m) => [this.methodKey(m), m]));
    const toMethodKeys = new Map(to.methods.map((m) => [this.methodKey(m), m]));

    for (const [key, method] of toMethodKeys) {
      const fromMethod = fromMethodKeys.get(key);
      if (!fromMethod) {
        // Check if method was renamed (same params, different name)
        const similar = this.findSimilarMethod(method, from.methods);
        if (similar) {
          modifiedMethods.push({
            old: similar,
            new: method,
            changes: ['Method renamed'],
          });
        } else {
          addedMethods.push(method);
        }
      } else {
        // Check for signature changes
        const changes = this.compareMethodSignatures(fromMethod, method);
        if (changes.length > 0) {
          modifiedMethods.push({ old: fromMethod, new: method, changes });
        }
      }
    }

    for (const [key, method] of fromMethodKeys) {
      if (!toMethodKeys.has(key)) {
        // Only add if not already tracked as renamed
        const wasRenamed = modifiedMethods.some((m) => m.old.name === method.name);
        if (!wasRenamed) {
          removedMethods.push(method);
        }
      }
    }

    // Compare fields
    const fromFieldNames = new Map(from.fields.map((f) => [f.name, f]));
    const toFieldNames = new Map(to.fields.map((f) => [f.name, f]));

    for (const [name, field] of toFieldNames) {
      if (!fromFieldNames.has(name)) {
        addedFields.push(field);
      }
    }

    for (const [name, field] of fromFieldNames) {
      if (!toFieldNames.has(name)) {
        removedFields.push(field);
      }
    }

    // Check superclass changes
    let superclassChange: ClassModification['superclassChange'];
    if (from.superclass !== to.superclass) {
      superclassChange = { old: from.superclass, new: to.superclass };
    }

    // Check interface changes
    let interfaceChanges: ClassModification['interfaceChanges'];
    const fromInterfaces = new Set(from.interfaces);
    const toInterfaces = new Set(to.interfaces);
    const addedInterfaces = to.interfaces.filter((i) => !fromInterfaces.has(i));
    const removedInterfaces = from.interfaces.filter((i) => !toInterfaces.has(i));

    if (addedInterfaces.length > 0 || removedInterfaces.length > 0) {
      interfaceChanges = { added: addedInterfaces, removed: removedInterfaces };
    }

    // Return null if no changes
    if (
      addedMethods.length === 0 &&
      removedMethods.length === 0 &&
      modifiedMethods.length === 0 &&
      addedFields.length === 0 &&
      removedFields.length === 0 &&
      !superclassChange &&
      !interfaceChanges
    ) {
      return null;
    }

    return {
      className: from.name,
      addedMethods,
      removedMethods,
      modifiedMethods,
      addedFields,
      removedFields,
      superclassChange,
      interfaceChanges,
    };
  }

  /**
   * Generate a unique key for a method (name + parameter types)
   */
  private methodKey(method: MethodSignature): string {
    return `${method.name}(${method.parameters.join(',')})`;
  }

  /**
   * Find a method with similar signature (for rename detection)
   */
  public findSimilarMethod(
    target: MethodSignature,
    candidates: MethodSignature[],
  ): MethodSignature | null {
    for (const candidate of candidates) {
      // Same parameters and return type, different name
      if (
        candidate.returnType === target.returnType &&
        candidate.parameters.length === target.parameters.length &&
        candidate.parameters.every((p, i) => p === target.parameters[i]) &&
        candidate.name !== target.name
      ) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Compare two method signatures for changes
   */
  public compareMethodSignatures(from: MethodSignature, to: MethodSignature): string[] {
    const changes: string[] = [];

    if (from.returnType !== to.returnType) {
      changes.push(`Return type changed: ${from.returnType} -> ${to.returnType}`);
    }

    const fromMods = new Set(from.modifiers);
    const toMods = new Set(to.modifiers);

    for (const mod of toMods) {
      if (!fromMods.has(mod)) {
        changes.push(`Added modifier: ${mod}`);
      }
    }

    for (const mod of fromMods) {
      if (!toMods.has(mod)) {
        changes.push(`Removed modifier: ${mod}`);
      }
    }

    if (from.throws.sort().join(',') !== to.throws.sort().join(',')) {
      changes.push(`Throws changed: [${from.throws.join(', ')}] -> [${to.throws.join(', ')}]`);
    }

    return changes;
  }

  /**
   * Get breaking changes between versions (methods/classes that were removed or had incompatible changes)
   */
  async getBreakingChanges(
    fromVersion: string,
    toVersion: string,
    mapping: MappingType,
    packages?: string[],
  ): Promise<{
    removedClasses: string[];
    removedMethods: Array<{ className: string; method: string }>;
    signatureChanges: Array<{ className: string; method: string; change: string }>;
  }> {
    const diff = await this.compareVersionsDetailed(fromVersion, toVersion, mapping, { packages });

    const removedClasses = diff.removedClasses.map((c) => c.name);

    const removedMethods: Array<{ className: string; method: string }> = [];
    const signatureChanges: Array<{ className: string; method: string; change: string }> = [];

    for (const mod of diff.modifiedClasses) {
      for (const method of mod.removedMethods) {
        removedMethods.push({
          className: mod.className,
          method: `${method.returnType} ${method.name}(${method.parameters.join(', ')})`,
        });
      }

      for (const change of mod.modifiedMethods) {
        // Only report return type changes and parameter changes as breaking
        // (see isBreakingChange, exported for direct unit-testing).
        const breakingChanges = change.changes.filter(isBreakingChange);
        if (breakingChanges.length > 0) {
          signatureChanges.push({
            className: mod.className,
            method: change.old.name,
            change: breakingChanges.join('; '),
          });
        }
      }
    }

    return { removedClasses, removedMethods, signatureChanges };
  }
}

// Singleton instance
let astDiffServiceInstance: AstDiffService | undefined;

export function getAstDiffService(): AstDiffService {
  if (!astDiffServiceInstance) {
    astDiffServiceInstance = new AstDiffService();
  }
  return astDiffServiceInstance;
}
