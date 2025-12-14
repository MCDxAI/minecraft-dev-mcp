import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';
import { downloadFile } from './http-client.js';

/**
 * Java dependency URLs (latest 2025 versions)
 * Sources:
 * - Vineflower: https://github.com/Vineflower/vineflower/releases
 * - tiny-remapper: https://maven.fabricmc.net/net/fabricmc/tiny-remapper/
 * - mojang2tiny: https://github.com/ThreadMC/mojang2tiny/releases
 */

const VINEFLOWER_VERSION = '1.11.2';
const TINY_REMAPPER_VERSION = '0.10.3'; // Using latest from Maven
const MOJANG2TINY_VERSION = '1.1.1';

const VINEFLOWER_URL = `https://github.com/Vineflower/vineflower/releases/download/${VINEFLOWER_VERSION}/vineflower-${VINEFLOWER_VERSION}.jar`;
const TINY_REMAPPER_URL = `https://maven.fabricmc.net/net/fabricmc/tiny-remapper/${TINY_REMAPPER_VERSION}/tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`;
const MOJANG2TINY_URL = `https://github.com/ThreadMC/mojang2tiny/releases/download/v${MOJANG2TINY_VERSION}/mojang2tiny-${MOJANG2TINY_VERSION}.jar`;

export class JavaResourceDownloader {
  private resourcesDir: string;

  // Lock to prevent concurrent downloads of the same resource
  private downloadLocks = new Map<string, Promise<string>>();

  constructor() {
    this.resourcesDir = paths.resources();
    ensureDir(this.resourcesDir);
  }

  /**
   * Get Vineflower JAR path (download if not exists)
   * Uses locking to prevent concurrent downloads
   */
  async getVineflowerJar(): Promise<string> {
    const jarPath = join(this.resourcesDir, `vineflower-${VINEFLOWER_VERSION}.jar`);

    if (existsSync(jarPath)) {
      logger.debug(`Using cached Vineflower at ${jarPath}`);
      return jarPath;
    }

    // Check if download is already in progress
    const existingDownload = this.downloadLocks.get('vineflower');
    if (existingDownload) {
      logger.info('Waiting for existing Vineflower download to complete');
      return existingDownload;
    }

    // Start download with lock
    const downloadPromise = this.doDownloadVineflower(jarPath);
    this.downloadLocks.set('vineflower', downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.downloadLocks.delete('vineflower');
    }
  }

  private async doDownloadVineflower(jarPath: string): Promise<string> {
    logger.info(`Downloading Vineflower ${VINEFLOWER_VERSION}...`);
    await downloadFile(VINEFLOWER_URL, jarPath, {
      onProgress: (downloaded, total) => {
        const percent = ((downloaded / total) * 100).toFixed(1);
        logger.debug(`Vineflower download progress: ${percent}%`);
      },
    });
    logger.info(`Vineflower downloaded to ${jarPath}`);
    return jarPath;
  }

  /**
   * Get tiny-remapper JAR path (download if not exists)
   * Uses locking to prevent concurrent downloads
   */
  async getTinyRemapperJar(): Promise<string> {
    const jarPath = join(this.resourcesDir, `tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`);

    if (existsSync(jarPath)) {
      logger.debug(`Using cached tiny-remapper at ${jarPath}`);
      return jarPath;
    }

    // Check if download is already in progress
    const existingDownload = this.downloadLocks.get('tiny-remapper');
    if (existingDownload) {
      logger.info('Waiting for existing tiny-remapper download to complete');
      return existingDownload;
    }

    // Start download with lock
    const downloadPromise = this.doDownloadTinyRemapper(jarPath);
    this.downloadLocks.set('tiny-remapper', downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.downloadLocks.delete('tiny-remapper');
    }
  }

  private async doDownloadTinyRemapper(jarPath: string): Promise<string> {
    logger.info(`Downloading tiny-remapper ${TINY_REMAPPER_VERSION}...`);
    await downloadFile(TINY_REMAPPER_URL, jarPath, {
      onProgress: (downloaded, total) => {
        const percent = ((downloaded / total) * 100).toFixed(1);
        logger.debug(`tiny-remapper download progress: ${percent}%`);
      },
    });
    logger.info(`tiny-remapper downloaded to ${jarPath}`);
    return jarPath;
  }

  /**
   * Get mojang2tiny JAR path (download if not exists)
   * Uses locking to prevent concurrent downloads
   * Used to convert Mojang ProGuard mappings to Tiny v2 format
   */
  async getMojang2TinyJar(): Promise<string> {
    const jarPath = join(this.resourcesDir, `mojang2tiny-${MOJANG2TINY_VERSION}.jar`);

    if (existsSync(jarPath)) {
      logger.debug(`Using cached mojang2tiny at ${jarPath}`);
      return jarPath;
    }

    // Check if download is already in progress
    const existingDownload = this.downloadLocks.get('mojang2tiny');
    if (existingDownload) {
      logger.info('Waiting for existing mojang2tiny download to complete');
      return existingDownload;
    }

    // Start download with lock
    const downloadPromise = this.doDownloadMojang2Tiny(jarPath);
    this.downloadLocks.set('mojang2tiny', downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.downloadLocks.delete('mojang2tiny');
    }
  }

  private async doDownloadMojang2Tiny(jarPath: string): Promise<string> {
    logger.info(`Downloading mojang2tiny ${MOJANG2TINY_VERSION}...`);
    await downloadFile(MOJANG2TINY_URL, jarPath, {
      onProgress: (downloaded, total) => {
        const percent = ((downloaded / total) * 100).toFixed(1);
        logger.debug(`mojang2tiny download progress: ${percent}%`);
      },
    });
    logger.info(`mojang2tiny downloaded to ${jarPath}`);
    return jarPath;
  }

  /**
   * Download all Java resources
   */
  async downloadAll(): Promise<void> {
    await Promise.all([
      this.getVineflowerJar(),
      this.getTinyRemapperJar(),
      this.getMojang2TinyJar(),
    ]);
    logger.info('All Java resources ready');
  }

  /**
   * Check if all resources are available
   */
  hasAllResources(): boolean {
    const vineflower = join(this.resourcesDir, `vineflower-${VINEFLOWER_VERSION}.jar`);
    const tinyRemapper = join(this.resourcesDir, `tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`);
    const mojang2tiny = join(this.resourcesDir, `mojang2tiny-${MOJANG2TINY_VERSION}.jar`);

    return existsSync(vineflower) && existsSync(tinyRemapper) && existsSync(mojang2tiny);
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
