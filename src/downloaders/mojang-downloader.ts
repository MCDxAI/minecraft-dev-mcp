import { downloadFile, fetchJson } from './http-client.js';
import { MOJANG_VERSION_MANIFEST_URL, findVersion, getClientDownload, getServerDownload, getClientMappingsDownload } from '../parsers/version-manifest.js';
import type { VersionManifest, VersionJson } from '../types/minecraft.js';
import { getVersionJarPath, getServerJarPath, getMappingPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { ensureDir } from '../utils/file-utils.js';
import { dirname } from 'node:path';
import { computeFileSha1 } from '../utils/hash.js';
import { VersionNotFoundError, DownloadError } from '../utils/errors.js';

export class MojangDownloader {
  private manifestCache: VersionManifest | null = null;

  /**
   * Get version manifest (cached)
   */
  async getVersionManifest(): Promise<VersionManifest> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    logger.info('Fetching Mojang version manifest');
    this.manifestCache = await fetchJson<VersionManifest>(MOJANG_VERSION_MANIFEST_URL);
    logger.info(`Loaded ${this.manifestCache.versions.length} versions`);

    return this.manifestCache;
  }

  /**
   * Get version JSON for a specific version
   */
  async getVersionJson(version: string): Promise<VersionJson> {
    const manifest = await this.getVersionManifest();
    const versionInfo = findVersion(manifest, version);

    logger.info(`Fetching version JSON for ${version}`);
    const versionJson = await fetchJson<VersionJson>(versionInfo.url);

    return versionJson;
  }

  /**
   * Download Minecraft client JAR
   */
  async downloadClientJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    const versionJson = await this.getVersionJson(version);
    const clientDownload = getClientDownload(versionJson);

    const destination = getVersionJarPath(version);
    ensureDir(dirname(destination));

    logger.info(`Downloading Minecraft ${version} client JAR`);
    await downloadFile(clientDownload.url, destination, { onProgress });

    // Verify SHA-1
    logger.info('Verifying JAR integrity');
    const actualSha1 = await computeFileSha1(destination);
    if (actualSha1 !== clientDownload.sha1) {
      throw new DownloadError(
        clientDownload.url,
        `SHA-1 mismatch: expected ${clientDownload.sha1}, got ${actualSha1}`,
      );
    }

    logger.info(`Client JAR verified: ${destination}`);
    return destination;
  }

  /**
   * Download Minecraft server JAR
   */
  async downloadServerJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    const versionJson = await this.getVersionJson(version);
    const serverDownload = getServerDownload(versionJson);

    const destination = getServerJarPath(version);
    ensureDir(dirname(destination));

    logger.info(`Downloading Minecraft ${version} server JAR`);
    await downloadFile(serverDownload.url, destination, { onProgress });

    // Verify SHA-1
    logger.info('Verifying server JAR integrity');
    const actualSha1 = await computeFileSha1(destination);
    if (actualSha1 !== serverDownload.sha1) {
      throw new DownloadError(
        serverDownload.url,
        `SHA-1 mismatch: expected ${serverDownload.sha1}, got ${actualSha1}`,
      );
    }

    logger.info(`Server JAR verified: ${destination}`);
    return destination;
  }

  /**
   * Download official Mojang mappings (ProGuard format)
   */
  async downloadMojangMappings(version: string): Promise<string> {
    const versionJson = await this.getVersionJson(version);
    const mappingsDownload = getClientMappingsDownload(versionJson);

    const destination = getMappingPath(version, 'mojmap');
    ensureDir(dirname(destination));

    logger.info(`Downloading Mojang mappings for ${version}`);
    await downloadFile(mappingsDownload.url, destination);

    // Verify SHA-1
    const actualSha1 = await computeFileSha1(destination);
    if (actualSha1 !== mappingsDownload.sha1) {
      throw new DownloadError(
        mappingsDownload.url,
        `SHA-1 mismatch: expected ${mappingsDownload.sha1}, got ${actualSha1}`,
      );
    }

    logger.info(`Mojang mappings verified: ${destination}`);
    return destination;
  }

  /**
   * List all available versions
   */
  async listVersions(): Promise<string[]> {
    const manifest = await this.getVersionManifest();
    return manifest.versions.map((v) => v.id);
  }

  /**
   * Check if version exists
   */
  async versionExists(version: string): Promise<boolean> {
    try {
      const manifest = await this.getVersionManifest();
      findVersion(manifest, version);
      return true;
    } catch (error) {
      if (error instanceof VersionNotFoundError) {
        return false;
      }
      throw error;
    }
  }
}

// Singleton instance
let mojangDownloaderInstance: MojangDownloader | undefined;

export function getMojangDownloader(): MojangDownloader {
  if (!mojangDownloaderInstance) {
    mojangDownloaderInstance = new MojangDownloader();
  }
  return mojangDownloaderInstance;
}
