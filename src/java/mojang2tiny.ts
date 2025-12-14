import { join } from 'node:path';
import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { executeJavaProcess } from './java-process.js';

export interface Mojang2TinyOptions {
  tinyVersion?: 'v1' | 'v2';
  onProgress?: (progress: string) => void;
}

/**
 * Mojang2Tiny wrapper for converting ProGuard mappings to Tiny format
 *
 * This tool converts Mojang's official ProGuard-format mappings to the
 * Tiny v2 format that tiny-remapper can consume. It uses Intermediary
 * mappings as a bridge to produce intermediary → named mappings.
 */
export class Mojang2TinyWrapper {
  private jarPath: string | null = null;

  /**
   * Ensure mojang2tiny JAR is downloaded
   */
  private async ensureJar(): Promise<string> {
    if (!this.jarPath) {
      const downloader = getJavaResourceDownloader();
      this.jarPath = await downloader.getMojang2TinyJar();
    }
    return this.jarPath;
  }

  /**
   * Convert Mojang ProGuard mappings to Tiny v2 format
   *
   * @param intermediaryFile Path to the intermediary .tiny file (official → intermediary)
   * @param mojangMappingsFile Path to the Mojang .txt file (ProGuard format: official → named)
   * @param outputDir Directory where mappings.tiny will be created
   * @param options Conversion options
   * @returns Path to the generated mappings.tiny file
   */
  async convert(
    intermediaryFile: string,
    mojangMappingsFile: string,
    outputDir: string,
    options: Mojang2TinyOptions = {},
  ): Promise<string> {
    const jarPath = await this.ensureJar();
    ensureDir(outputDir);

    const { tinyVersion = 'v2', onProgress } = options;

    // Build mojang2tiny arguments
    // Format: -i <intermediary> -m <mappings> -o <output-dir> -t <v1|v2>
    const args: string[] = [
      '-i',
      intermediaryFile,
      '-m',
      mojangMappingsFile,
      '-o',
      outputDir,
      '-t',
      tinyVersion,
    ];

    logger.info(`Converting Mojang mappings to Tiny ${tinyVersion} format`);
    logger.info(`  Intermediary: ${intermediaryFile}`);
    logger.info(`  Mojang mappings: ${mojangMappingsFile}`);
    logger.info(`  Output: ${outputDir}`);

    try {
      await executeJavaProcess(jarPath, args, {
        maxMemory: '2G',
        minMemory: '512M',
        timeout: 5 * 60 * 1000, // 5 minutes should be plenty
        onStdout: (data) => {
          const trimmed = data.trim();
          if (trimmed) {
            logger.debug(`Mojang2Tiny: ${trimmed}`);
            if (onProgress) {
              onProgress(trimmed);
            }
          }
        },
        onStderr: (data) => {
          const trimmed = data.trim();
          if (trimmed) {
            logger.debug(`Mojang2Tiny: ${trimmed}`);
            if (onProgress) {
              onProgress(trimmed);
            }
          }
        },
      });

      const outputFile = join(outputDir, 'mappings.tiny');
      logger.info(`Mojang mappings converted successfully: ${outputFile}`);
      return outputFile;
    } catch (error) {
      logger.error('Mojang2Tiny conversion failed', error);
      throw new Error(
        `Mojang2Tiny conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

// Singleton instance
let mojang2TinyInstance: Mojang2TinyWrapper | undefined;

export function getMojang2Tiny(): Mojang2TinyWrapper {
  if (!mojang2TinyInstance) {
    mojang2TinyInstance = new Mojang2TinyWrapper();
  }
  return mojang2TinyInstance;
}
