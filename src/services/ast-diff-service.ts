/**
 * AST-Based Version Diffing Service
 *
 * Provides detailed comparison of Minecraft versions at the API level.
 * Parses Java source into structural signatures and compares methods,
 * fields, and class hierarchies between versions.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { AstParseError } from '../utils/errors.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { getDecompiledPath } from '../utils/paths.js';
import type {
  ClassSignature,
  MethodSignature,
  FieldSignature,
  DetailedVersionDiff,
  ClassModification,
  MappingType,
} from '../types/minecraft.js';

/**
 * AST Diff Service for detailed version comparison
 */
export class AstDiffService {
  /**
   * Parse a Java source file into a ClassSignature
   */
  parseClassSignature(source: string, filePath?: string): ClassSignature {
    const lines = source.split('\n');

    // Extract package
    let packageName = '';
    for (const line of lines) {
      const packageMatch = line.match(/^package\s+([\w.]+);/);
      if (packageMatch) {
        packageName = packageMatch[1];
        break;
      }
    }

    // Extract class declaration
    let simpleName = '';
    let isInterface = false;
    let isEnum = false;
    let isAbstract = false;
    let superclass: string | undefined;
    const interfaces: string[] = [];

    for (const line of lines) {
      // Match class/interface/enum declaration
      const classMatch = line.match(
        /^(?:public\s+)?(?:(abstract)\s+)?(?:final\s+)?(class|interface|enum)\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([\w.<>,\s]+))?(?:\s+implements\s+([\w.<>,\s]+))?/
      );

      if (classMatch) {
        isAbstract = classMatch[1] === 'abstract';
        const typeKeyword = classMatch[2];
        simpleName = classMatch[3];
        isInterface = typeKeyword === 'interface';
        isEnum = typeKeyword === 'enum';

        if (classMatch[4]) {
          superclass = classMatch[4].trim().split('<')[0].trim();
        }

        if (classMatch[5]) {
          const implementsList = classMatch[5].split(',').map(i => i.trim().split('<')[0].trim());
          interfaces.push(...implementsList);
        }
        break;
      }
    }

    if (!simpleName && filePath) {
      // Fallback: extract from file path
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
      simpleName = fileName.replace('.java', '');
    }

    const fullName = packageName ? `${packageName}.${simpleName}` : simpleName;

    // Extract methods
    const methods = this.extractMethods(source);

    // Extract fields
    const fields = this.extractFields(source);

    // Extract inner classes (simple detection)
    const innerClasses = this.extractInnerClasses(source, simpleName);

    return {
      name: fullName,
      package: packageName,
      simpleName,
      isInterface,
      isEnum,
      isAbstract,
      superclass,
      interfaces,
      methods,
      fields,
      innerClasses,
    };
  }

  /**
   * Extract method signatures from source
   */
  private extractMethods(source: string): MethodSignature[] {
    const methods: MethodSignature[] = [];

    // Regex to match method declarations (not constructors)
    // Handles generics, arrays, varargs
    const methodRegex = /^\s*((?:public|private|protected)\s+)?(?:(static)\s+)?(?:(final)\s+)?(?:(synchronized)\s+)?(?:(native)\s+)?(?:(abstract)\s+)?(?:(<[^>]+>)\s+)?([\w<>,\[\]?]+)\s+(\w+)\s*\(([^)]*)\)(?:\s+throws\s+([\w,\s]+))?/gm;

    let match;
    while ((match = methodRegex.exec(source)) !== null) {
      const modifiers: string[] = [];
      if (match[1]) modifiers.push(match[1].trim());
      if (match[2]) modifiers.push('static');
      if (match[3]) modifiers.push('final');
      if (match[4]) modifiers.push('synchronized');
      if (match[5]) modifiers.push('native');
      if (match[6]) modifiers.push('abstract');

      const typeParameters = match[7] ? [match[7]] : undefined;
      const returnType = match[8];
      const methodName = match[9];
      const paramsStr = match[10];
      const throwsStr = match[11];

      // Parse parameters
      const parameters = this.parseParameters(paramsStr);

      // Parse throws
      const throwsList = throwsStr
        ? throwsStr.split(',').map(t => t.trim())
        : [];

      methods.push({
        name: methodName,
        returnType,
        parameters,
        modifiers,
        throws: throwsList,
        typeParameters,
      });
    }

    return methods;
  }

  /**
   * Parse method parameters
   */
  private parseParameters(paramsStr: string): string[] {
    if (!paramsStr.trim()) return [];

    const params: string[] = [];
    let current = '';
    let depth = 0; // Track generic depth

    for (const char of paramsStr) {
      if (char === '<') depth++;
      if (char === '>') depth--;
      if (char === ',' && depth === 0) {
        const param = current.trim();
        if (param) {
          // Extract just the type (last space-separated part before variable name)
          const parts = param.split(/\s+/);
          // Handle annotations and modifiers
          let typeIdx = parts.length - 2;
          while (typeIdx >= 0 && (parts[typeIdx].startsWith('@') || ['final'].includes(parts[typeIdx]))) {
            typeIdx--;
          }
          if (typeIdx >= 0) {
            params.push(parts[typeIdx]);
          }
        }
        current = '';
      } else {
        current += char;
      }
    }

    // Last parameter
    const param = current.trim();
    if (param) {
      const parts = param.split(/\s+/);
      let typeIdx = parts.length - 2;
      while (typeIdx >= 0 && (parts[typeIdx].startsWith('@') || ['final'].includes(parts[typeIdx]))) {
        typeIdx--;
      }
      if (typeIdx >= 0) {
        params.push(parts[typeIdx]);
      }
    }

    return params;
  }

  /**
   * Extract field signatures from source
   */
  private extractFields(source: string): FieldSignature[] {
    const fields: FieldSignature[] = [];

    // Regex to match field declarations
    const fieldRegex = /^\s*((?:public|private|protected)\s+)?(?:(static)\s+)?(?:(final)\s+)?(?:(volatile)\s+)?(?:(transient)\s+)?([\w<>,\[\]?]+)\s+(\w+)\s*(?:=\s*([^;]+))?;/gm;

    let match;
    while ((match = fieldRegex.exec(source)) !== null) {
      const modifiers: string[] = [];
      if (match[1]) modifiers.push(match[1].trim());
      if (match[2]) modifiers.push('static');
      if (match[3]) modifiers.push('final');
      if (match[4]) modifiers.push('volatile');
      if (match[5]) modifiers.push('transient');

      const type = match[6];
      const name = match[7];
      const constantValue = match[8]?.trim();

      fields.push({
        name,
        type,
        modifiers,
        constantValue: modifiers.includes('final') && constantValue ? constantValue : undefined,
      });
    }

    return fields;
  }

  /**
   * Extract inner class names
   */
  private extractInnerClasses(source: string, outerClassName: string): string[] {
    const innerClasses: string[] = [];

    let depth = 0;
    let inOuterClass = false;

    for (let i = 0; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;

      // Look for class declarations at depth > 1 (inside outer class)
      if (depth >= 1 && !inOuterClass) {
        inOuterClass = true;
      }

      if (inOuterClass && depth >= 2) {
        // Check if we're at a class declaration
        const remaining = source.substring(i);
        const classMatch = remaining.match(/^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum)\s+(\w+)/);
        if (classMatch && classMatch[1] !== outerClassName) {
          innerClasses.push(`${outerClassName}$${classMatch[1]}`);
        }
      }
    }

    return [...new Set(innerClasses)];
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
      ? (className: string) => packages.some(pkg => className.startsWith(pkg))
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
    const addedClassNames = toClasses.filter(c => !fromSet.has(c));
    const removedClassNames = fromClasses.filter(c => !toSet.has(c));
    const commonClassNames = fromClasses.filter(c => toSet.has(c));

    // Get full signatures for added/removed
    const addedClasses = addedClassNames
      .map(name => toSignatures.get(name)!)
      .filter(Boolean);

    const removedClasses = removedClassNames
      .map(name => fromSignatures.get(name)!)
      .filter(Boolean);

    // Compare common classes for modifications
    const modifiedClasses: ClassModification[] = [];
    let methodsAdded = 0;
    let methodsRemoved = 0;
    let methodsModified = 0;
    let fieldsAdded = 0;
    let fieldsRemoved = 0;

    for (const className of commonClassNames) {
      const fromClass = fromSignatures.get(className)!;
      const toClass = toSignatures.get(className)!;

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
  private compareClasses(from: ClassSignature, to: ClassSignature): ClassModification | null {
    const addedMethods: MethodSignature[] = [];
    const removedMethods: MethodSignature[] = [];
    const modifiedMethods: ClassModification['modifiedMethods'] = [];
    const addedFields: FieldSignature[] = [];
    const removedFields: FieldSignature[] = [];

    // Compare methods
    const fromMethodKeys = new Map(from.methods.map(m => [this.methodKey(m), m]));
    const toMethodKeys = new Map(to.methods.map(m => [this.methodKey(m), m]));

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
        const wasRenamed = modifiedMethods.some(m => m.old.name === method.name);
        if (!wasRenamed) {
          removedMethods.push(method);
        }
      }
    }

    // Compare fields
    const fromFieldNames = new Map(from.fields.map(f => [f.name, f]));
    const toFieldNames = new Map(to.fields.map(f => [f.name, f]));

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
    const addedInterfaces = to.interfaces.filter(i => !fromInterfaces.has(i));
    const removedInterfaces = from.interfaces.filter(i => !toInterfaces.has(i));

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
  private findSimilarMethod(target: MethodSignature, candidates: MethodSignature[]): MethodSignature | null {
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
  private compareMethodSignatures(from: MethodSignature, to: MethodSignature): string[] {
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

    const removedClasses = diff.removedClasses.map(c => c.name);

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
        const breakingChanges = change.changes.filter(
          c => c.startsWith('Return type changed') || c.startsWith('Parameter')
        );
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
