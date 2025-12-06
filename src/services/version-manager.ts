import { getMojangDownloader } from '../downloaders/mojang-downloader.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { logger } from '../utils/logger.js';
import { VersionNotFoundError } from '../utils/errors.js';
import { computeFileSha1 } from '../utils/hash.js';

/**
 * Manages Minecraft versions - downloading, caching, and metadata
 */
export class VersionManager {
  private downloader = getMojangDownloader();
  private cache = getCacheManager();

  /**
   * Get or download a Minecraft client JAR
   */
  async getVersionJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    // Check cache first
    const cachedPath = this.cache.getVersionJarPath(version);
    if (cachedPath) {
      logger.info(`Using cached JAR for ${version}: ${cachedPath}`);
      return cachedPath;
    }

    // Download if not cached
    logger.info(`Downloading client JAR for ${version}`);
    const jarPath = await this.downloader.downloadClientJar(version, onProgress);

    // Compute SHA-1 and cache
    const sha1 = await computeFileSha1(jarPath);
    this.cache.cacheVersionJar(version, jarPath, sha1);

    return jarPath;
  }

  /**
   * Get or download a Minecraft server JAR
   */
  async getServerJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    // Check cache first
    const cachedPath = this.cache.getServerJarPath(version);
    if (cachedPath) {
      logger.info(`Using cached server JAR for ${version}: ${cachedPath}`);
      return cachedPath;
    }

    // Download if not cached
    logger.info(`Downloading server JAR for ${version}`);
    const jarPath = await this.downloader.downloadServerJar(version, onProgress);

    return jarPath;
  }

  /**
   * Check if version JAR is cached
   */
  hasVersion(version: string): boolean {
    return this.cache.hasVersionJar(version);
  }

  /**
   * List all available Minecraft versions
   */
  async listAvailableVersions(): Promise<string[]> {
    return this.downloader.listVersions();
  }

  /**
   * List cached versions
   */
  listCachedVersions(): string[] {
    return this.cache.listCachedVersions();
  }

  /**
   * Verify version exists
   */
  async verifyVersion(version: string): Promise<void> {
    const exists = await this.downloader.versionExists(version);
    if (!exists) {
      throw new VersionNotFoundError(version);
    }
  }

  /**
   * Get version JAR path (must be cached)
   */
  getCachedJarPath(version: string): string {
    const path = this.cache.getVersionJarPath(version);
    if (!path) {
      throw new Error(`Version ${version} not cached`);
    }
    return path;
  }
}

// Singleton instance
let versionManagerInstance: VersionManager | undefined;

export function getVersionManager(): VersionManager {
  if (!versionManagerInstance) {
    versionManagerInstance = new VersionManager();
  }
  return versionManagerInstance;
}
