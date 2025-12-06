import { getMojangDownloader } from '../downloaders/mojang-downloader.js';
import { getFabricMaven } from '../downloaders/fabric-maven.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { logger } from '../utils/logger.js';
import { MappingNotFoundError } from '../utils/errors.js';
import type { MappingType } from '../types/minecraft.js';
import AdmZip from 'adm-zip';
import { writeFileSync } from 'node:fs';
import { ensureDir } from '../utils/file-utils.js';
import { dirname } from 'node:path';

/**
 * Manages mapping downloads and caching
 */
export class MappingService {
  private mojangDownloader = getMojangDownloader();
  private fabricMaven = getFabricMaven();
  private cache = getCacheManager();

  /**
   * Get or download mappings for a version
   */
  async getMappings(version: string, mappingType: MappingType): Promise<string> {
    // Check cache first
    const cachedPath = this.cache.getMappingPath(version, mappingType);
    if (cachedPath) {
      logger.info(`Using cached ${mappingType} mappings for ${version}: ${cachedPath}`);
      return cachedPath;
    }

    // Download based on type
    logger.info(`Downloading ${mappingType} mappings for ${version}`);
    let mappingPath: string;

    switch (mappingType) {
      case 'mojmap':
        mappingPath = await this.mojangDownloader.downloadMojangMappings(version);
        break;
      case 'yarn':
        mappingPath = await this.downloadAndExtractYarn(version);
        break;
      case 'intermediary':
        mappingPath = await this.downloadAndExtractIntermediary(version);
        break;
      default:
        throw new MappingNotFoundError(version, mappingType, `Unsupported mapping type: ${mappingType}`);
    }

    // Cache the mapping
    this.cache.cacheMapping(version, mappingType, mappingPath);

    return mappingPath;
  }

  /**
   * Download and extract Yarn mappings from JAR
   */
  private async downloadAndExtractYarn(version: string): Promise<string> {
    const jarPath = await this.fabricMaven.downloadYarnMappings(version);

    // Extract mappings.tiny from the JAR
    const zip = new AdmZip(jarPath);
    const mappingEntry = zip.getEntry('mappings/mappings.tiny');

    if (!mappingEntry) {
      throw new MappingNotFoundError(
        version,
        'yarn',
        'mappings.tiny not found in Yarn JAR',
      );
    }

    // Save extracted mappings
    const extractedPath = jarPath.replace('.jar', '.tiny');
    const content = mappingEntry.getData();
    ensureDir(dirname(extractedPath));
    writeFileSync(extractedPath, content);

    logger.info(`Extracted Yarn mappings to ${extractedPath}`);
    return extractedPath;
  }

  /**
   * Download and extract Intermediary mappings from JAR
   */
  private async downloadAndExtractIntermediary(version: string): Promise<string> {
    const jarPath = await this.fabricMaven.downloadIntermediaryMappings(version);

    // Extract mappings.tiny from the JAR
    const zip = new AdmZip(jarPath);
    const mappingEntry = zip.getEntry('mappings/mappings.tiny');

    if (!mappingEntry) {
      throw new MappingNotFoundError(
        version,
        'intermediary',
        'mappings.tiny not found in Intermediary JAR',
      );
    }

    // Save extracted mappings
    const extractedPath = jarPath.replace('.jar', '.tiny');
    const content = mappingEntry.getData();
    ensureDir(dirname(extractedPath));
    writeFileSync(extractedPath, content);

    logger.info(`Extracted Intermediary mappings to ${extractedPath}`);
    return extractedPath;
  }

  /**
   * Check if mappings are available
   */
  hasMappings(version: string, mappingType: MappingType): boolean {
    return this.cache.hasMappings(version, mappingType);
  }

  /**
   * Verify mappings exist for a version
   */
  async verifyMappingsAvailable(version: string, mappingType: MappingType): Promise<void> {
    // For Yarn, check Maven
    if (mappingType === 'yarn') {
      const exists = await this.fabricMaven.yarnMappingsExist(version);
      if (!exists) {
        throw new MappingNotFoundError(version, mappingType);
      }
    }
    // Mojmap should always exist for 1.21.1+
    // Intermediary should exist for all Fabric-supported versions
  }
}

// Singleton instance
let mappingServiceInstance: MappingService | undefined;

export function getMappingService(): MappingService {
  if (!mappingServiceInstance) {
    mappingServiceInstance = new MappingService();
  }
  return mappingServiceInstance;
}
