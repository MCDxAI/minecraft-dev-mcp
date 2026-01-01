import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { logger } from '../utils/logger.js';
import { executeJavaProcess } from './java-process.js';

export interface MappingIOOptions {
  onProgress?: (progress: string) => void;
}

/**
 * MappingIO wrapper for converting ProGuard + Intermediary mappings to Tiny v2 format
 *
 * This tool uses FabricMC's mapping-io library to properly merge Mojang's ProGuard
 * mappings with Fabric's Intermediary mappings. The output is a Tiny v2 file
 * suitable for tiny-remapper with namespaces: intermediary → named
 *
 * This replaces the old mojang2tiny approach which produced incorrectly structured
 * Tiny v2 files where fields/methods were not nested under their parent classes.
 */
export class MappingIOWrapper {
  /**
   * Convert ProGuard + Intermediary mappings to Tiny v2 format
   *
   * @param proguardFile Path to Mojang ProGuard mapping file (named → obfuscated)
   * @param intermediaryFile Path to Intermediary Tiny v2 mapping file (official → intermediary)
   * @param outputFile Path for output Tiny v2 file (intermediary → named)
   * @param options Conversion options
   * @returns Path to the generated output file
   */
  async convert(
    proguardFile: string,
    intermediaryFile: string,
    outputFile: string,
    options: MappingIOOptions = {}
  ): Promise<string> {
    const jarPath = getJavaResourceDownloader().getMappingIOCliJar();

    const { onProgress } = options;

    logger.info('Converting mappings with mapping-io');
    logger.info(`  ProGuard: ${proguardFile}`);
    logger.info(`  Intermediary: ${intermediaryFile}`);
    logger.info(`  Output: ${outputFile}`);

    try {
      await executeJavaProcess(jarPath, [proguardFile, intermediaryFile, outputFile], {
        maxMemory: '2G',
        minMemory: '512M',
        timeout: 5 * 60 * 1000, // 5 minutes
        onStdout: (data) => {
          const trimmed = data.trim();
          if (trimmed) {
            logger.debug(`MappingIO: ${trimmed}`);
            onProgress?.(trimmed);
          }
        },
        onStderr: (data) => {
          const trimmed = data.trim();
          if (trimmed) {
            logger.debug(`MappingIO: ${trimmed}`);
            onProgress?.(trimmed);
          }
        },
      });

      logger.info(`Mapping conversion complete: ${outputFile}`);
      return outputFile;
    } catch (error) {
      logger.error('MappingIO conversion failed', error);
      throw new Error(
        `MappingIO conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Singleton instance
let mappingIOInstance: MappingIOWrapper | undefined;

export function getMappingIO(): MappingIOWrapper {
  if (!mappingIOInstance) {
    mappingIOInstance = new MappingIOWrapper();
  }
  return mappingIOInstance;
}
