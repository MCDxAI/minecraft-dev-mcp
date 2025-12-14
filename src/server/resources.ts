import { existsSync, readFileSync } from 'node:fs';
import { getDecompileService } from '../services/decompile-service.js';
import { getDocumentationService } from '../services/documentation-service.js';
import { getMappingService } from '../services/mapping-service.js';
import { getRegistryService } from '../services/registry-service.js';
import { getSearchIndexService } from '../services/search-index-service.js';
import { getVersionManager } from '../services/version-manager.js';
import type { MappingType } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';

/**
 * MCP Resource definitions
 * Resources provide a way to access data via URIs
 */

// Resource templates for discovery
export const resourceTemplates = [
  // Phase 1 resources
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
  // Phase 2 resources
  {
    uriTemplate: 'minecraft://docs/{className}',
    name: 'Class Documentation',
    description: 'Documentation for a Minecraft class (Fabric Wiki links, summaries)',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'minecraft://docs/topic/{topic}',
    name: 'Topic Documentation',
    description: 'Documentation for a Minecraft modding topic (mixin, blocks, entities, etc.)',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'minecraft://index/{version}/{mapping}',
    name: 'Search Index Status',
    description: 'Status of the full-text search index for a version',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'minecraft://index/list',
    name: 'Indexed Versions',
    description: 'List of all indexed Minecraft versions',
    mimeType: 'application/json',
  },
];

// Fixed resources (always available)
export const resources = [
  // Phase 1 resources
  {
    uri: 'minecraft://versions/list',
    name: 'Minecraft Versions List',
    description: 'List of available and cached Minecraft versions',
    mimeType: 'application/json',
  },
  // Phase 2 resources
  {
    uri: 'minecraft://index/list',
    name: 'Indexed Versions List',
    description: 'List of all indexed Minecraft versions for full-text search',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://docs/topic/mixin',
    name: 'Mixin Documentation',
    description: 'Documentation and guide for using Mixins in Fabric mods',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://docs/topic/accesswidener',
    name: 'Access Widener Documentation',
    description: 'Documentation and guide for Access Wideners in Fabric mods',
    mimeType: 'application/json',
  },
];

/**
 * Parse a minecraft:// URI
 */
function parseMinecraftUri(uri: string): {
  type:
    | 'source'
    | 'mappings'
    | 'registry'
    | 'versions'
    | 'docs'
    | 'docs-topic'
    | 'index'
    | 'index-list';
  version?: string;
  mapping?: string;
  className?: string;
  registryType?: string;
  topic?: string;
} | null {
  const match = uri.match(/^minecraft:\/\/(.+)$/);
  if (!match) return null;

  const path = match[1];

  // minecraft://versions/list
  if (path === 'versions/list') {
    return { type: 'versions' };
  }

  // minecraft://index/list
  if (path === 'index/list') {
    return { type: 'index-list' };
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

  // minecraft://docs/topic/{topic}
  const docsTopicMatch = path.match(/^docs\/topic\/(.+)$/);
  if (docsTopicMatch) {
    return {
      type: 'docs-topic',
      topic: docsTopicMatch[1],
    };
  }

  // minecraft://docs/{className}
  const docsMatch = path.match(/^docs\/(.+)$/);
  if (docsMatch) {
    return {
      type: 'docs',
      className: docsMatch[1],
    };
  }

  // minecraft://index/{version}/{mapping}
  const indexMatch = path.match(/^index\/([^/]+)\/([^/]+)$/);
  if (indexMatch) {
    return {
      type: 'index',
      version: indexMatch[1],
      mapping: indexMatch[2],
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
      return handleSourceResource(
        uri,
        parsed.version ?? '',
        parsed.mapping ?? 'yarn',
        parsed.className ?? '',
      );
    case 'mappings':
      return handleMappingsResource(uri, parsed.version ?? '', parsed.mapping ?? 'yarn');
    case 'registry':
      return handleRegistryResource(uri, parsed.version ?? '', parsed.registryType);
    // Phase 2 resources
    case 'docs':
      return handleDocsResource(uri, parsed.className ?? '');
    case 'docs-topic':
      return handleDocsTopicResource(uri, parsed.topic ?? '');
    case 'index':
      return handleIndexResource(uri, parsed.version ?? '', parsed.mapping ?? 'yarn');
    case 'index-list':
      return handleIndexListResource(uri);
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
    throw new Error(
      `Invalid mapping type: ${mapping}. Must be 'yarn', 'mojmap', or 'intermediary'`,
    );
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

// ============================================================================
// Phase 2 Resource Handlers
// ============================================================================

/**
 * Handle minecraft://docs/{className} resource
 */
async function handleDocsResource(uri: string, className: string) {
  const docService = getDocumentationService();

  const doc = await docService.getDocumentation(className);
  const related = await docService.getRelatedDocumentation(className);

  const data = {
    className,
    documentation: doc,
    relatedDocumentation: related,
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
 * Handle minecraft://docs/topic/{topic} resource
 */
async function handleDocsTopicResource(uri: string, topic: string) {
  const docService = getDocumentationService();

  // Handle special topics
  if (topic === 'mixin') {
    const data = docService.getMixinDocumentation();
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

  if (topic === 'accesswidener') {
    const data = docService.getAccessWidenerDocumentation();
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

  // Generic topic lookup
  const doc = await docService.getTopicDocumentation(topic);

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(doc, null, 2),
      },
    ],
  };
}

/**
 * Handle minecraft://index/{version}/{mapping} resource
 */
async function handleIndexResource(uri: string, version: string, mapping: string) {
  const searchService = getSearchIndexService();

  // Validate mapping type
  if (mapping !== 'yarn' && mapping !== 'mojmap') {
    throw new Error(`Invalid mapping type: ${mapping}. Must be 'yarn' or 'mojmap'`);
  }

  const stats = searchService.getStats(version, mapping as MappingType);

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(stats, null, 2),
      },
    ],
  };
}

/**
 * Handle minecraft://index/list resource
 */
async function handleIndexListResource(uri: string) {
  const searchService = getSearchIndexService();

  const indexed = searchService.listIndexedVersions();

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            indexedVersions: indexed,
            count: indexed.length,
          },
          null,
          2,
        ),
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
