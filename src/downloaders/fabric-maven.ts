import { downloadFile, fetchText } from './http-client.js';
import { getMappingPath, paths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { ensureDir } from '../utils/file-utils.js';
import { dirname, join } from 'node:path';
import { MappingNotFoundError } from '../utils/errors.js';
import type { MappingType } from '../types/minecraft.js';

const FABRIC_MAVEN_BASE = 'https://maven.fabricmc.net';

export class FabricMavenClient {
  /**
   * Resolve Minecraft version to Yarn version with build number
   * e.g. "1.21.10" -> "1.21.10+build.4"
   */
  async resolveYarnVersion(minecraftVersion: string): Promise<string> {
    logger.debug(`Resolving Yarn version for Minecraft ${minecraftVersion}`);

    const availableVersions = await this.getAvailableYarnVersions();

    // Filter versions that match the Minecraft version
    // Format: "1.21.10+build.4", "1.21.10-pre1+build.1", etc.
    const matchingVersions = availableVersions.filter(v => {
      // Match exact release versions (not pre-release or RC)
      return v.startsWith(minecraftVersion + '+build.');
    });

    if (matchingVersions.length === 0) {
      throw new MappingNotFoundError(
        minecraftVersion,
        'yarn',
        `No Yarn mappings found for Minecraft ${minecraftVersion}`,
      );
    }

    // Sort by build number (highest first) and take the latest
    matchingVersions.sort((a, b) => {
      const buildA = Number.parseInt(a.split('+build.')[1]);
      const buildB = Number.parseInt(b.split('+build.')[1]);
      return buildB - buildA;
    });

    const yarnVersion = matchingVersions[0];
    logger.info(`Resolved Minecraft ${minecraftVersion} to Yarn ${yarnVersion}`);

    return yarnVersion;
  }

  /**
   * Download Yarn mappings (Tiny v2 format JAR)
   * Returns the path to the downloaded JAR file (NOT the extracted .tiny file)
   */
  async downloadYarnMappings(minecraftVersion: string): Promise<string> {
    // Resolve Minecraft version to Yarn version (e.g. "1.21.10" -> "1.21.10+build.4")
    const yarnVersion = await this.resolveYarnVersion(minecraftVersion);

    const v2Url = `${FABRIC_MAVEN_BASE}/net/fabricmc/yarn/${yarnVersion}/yarn-${yarnVersion}-v2.jar`;

    // Download as JAR file (will be extracted by mapping service)
    const destination = join(paths.mappings(), `yarn-${minecraftVersion}.jar`);

    ensureDir(dirname(destination));

    logger.info(`Downloading Yarn mappings ${yarnVersion} for Minecraft ${minecraftVersion} (Tiny v2)`);

    try {
      // Download the JAR (it's actually a ZIP with mappings.tiny inside)
      await downloadFile(v2Url, destination);
      logger.info(`Yarn mappings JAR downloaded: ${destination}`);
      return destination;
    } catch (error) {
      throw new MappingNotFoundError(
        minecraftVersion,
        'yarn',
        `Yarn mappings not available for ${minecraftVersion} (tried ${yarnVersion})`,
      );
    }
  }

  /**
   * Download Intermediary mappings
   */
  async downloadIntermediaryMappings(version: string): Promise<string> {
    const url = `${FABRIC_MAVEN_BASE}/net/fabricmc/intermediary/${version}/intermediary-${version}-v2.jar`;
    const destination = getMappingPath(version, 'intermediary');

    ensureDir(dirname(destination));

    logger.info(`Downloading Intermediary mappings for ${version}`);

    try {
      await downloadFile(url, destination);
      logger.info(`Intermediary mappings downloaded: ${destination}`);
      return destination;
    } catch (error) {
      throw new MappingNotFoundError(
        version,
        'intermediary',
        `Intermediary mappings not available for ${version}`,
      );
    }
  }

  /**
   * Get available Yarn versions from Maven metadata
   */
  async getAvailableYarnVersions(): Promise<string[]> {
    const metadataUrl = `${FABRIC_MAVEN_BASE}/net/fabricmc/yarn/maven-metadata.xml`;

    logger.debug('Fetching Yarn version metadata');
    const xml = await fetchText(metadataUrl);

    // Simple XML parsing to extract version tags
    const versionRegex = /<version>([^<]+)<\/version>/g;
    const versions: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = versionRegex.exec(xml)) !== null) {
      versions.push(match[1]);
    }

    return versions;
  }

  /**
   * Check if Yarn mappings exist for a version
   */
  async yarnMappingsExist(minecraftVersion: string): Promise<boolean> {
    try {
      await this.resolveYarnVersion(minecraftVersion);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download mappings based on type
   */
  async downloadMappings(version: string, mappingType: MappingType): Promise<string> {
    switch (mappingType) {
      case 'yarn':
        return this.downloadYarnMappings(version);
      case 'intermediary':
        return this.downloadIntermediaryMappings(version);
      default:
        throw new Error(`Unsupported mapping type: ${mappingType}`);
    }
  }
}

// Singleton instance
let fabricMavenInstance: FabricMavenClient | undefined;

export function getFabricMaven(): FabricMavenClient {
  if (!fabricMavenInstance) {
    fabricMavenInstance = new FabricMavenClient();
  }
  return fabricMavenInstance;
}
