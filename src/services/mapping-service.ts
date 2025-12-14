import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { getCacheManager } from '../cache/cache-manager.js';
import { getFabricMaven } from '../downloaders/fabric-maven.js';
import { getMojangDownloader } from '../downloaders/mojang-downloader.js';
import { getMojang2Tiny } from '../java/mojang2tiny.js';
import { parseTinyV2 } from '../parsers/tiny-v2.js';
import type { MappingType } from '../types/minecraft.js';
import { MappingNotFoundError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { getMojmapConversionDir, getMojmapTinyPath, paths } from '../utils/paths.js';

/**
 * Convert Tiny v2 format to Tiny v1 format.
 *
 * mojang2tiny expects intermediary mappings in Tiny v1 format:
 *   v1\tofficial\tintermediary
 *   CLASS\ta\tnet/minecraft/class_1234
 *   FIELD\ta\tLjava/lang/String;\ta\tfield_5678
 *   METHOD\ta\t()V\ta\tmethod_9012
 *
 * But Fabric Maven provides Tiny v2 format:
 *   tiny\t2\t0\tofficial\tintermediary
 *   c\ta\tnet/minecraft/class_1234
 *   \tf\tLjava/lang/String;\ta\tfield_5678
 *   \tm\t()V\ta\tmethod_9012
 */
function convertTinyV2ToV1(inputPath: string, outputPath: string): void {
  const content = readFileSync(inputPath, 'utf8');
  const lines = content.split('\n');
  const outputLines: string[] = [];

  let currentClass = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0) {
      // Convert header: "tiny\t2\t0\tofficial\tintermediary" -> "v1\tofficial\tintermediary"
      const parts = line.split('\t');
      if (parts[0] === 'tiny' && parts[1] === '2') {
        // Skip "tiny", "2", "0", take rest as namespaces
        const namespaces = parts.slice(3).join('\t');
        outputLines.push(`v1\t${namespaces}`);
      } else {
        // Already v1 or unknown format, pass through
        outputLines.push(line);
      }
      continue;
    }

    // Convert class entries: "c\tobf\tintermediary" -> "CLASS\tobf\tintermediary"
    if (line.startsWith('c\t')) {
      const parts = line.split('\t');
      currentClass = parts[1]; // Store obfuscated class name
      outputLines.push(`CLASS\t${parts.slice(1).join('\t')}`);
    }
    // Convert field entries: "\tf\ttype\tobf\tintermediary" -> "FIELD\tclass\ttype\tobf\tintermediary"
    else if (line.startsWith('\tf\t')) {
      const parts = line.split('\t');
      // parts: ['', 'f', type, obfName, intermediaryName]
      if (parts.length >= 5) {
        outputLines.push(`FIELD\t${currentClass}\t${parts[2]}\t${parts[3]}\t${parts[4]}`);
      }
    }
    // Convert method entries: "\tm\tsig\tobf\tintermediary" -> "METHOD\tclass\tsig\tobf\tintermediary"
    else if (line.startsWith('\tm\t')) {
      const parts = line.split('\t');
      // parts: ['', 'm', sig, obfName, intermediaryName]
      if (parts.length >= 5) {
        outputLines.push(`METHOD\t${currentClass}\t${parts[2]}\t${parts[3]}\t${parts[4]}`);
      }
    }
    // Skip comments, nested content, and empty lines for v1 format
    // (handled by not adding them to outputLines)
  }

  writeFileSync(outputPath, outputLines.join('\n'));
  logger.info(`Converted Tiny v2 to v1 format: ${outputPath}`);
}

/**
 * Post-process mojang2tiny output to proper Tiny v2 format.
 *
 * mojang2tiny outputs an invalid hybrid format with 3 namespaces in data but 2 in header:
 *   v2\tintermediary\tnamed
 *   CLASS\tobf\tint\tnamed           (3 names but header says 2 namespaces)
 *   \tFIELD\tobfClass\ttype\tobfName\tintName\tnamedName
 *   \tMETHOD\tobfClass\tsig\tobfName\tintName\tnamedName
 *
 * Proper Tiny v2 format (2 namespaces means 2 names per entry):
 *   tiny\t2\t0\tintermediary\tnamed
 *   c\tint\tnamed                    (only 2 names matching header)
 *   \tf\ttype\tintName\tnamedName
 *   \tm\tsig\tintName\tnamedName
 */
function postProcessMojang2TinyOutput(inputPath: string, outputPath: string): void {
  const content = readFileSync(inputPath, 'utf8');
  const lines = content.split('\n');
  const outputLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0) {
      // Fix header: "v2\tintermediary\tnamed" -> "tiny\t2\t0\tintermediary\tnamed"
      if (line.startsWith('v2\t')) {
        const namespaces = line.substring(3); // Remove "v2\t"
        outputLines.push(`tiny\t2\t0\t${namespaces}`);
      } else if (line.startsWith('v1\t')) {
        // If v1 format, convert to v2
        const namespaces = line.substring(3);
        outputLines.push(`tiny\t2\t0\t${namespaces}`);
      } else {
        outputLines.push(line);
      }
      continue;
    }

    // Convert CLASS/FIELD/METHOD tokens to c/f/m and remove obfuscated column
    if (line.startsWith('CLASS\t')) {
      // CLASS\tobf\tint\tnamed -> c\tint\tnamed (remove obfuscated name)
      const parts = line.split('\t');
      // parts: ['CLASS', obf, int, named]
      if (parts.length >= 4) {
        outputLines.push(`c\t${parts[2]}\t${parts[3]}`);
      } else if (parts.length === 3) {
        // Fallback if already 2 names
        outputLines.push(`c\t${parts[1]}\t${parts[2]}`);
      } else {
        outputLines.push(line);
      }
    } else if (line.startsWith('\tFIELD\t')) {
      // \tFIELD\tobfClass\ttype\tobfName\tintName\tnamedName
      // -> \tf\ttype\tintName\tnamedName (remove obfClass and obfName)
      const parts = line.split('\t');
      // parts: ['', 'FIELD', obfClass, type, obfName, intName, namedName]
      if (parts.length >= 7) {
        outputLines.push(`\tf\t${parts[3]}\t${parts[5]}\t${parts[6]}`);
      } else {
        outputLines.push(line);
      }
    } else if (line.startsWith('\tMETHOD\t')) {
      // \tMETHOD\tobfClass\tsig\tobfName\tintName\tnamedName
      // -> \tm\tsig\tintName\tnamedName (remove obfClass and obfName)
      const parts = line.split('\t');
      // parts: ['', 'METHOD', obfClass, sig, obfName, intName, namedName]
      if (parts.length >= 7) {
        outputLines.push(`\tm\t${parts[3]}\t${parts[5]}\t${parts[6]}`);
      } else {
        outputLines.push(line);
      }
    } else {
      outputLines.push(line);
    }
  }

  writeFileSync(outputPath, outputLines.join('\n'));
  logger.info(`Post-processed mojang2tiny output to proper Tiny v2 format: ${outputPath}`);
}

/**
 * Manages mapping downloads and caching
 */
export class MappingService {
  private mojangDownloader = getMojangDownloader();
  private fabricMaven = getFabricMaven();
  private cache = getCacheManager();

  // Lock to prevent concurrent downloads of the same mappings
  private downloadLocks = new Map<string, Promise<string>>();

  /**
   * Get or download mappings for a version
   * Uses locking to prevent concurrent downloads of the same mapping
   */
  async getMappings(version: string, mappingType: MappingType): Promise<string> {
    const lockKey = `${version}-${mappingType}`;

    // For Mojmap, check for converted Tiny file first (not raw ProGuard)
    if (mappingType === 'mojmap') {
      const convertedPath = getMojmapTinyPath(version);
      if (existsSync(convertedPath)) {
        logger.info(`Using cached Mojmap (Tiny format) mappings for ${version}: ${convertedPath}`);
        return convertedPath;
      }

      // Check if download is already in progress
      const existingDownload = this.downloadLocks.get(lockKey);
      if (existingDownload) {
        logger.info(`Waiting for existing Mojmap download of ${version} to complete`);
        return existingDownload;
      }

      // Download and convert Mojmap with lock
      const downloadPromise = this.downloadAndConvertMojmap(version);
      this.downloadLocks.set(lockKey, downloadPromise);
      try {
        return await downloadPromise;
      } finally {
        this.downloadLocks.delete(lockKey);
      }
    }

    // Check cache first for other mapping types
    const cachedPath = this.cache.getMappingPath(version, mappingType);
    if (cachedPath) {
      logger.info(`Using cached ${mappingType} mappings for ${version}: ${cachedPath}`);
      return cachedPath;
    }

    // Check if download is already in progress
    const existingDownload = this.downloadLocks.get(lockKey);
    if (existingDownload) {
      logger.info(`Waiting for existing ${mappingType} download of ${version} to complete`);
      return existingDownload;
    }

    // Download based on type with lock
    logger.info(`Downloading ${mappingType} mappings for ${version}`);
    let downloadPromise: Promise<string>;

    switch (mappingType) {
      case 'yarn':
        downloadPromise = this.downloadAndExtractYarn(version);
        break;
      case 'intermediary':
        downloadPromise = this.downloadAndExtractIntermediary(version);
        break;
      default:
        throw new MappingNotFoundError(
          version,
          mappingType,
          `Unsupported mapping type: ${mappingType}`,
        );
    }

    this.downloadLocks.set(lockKey, downloadPromise);
    let mappingPath: string;
    try {
      mappingPath = await downloadPromise;
    } finally {
      this.downloadLocks.delete(lockKey);
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
      throw new MappingNotFoundError(version, 'yarn', 'mappings.tiny not found in Yarn JAR');
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
   * Download Mojang mappings and convert from ProGuard to Tiny v2 format
   *
   * Mojang mappings use ProGuard format which tiny-remapper cannot read directly.
   * This method:
   * 1. Downloads the raw ProGuard mappings from Mojang
   * 2. Downloads Intermediary mappings (as a bridge)
   * 3. Converts intermediary from Tiny v2 to v1 (mojang2tiny requires v1 input)
   * 4. Uses mojang2tiny to convert ProGuard → Tiny v2 (intermediary → named)
   * 5. Post-processes mojang2tiny output to proper Tiny v2 format
   */
  private async downloadAndConvertMojmap(version: string): Promise<string> {
    logger.info(`Converting Mojmap for ${version} from ProGuard to Tiny format`);

    // Step 1: Download raw Mojang ProGuard mappings
    const mojangRawPath = await this.mojangDownloader.downloadMojangMappings(version);

    // Step 2: Get Intermediary mappings (download if needed) - this is Tiny v2 format
    const intermediaryV2Path = await this.downloadAndExtractIntermediary(version);

    // Step 3: Convert intermediary from Tiny v2 to v1 (mojang2tiny requires v1 input)
    const conversionDir = getMojmapConversionDir(version);
    ensureDir(conversionDir);
    const intermediaryV1Path = join(conversionDir, `intermediary-${version}-v1.tiny`);
    convertTinyV2ToV1(intermediaryV2Path, intermediaryV1Path);

    // Step 4: Convert using mojang2tiny (now with v1 intermediary input)
    const mojang2tiny = getMojang2Tiny();

    const rawConvertedPath = await mojang2tiny.convert(
      intermediaryV1Path,
      mojangRawPath,
      conversionDir,
      { tinyVersion: 'v2' },
    );

    // Step 5: Post-process to proper Tiny v2 format and save to final location
    // mojang2tiny outputs an invalid hybrid format that needs fixing
    const finalPath = getMojmapTinyPath(version);
    ensureDir(dirname(finalPath));
    postProcessMojang2TinyOutput(rawConvertedPath, finalPath);

    logger.info(`Mojmap converted and saved to ${finalPath}`);

    // Cache the converted mapping
    this.cache.cacheMapping(version, 'mojmap', finalPath);

    return finalPath;
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
      if (
        sourceName === symbol ||
        sourceName.endsWith(`/${symbol}`) ||
        sourceName.replace(/\//g, '.').endsWith(`.${symbol}`)
      ) {
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
