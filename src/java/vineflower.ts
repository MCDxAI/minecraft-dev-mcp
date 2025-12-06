import { executeJavaProcess } from './java-process.js';
import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { logger } from '../utils/logger.js';
import { ensureDir } from '../utils/file-utils.js';
import { DecompilationError } from '../utils/errors.js';

export interface VineflowerOptions {
  decompileGenerics?: boolean; // -dgs=1
  hideDefaultConstructor?: boolean; // -hdc=0
  asciiStrings?: boolean; // -asc=1
  removeSynthetic?: boolean; // -rsy=1
  literalsAsIs?: boolean; // -lit=1
  indent?: string; // -ind="  "
  threads?: number; // -thr=4
  onProgress?: (current: number, total: number) => void;
}

/**
 * Vineflower decompiler wrapper
 */
export class VineflowerWrapper {
  private jarPath: string | null = null;

  /**
   * Ensure Vineflower JAR is downloaded
   */
  private async ensureJar(): Promise<string> {
    if (!this.jarPath) {
      const downloader = getJavaResourceDownloader();
      this.jarPath = await downloader.getVineflowerJar();
    }
    return this.jarPath;
  }

  /**
   * Decompile a JAR file
   */
  async decompile(
    inputJar: string,
    outputDir: string,
    options: VineflowerOptions = {},
  ): Promise<void> {
    const jarPath = await this.ensureJar();
    ensureDir(outputDir);

    const {
      decompileGenerics = true,
      hideDefaultConstructor = false,
      asciiStrings = true,
      removeSynthetic = true,
      literalsAsIs = true,
      indent = '  ',
      threads = 4,
      onProgress,
    } = options;

    // Build Vineflower arguments
    const args: string[] = [];

    // Options
    args.push(`-dgs=${decompileGenerics ? 1 : 0}`);
    args.push(`-hdc=${hideDefaultConstructor ? 1 : 0}`);
    args.push(`-asc=${asciiStrings ? 1 : 0}`);
    args.push(`-rsy=${removeSynthetic ? 1 : 0}`);
    args.push(`-lit=${literalsAsIs ? 1 : 0}`);
    args.push(`-ind=${indent}`);
    args.push(`-thr=${threads}`);

    // Input and output
    args.push(inputJar);
    args.push(outputDir);

    logger.info(`Decompiling with Vineflower: ${inputJar} -> ${outputDir}`);

    try {
      let classesProcessed = 0;
      let totalClasses = 0;

      await executeJavaProcess(jarPath, args, {
        maxMemory: '4G',
        minMemory: '1G',
        timeout: 30 * 60 * 1000, // 30 minutes for large JARs
        onStdout: (data) => {
          // Parse progress from Vineflower output
          // Example: "Decompiling class 1234/5678 ..."
          const match = data.match(/Decompiling class (\d+)\/(\d+)/);
          if (match) {
            classesProcessed = Number.parseInt(match[1], 10);
            totalClasses = Number.parseInt(match[2], 10);

            if (onProgress && totalClasses > 0) {
              onProgress(classesProcessed, totalClasses);
            }
          }

          // Also check for completion message
          if (data.includes('Finished decompilation')) {
            logger.info('Vineflower decompilation completed');
          }
        },
        onStderr: (data) => {
          // Log warnings but don't fail
          if (data.includes('WARN')) {
            logger.warn(`Vineflower warning: ${data.trim()}`);
          }
        },
      });

      logger.info(`Decompilation successful: ${outputDir}`);
    } catch (error) {
      logger.error('Decompilation failed', error);
      throw new DecompilationError(
        inputJar,
        `Vineflower decompilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Decompile a single class from a JAR
   */
  async decompileClass(
    inputJar: string,
    className: string,
    outputDir: string,
  ): Promise<string> {
    // Vineflower doesn't support single-class decompilation directly
    // We need to decompile the whole JAR (but it's cached)
    await this.decompile(inputJar, outputDir);

    // Return path to decompiled class
    const classPath = className.replace(/\./g, '/') + '.java';
    return `${outputDir}/${classPath}`;
  }
}

// Singleton instance
let vineflowerInstance: VineflowerWrapper | undefined;

export function getVineflower(): VineflowerWrapper {
  if (!vineflowerInstance) {
    vineflowerInstance = new VineflowerWrapper();
  }
  return vineflowerInstance;
}
