import { getDataGenerator } from '../java/mc-data-gen.js';
import { getVersionManager } from './version-manager.js';
import { getRegistryPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../utils/file-utils.js';

/**
 * Service for extracting and caching Minecraft registry data
 */
export class RegistryService {
  private dataGen = getDataGenerator();
  private versionManager = getVersionManager();

  /**
   * Get registry data for a version
   */
  async getRegistryData(
    version: string,
    registryType?: string,
  ): Promise<Record<string, unknown>> {
    // Get the actual registries.json file path (may be in different locations)
    const registriesFile = await this.getRegistriesFilePath(version);

    // Read registry data
    const allRegistries = this.dataGen.parseRegistryData(registriesFile);

    // Return specific registry or all
    if (registryType) {
      const registry = this.dataGen.extractRegistry(registriesFile, registryType);
      if (!registry) {
        throw new Error(`Registry '${registryType}' not found for version ${version}`);
      }
      return registry;
    }

    return allRegistries;
  }

  /**
   * Get the path to registries.json, generating if needed
   */
  private async getRegistriesFilePath(version: string): Promise<string> {
    const registryDir = getRegistryPath(version);

    // Check both possible locations
    const possiblePaths = [
      join(registryDir, 'reports', 'registries.json'),
      join(registryDir, 'generated', 'reports', 'registries.json'),
      join(registryDir, 'registries.json'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    // Not found, generate it
    logger.info(`Generating registry data for ${version}`);
    return await this.generateRegistryData(version);
  }

  /**
   * Generate registry data for a version
   */
  private async generateRegistryData(version: string): Promise<string> {
    // Get server JAR for registry extraction
    // Server JAR has the built-in data generator
    const serverJarPath = await this.versionManager.getServerJar(version);

    // Generate data
    const registryDir = getRegistryPath(version);
    ensureDir(registryDir);

    const registriesFile = await this.dataGen.generateRegistryData(serverJarPath, registryDir, version);

    logger.info(`Registry data generated: ${registriesFile}`);
    return registriesFile;
  }

  /**
   * List available registries for a version
   */
  async listRegistries(version: string): Promise<string[]> {
    const allRegistries = await this.getRegistryData(version);
    return Object.keys(allRegistries);
  }

  /**
   * Check if registry data is cached
   */
  hasRegistryData(version: string): boolean {
    const registryDir = getRegistryPath(version);
    const registriesFile = join(registryDir, 'registries.json');
    return existsSync(registriesFile);
  }
}

// Singleton instance
let registryServiceInstance: RegistryService | undefined;

export function getRegistryService(): RegistryService {
  if (!registryServiceInstance) {
    registryServiceInstance = new RegistryService();
  }
  return registryServiceInstance;
}
