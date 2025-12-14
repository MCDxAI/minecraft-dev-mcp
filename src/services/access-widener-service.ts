/**
 * Access Widener Service
 *
 * Parses and validates Fabric Access Widener files.
 * Access wideners allow mods to change the access level of classes, methods, and fields.
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
import { AccessWidenerParseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';

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

    // Validate each entry
    for (const entry of accessWidener.entries) {
      const validation = this.validateEntry(entry, decompiledPath);
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
   * Validate a single entry
   */
  private validateEntry(
    entry: AccessWidenerEntry,
    decompiledPath: string,
  ): { errors: string[]; warnings: string[]; suggestion?: string } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let suggestion: string | undefined;

    // Check if class exists
    const classPath = join(decompiledPath, `${entry.className.replace(/\./g, '/')}.java`);

    if (!existsSync(classPath)) {
      errors.push(`Class not found: ${entry.className}`);

      // Try to find similar classes
      const similar = this.findSimilarClass(entry.className, decompiledPath);
      if (similar) {
        suggestion = `Did you mean: ${similar}?`;
      }
      return { errors, warnings, suggestion };
    }

    // For class-level access widener, we're done
    if (entry.targetType === 'class') {
      // Check for extendable on final class
      if (entry.accessType === 'extendable') {
        const source = readFileSync(classPath, 'utf8');
        if (source.includes('final class')) {
          warnings.push(`Class ${entry.className} is final - extendable may not work as expected`);
        }
      }
      return { errors, warnings, suggestion };
    }

    // For method/field, check if member exists
    const source = readFileSync(classPath, 'utf8');

    if (entry.targetType === 'method' && entry.memberName) {
      if (!this.methodExists(source, entry.memberName)) {
        errors.push(`Method '${entry.memberName}' not found in ${entry.className}`);

        // Find similar methods
        const methods = this.extractMethods(source);
        const similar = this.findSimilarName(entry.memberName, methods);
        if (similar) {
          suggestion = `Did you mean: ${similar}?`;
        }
      }
    }

    if (entry.targetType === 'field' && entry.memberName) {
      if (!this.fieldExists(source, entry.memberName)) {
        errors.push(`Field '${entry.memberName}' not found in ${entry.className}`);

        // Find similar fields
        const fields = this.extractFields(source);
        const similar = this.findSimilarName(entry.memberName, fields);
        if (similar) {
          suggestion = `Did you mean: ${similar}?`;
        }
      } else if (entry.accessType === 'mutable') {
        // Check if field is already non-final
        const fieldRegex = new RegExp(
          `\\b(private|protected|public)\\s+(?!final)\\w+\\s+${entry.memberName}\\b`,
        );
        if (fieldRegex.test(source)) {
          warnings.push(`Field '${entry.memberName}' appears to already be mutable`);
        }
      }
    }

    return { errors, warnings, suggestion };
  }

  /**
   * Check if a method exists in source
   */
  private methodExists(source: string, methodName: string): boolean {
    // Handle constructor
    if (methodName === '<init>') {
      return (
        source.includes('public ') || source.includes('private ') || source.includes('protected ')
      );
    }

    // Handle clinit
    if (methodName === '<clinit>') {
      return source.includes('static {');
    }

    const regex = new RegExp(`\\b${methodName}\\s*\\(`);
    return regex.test(source);
  }

  /**
   * Check if a field exists in source
   */
  private fieldExists(source: string, fieldName: string): boolean {
    const regex = new RegExp(`\\b${fieldName}\\s*[;=]`);
    return regex.test(source);
  }

  /**
   * Extract method names from source
   */
  private extractMethods(source: string): string[] {
    const methods: string[] = [];
    const regex =
      /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>,\[\]]+)\s+(\w+)\s*\(/g;
    for (const match of source.matchAll(regex)) {
      methods.push(match[1]);
    }
    return [...new Set(methods)];
  }

  /**
   * Extract field names from source
   */
  private extractFields(source: string): string[] {
    const fields: string[] = [];
    const regex =
      /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>,\[\]]+)\s+(\w+)\s*[;=]/g;
    for (const match of source.matchAll(regex)) {
      fields.push(match[1]);
    }
    return [...new Set(fields)];
  }

  /**
   * Find a similar class name
   */
  private findSimilarClass(className: string, basePath: string): string | null {
    const simpleName = className.split('.').pop() || className;
    const packagePath = className
      .substring(0, className.length - simpleName.length - 1)
      .replace(/\./g, '/');
    const packageDir = join(basePath, packagePath);

    if (!existsSync(packageDir)) {
      return null;
    }

    try {
      const { readdirSync } = require('node:fs');
      const files = readdirSync(packageDir) as string[];
      const javaFiles = files.filter((f: string) => f.endsWith('.java'));

      for (const file of javaFiles) {
        const name = file.replace('.java', '');
        if (this.isSimilar(simpleName, name)) {
          return className.replace(simpleName, name);
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Find a similar name from a list
   */
  private findSimilarName(target: string, candidates: string[]): string | null {
    for (const candidate of candidates) {
      if (this.isSimilar(target, candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Check if two strings are similar
   */
  private isSimilar(a: string, b: string): boolean {
    const distance = this.levenshteinDistance(a.toLowerCase(), b.toLowerCase());
    return distance <= 2;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(a: string, b: string): number {
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
   * Convert descriptor to human-readable format
   */
  descriptorToReadable(descriptor: string): string {
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
        // Object type
        const end = descriptor.indexOf(';', i);
        const className = descriptor.substring(i + 1, end).replace(/\//g, '.');
        i = end + 1;
        return className;
      }

      if (c === '[') {
        // Array
        i++;
        return `${parseType()}[]`;
      }

      return '';
    };

    // For method descriptors: (params)returnType
    if (descriptor.startsWith('(')) {
      i = 1; // Skip '('
      const params: string[] = [];

      while (descriptor[i] !== ')') {
        params.push(parseType());
      }

      i++; // Skip ')'
      const returnType = parseType();

      return `${returnType} (${params.join(', ')})`;
    }

    // For field descriptors
    return parseType();
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
