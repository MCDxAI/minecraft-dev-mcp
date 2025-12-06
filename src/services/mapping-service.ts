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
import { parseTinyV2 } from '../parsers/tiny-v2.js';

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

  /**
   * Lookup a symbol mapping between namespaces
   * Searches for class, method, or field names and returns the translation
   *
   * Note: Tiny v2 files contain multiple namespaces. For yarn mappings,
   * the namespaces are typically: official, intermediary, named
   * So we can look up between any of these in a single file.
   */
  async lookupMapping(
    version: string,
    symbol: string,
    sourceMapping: MappingType,
    targetMapping: MappingType,
  ): Promise<{
    found: boolean;
    type?: 'class' | 'method' | 'field';
    source: string;
    target?: string;
    className?: string;
  }> {
    logger.info(`Looking up mapping: ${symbol} (${sourceMapping} -> ${targetMapping})`);

    // Yarn mappings contain all namespaces (official, intermediary, named)
    // So we can use yarn to translate between any of them
    // Use yarn mappings as the primary lookup source
    const mappingPath = await this.getMappings(version, 'yarn');
    const mappingData = parseTinyV2(mappingPath);

    // Determine namespace names
    const sourceNamespace = this.getMappingNamespace(sourceMapping);
    const targetNamespace = this.getMappingNamespace(targetMapping);

    const sourceIndex = mappingData.header.namespaces.indexOf(sourceNamespace);
    const targetIndex = mappingData.header.namespaces.indexOf(targetNamespace);

    if (sourceIndex === -1) {
      // Return not found instead of throwing
      return {
        found: false,
        source: symbol,
      };
    }

    if (targetIndex === -1) {
      return {
        found: false,
        source: symbol,
      };
    }

    // Search for the symbol
    for (const cls of mappingData.classes) {
      const sourceName = cls.names[sourceIndex];
      const targetName = cls.names[targetIndex];

      // Check class name match (support simple name or full path)
      if (sourceName === symbol || sourceName.endsWith(`/${symbol}`) || sourceName.replace(/\//g, '.').endsWith(`.${symbol}`)) {
        return {
          found: true,
          type: 'class',
          source: sourceName,
          target: targetName,
        };
      }

      // Check method names
      for (const method of cls.methods) {
        const sourceMethodName = method.names[sourceIndex];
        if (sourceMethodName === symbol) {
          const targetMethodName = method.names[targetIndex];
          return {
            found: true,
            type: 'method',
            source: sourceMethodName,
            target: targetMethodName,
            className: sourceName,
          };
        }
      }

      // Check field names
      for (const field of cls.fields) {
        const sourceFieldName = field.names[sourceIndex];
        if (sourceFieldName === symbol) {
          const targetFieldName = field.names[targetIndex];
          return {
            found: true,
            type: 'field',
            source: sourceFieldName,
            target: targetFieldName,
            className: sourceName,
          };
        }
      }
    }

    return {
      found: false,
      source: symbol,
    };
  }

  /**
   * Get the namespace name for a mapping type
   */
  private getMappingNamespace(mapping: MappingType): string {
    switch (mapping) {
      case 'yarn':
        return 'named';
      case 'intermediary':
        return 'intermediary';
      case 'mojmap':
        return 'official'; // Mojmap uses obfuscated -> named, but we only have official
      default:
        return 'official';
    }
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
