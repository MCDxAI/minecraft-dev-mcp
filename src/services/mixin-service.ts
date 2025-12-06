/**
 * Mixin Analysis Service
 *
 * Parses, validates, and provides suggestions for Mixin classes.
 * Supports full validation against Minecraft target classes with fix suggestions.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger.js';
import { MixinParseError } from '../utils/errors.js';
import { getDecompileService } from './decompile-service.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { getDecompiledPath } from '../utils/paths.js';
import type {
  MixinClass,
  MixinInjection,
  MixinInjectionType,
  MixinShadow,
  MixinAccessor,
  MixinValidationResult,
  MixinValidationError,
  MixinValidationWarning,
  MixinSuggestion,
  MappingType,
} from '../types/minecraft.js';

/**
 * Mixin Analysis Service
 */
export class MixinService {
  /**
   * Parse a single mixin Java source file
   */
  parseMixinSource(source: string, sourcePath?: string): MixinClass | null {
    const lines = source.split('\n');

    // Find @Mixin annotation - may span multiple lines
    let mixinAnnotationLine = -1;
    let mixinTargets: string[] = [];
    let priority = 1000; // Default priority
    let annotationText = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for @Mixin annotation start
      if (line.includes('@Mixin')) {
        mixinAnnotationLine = i;

        // Build complete annotation (may span multiple lines)
        annotationText = line;
        let j = i;
        let parenCount = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

        while (parenCount > 0 && j < lines.length - 1) {
          j++;
          annotationText += ' ' + lines[j];
          parenCount += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
        }

        // Extract content inside @Mixin(...)
        const mixinMatch = annotationText.match(/@Mixin\s*\(\s*([\s\S]*?)\s*\)(?:\s|$)/);
        if (mixinMatch) {
          const annotationContent = mixinMatch[1];

          // Parse targets - handle both single class and array
          // @Mixin(Entity.class) or @Mixin({Entity.class, LivingEntity.class}) or @Mixin(value = {...}, priority = 500)

          // Extract class names - match ClassName.class patterns
          const classMatches = annotationContent.matchAll(/([A-Z][\w.]*?)\.class/g);
          for (const match of classMatches) {
            mixinTargets.push(match[1]);
          }

          // Parse priority
          const priorityMatch = annotationContent.match(/priority\s*=\s*(\d+)/);
          if (priorityMatch) {
            priority = parseInt(priorityMatch[1], 10);
          }
        }
        break;
      }
    }

    if (mixinAnnotationLine === -1 || mixinTargets.length === 0) {
      return null; // Not a mixin file
    }

    // Find class name
    let className = '';
    for (let i = mixinAnnotationLine; i < lines.length; i++) {
      const classMatch = lines[i].match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        className = classMatch[1];
        break;
      }
    }

    if (!className) {
      return null;
    }

    // Find package
    let packageName = '';
    for (const line of lines) {
      const packageMatch = line.match(/^package\s+([\w.]+);/);
      if (packageMatch) {
        packageName = packageMatch[1];
        break;
      }
    }

    const fullClassName = packageName ? `${packageName}.${className}` : className;

    // Parse injections
    const injections = this.parseInjections(lines);

    // Parse shadows
    const shadows = this.parseShadows(lines);

    // Parse accessors
    const accessors = this.parseAccessors(lines);

    return {
      className: fullClassName,
      targets: mixinTargets,
      priority,
      injections,
      shadows,
      accessors,
      sourcePath,
    };
  }

  /**
   * Parse @Inject, @Redirect, @ModifyArg, etc. annotations
   */
  private parseInjections(lines: string[]): MixinInjection[] {
    const injections: MixinInjection[] = [];

    const injectionTypes: Record<string, MixinInjectionType> = {
      '@Inject': 'inject',
      '@Redirect': 'redirect',
      '@ModifyArg': 'modify_arg',
      '@ModifyVariable': 'modify_variable',
      '@ModifyConstant': 'modify_constant',
      '@ModifyReturnValue': 'modify_return_value',
      '@WrapOperation': 'wrap_operation',
      '@WrapMethod': 'wrap_method',
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const [annotation, type] of Object.entries(injectionTypes)) {
        if (line.includes(annotation)) {
          // Build the full annotation text (may span multiple lines)
          let annotationText = line;
          let j = i;
          let parenCount = (annotationText.match(/\(/g) || []).length - (annotationText.match(/\)/g) || []).length;

          while (parenCount > 0 && j < lines.length - 1) {
            j++;
            annotationText += '\n' + lines[j];
            parenCount += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
          }

          // Find the method name (next line with method signature)
          let methodName = '';
          for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
            const methodMatch = lines[k].match(/(?:private|public|protected)?\s*(?:static\s+)?(?:void|[\w<>,\[\]]+)\s+(\w+)\s*\(/);
            if (methodMatch) {
              methodName = methodMatch[1];
              break;
            }
          }

          // Parse method target
          const methodTargetMatch = annotationText.match(/method\s*=\s*["']([^"']+)["']/);
          const targetMethod = methodTargetMatch ? methodTargetMatch[1] : '';

          // Parse @At
          const atMatch = annotationText.match(/@At\s*\(\s*(?:value\s*=\s*)?["'](\w+)["']/);
          const at = atMatch ? atMatch[1] : undefined;

          // Parse @At target
          const atTargetMatch = annotationText.match(/@At\s*\([^)]*target\s*=\s*["']([^"']+)["']/);
          const atTarget = atTargetMatch ? atTargetMatch[1] : undefined;

          // Parse cancellable
          const cancellable = annotationText.includes('cancellable = true') ||
                             annotationText.includes('cancellable=true');

          injections.push({
            type,
            methodName,
            targetMethod,
            at,
            atTarget,
            cancellable,
            line: i + 1,
            rawAnnotation: annotationText.trim(),
          });
        }
      }
    }

    return injections;
  }

  /**
   * Parse @Shadow annotations
   */
  private parseShadows(lines: string[]): MixinShadow[] {
    const shadows: MixinShadow[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('@Shadow')) {
        // Look at the next few lines for the field/method declaration
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLine = lines[j].trim();

          // Skip empty lines and more annotations
          if (!nextLine || nextLine.startsWith('@')) continue;

          // Check for method (has parentheses)
          const methodMatch = nextLine.match(/(?:private|public|protected)?\s*(?:static\s+)?(?:native\s+)?(?:abstract\s+)?([\w<>,\[\]]+)\s+(\w+)\s*\(/);
          if (methodMatch) {
            shadows.push({
              name: methodMatch[2],
              type: methodMatch[1],
              isMethod: true,
              line: j + 1,
            });
            break;
          }

          // Check for field
          const fieldMatch = nextLine.match(/(?:private|public|protected)?\s*(?:static\s+)?(?:final\s+)?([\w<>,\[\]]+)\s+(\w+)\s*[;=]/);
          if (fieldMatch) {
            shadows.push({
              name: fieldMatch[2],
              type: fieldMatch[1],
              isMethod: false,
              line: j + 1,
            });
            break;
          }
        }
      }
    }

    return shadows;
  }

  /**
   * Parse @Accessor and @Invoker annotations
   */
  private parseAccessors(lines: string[]): MixinAccessor[] {
    const accessors: MixinAccessor[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isAccessor = line.includes('@Accessor');
      const isInvoker = line.includes('@Invoker');

      if (isAccessor || isInvoker) {
        // Parse the target from annotation if specified
        const targetMatch = line.match(/@(?:Accessor|Invoker)\s*\(\s*["'](\w+)["']\s*\)/);
        let target = targetMatch ? targetMatch[1] : '';

        // Look for the method declaration
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (!nextLine || nextLine.startsWith('@')) continue;

          const methodMatch = nextLine.match(/([\w<>,\[\]]+)\s+(\w+)\s*\(/);
          if (methodMatch) {
            const methodName = methodMatch[2];

            // Infer target from method name if not specified
            if (!target) {
              if (isAccessor) {
                // getFieldName -> fieldName, setFieldName -> fieldName
                target = methodName.replace(/^(get|set|is)/, '');
                target = target.charAt(0).toLowerCase() + target.slice(1);
              } else {
                // invokeMethodName -> methodName
                target = methodName.replace(/^(invoke|call)/, '');
                target = target.charAt(0).toLowerCase() + target.slice(1);
              }
            }

            accessors.push({
              name: methodName,
              target,
              isInvoker,
              line: j + 1,
            });
            break;
          }
        }
      }
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
    const fabricModJson = entries.find(e => e.entryName === 'fabric.mod.json');
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

    // Also check for decompiled class files (if remapped)
    for (const entry of entries) {
      if (entry.entryName.endsWith('.class') && !entry.entryName.includes('$')) {
        // Try to find corresponding source
        const sourceName = entry.entryName.replace('.class', '.java');
        const sourceEntry = entries.find(e => e.entryName === sourceName);
        if (sourceEntry) {
          // Already processed
          continue;
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
        // Target exists, validate injections against it
        const targetSource = readFileSync(targetPath, 'utf8');

        // Validate each injection
        for (const injection of mixin.injections) {
          const validationResult = this.validateInjection(injection, targetSource, target);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          suggestions.push(...validationResult.suggestions);
        }

        // Validate shadows
        for (const shadow of mixin.shadows) {
          const validationResult = this.validateShadow(shadow, targetSource, target);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          suggestions.push(...validationResult.suggestions);
        }

        // Validate accessors
        for (const accessor of mixin.accessors) {
          const validationResult = this.validateAccessor(accessor, targetSource, target);
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
          message: `@Inject at INVOKE without specific target is fragile`,
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
   * Validate an injection against target source
   */
  private validateInjection(
    injection: MixinInjection,
    targetSource: string,
    targetClass: string,
  ): { errors: MixinValidationError[]; warnings: MixinValidationWarning[]; suggestions: MixinSuggestion[] } {
    const errors: MixinValidationError[] = [];
    const warnings: MixinValidationWarning[] = [];
    const suggestions: MixinSuggestion[] = [];

    if (!injection.targetMethod) {
      return { errors, warnings, suggestions };
    }

    // Extract method name from target (may include descriptor)
    const methodName = injection.targetMethod.split('(')[0];

    // Check if method exists in target
    const methodRegex = new RegExp(`\\b${methodName}\\s*\\(`);
    if (!methodRegex.test(targetSource)) {
      errors.push({
        type: 'method_not_found',
        message: `Target method '${methodName}' not found in ${targetClass}`,
        element: injection,
        line: injection.line,
      });

      // Find similar methods
      const methods = this.extractMethodNames(targetSource);
      const similar = this.findSimilar(methodName, methods);
      if (similar.length > 0) {
        suggestions.push({
          type: 'fix_method',
          message: `Similar methods in target: ${similar.slice(0, 3).join(', ')}`,
          element: injection,
          line: injection.line,
        });
      }
    }

    // Warn about HEAD injections in constructors
    if (injection.at === 'HEAD' && methodName === '<init>') {
      warnings.push({
        type: 'fragile_injection',
        message: 'Injecting at HEAD of constructor is fragile - consider using @Inject with at = @At(value = "INVOKE", target = "super()")',
        element: injection,
        line: injection.line,
      });
    }

    return { errors, warnings, suggestions };
  }

  /**
   * Validate a shadow against target source
   */
  private validateShadow(
    shadow: MixinShadow,
    targetSource: string,
    targetClass: string,
  ): { errors: MixinValidationError[]; warnings: MixinValidationWarning[]; suggestions: MixinSuggestion[] } {
    const errors: MixinValidationError[] = [];
    const warnings: MixinValidationWarning[] = [];
    const suggestions: MixinSuggestion[] = [];

    // Check if the shadowed field/method exists
    const pattern = shadow.isMethod
      ? new RegExp(`\\b${shadow.name}\\s*\\(`)
      : new RegExp(`\\b${shadow.name}\\s*[;=]`);

    if (!pattern.test(targetSource)) {
      errors.push({
        type: 'shadow_not_found',
        message: `Shadow ${shadow.isMethod ? 'method' : 'field'} '${shadow.name}' not found in ${targetClass}`,
        element: shadow,
        line: shadow.line,
      });

      // Find similar names
      const names = shadow.isMethod
        ? this.extractMethodNames(targetSource)
        : this.extractFieldNames(targetSource);
      const similar = this.findSimilar(shadow.name, names);
      if (similar.length > 0) {
        suggestions.push({
          type: 'fix_method',
          message: `Similar ${shadow.isMethod ? 'methods' : 'fields'}: ${similar.slice(0, 3).join(', ')}`,
          element: shadow,
          line: shadow.line,
        });
      }
    }

    return { errors, warnings, suggestions };
  }

  /**
   * Validate an accessor against target source
   */
  private validateAccessor(
    accessor: MixinAccessor,
    targetSource: string,
    targetClass: string,
  ): { errors: MixinValidationError[]; warnings: MixinValidationWarning[]; suggestions: MixinSuggestion[] } {
    const errors: MixinValidationError[] = [];
    const warnings: MixinValidationWarning[] = [];
    const suggestions: MixinSuggestion[] = [];

    // Check if target exists
    const pattern = accessor.isInvoker
      ? new RegExp(`\\b${accessor.target}\\s*\\(`)
      : new RegExp(`\\b${accessor.target}\\s*[;=]`);

    if (!pattern.test(targetSource)) {
      errors.push({
        type: 'shadow_not_found',
        message: `${accessor.isInvoker ? 'Invoker' : 'Accessor'} target '${accessor.target}' not found in ${targetClass}`,
        element: accessor,
        line: accessor.line,
      });
    }

    return { errors, warnings, suggestions };
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
    const relativePath = className.replace(/\./g, '/') + '.java';
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
      } catch {
        // Ignore permission errors
      }
      return null;
    };

    return search(basePath);
  }

  /**
   * Find similar class names
   */
  private findSimilarClasses(className: string, basePath: string, limit = 5): string[] {
    const simpleName = className.includes('.') ? className.split('.').pop()! : className;
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
            if (this.isSimilar(simpleName, name)) {
              similar.push(prefix ? `${prefix}.${name}` : name);
            }
          }
        }
      } catch {
        // Ignore
      }
    };

    search(basePath, '');
    return similar.slice(0, limit);
  }

  /**
   * Extract method names from source
   */
  private extractMethodNames(source: string): string[] {
    const methods: string[] = [];
    const regex = /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>,\[\]]+)\s+(\w+)\s*\(/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
      methods.push(match[1]);
    }
    return [...new Set(methods)];
  }

  /**
   * Extract field names from source
   */
  private extractFieldNames(source: string): string[] {
    const fields: string[] = [];
    const regex = /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>,\[\]]+)\s+(\w+)\s*[;=]/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
      fields.push(match[1]);
    }
    return [...new Set(fields)];
  }

  /**
   * Find similar strings using Levenshtein distance
   */
  private findSimilar(target: string, candidates: string[], maxDistance = 3): string[] {
    return candidates
      .map(c => ({ name: c, distance: this.levenshteinDistance(target.toLowerCase(), c.toLowerCase()) }))
      .filter(c => c.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .map(c => c.name);
  }

  /**
   * Check if two strings are similar
   */
  private isSimilar(a: string, b: string): boolean {
    const distance = this.levenshteinDistance(a.toLowerCase(), b.toLowerCase());
    return distance <= 3 || b.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(b.toLowerCase());
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
      validMixins: results.filter(r => r.isValid).length,
      invalidMixins: results.filter(r => !r.isValid).length,
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
