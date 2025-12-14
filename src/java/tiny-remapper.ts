import { dirname } from 'node:path';
import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { RemappingError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { executeJavaProcess } from './java-process.js';

export interface TinyRemapperOptions {
  fromNamespace: string;
  toNamespace: string;
  threads?: number;
  rebuildSourceFilenames?: boolean;
  onProgress?: (progress: string) => void;
}

/**
 * TinyRemapper wrapper for JAR remapping
 */
export class TinyRemapperWrapper {
  private jarPath: string | null = null;

  /**
   * Ensure tiny-remapper JAR is downloaded
   */
  private async ensureJar(): Promise<string> {
    if (!this.jarPath) {
      const downloader = getJavaResourceDownloader();
      this.jarPath = await downloader.getTinyRemapperJar();
    }
    return this.jarPath;
  }

  /**
   * Remap a JAR file using Tiny mappings
   */
  async remap(
    inputJar: string,
    outputJar: string,
    mappingsFile: string,
    options: TinyRemapperOptions,
  ): Promise<void> {
    const jarPath = await this.ensureJar();
    ensureDir(dirname(outputJar));

    const {
      fromNamespace,
      toNamespace,
      threads = 4,
      rebuildSourceFilenames = true,
      onProgress,
    } = options;

    // Build tiny-remapper arguments
    // Format: <input> <output> <mappings> <from> <to> [--option=value]
    const args: string[] = [inputJar, outputJar, mappingsFile, fromNamespace, toNamespace];

    // Options must use --option=value format (NOT --option value)
    if (threads > 1) {
      args.push(`--threads=${threads}`);
    }

    if (rebuildSourceFilenames) {
      args.push('--rebuildSourceFilenames');
    }

    logger.info(`Remapping JAR: ${inputJar} -> ${outputJar}`);
    logger.info(`Mappings: ${mappingsFile} (${fromNamespace} -> ${toNamespace})`);

    try {
      await executeJavaProcess(jarPath, args, {
        maxMemory: '4G',
        minMemory: '1G',
        timeout: 20 * 60 * 1000, // 20 minutes
        onStdout: (data) => {
          if (onProgress) {
            onProgress(data.trim());
          }

          // Log progress indicators
          if (data.includes('Remapping')) {
            logger.debug(`TinyRemapper: ${data.trim()}`);
          }
        },
        onStderr: (data) => {
          // tiny-remapper logs to stderr by default
          logger.debug(`TinyRemapper: ${data.trim()}`);

          if (onProgress) {
            onProgress(data.trim());
          }
        },
      });

      logger.info(`Remapping successful: ${outputJar}`);
    } catch (error) {
      logger.error('Remapping failed', error);
      throw new RemappingError(
        inputJar,
        `${fromNamespace}->${toNamespace}`,
        `TinyRemapper failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

// Singleton instance
let tinyRemapperInstance: TinyRemapperWrapper | undefined;

export function getTinyRemapper(): TinyRemapperWrapper {
  if (!tinyRemapperInstance) {
    tinyRemapperInstance = new TinyRemapperWrapper();
  }
  return tinyRemapperInstance;
}
