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
import { getMojmapConversionDir, getMojmapTinyPath } from '../utils/paths.js';

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
   * Lookup result type
   */
  private createLookupResult(
    found: boolean,
    source: string,
    target?: string,
    type?: 'class' | 'method' | 'field',
    className?: string,
  ): MappingLookupResult {
    return { found, source, target, type, className };
  }

  /**
   * Lookup a symbol mapping between namespaces
   * Searches for class, method, or field names and returns the translation
   *
   * Mapping files and their namespaces:
   * - intermediary file: 'official' (obfuscated) ↔ 'intermediary'
   * - yarn file: 'intermediary' ↔ 'named' (yarn names)
   * - mojmap file: 'intermediary' ↔ 'named' (mojang names)
   *
   * The routing graph (intermediary is the central hub):
   *   official ←──→ intermediary ←──→ yarn
   *                      ↕
   *                   mojmap
   */
  async lookupMapping(
    version: string,
    symbol: string,
    sourceMapping: MappingType,
    targetMapping: MappingType,
  ): Promise<MappingLookupResult> {
    logger.info(`Looking up mapping: ${symbol} (${sourceMapping} -> ${targetMapping})`);

    // Same mapping type - no translation needed
    if (sourceMapping === targetMapping) {
      return this.createLookupResult(true, symbol, symbol);
    }

    // Determine routing strategy
    const singleFile = this.getSingleFileLookup(sourceMapping, targetMapping);

    if (singleFile) {
      // Direct lookup in a single file
      return this.lookupInSingleFile(version, symbol, sourceMapping, targetMapping, singleFile);
    }

    // Two-step lookup via intermediary bridge
    return this.lookupViaBridge(version, symbol, sourceMapping, targetMapping);
  }

  /**
   * Determine if two mapping types can be looked up in a single file
   * Returns the file type to use, or null if two-step lookup is required
   */
  private getSingleFileLookup(
    source: MappingType,
    target: MappingType,
  ): 'intermediary' | 'yarn' | 'mojmap' | null {
    // official ↔ intermediary: use intermediary file
    if (
      (source === 'official' && target === 'intermediary') ||
      (source === 'intermediary' && target === 'official')
    ) {
      return 'intermediary';
    }

    // intermediary ↔ yarn: use yarn file
    if (
      (source === 'intermediary' && target === 'yarn') ||
      (source === 'yarn' && target === 'intermediary')
    ) {
      return 'yarn';
    }

    // intermediary ↔ mojmap: use mojmap file
    if (
      (source === 'intermediary' && target === 'mojmap') ||
      (source === 'mojmap' && target === 'intermediary')
    ) {
      return 'mojmap';
    }

    // Cross-file lookup required (official↔yarn, official↔mojmap, yarn↔mojmap)
    return null;
  }

  /**
   * Get the namespace name for a mapping type within a specific file
   * Note: fileType is kept for potential future validation but not currently used
   */
  private getNamespaceForType(
    mappingType: MappingType,
    _fileType: 'intermediary' | 'yarn' | 'mojmap',
  ): string {
    // Intermediary file has: official, intermediary
    // Yarn file has: intermediary, named
    // Mojmap file has: intermediary, named

    if (mappingType === 'official') {
      return 'official';
    }

    if (mappingType === 'intermediary') {
      return 'intermediary';
    }

    // Both yarn and mojmap use 'named' namespace in their respective files
    if (mappingType === 'yarn' || mappingType === 'mojmap') {
      return 'named';
    }

    return 'intermediary'; // fallback
  }

  /**
   * Perform lookup in a single mapping file
   */
  private async lookupInSingleFile(
    version: string,
    symbol: string,
    sourceMapping: MappingType,
    targetMapping: MappingType,
    fileType: 'intermediary' | 'yarn' | 'mojmap',
  ): Promise<MappingLookupResult> {
    const mappingPath = await this.getMappings(version, fileType);
    const mappingData = parseTinyV2(mappingPath);

    const sourceNamespace = this.getNamespaceForType(sourceMapping, fileType);
    const targetNamespace = this.getNamespaceForType(targetMapping, fileType);

    const sourceIndex = mappingData.header.namespaces.indexOf(sourceNamespace);
    const targetIndex = mappingData.header.namespaces.indexOf(targetNamespace);

    if (sourceIndex === -1 || targetIndex === -1) {
      logger.warn(
        `Namespace not found in ${fileType} file: source=${sourceNamespace}(${sourceIndex}), target=${targetNamespace}(${targetIndex}). Available: ${mappingData.header.namespaces.join(', ')}`,
      );
      return this.createLookupResult(false, symbol);
    }

    return this.searchInMappingData(mappingData, symbol, sourceIndex, targetIndex);
  }

  /**
   * Perform two-step lookup via intermediary bridge
   *
   * Routes:
   * - official → yarn: official→intermediary (int file), intermediary→yarn (yarn file)
   * - official → mojmap: official→intermediary (int file), intermediary→mojmap (mojmap file)
   * - yarn → official: yarn→intermediary (yarn file), intermediary→official (int file)
   * - mojmap → official: mojmap→intermediary (mojmap file), intermediary→official (int file)
   * - yarn → mojmap: yarn→intermediary (yarn file), intermediary→mojmap (mojmap file)
   * - mojmap → yarn: mojmap→intermediary (mojmap file), intermediary→yarn (yarn file)
   */
  private async lookupViaBridge(
    version: string,
    symbol: string,
    sourceMapping: MappingType,
    targetMapping: MappingType,
  ): Promise<MappingLookupResult> {
    logger.info(`Two-step lookup: ${sourceMapping} → intermediary → ${targetMapping}`);

    // Step 1: Source → Intermediary
    const step1File = this.getFileForMapping(sourceMapping);
    const step1Path = await this.getMappings(version, step1File);
    const step1Data = parseTinyV2(step1Path);

    const sourceNamespace = this.getNamespaceForType(sourceMapping, step1File);
    const intermediaryNamespace = 'intermediary';

    const sourceIndex = step1Data.header.namespaces.indexOf(sourceNamespace);
    const intermediaryIndex = step1Data.header.namespaces.indexOf(intermediaryNamespace);

    if (sourceIndex === -1 || intermediaryIndex === -1) {
      logger.warn(
        `Step 1 namespace not found: source=${sourceNamespace}(${sourceIndex}), intermediary(${intermediaryIndex})`,
      );
      return this.createLookupResult(false, symbol);
    }

    // Find intermediary name for the symbol
    const step1Result = this.searchInMappingData(step1Data, symbol, sourceIndex, intermediaryIndex);

    if (!step1Result.found || !step1Result.target) {
      return this.createLookupResult(false, symbol);
    }

    const intermediarySymbol = step1Result.target;
    const symbolType = step1Result.type;
    const step1ClassName = step1Result.className;

    // Step 2: Intermediary → Target
    const step2File = this.getFileForMapping(targetMapping);
    const step2Path = await this.getMappings(version, step2File);
    const step2Data = parseTinyV2(step2Path);

    const targetNamespace = this.getNamespaceForType(targetMapping, step2File);
    const step2IntermediaryIndex = step2Data.header.namespaces.indexOf(intermediaryNamespace);
    const targetIndex = step2Data.header.namespaces.indexOf(targetNamespace);

    if (step2IntermediaryIndex === -1 || targetIndex === -1) {
      logger.warn(
        `Step 2 namespace not found: intermediary(${step2IntermediaryIndex}), target=${targetNamespace}(${targetIndex})`,
      );
      return this.createLookupResult(false, symbol);
    }

    // For methods/fields, we need to find them within the correct class context
    if (symbolType === 'method' || symbolType === 'field') {
      // First, translate the class name to intermediary if needed
      let intermediaryClassName = step1ClassName;
      if (step1ClassName && sourceIndex !== intermediaryIndex) {
        // The className from step1 is in source namespace, we have intermediary from the lookup
        // Actually, step1Result.className is already in source namespace, and we got intermediary
        // We need to find the class in step2 using intermediary className
        // Let's search for the class first to get its intermediary name
        for (const cls of step1Data.classes) {
          if (cls.names[sourceIndex] === step1ClassName) {
            intermediaryClassName = cls.names[intermediaryIndex];
            break;
          }
        }
      }

      // Now search for the method/field in step2 data within the correct class
      const step2Result = this.searchMemberInClass(
        step2Data,
        intermediarySymbol,
        intermediaryClassName,
        symbolType,
        step2IntermediaryIndex,
        targetIndex,
      );

      if (step2Result.found) {
        return this.createLookupResult(
          true,
          symbol,
          step2Result.target,
          symbolType,
          step2Result.className,
        );
      }

      return this.createLookupResult(false, symbol);
    }

    // For classes, do a simple lookup
    const step2Result = this.searchInMappingData(
      step2Data,
      intermediarySymbol,
      step2IntermediaryIndex,
      targetIndex,
    );

    if (step2Result.found) {
      return this.createLookupResult(true, symbol, step2Result.target, step2Result.type);
    }

    return this.createLookupResult(false, symbol);
  }

  /**
   * Get the file type that contains a mapping type
   */
  private getFileForMapping(mappingType: MappingType): 'intermediary' | 'yarn' | 'mojmap' {
    switch (mappingType) {
      case 'official':
        return 'intermediary';
      case 'intermediary':
        return 'intermediary'; // Could use any file, but intermediary has official too
      case 'yarn':
        return 'yarn';
      case 'mojmap':
        return 'mojmap';
    }
  }

  /**
   * Search for a symbol in parsed mapping data
   */
  private searchInMappingData(
    mappingData: ReturnType<typeof parseTinyV2>,
    symbol: string,
    sourceIndex: number,
    targetIndex: number,
  ): MappingLookupResult {
    // Normalize symbol for comparison (handle both / and . separators)
    const normalizedSymbol = symbol.replace(/\./g, '/');

    for (const cls of mappingData.classes) {
      const sourceName = cls.names[sourceIndex];
      const targetName = cls.names[targetIndex];

      // Check class name match (support simple name or full path)
      if (
        sourceName === symbol ||
        sourceName === normalizedSymbol ||
        sourceName.endsWith(`/${symbol}`) ||
        sourceName.replace(/\//g, '.') === symbol
      ) {
        return this.createLookupResult(true, sourceName, targetName, 'class');
      }

      // Check method names
      for (const method of cls.methods) {
        const sourceMethodName = method.names[sourceIndex];
        if (sourceMethodName === symbol) {
          const targetMethodName = method.names[targetIndex];
          return this.createLookupResult(
            true,
            sourceMethodName,
            targetMethodName,
            'method',
            sourceName,
          );
        }
      }

      // Check field names
      for (const field of cls.fields) {
        const sourceFieldName = field.names[sourceIndex];
        if (sourceFieldName === symbol) {
          const targetFieldName = field.names[targetIndex];
          return this.createLookupResult(
            true,
            sourceFieldName,
            targetFieldName,
            'field',
            sourceName,
          );
        }
      }
    }

    return this.createLookupResult(false, symbol);
  }

  /**
   * Search for a method or field within a specific class context
   */
  private searchMemberInClass(
    mappingData: ReturnType<typeof parseTinyV2>,
    memberName: string,
    className: string | undefined,
    memberType: 'method' | 'field',
    sourceIndex: number,
    targetIndex: number,
  ): MappingLookupResult {
    for (const cls of mappingData.classes) {
      const classSourceName = cls.names[sourceIndex];
      const classTargetName = cls.names[targetIndex];

      // If className is specified, only search in that class
      if (className && classSourceName !== className) {
        continue;
      }

      if (memberType === 'method') {
        for (const method of cls.methods) {
          const sourceMethodName = method.names[sourceIndex];
          if (sourceMethodName === memberName) {
            const targetMethodName = method.names[targetIndex];
            return this.createLookupResult(
              true,
              sourceMethodName,
              targetMethodName,
              'method',
              classTargetName,
            );
          }
        }
      } else {
        for (const field of cls.fields) {
          const sourceFieldName = field.names[sourceIndex];
          if (sourceFieldName === memberName) {
            const targetFieldName = field.names[targetIndex];
            return this.createLookupResult(
              true,
              sourceFieldName,
              targetFieldName,
              'field',
              classTargetName,
            );
          }
        }
      }
    }

    return this.createLookupResult(false, memberName);
  }
}

/**
 * Result type for mapping lookups
 */
export interface MappingLookupResult {
  found: boolean;
  type?: 'class' | 'method' | 'field';
  source: string;
  target?: string;
  className?: string;
}

// Singleton instance
let mappingServiceInstance: MappingService | undefined;

export function getMappingService(): MappingService {
  if (!mappingServiceInstance) {
    mappingServiceInstance = new MappingService();
  }
  return mappingServiceInstance;
}
