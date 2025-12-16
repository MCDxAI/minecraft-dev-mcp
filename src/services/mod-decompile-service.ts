import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import { getVineflower } from '../java/vineflower.js';
import type { MappingType } from '../types/minecraft.js';
import { ClassNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizePath } from '../utils/path-converter.js';
import { classNameToPath, getDecompiledModPath } from '../utils/paths.js';
import { getModAnalyzerService } from './mod-analyzer-service.js';

/**
 * Service for decompiling mod JARs
 */
export class ModDecompileService {
  private vineflower = getVineflower();
  private modAnalyzer = getModAnalyzerService();
  private cache = getCacheManager();

  /**
   * Decompile a mod JAR (if not already done)
   * @param jarPath - Path to the mod JAR file (can be WSL or Windows path)
   * @param mapping - Mapping type used (should match the JAR's mapping)
   * @param modId - Optional mod ID (will be auto-detected if not provided)
   * @param modVersion - Optional mod version (will be auto-detected if not provided)
   * @param onProgress - Optional progress callback
   */
  async decompileMod(
    jarPath: string,
    mapping: MappingType,
    modId?: string,
    modVersion?: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ outputDir: string; modId: string; modVersion: string }> {
    // Normalize the input path for the current platform
    const normalizedJarPath = normalizePath(jarPath);

    if (!existsSync(normalizedJarPath)) {
      throw new Error(`Mod JAR not found at: ${normalizedJarPath}`);
    }

    // Auto-detect mod ID and version if not provided
    if (!modId || !modVersion) {
      logger.info('Auto-detecting mod metadata from JAR');
      const analysis = await this.modAnalyzer.analyzeMod(normalizedJarPath);

      if (!analysis.metadata?.id) {
        throw new Error(
          'Could not detect mod ID from JAR. Please provide modId parameter explicitly.',
        );
      }

      if (!analysis.metadata?.version) {
        throw new Error(
          'Could not detect mod version from JAR. Please provide modVersion parameter explicitly.',
        );
      }

      modId = analysis.metadata.id;
      modVersion = analysis.metadata.version;
      logger.info(`Detected mod: ${modId} v${modVersion}`);
    }

    const outputDir = getDecompiledModPath(modId, modVersion, mapping);

    // Check if already decompiled
    if (this.cache.hasDecompiledModSource(modId, modVersion, mapping)) {
      logger.info(`Mod ${modId} v${modVersion} with ${mapping} mappings already decompiled`);
      return { outputDir, modId, modVersion };
    }

    logger.info(`Decompiling mod ${modId} v${modVersion} with ${mapping} mappings`);

    // Create or get decompile job
    const jobId = this.cache.getOrCreateModJob(modId, modVersion, mapping, normalizedJarPath);

    try {
      // Decompile
      this.cache.updateModJobProgress(jobId, 0);

      await this.vineflower.decompile(normalizedJarPath, outputDir, {
        decompileGenerics: true,
        hideDefaultConstructor: false,
        asciiStrings: true,
        removeSynthetic: true,
        literalsAsIs: true,
        threads: 4,
        onProgress: (current, total) => {
          const progress = (current / total) * 100;
          this.cache.updateModJobProgress(jobId, progress);

          if (onProgress) {
            onProgress(current, total);
          }

          if (current % 100 === 0) {
            logger.info(`Decompilation progress: ${current}/${total} (${progress.toFixed(1)}%)`);
          }
        },
      });

      this.cache.completeModJob(jobId);
      logger.info(`Mod decompilation complete: ${outputDir}`);

      return { outputDir, modId, modVersion };
    } catch (error) {
      this.cache.failModJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Get source code for a specific class in a decompiled mod
   */
  async getModClassSource(
    modId: string,
    modVersion: string,
    className: string,
    mapping: MappingType,
  ): Promise<string> {
    // Ensure mod is decompiled
    if (!this.cache.hasDecompiledModSource(modId, modVersion, mapping)) {
      throw new Error(
        `Mod ${modId} v${modVersion} with ${mapping} mappings is not decompiled. Use decompile_mod_jar first.`,
      );
    }

    const decompiledDir = this.cache.getDecompiledModSourcePath(modId, modVersion, mapping);

    // Build path to class file
    const classPath = classNameToPath(className);
    const fullPath = join(decompiledDir, classPath);

    if (!existsSync(fullPath)) {
      throw new ClassNotFoundError(
        className,
        `${modId}:${modVersion}`,
        `Class file not found at ${fullPath}`,
      );
    }

    logger.debug(`Reading mod class source: ${fullPath}`);
    return readFileSync(fullPath, 'utf8');
  }

  /**
   * Check if mod is decompiled
   */
  isModDecompiled(modId: string, modVersion: string, mapping: MappingType): boolean {
    return this.cache.hasDecompiledModSource(modId, modVersion, mapping);
  }

  /**
   * Get decompiled mod path
   */
  getDecompiledModPath(modId: string, modVersion: string, mapping: MappingType): string {
    return this.cache.getDecompiledModSourcePath(modId, modVersion, mapping);
  }
}

// Singleton instance
let modDecompileServiceInstance: ModDecompileService | undefined;

export function getModDecompileService(): ModDecompileService {
  if (!modDecompileServiceInstance) {
    modDecompileServiceInstance = new ModDecompileService();
  }
  return modDecompileServiceInstance;
}
