import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import { getDatabase } from '../cache/database.js';
import { getVineflower } from '../java/vineflower.js';
import type { MappingType } from '../types/minecraft.js';
import { ClassNotFoundError, DecompilationError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { extractSourcesJar, inspectJar } from '../utils/jar-inspector.js';
import { logger } from '../utils/logger.js';
import { classNameToPath, getDecompiledPath, getRemappedJarPath, paths } from '../utils/paths.js';
import { getBytecodeIndexService } from './bytecode-index-service.js';
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
   *
   * A COMPILED input JAR is also registered as this version key's remapped JAR
   * (see `registerAsRemappedJar`), which is what keeps the bytecode-backed
   * validators (`validate_access_transformer` / `validate_access_widener`)
   * working for patched Forge/NeoForge versions.
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
      // Backfill the remapped JAR for caches decompiled before it was registered
      // here — otherwise the bytecode validators stay broken for this key until
      // the user force re-decompiles.
      if (
        !existsSync(getRemappedJarPath(version, mapping)) &&
        inspectJar(jarPath).type === 'compiled'
      ) {
        this.registerAsRemappedJar(jarPath, version, mapping);
      }
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
        // No bytecode exists anywhere in this flow, so there is nothing to
        // register as a remapped JAR — the bytecode validators detect the
        // sources-only case and say so explicitly.
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
      // Register AFTER a successful decompile so a failed run leaves no JAR
      // claiming to back a source tree that does not exist.
      this.registerAsRemappedJar(jarPath, version, mapping);
      logger.info(`Local JAR decompilation complete: ${outputDir}`);
      return { outputDir, mode: 'decompiled' };
    } catch (error) {
      this.cache.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Register a compiled local JAR as the remapped JAR for its version key.
   *
   * The patched-JAR flow does no remapping — the caller asserts the JAR is
   * already in `mapping` — so the input JAR IS this version's remapped JAR by
   * definition. Copying it under `remapped/{version}-{mapping}.jar` means every
   * bytecode consumer (`cache-manager.hasRemappedJar`, `BytecodeIndexService`,
   * and so the AT/AW validators) resolves a patched key through exactly the same
   * path as a vanilla one — no branching on "is this patched?" anywhere
   * downstream, matching how the opaque version key flows through the rest of
   * the system.
   *
   * We copy rather than symlink/point-at-source because the user's JAR lives in
   * a Gradle/NFRT cache that they may clean at any time; the copy is a snapshot
   * consistent with the decompiled source tree taken from the same JAR, and
   * `force: true` re-runs both together. Always overwrites, so re-running after
   * a rebuilt patched JAR refreshes it (and the new size/mtime invalidates the
   * bytecode sidecar automatically).
   */
  registerAsRemappedJar(jarPath: string, version: string, mapping: MappingType): void {
    const dest = getRemappedJarPath(version, mapping);
    if (resolve(jarPath) === resolve(dest)) return;
    try {
      ensureDir(paths.remapped());
      copyFileSync(jarPath, dest);
      logger.info(`Registered ${jarPath} as remapped JAR for ${version}/${mapping}: ${dest}`);
    } catch (error) {
      // Non-fatal: decompiled source is already written and usable. Only the
      // bytecode-backed validators degrade, and they report why.
      logger.warn(
        `Failed to register remapped JAR for ${version}/${mapping} — bytecode validation will be unavailable: ${String(error)}`,
      );
    }
  }

  /**
   * Force-clear all cached state for (version, mapping):
   *   - decompiled source directory
   *   - decompile_jobs row (so getOrCreateJob doesn't short-circuit)
   *   - FTS5 search index entries (so stale results don't surface)
   *   - the AT validator's bytecode sidecar cache (rebuilt from the new JAR)
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
    // The remapped JAR itself is deliberately KEPT (re-remapping a vanilla
    // version is expensive, and the patched flow overwrites it on the next run),
    // so its size/mtime signature would not necessarily change — clearing the
    // sidecar here is what actually guarantees a fresh read after a force.
    logger.info(`Force: clearing bytecode cache for ${version}/${mapping}`);
    getBytecodeIndexService().clearCache(version, mapping);
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
