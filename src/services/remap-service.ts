import { existsSync } from 'node:fs';
import { getCacheManager } from '../cache/cache-manager.js';
import { getTinyRemapper } from '../java/tiny-remapper.js';
import type { MappingType } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { getRemappedJarPath } from '../utils/paths.js';
import { getMappingService } from './mapping-service.js';
import { getVersionManager } from './version-manager.js';

/**
 * Service for remapping Minecraft JARs using mappings
 */
export class RemapService {
  private tinyRemapper = getTinyRemapper();
  private cache = getCacheManager();
  private mappingService = getMappingService();
  private versionManager = getVersionManager();

  // Lock to prevent concurrent remapping of the same version+mapping
  private remapLocks = new Map<string, Promise<string>>();

  /**
   * Get or create remapped JAR
   * Uses locking to prevent concurrent remapping of the same version+mapping
   */
  async getRemappedJar(
    version: string,
    mapping: MappingType,
    onProgress?: (progress: string) => void,
  ): Promise<string> {
    const lockKey = `${version}-${mapping}`;

    // Check if remapped JAR already exists
    const outputPath = getRemappedJarPath(version, mapping);
    if (existsSync(outputPath)) {
      logger.info(`Using cached remapped JAR: ${outputPath}`);
      return outputPath;
    }

    // Check if remapping is already in progress
    const existingRemap = this.remapLocks.get(lockKey);
    if (existingRemap) {
      logger.info(`Waiting for existing remapping of ${version} (${mapping}) to complete`);
      return existingRemap;
    }

    // Start remapping with lock
    const remapPromise = this.doGetRemappedJar(version, mapping, outputPath, onProgress);
    this.remapLocks.set(lockKey, remapPromise);

    try {
      return await remapPromise;
    } finally {
      this.remapLocks.delete(lockKey);
    }
  }

  /**
   * Internal method to perform remapping
   */
  private async doGetRemappedJar(
    version: string,
    mapping: MappingType,
    outputPath: string,
    onProgress?: (progress: string) => void,
  ): Promise<string> {
    // Get input JAR (original Minecraft client)
    const inputJar = await this.versionManager.getVersionJar(version, (downloaded, total) => {
      if (onProgress) {
        const percent = ((downloaded / total) * 100).toFixed(1);
        onProgress(`Downloading Minecraft ${version}: ${percent}%`);
      }
    });

    // Yarn mappings require two-step remapping: official -> intermediary -> named
    if (mapping === 'yarn') {
      return await this.remapYarn(version, inputJar, outputPath, onProgress);
    }

    // Mojmap also requires two-step remapping: official -> intermediary -> named
    // (The converted Tiny file has intermediary -> named namespaces)
    if (mapping === 'mojmap') {
      return await this.remapMojmap(version, inputJar, outputPath, onProgress);
    }

    // Get mappings
    const mappingsFile = await this.mappingService.getMappings(version, mapping);

    // Determine namespaces based on mapping type
    const { fromNamespace, toNamespace } = this.getNamespaces(mapping);

    logger.info(`Remapping ${version} from ${fromNamespace} to ${toNamespace}`);

    // Perform remapping
    await this.tinyRemapper.remap(inputJar, outputPath, mappingsFile, {
      fromNamespace,
      toNamespace,
      threads: 4,
      rebuildSourceFilenames: true,
      onProgress,
    });

    logger.info(`Remapped JAR created: ${outputPath}`);
    return outputPath;
  }

  /**
   * Remap using Yarn mappings (two-step process: official -> intermediary -> named)
   */
  private async remapYarn(
    version: string,
    inputJar: string,
    outputPath: string,
    onProgress?: (progress: string) => void,
  ): Promise<string> {
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync } = await import('node:fs');

    // Create temp directory for intermediary JAR
    const tempDir = mkdtempSync(join(tmpdir(), 'mc-remap-'));
    const intermediaryJar = join(tempDir, `${version}-intermediary.jar`);

    try {
      // Step 1: Remap official -> intermediary
      logger.info(`Step 1/2: Remapping ${version} from official to intermediary`);
      const intermediaryMappings = await this.mappingService.getMappings(version, 'intermediary');

      await this.tinyRemapper.remap(inputJar, intermediaryJar, intermediaryMappings, {
        fromNamespace: 'official',
        toNamespace: 'intermediary',
        threads: 4,
        rebuildSourceFilenames: false,
        onProgress: (msg) => onProgress?.(`[1/2] ${msg}`),
      });

      // Step 2: Remap intermediary -> named (Yarn)
      logger.info(`Step 2/2: Remapping ${version} from intermediary to named`);
      const yarnMappings = await this.mappingService.getMappings(version, 'yarn');

      await this.tinyRemapper.remap(intermediaryJar, outputPath, yarnMappings, {
        fromNamespace: 'intermediary',
        toNamespace: 'named',
        threads: 4,
        rebuildSourceFilenames: true,
        onProgress: (msg) => onProgress?.(`[2/2] ${msg}`),
      });

      logger.info(`Yarn remapping complete: ${outputPath}`);
      return outputPath;
    } finally {
      // Clean up temp files
      try {
        const { unlinkSync, rmdirSync } = await import('node:fs');
        if (existsSync(intermediaryJar)) {
          unlinkSync(intermediaryJar);
        }
        rmdirSync(tempDir);
      } catch (error) {
        logger.warn(`Failed to clean up temp directory: ${tempDir}`);
      }
    }
  }

  /**
   * Remap using Mojmap mappings (two-step process: official -> intermediary -> named)
   *
   * Similar to Yarn, Mojmap requires two-step remapping because:
   * 1. The converted Tiny file has namespaces: intermediary -> named
   * 2. We need to first remap from official -> intermediary
   * 3. Then remap from intermediary -> named (Mojang's official names)
   */
  private async remapMojmap(
    version: string,
    inputJar: string,
    outputPath: string,
    onProgress?: (progress: string) => void,
  ): Promise<string> {
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync } = await import('node:fs');

    // Create temp directory for intermediary JAR
    const tempDir = mkdtempSync(join(tmpdir(), 'mc-remap-mojmap-'));
    const intermediaryJar = join(tempDir, `${version}-intermediary.jar`);

    try {
      // Step 1: Remap official -> intermediary
      logger.info(`Step 1/2: Remapping ${version} from official to intermediary (Mojmap)`);
      const intermediaryMappings = await this.mappingService.getMappings(version, 'intermediary');

      await this.tinyRemapper.remap(inputJar, intermediaryJar, intermediaryMappings, {
        fromNamespace: 'official',
        toNamespace: 'intermediary',
        threads: 4,
        rebuildSourceFilenames: false,
        onProgress: (msg) => onProgress?.(`[1/2] ${msg}`),
      });

      // Step 2: Remap intermediary -> named (Mojmap)
      // The converted Mojmap file has namespaces: intermediary, named
      logger.info(`Step 2/2: Remapping ${version} from intermediary to named (Mojmap)`);
      const mojmapMappings = await this.mappingService.getMappings(version, 'mojmap');

      await this.tinyRemapper.remap(intermediaryJar, outputPath, mojmapMappings, {
        fromNamespace: 'intermediary',
        toNamespace: 'named',
        threads: 4,
        rebuildSourceFilenames: true,
        ignoreConflicts: true, // Mojmap may have inheritance conflicts
        onProgress: (msg) => onProgress?.(`[2/2] ${msg}`),
      });

      logger.info(`Mojmap remapping complete: ${outputPath}`);
      return outputPath;
    } finally {
      // Clean up temp files
      try {
        const { unlinkSync, rmdirSync } = await import('node:fs');
        if (existsSync(intermediaryJar)) {
          unlinkSync(intermediaryJar);
        }
        rmdirSync(tempDir);
      } catch (error) {
        logger.warn(`Failed to clean up temp directory: ${tempDir}`);
      }
    }
  }

  /**
   * Get namespaces for mapping type
   */
  private getNamespaces(mapping: MappingType): { fromNamespace: string; toNamespace: string } {
    switch (mapping) {
      case 'yarn':
        return { fromNamespace: 'official', toNamespace: 'named' };
      case 'mojmap':
        // Mojmap uses ProGuard format, not Tiny - handle differently
        return { fromNamespace: 'official', toNamespace: 'named' };
      case 'intermediary':
        return { fromNamespace: 'official', toNamespace: 'intermediary' };
      default:
        throw new Error(`Unsupported mapping type: ${mapping}`);
    }
  }

  /**
   * Check if remapped JAR exists
   */
  hasRemappedJar(version: string, mapping: MappingType): boolean {
    return this.cache.hasRemappedJar(version, mapping);
  }

  /**
   * Remap a mod JAR from intermediary to named mappings
   * This is for remapping Fabric mod JARs to use human-readable names
   */
  async remapModJar(
    inputJar: string,
    outputJar: string,
    mcVersion: string,
    toMapping: MappingType,
    onProgress?: (progress: string) => void,
  ): Promise<string> {
    logger.info(`Remapping mod JAR: ${inputJar} -> ${outputJar}`);

    // Get mappings for the target mapping type
    const mappingsFile = await this.mappingService.getMappings(mcVersion, toMapping);

    // Fabric mods use intermediary names, so we remap from intermediary to named
    const fromNamespace = 'intermediary';
    const toNamespace = toMapping === 'intermediary' ? 'official' : 'named';

    await this.tinyRemapper.remap(inputJar, outputJar, mappingsFile, {
      fromNamespace,
      toNamespace,
      threads: 4,
      rebuildSourceFilenames: true,
      onProgress,
    });

    logger.info(`Mod JAR remapped: ${outputJar}`);
    return outputJar;
  }
}

// Singleton instance
let remapServiceInstance: RemapService | undefined;

export function getRemapService(): RemapService {
  if (!remapServiceInstance) {
    remapServiceInstance = new RemapService();
  }
  return remapServiceInstance;
}
