import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';
import { downloadFile } from './http-client.js';

/**
 * Java dependency URLs (latest 2025 versions)
 * Sources:
 * - Vineflower: https://github.com/Vineflower/vineflower/releases
 * - tiny-remapper: https://maven.fabricmc.net/net/fabricmc/tiny-remapper/
 * - mapping-io-cli: Bundled with package (tools/mapping-io-cli/)
 */

const VINEFLOWER_VERSION = '1.11.2';
const TINY_REMAPPER_VERSION = '0.10.3'; // Using latest from Maven

const VINEFLOWER_URL = `https://github.com/Vineflower/vineflower/releases/download/${VINEFLOWER_VERSION}/vineflower-${VINEFLOWER_VERSION}.jar`;
const TINY_REMAPPER_URL = `https://maven.fabricmc.net/net/fabricmc/tiny-remapper/${TINY_REMAPPER_VERSION}/tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`;

// Get the directory of this module for resolving bundled resources
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
   * Get mapping-io-cli JAR path (bundled with package)
   *
   * This JAR is used to convert ProGuard + Intermediary mappings to Tiny v2 format.
   * Unlike other tools, this is shipped with the package, not downloaded.
   *
   * @throws Error if the bundled JAR is not found
   */
  getMappingIOCliJar(): string {
    // Resolve path relative to package root
    // From: dist/downloaders/java-resources.js
    // To: tools/mapping-io-cli/build/libs/mapping-io-cli-1.0.0.jar
    const jarPath = join(__dirname, '..', '..', 'tools', 'mapping-io-cli', 'build', 'libs', 'mapping-io-cli-1.0.0.jar');

    if (!existsSync(jarPath)) {
      throw new Error(
        `Bundled mapping-io-cli.jar not found at ${jarPath}. ` +
          'Please build it with: cd tools/mapping-io-cli && ./gradlew shadowJar'
      );
    }

    logger.debug(`Using bundled mapping-io-cli at ${jarPath}`);
    return jarPath;
  }

  /**
   * Download all Java resources (that need downloading)
   */
  async downloadAll(): Promise<void> {
    await Promise.all([this.getVineflowerJar(), this.getTinyRemapperJar()]);
    // Also verify bundled JAR exists
    this.getMappingIOCliJar();
    logger.info('All Java resources ready');
  }

  /**
   * Check if all resources are available
   */
  hasAllResources(): boolean {
    const vineflower = join(this.resourcesDir, `vineflower-${VINEFLOWER_VERSION}.jar`);
    const tinyRemapper = join(this.resourcesDir, `tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`);
    const mappingIoCli = join(
      __dirname,
      '..',
      '..',
      'tools',
      'mapping-io-cli',
      'build',
      'libs',
      'mapping-io-cli-1.0.0.jar'
    );

    return existsSync(vineflower) && existsSync(tinyRemapper) && existsSync(mappingIoCli);
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
