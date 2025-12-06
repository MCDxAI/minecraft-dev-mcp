import { executeJavaProcess } from './java-process.js';
import { logger } from '../utils/logger.js';
import { RegistryExtractionError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minecraft data generator wrapper for extracting registry data
 */
export class MinecraftDataGenerator {
  /**
   * Determine if version uses legacy data generator format (pre-1.18)
   */
  private isLegacyVersion(version: string): boolean {
    try {
      const parts = version.split('.');
      if (parts.length < 2) return false;

      const major = Number.parseInt(parts[0], 10);
      const minor = Number.parseInt(parts[1], 10);

      return major === 1 && minor < 18;
    } catch {
      return false;
    }
  }

  /**
   * Run Minecraft's data generator to extract registry data
   *
   * For MC 1.18+: Uses bundler format with -DbundlerMainClass
   * For MC <1.18: Uses legacy -cp format with explicit main class
   */
  async generateRegistryData(
    serverJarPath: string,
    outputDir: string,
    version?: string,
  ): Promise<string> {
    ensureDir(outputDir);

    logger.info(`Running Minecraft data generator for ${serverJarPath}`);
    logger.info(`Output directory: ${outputDir}`);

    try {
      const isLegacy = version ? this.isLegacyVersion(version) : false;

      if (isLegacy) {
        // Pre-1.18: Use -cp with explicit main class
        logger.debug('Using legacy data generator format (pre-1.18)');
        await executeJavaProcess(serverJarPath, ['--reports', '--all', '--server', '--output', outputDir], {
          maxMemory: '2G',
          minMemory: '512M',
          timeout: 5 * 60 * 1000,
          mainClass: 'net.minecraft.data.Main',
          onStdout: (data) => {
            logger.debug(`[MC DataGen] ${data.trim()}`);
          },
          onStderr: (data) => {
            logger.debug(`[MC DataGen] ${data.trim()}`);
          },
        });
      } else {
        // 1.18+: Use bundler format with -DbundlerMainClass
        logger.debug('Using bundler data generator format (1.18+)');
        await executeJavaProcess(serverJarPath, ['--reports', '--all', '--server', '--output', outputDir], {
          maxMemory: '2G',
          minMemory: '512M',
          timeout: 5 * 60 * 1000,
          jvmArgs: ['-DbundlerMainClass=net.minecraft.data.Main'],
          onStdout: (data) => {
            logger.debug(`[MC DataGen] ${data.trim()}`);
          },
          onStderr: (data) => {
            logger.debug(`[MC DataGen] ${data.trim()}`);
          },
        });
      }

      // Check for registries.json in multiple possible locations
      // MC 1.21+: reports/registries.json
      // MC <1.21: generated/reports/registries.json
      const possiblePaths = [
        join(outputDir, 'reports', 'registries.json'),
        join(outputDir, 'generated', 'reports', 'registries.json'),
      ];

      let registriesFile: string | undefined;
      for (const path of possiblePaths) {
        if (existsSync(path)) {
          registriesFile = path;
          break;
        }
      }

      if (!registriesFile) {
        const outputContents = existsSync(outputDir) ? readdirSync(outputDir) : [];
        throw new Error(`Registry data not generated - registries.json not found in any expected location. Output directory contents: ${outputContents}`);
      }

      logger.info(`Registry data generated: ${registriesFile}`);
      return registriesFile;
    } catch (error) {
      logger.error('Registry extraction failed', error);
      throw new RegistryExtractionError(
        serverJarPath,
        `Data generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Parse registry data from generated JSON
   */
  parseRegistryData(registriesFilePath: string): Record<string, unknown> {
    logger.debug(`Parsing registry data from ${registriesFilePath}`);

    const content = readFileSync(registriesFilePath, 'utf8');
    const data = JSON.parse(content);

    return data;
  }

  /**
   * Extract specific registry (blocks, items, entities, etc.)
   */
  extractRegistry(
    registriesFilePath: string,
    registryName: string,
  ): Record<string, unknown> | undefined {
    const allRegistries = this.parseRegistryData(registriesFilePath);

    // Registry format: { "minecraft:block": { "entries": {...} } }
    const fullName = registryName.includes(':') ? registryName : `minecraft:${registryName}`;

    return (allRegistries as Record<string, unknown>)[fullName] as Record<string, unknown> | undefined;
  }
}

// Singleton instance
let dataGeneratorInstance: MinecraftDataGenerator | undefined;

export function getDataGenerator(): MinecraftDataGenerator {
  if (!dataGeneratorInstance) {
    dataGeneratorInstance = new MinecraftDataGenerator();
  }
  return dataGeneratorInstance;
}
