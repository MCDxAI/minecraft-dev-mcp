import { downloadFile } from './http-client.js';
import { paths } from '../utils/paths.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';

/**
 * Java dependency URLs (latest 2025 versions)
 * Sources:
 * - Vineflower: https://github.com/Vineflower/vineflower/releases
 * - tiny-remapper: https://maven.fabricmc.net/net/fabricmc/tiny-remapper/
 */

const VINEFLOWER_VERSION = '1.11.2';
const TINY_REMAPPER_VERSION = '0.10.3'; // Using latest from Maven

const VINEFLOWER_URL = `https://github.com/Vineflower/vineflower/releases/download/${VINEFLOWER_VERSION}/vineflower-${VINEFLOWER_VERSION}.jar`;
const TINY_REMAPPER_URL = `https://maven.fabricmc.net/net/fabricmc/tiny-remapper/${TINY_REMAPPER_VERSION}/tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`;

export class JavaResourceDownloader {
  private resourcesDir: string;

  constructor() {
    this.resourcesDir = paths.resources();
    ensureDir(this.resourcesDir);
  }

  /**
   * Get Vineflower JAR path (download if not exists)
   */
  async getVineflowerJar(): Promise<string> {
    const jarPath = join(this.resourcesDir, `vineflower-${VINEFLOWER_VERSION}.jar`);

    if (!existsSync(jarPath)) {
      logger.info(`Downloading Vineflower ${VINEFLOWER_VERSION}...`);
      await downloadFile(VINEFLOWER_URL, jarPath, {
        onProgress: (downloaded, total) => {
          const percent = ((downloaded / total) * 100).toFixed(1);
          logger.debug(`Vineflower download progress: ${percent}%`);
        },
      });
      logger.info(`Vineflower downloaded to ${jarPath}`);
    } else {
      logger.debug(`Using cached Vineflower at ${jarPath}`);
    }

    return jarPath;
  }

  /**
   * Get tiny-remapper JAR path (download if not exists)
   */
  async getTinyRemapperJar(): Promise<string> {
    const jarPath = join(this.resourcesDir, `tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`);

    if (!existsSync(jarPath)) {
      logger.info(`Downloading tiny-remapper ${TINY_REMAPPER_VERSION}...`);
      await downloadFile(TINY_REMAPPER_URL, jarPath, {
        onProgress: (downloaded, total) => {
          const percent = ((downloaded / total) * 100).toFixed(1);
          logger.debug(`tiny-remapper download progress: ${percent}%`);
        },
      });
      logger.info(`tiny-remapper downloaded to ${jarPath}`);
    } else {
      logger.debug(`Using cached tiny-remapper at ${jarPath}`);
    }

    return jarPath;
  }

  /**
   * Download all Java resources
   */
  async downloadAll(): Promise<void> {
    await Promise.all([this.getVineflowerJar(), this.getTinyRemapperJar()]);
    logger.info('All Java resources ready');
  }

  /**
   * Check if all resources are available
   */
  hasAllResources(): boolean {
    const vineflower = join(this.resourcesDir, `vineflower-${VINEFLOWER_VERSION}.jar`);
    const tinyRemapper = join(this.resourcesDir, `tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`);

    return existsSync(vineflower) && existsSync(tinyRemapper);
  }
}

// Singleton instance
let javaResourceDownloaderInstance: JavaResourceDownloader | undefined;

export function getJavaResourceDownloader(): JavaResourceDownloader {
  if (!javaResourceDownloaderInstance) {
    javaResourceDownloaderInstance = new JavaResourceDownloader();
  }
  return javaResourceDownloaderInstance;
}
