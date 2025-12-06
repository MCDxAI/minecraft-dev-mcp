import { getDecompileService } from '../services/decompile-service.js';
import { getMappingService } from '../services/mapping-service.js';
import { getVersionManager } from '../services/version-manager.js';
import { getRegistryService } from '../services/registry-service.js';
import { logger } from '../utils/logger.js';
import { readFileSync, existsSync } from 'node:fs';
import type { MappingType } from '../types/minecraft.js';

/**
 * MCP Resource definitions
 * Resources provide a way to access data via URIs
 */

// Resource templates for discovery
export const resourceTemplates = [
  {
    uriTemplate: 'minecraft://source/{version}/{mapping}/{className}',
    name: 'Minecraft Source Code',
    description: 'Decompiled Minecraft source code for a specific class',
    mimeType: 'text/x-java-source',
  },
  {
    uriTemplate: 'minecraft://mappings/{version}/{mapping}',
    name: 'Minecraft Mappings',
    description: 'Mapping file content for a specific version and mapping type',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'minecraft://registry/{version}/{registryType}',
    name: 'Minecraft Registry',
    description: 'Registry data for blocks, items, entities, etc.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'minecraft://versions/list',
    name: 'Minecraft Versions',
    description: 'List of available and cached Minecraft versions',
    mimeType: 'application/json',
  },
];

// Fixed resources (always available)
export const resources = [
  {
    uri: 'minecraft://versions/list',
    name: 'Minecraft Versions List',
    description: 'List of available and cached Minecraft versions',
    mimeType: 'application/json',
  },
];

/**
 * Parse a minecraft:// URI
 */
function parseMinecraftUri(uri: string): {
  type: 'source' | 'mappings' | 'registry' | 'versions';
  version?: string;
  mapping?: string;
  className?: string;
  registryType?: string;
} | null {
  const match = uri.match(/^minecraft:\/\/(.+)$/);
  if (!match) return null;

  const path = match[1];

  // minecraft://versions/list
  if (path === 'versions/list') {
    return { type: 'versions' };
  }

  // minecraft://source/{version}/{mapping}/{className}
  const sourceMatch = path.match(/^source\/([^/]+)\/([^/]+)\/(.+)$/);
  if (sourceMatch) {
    return {
      type: 'source',
      version: sourceMatch[1],
      mapping: sourceMatch[2],
      className: sourceMatch[3],
    };
  }

  // minecraft://mappings/{version}/{mapping}
  const mappingsMatch = path.match(/^mappings\/([^/]+)\/([^/]+)$/);
  if (mappingsMatch) {
    return {
      type: 'mappings',
      version: mappingsMatch[1],
      mapping: mappingsMatch[2],
    };
  }

  // minecraft://registry/{version}/{registryType}
  const registryMatch = path.match(/^registry\/([^/]+)\/([^/]+)$/);
  if (registryMatch) {
    return {
      type: 'registry',
      version: registryMatch[1],
      registryType: registryMatch[2],
    };
  }

  // minecraft://registry/{version} (all registries)
  const registryAllMatch = path.match(/^registry\/([^/]+)$/);
  if (registryAllMatch) {
    return {
      type: 'registry',
      version: registryAllMatch[1],
    };
  }

  return null;
}

/**
 * Handle reading a minecraft:// resource
 */
export async function handleReadResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }>;
}> {
  logger.info(`Reading resource: ${uri}`);

  const parsed = parseMinecraftUri(uri);
  if (!parsed) {
    throw new Error(`Invalid minecraft:// URI: ${uri}`);
  }

  switch (parsed.type) {
    case 'versions':
      return handleVersionsResource(uri);
    case 'source':
      return handleSourceResource(uri, parsed.version!, parsed.mapping!, parsed.className!);
    case 'mappings':
      return handleMappingsResource(uri, parsed.version!, parsed.mapping!);
    case 'registry':
      return handleRegistryResource(uri, parsed.version!, parsed.registryType);
    default:
      throw new Error(`Unknown resource type: ${parsed.type}`);
  }
}

/**
 * Handle minecraft://versions/list resource
 */
async function handleVersionsResource(uri: string) {
  const versionManager = getVersionManager();

  const cached = versionManager.listCachedVersions();
  const available = await versionManager.listAvailableVersions();

  // Get latest 50 releases for brevity
  const recentReleases = available.slice(0, 50);

  const data = {
    cached,
    available: recentReleases,
    total_available: available.length,
  };

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Handle minecraft://source/{version}/{mapping}/{className} resource
 */
async function handleSourceResource(
  uri: string,
  version: string,
  mapping: string,
  className: string,
) {
  const decompileService = getDecompileService();

  // Validate mapping type
  if (mapping !== 'yarn' && mapping !== 'mojmap') {
    throw new Error(`Invalid mapping type: ${mapping}. Must be 'yarn' or 'mojmap'`);
  }

  const source = await decompileService.getClassSource(version, className, mapping as MappingType);

  return {
    contents: [
      {
        uri,
        mimeType: 'text/x-java-source',
        text: source,
      },
    ],
  };
}

/**
 * Handle minecraft://mappings/{version}/{mapping} resource
 */
async function handleMappingsResource(uri: string, version: string, mapping: string) {
  const mappingService = getMappingService();

  // Validate mapping type
  if (mapping !== 'yarn' && mapping !== 'mojmap' && mapping !== 'intermediary') {
    throw new Error(`Invalid mapping type: ${mapping}. Must be 'yarn', 'mojmap', or 'intermediary'`);
  }

  const mappingPath = await mappingService.getMappings(version, mapping as MappingType);

  // Read the mapping file content
  if (!existsSync(mappingPath)) {
    throw new Error(`Mapping file not found: ${mappingPath}`);
  }

  const content = readFileSync(mappingPath, 'utf8');

  return {
    contents: [
      {
        uri,
        mimeType: 'text/plain',
        text: content,
      },
    ],
  };
}

/**
 * Handle minecraft://registry/{version}/{registryType} resource
 */
async function handleRegistryResource(uri: string, version: string, registryType?: string) {
  const registryService = getRegistryService();

  const data = await registryService.getRegistryData(version, registryType);

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * List resources available for a specific version
 */
export async function listResourcesForVersion(version: string): Promise<
  Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
  }>
> {
  const result: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
  }> = [];

  // Add mapping resources
  for (const mapping of ['yarn', 'mojmap', 'intermediary']) {
    result.push({
      uri: `minecraft://mappings/${version}/${mapping}`,
      name: `${mapping} mappings for ${version}`,
      description: `Mapping file for Minecraft ${version} using ${mapping} mappings`,
      mimeType: 'text/plain',
    });
  }

  // Add registry resource
  result.push({
    uri: `minecraft://registry/${version}`,
    name: `Registry data for ${version}`,
    description: `All registry data for Minecraft ${version}`,
    mimeType: 'application/json',
  });

  return result;
}
