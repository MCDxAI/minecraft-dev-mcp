import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import { getVineflower } from '../java/vineflower.js';
import type { MappingType } from '../types/minecraft.js';
import { ClassNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { classNameToPath, getDecompiledPath } from '../utils/paths.js';
import { getRemapService } from './remap-service.js';

/**
 * Service for decompiling Minecraft JARs
 */
export class DecompileService {
  private vineflower = getVineflower();
  private remapService = getRemapService();
  private cache = getCacheManager();

  /**
   * Decompile a Minecraft version (if not already done)
   */
  async decompileVersion(
    version: string,
    mapping: MappingType,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string> {
    const outputDir = getDecompiledPath(version, mapping);

    // Check if already decompiled
    if (this.cache.hasDecompiledSource(version, mapping)) {
      logger.info(`Version ${version} with ${mapping} mappings already decompiled`);
      return outputDir;
    }

    logger.info(`Decompiling Minecraft ${version} with ${mapping} mappings`);

    // Create or get decompile job
    const jobId = this.cache.getOrCreateJob(version, mapping);

    try {
      // Get remapped JAR
      const remappedJar = await this.remapService.getRemappedJar(version, mapping, (progress) => {
        logger.debug(`Remap progress: ${progress}`);
      });

      // Decompile
      this.cache.updateJobProgress(jobId, 0);

      await this.vineflower.decompile(remappedJar, outputDir, {
        decompileGenerics: true,
        hideDefaultConstructor: false,
        asciiStrings: true,
        removeSynthetic: true,
        literalsAsIs: true,
        threads: 4,
        onProgress: (current, total) => {
          const progress = (current / total) * 100;
          this.cache.updateJobProgress(jobId, progress);

          if (onProgress) {
            onProgress(current, total);
          }

          if (current % 100 === 0) {
            logger.info(`Decompilation progress: ${current}/${total} (${progress.toFixed(1)}%)`);
          }
        },
      });

      this.cache.completeJob(jobId);
      logger.info(`Decompilation complete: ${outputDir}`);

      return outputDir;
    } catch (error) {
      this.cache.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Get source code for a specific class
   */
  async getClassSource(version: string, className: string, mapping: MappingType): Promise<string> {
    // Ensure version is decompiled
    const decompiledDir = await this.decompileVersion(version, mapping);

    // Build path to class file
    const classPath = classNameToPath(className);
    const fullPath = join(decompiledDir, classPath);

    if (!existsSync(fullPath)) {
      throw new ClassNotFoundError(className, version, `Class file not found at ${fullPath}`);
    }

    logger.debug(`Reading class source: ${fullPath}`);
    return readFileSync(fullPath, 'utf8');
  }

  /**
   * Check if version is decompiled
   */
  isDecompiled(version: string, mapping: MappingType): boolean {
    return this.cache.hasDecompiledSource(version, mapping);
  }

  /**
   * Get decompiled source directory
   */
  getDecompiledDir(version: string, mapping: MappingType): string {
    return getDecompiledPath(version, mapping);
  }
}

// Singleton instance
let decompileServiceInstance: DecompileService | undefined;

export function getDecompileService(): DecompileService {
  if (!decompileServiceInstance) {
    decompileServiceInstance = new DecompileService();
  }
  return decompileServiceInstance;
}
