import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import { getDatabase } from '../cache/database.js';
import { getVineflower } from '../java/vineflower.js';
import type { MappingType } from '../types/minecraft.js';
import { ClassNotFoundError, DecompilationError } from '../utils/errors.js';
import { extractSourcesJar, inspectJar } from '../utils/jar-inspector.js';
import { logger } from '../utils/logger.js';
import { classNameToPath, getDecompiledPath } from '../utils/paths.js';
import { getRemapService } from './remap-service.js';
import { getSearchIndexService } from './search-index-service.js';

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
   * Decompile (or extract) a user-provided local JAR — used for Forge/NeoForge
   * patched Minecraft JARs. The `version` is treated as an opaque cache key;
   * the conventional schema is `<mc>-<loader>-<loaderVersion>` but anything
   * filesystem-safe works.
   *
   * Sources JARs (no .class entries) are extracted directly. Compiled JARs
   * (and mixed JARs that contain any .class) are run through VineFlower.
   * No remapping is performed — caller asserts the JAR is already in `mapping`.
   */
  async decompileLocalJar(
    jarPath: string,
    version: string,
    mapping: MappingType,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ outputDir: string; mode: 'decompiled' | 'extracted' }> {
    if (!existsSync(jarPath)) {
      throw new DecompilationError(version, `Input JAR not found: ${jarPath}`);
    }

    const outputDir = getDecompiledPath(version, mapping);

    if (this.cache.hasDecompiledSource(version, mapping)) {
      logger.info(`${version}/${mapping} already present; skipping (use force to re-run)`);
      return { outputDir, mode: 'decompiled' };
    }

    const inspection = inspectJar(jarPath);
    logger.info(
      `Inspected ${jarPath}: type=${inspection.type} class=${inspection.classCount} java=${inspection.javaCount}`,
    );

    if (inspection.type === 'empty') {
      throw new DecompilationError(version, `JAR contains no .class or .java entries: ${jarPath}`);
    }

    const jobId = this.cache.getOrCreateJob(version, mapping);

    try {
      this.cache.updateJobProgress(jobId, 0);

      if (inspection.type === 'sources') {
        const written = extractSourcesJar(jarPath, outputDir);
        if (onProgress) onProgress(written, written);
        this.cache.completeJob(jobId);
        logger.info(`Sources extraction complete: ${outputDir}`);
        return { outputDir, mode: 'extracted' };
      }

      // compiled (or mixed) → decompile
      await this.vineflower.decompile(jarPath, outputDir, {
        decompileGenerics: true,
        hideDefaultConstructor: false,
        asciiStrings: true,
        removeSynthetic: true,
        literalsAsIs: true,
        threads: 4,
        onProgress: (current, total) => {
          const progress = (current / total) * 100;
          this.cache.updateJobProgress(jobId, progress);
          if (onProgress) onProgress(current, total);
          if (current % 100 === 0) {
            logger.info(`Decompilation progress: ${current}/${total} (${progress.toFixed(1)}%)`);
          }
        },
      });

      this.cache.completeJob(jobId);
      logger.info(`Local JAR decompilation complete: ${outputDir}`);
      return { outputDir, mode: 'decompiled' };
    } catch (error) {
      this.cache.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Force-clear all cached state for (version, mapping):
   *   - decompiled source directory
   *   - decompile_jobs row (so getOrCreateJob doesn't short-circuit)
   *   - FTS5 search index entries (so stale results don't surface)
   *
   * The next decompile call will rebuild from scratch. Indexing must be
   * triggered explicitly via index_minecraft_version after re-decompile.
   */
  forceClear(version: string, mapping: MappingType): void {
    const dir = getDecompiledPath(version, mapping);
    if (existsSync(dir)) {
      logger.info(`Force: removing decompiled directory ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
    logger.info(`Force: clearing decompile job row for ${version}/${mapping}`);
    getDatabase().deleteJob(version, mapping);
    logger.info(`Force: clearing FTS5 index entries for ${version}/${mapping}`);
    getSearchIndexService().clearIndex(version, mapping);
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
