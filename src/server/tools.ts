import { z } from 'zod';
import { getDecompileService } from '../services/decompile-service.js';
import { getVersionManager } from '../services/version-manager.js';
import { getRegistryService } from '../services/registry-service.js';
import { logger } from '../utils/logger.js';
import type { MappingType } from '../types/minecraft.js';

// Tool input schemas
const GetMinecraftSourceSchema = z.object({
  version: z.string().describe('Minecraft version (e.g., "1.21.10")'),
  className: z.string().describe('Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
});

const DecompileMinecraftVersionSchema = z.object({
  version: z.string().describe('Minecraft version to decompile'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  force: z.boolean().optional().describe('Force re-decompilation even if cached'),
});

const GetRegistryDataSchema = z.object({
  version: z.string().describe('Minecraft version'),
  registry: z.string().optional().describe('Specific registry to fetch (e.g., "blocks", "items", "entities")'),
});

// Tool definitions
export const tools = [
  {
    name: 'get_minecraft_source',
    description:
      'Get decompiled source code for a specific Minecraft class. This will automatically download, remap, and decompile the Minecraft version if not cached.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version (e.g., "1.21.10")',
        },
        className: {
          type: 'string',
          description:
            'Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
      },
      required: ['version', 'className', 'mapping'],
    },
  },
  {
    name: 'decompile_minecraft_version',
    description:
      'Decompile an entire Minecraft version. This downloads the client JAR, remaps it, and decompiles all classes. Subsequent calls will use cached results.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version to decompile',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
        force: {
          type: 'boolean',
          description: 'Force re-decompilation even if cached',
        },
      },
      required: ['version', 'mapping'],
    },
  },
  {
    name: 'list_minecraft_versions',
    description:
      'List available and cached Minecraft versions. Shows which versions are available for download and which are already cached locally.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_registry_data',
    description:
      'Get Minecraft registry data (blocks, items, entities, etc.). This runs the data generator if not cached.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        registry: {
          type: 'string',
          description:
            'Specific registry to fetch (e.g., "blocks", "items", "entities"). Omit to get all registries.',
        },
      },
      required: ['version'],
    },
  },
];

// Tool handlers
export async function handleGetMinecraftSource(args: unknown) {
  const { version, className, mapping } = GetMinecraftSourceSchema.parse(args);

  logger.info(`Getting source for ${className} in ${version} (${mapping})`);

  const decompileService = getDecompileService();

  try {
    const source = await decompileService.getClassSource(version, className, mapping as MappingType);

    return {
      content: [
        {
          type: 'text',
          text: source,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get source', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDecompileMinecraftVersion(args: unknown) {
  const { version, mapping, force } = DecompileMinecraftVersionSchema.parse(args);

  logger.info(`Decompiling ${version} with ${mapping} mappings`);

  const decompileService = getDecompileService();

  // TODO: Handle force flag by clearing cache
  if (force) {
    logger.warn('Force flag not yet implemented');
  }

  try {
    let totalClasses = 0;

    const outputDir = await decompileService.decompileVersion(
      version,
      mapping as MappingType,
      (_current, total) => {
        totalClasses = total;
      },
    );

    return {
      content: [
        {
          type: 'text',
          text: `Decompilation completed successfully!\n\nVersion: ${version}\nMapping: ${mapping}\nClasses: ${totalClasses}\nOutput: ${outputDir}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Decompilation failed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Decompilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListMinecraftVersions() {
  logger.info('Listing Minecraft versions');

  const versionManager = getVersionManager();

  try {
    const cached = versionManager.listCachedVersions();
    const available = await versionManager.listAvailableVersions();

    // Get latest 20 releases for brevity
    const recentReleases = available.slice(0, 20);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              cached,
              available: recentReleases,
              total_available: available.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list versions', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGetRegistryData(args: unknown) {
  const { version, registry } = GetRegistryDataSchema.parse(args);

  logger.info(`Getting registry data for ${version}${registry ? ` (${registry})` : ''}`);

  const registryService = getRegistryService();

  try {
    const data = await registryService.getRegistryData(version, registry);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get registry data', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Tool router
export async function handleToolCall(name: string, args: unknown) {
  switch (name) {
    case 'get_minecraft_source':
      return handleGetMinecraftSource(args);
    case 'decompile_minecraft_version':
      return handleDecompileMinecraftVersion(args);
    case 'list_minecraft_versions':
      return handleListMinecraftVersions();
    case 'get_registry_data':
      return handleGetRegistryData(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
