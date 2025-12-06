import { z } from 'zod';
import { getDecompileService } from '../services/decompile-service.js';
import { getVersionManager } from '../services/version-manager.js';
import { getRegistryService } from '../services/registry-service.js';
import { getRemapService } from '../services/remap-service.js';
import { getMappingService } from '../services/mapping-service.js';
import { getMixinService } from '../services/mixin-service.js';
import { getAccessWidenerService } from '../services/access-widener-service.js';
import { getAstDiffService } from '../services/ast-diff-service.js';
import { getSearchIndexService } from '../services/search-index-service.js';
import { getDocumentationService } from '../services/documentation-service.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { getDecompiledPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const RemapModJarSchema = z.object({
  inputJar: z.string().describe('Path to the input mod JAR file'),
  outputJar: z.string().describe('Path for the output remapped JAR file'),
  mcVersion: z.string().describe('Minecraft version the mod is for'),
  toMapping: z.enum(['yarn', 'mojmap']).describe('Target mapping type'),
});

const FindMappingSchema = z.object({
  symbol: z.string().describe('Symbol name to look up (class name, method name, or field name)'),
  version: z.string().describe('Minecraft version'),
  sourceMapping: z.enum(['yarn', 'mojmap', 'intermediary']).describe('Source mapping type'),
  targetMapping: z.enum(['yarn', 'mojmap', 'intermediary']).describe('Target mapping type'),
});

const SearchMinecraftCodeSchema = z.object({
  version: z.string().describe('Minecraft version'),
  query: z.string().describe('Search query (regex pattern or literal string)'),
  searchType: z.enum(['class', 'method', 'field', 'content', 'all']).describe('Type of search'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
  limit: z.number().optional().describe('Maximum number of results (default: 50)'),
});

const CompareVersionsSchema = z.object({
  fromVersion: z.string().describe('Source Minecraft version'),
  toVersion: z.string().describe('Target Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  category: z.enum(['classes', 'registry', 'all']).optional().describe('What to compare'),
});

// Phase 2 Tool Schemas
const AnalyzeMixinSchema = z.object({
  source: z.string().describe('Mixin source code (Java) or path to a JAR/directory'),
  mcVersion: z.string().describe('Minecraft version to validate against'),
  mapping: z.enum(['yarn', 'mojmap']).optional().describe('Mapping type (default: yarn)'),
});

const ValidateAccessWidenerSchema = z.object({
  content: z.string().describe('Access widener file content or path to .accesswidener file'),
  mcVersion: z.string().describe('Minecraft version to validate against'),
  mapping: z.enum(['yarn', 'mojmap']).optional().describe('Mapping type (default: yarn)'),
});

const CompareVersionsDetailedSchema = z.object({
  fromVersion: z.string().describe('Source Minecraft version'),
  toVersion: z.string().describe('Target Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  packages: z.array(z.string()).optional().describe('Specific packages to compare (e.g., ["net.minecraft.entity"])'),
  maxClasses: z.number().optional().describe('Maximum classes to compare (default: 1000)'),
});

const IndexVersionSchema = z.object({
  version: z.string().describe('Minecraft version to index'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
});

const SearchIndexedSchema = z.object({
  query: z.string().describe('Search query (supports FTS5 syntax)'),
  version: z.string().describe('Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
  types: z.array(z.enum(['class', 'method', 'field'])).optional().describe('Entry types to search'),
  limit: z.number().optional().describe('Maximum results (default: 100)'),
});

const GetDocumentationSchema = z.object({
  className: z.string().describe('Class name to get documentation for'),
});

const SearchDocumentationSchema = z.object({
  query: z.string().describe('Search query for documentation'),
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
  {
    name: 'remap_mod_jar',
    description:
      'Remap a Fabric mod JAR from intermediary mappings to human-readable mappings. Useful for reading mod source code.',
    inputSchema: {
      type: 'object',
      properties: {
        inputJar: {
          type: 'string',
          description: 'Path to the input mod JAR file',
        },
        outputJar: {
          type: 'string',
          description: 'Path for the output remapped JAR file',
        },
        mcVersion: {
          type: 'string',
          description: 'Minecraft version the mod is for',
        },
        toMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Target mapping type',
        },
      },
      required: ['inputJar', 'outputJar', 'mcVersion', 'toMapping'],
    },
  },
  {
    name: 'find_mapping',
    description:
      'Look up a symbol (class, method, or field) mapping between different mapping systems. Useful for translating between intermediary, yarn, and mojmap names.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to look up (class name, method name, or field name)',
        },
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        sourceMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap', 'intermediary'],
          description: 'Source mapping type',
        },
        targetMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap', 'intermediary'],
          description: 'Target mapping type',
        },
      },
      required: ['symbol', 'version', 'sourceMapping', 'targetMapping'],
    },
  },
  {
    name: 'search_minecraft_code',
    description:
      'Search for classes, methods, fields, or content in decompiled Minecraft source code. Supports regex patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        query: {
          type: 'string',
          description: 'Search query (regex pattern or literal string)',
        },
        searchType: {
          type: 'string',
          enum: ['class', 'method', 'field', 'content', 'all'],
          description: 'Type of search to perform',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['version', 'query', 'searchType', 'mapping'],
    },
  },
  {
    name: 'compare_versions',
    description:
      'Compare two Minecraft versions to find differences in classes or registry data. Useful for tracking breaking changes between versions.',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: {
          type: 'string',
          description: 'Source Minecraft version',
        },
        toVersion: {
          type: 'string',
          description: 'Target Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
        category: {
          type: 'string',
          enum: ['classes', 'registry', 'all'],
          description: 'What to compare (default: all)',
        },
      },
      required: ['fromVersion', 'toVersion', 'mapping'],
    },
  },
  // Phase 2 Tools
  {
    name: 'analyze_mixin',
    description:
      'Analyze and validate Mixin code against Minecraft source. Parses @Mixin annotations, validates injection targets, and suggests fixes for issues.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Mixin source code (Java) or path to a JAR/directory containing mixins',
        },
        mcVersion: {
          type: 'string',
          description: 'Minecraft version to validate against',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type (default: yarn)',
        },
      },
      required: ['source', 'mcVersion'],
    },
  },
  {
    name: 'validate_access_widener',
    description:
      'Parse and validate Fabric Access Widener files against Minecraft source. Checks that targets exist and suggests fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Access widener file content or path to .accesswidener file',
        },
        mcVersion: {
          type: 'string',
          description: 'Minecraft version to validate against',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type (default: yarn)',
        },
      },
      required: ['content', 'mcVersion'],
    },
  },
  {
    name: 'compare_versions_detailed',
    description:
      'Compare two Minecraft versions with detailed AST-level analysis. Shows method signature changes, field changes, and breaking API changes.',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: {
          type: 'string',
          description: 'Source Minecraft version',
        },
        toVersion: {
          type: 'string',
          description: 'Target Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific packages to compare (e.g., ["net.minecraft.entity"])',
        },
        maxClasses: {
          type: 'number',
          description: 'Maximum classes to compare (default: 1000)',
        },
      },
      required: ['fromVersion', 'toVersion', 'mapping'],
    },
  },
  {
    name: 'index_minecraft_version',
    description:
      'Create a full-text search index for decompiled Minecraft source. Enables fast searching with search_indexed tool.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version to index',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type',
        },
      },
      required: ['version', 'mapping'],
    },
  },
  {
    name: 'search_indexed',
    description:
      'Fast full-text search using pre-built index. Much faster than search_minecraft_code for large queries. Requires index_minecraft_version first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)',
        },
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type',
        },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['class', 'method', 'field'] },
          description: 'Entry types to search',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 100)',
        },
      },
      required: ['query', 'version', 'mapping'],
    },
  },
  {
    name: 'get_documentation',
    description:
      'Get documentation for a Minecraft class or concept. Links to Fabric Wiki, Minecraft Wiki, and provides usage hints.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Class name to get documentation for',
        },
      },
      required: ['className'],
    },
  },
  {
    name: 'search_documentation',
    description:
      'Search for documentation across all known Minecraft/Fabric topics.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
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

// Handler for remap_mod_jar
export async function handleRemapModJar(args: unknown) {
  const { inputJar, outputJar, mcVersion, toMapping } = RemapModJarSchema.parse(args);

  logger.info(`Remapping mod JAR: ${inputJar} -> ${outputJar}`);

  const remapService = getRemapService();

  try {
    // Check input file exists
    if (!existsSync(inputJar)) {
      throw new Error(`Input JAR not found: ${inputJar}`);
    }

    const result = await remapService.remapModJar(
      inputJar,
      outputJar,
      mcVersion,
      toMapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: `Mod JAR remapped successfully!\n\nInput: ${inputJar}\nOutput: ${result}\nMinecraft Version: ${mcVersion}\nMapping: ${toMapping}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to remap mod JAR', error);
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

// Handler for find_mapping
export async function handleFindMapping(args: unknown) {
  const { symbol, version, sourceMapping, targetMapping } = FindMappingSchema.parse(args);

  logger.info(`Looking up mapping: ${symbol} (${sourceMapping} -> ${targetMapping})`);

  const mappingService = getMappingService();

  try {
    const result = await mappingService.lookupMapping(
      version,
      symbol,
      sourceMapping as MappingType,
      targetMapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to find mapping', error);
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

// Handler for search_minecraft_code
export async function handleSearchMinecraftCode(args: unknown) {
  const { version, query, searchType, mapping, limit = 50 } = SearchMinecraftCodeSchema.parse(args);

  logger.info(`Searching Minecraft code: ${query} (${searchType}) in ${version}/${mapping}`);

  const cacheManager = getCacheManager();

  try {
    // Check if decompiled source exists
    if (!cacheManager.hasDecompiledSource(version, mapping)) {
      return {
        content: [
          {
            type: 'text',
            text: `Decompiled source not found for ${version} with ${mapping} mappings. Run decompile_minecraft_version first.`,
          },
        ],
        isError: true,
      };
    }

    const decompiledPath = getDecompiledPath(version, mapping);
    const results: Array<{
      type: string;
      name: string;
      file: string;
      line?: number;
      context?: string;
    }> = [];

    // Recursively search files
    const searchDir = (dir: string) => {
      if (results.length >= limit) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.name.endsWith('.java')) {
          const relativePath = relative(decompiledPath, fullPath);
          const className = relativePath.replace(/\//g, '.').replace(/\.java$/, '');

          // For class search, match against file name
          if (searchType === 'class' || searchType === 'all') {
            const regex = new RegExp(query, 'i');
            if (regex.test(entry.name.replace('.java', ''))) {
              results.push({
                type: 'class',
                name: className,
                file: relativePath,
              });
            }
          }

          // For content/method/field search, read file and search
          if ((searchType === 'content' || searchType === 'method' || searchType === 'field' || searchType === 'all') && results.length < limit) {
            const content = readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const regex = new RegExp(query, 'gi');

            for (let i = 0; i < lines.length && results.length < limit; i++) {
              const line = lines[i];
              if (regex.test(line)) {
                // Determine type based on line content
                let type = 'content';
                if (searchType === 'method' || (searchType === 'all' && /\s+(public|private|protected)\s+.*\(/.test(line))) {
                  type = 'method';
                } else if (searchType === 'field' || (searchType === 'all' && /\s+(public|private|protected)\s+\w+\s+\w+\s*[;=]/.test(line))) {
                  type = 'field';
                }

                if (searchType === 'all' || type === searchType || searchType === 'content') {
                  results.push({
                    type,
                    name: className,
                    file: relativePath,
                    line: i + 1,
                    context: line.trim().substring(0, 200),
                  });
                }
              }
            }
          }
        }
      }
    };

    searchDir(decompiledPath);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              searchType,
              version,
              mapping,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search code', error);
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

// Handler for compare_versions
export async function handleCompareVersions(args: unknown) {
  const { fromVersion, toVersion, mapping, category = 'all' } = CompareVersionsSchema.parse(args);

  logger.info(`Comparing versions: ${fromVersion} -> ${toVersion} (${mapping})`);

  const cacheManager = getCacheManager();
  const registryService = getRegistryService();

  try {
    const result: {
      fromVersion: string;
      toVersion: string;
      mapping: string;
      classes?: {
        added: string[];
        removed: string[];
        addedCount: number;
        removedCount: number;
      };
      registry?: {
        added: Record<string, string[]>;
        removed: Record<string, string[]>;
      };
    } = {
      fromVersion,
      toVersion,
      mapping,
    };

    // Compare classes
    if (category === 'classes' || category === 'all') {
      const fromDecompiled = cacheManager.hasDecompiledSource(fromVersion, mapping);
      const toDecompiled = cacheManager.hasDecompiledSource(toVersion, mapping);

      if (fromDecompiled && toDecompiled) {
        const fromPath = getDecompiledPath(fromVersion, mapping);
        const toPath = getDecompiledPath(toVersion, mapping);

        const getClasses = (dir: string): Set<string> => {
          const classes = new Set<string>();
          const walk = (currentDir: string) => {
            const entries = readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = join(currentDir, entry.name);
              if (entry.isDirectory()) {
                walk(fullPath);
              } else if (entry.name.endsWith('.java')) {
                const relativePath = relative(dir, fullPath);
                classes.add(relativePath.replace(/\//g, '.').replace(/\.java$/, ''));
              }
            }
          };
          walk(dir);
          return classes;
        };

        const fromClasses = getClasses(fromPath);
        const toClasses = getClasses(toPath);

        const added = [...toClasses].filter((c) => !fromClasses.has(c));
        const removed = [...fromClasses].filter((c) => !toClasses.has(c));

        result.classes = {
          added: added.slice(0, 100), // Limit to first 100
          removed: removed.slice(0, 100),
          addedCount: added.length,
          removedCount: removed.length,
        };
      } else {
        result.classes = {
          added: [],
          removed: [],
          addedCount: 0,
          removedCount: 0,
        };
      }
    }

    // Compare registries
    if (category === 'registry' || category === 'all') {
      try {
        const fromRegistry = await registryService.getRegistryData(fromVersion) as Record<string, unknown>;
        const toRegistry = await registryService.getRegistryData(toVersion) as Record<string, unknown>;

        const added: Record<string, string[]> = {};
        const removed: Record<string, string[]> = {};

        // Compare each registry type
        const allKeys = new Set([...Object.keys(fromRegistry), ...Object.keys(toRegistry)]);

        for (const key of allKeys) {
          const fromEntries = new Set(Object.keys((fromRegistry[key] as Record<string, unknown>) || {}));
          const toEntries = new Set(Object.keys((toRegistry[key] as Record<string, unknown>) || {}));

          const addedEntries = [...toEntries].filter((e) => !fromEntries.has(e));
          const removedEntries = [...fromEntries].filter((e) => !toEntries.has(e));

          if (addedEntries.length > 0) {
            added[key] = addedEntries.slice(0, 20);
          }
          if (removedEntries.length > 0) {
            removed[key] = removedEntries.slice(0, 20);
          }
        }

        result.registry = { added, removed };
      } catch {
        result.registry = { added: {}, removed: {} };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to compare versions', error);
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

// Phase 2 Tool Handlers

// Handler for analyze_mixin
export async function handleAnalyzeMixin(args: unknown) {
  const { source, mcVersion, mapping = 'yarn' } = AnalyzeMixinSchema.parse(args);

  logger.info(`Analyzing mixin for MC ${mcVersion} (${mapping})`);

  const mixinService = getMixinService();

  try {
    // Check if source is a file path or actual source code
    let mixin;
    if (existsSync(source)) {
      // It's a path - could be JAR, directory, or single file
      if (source.endsWith('.jar')) {
        const mixins = await mixinService.parseMixinsFromJar(source);
        if (mixins.length === 0) {
          return {
            content: [{ type: 'text', text: 'No mixins found in JAR file' }],
          };
        }

        // Validate all mixins
        const results = await Promise.all(
          mixins.map(m => mixinService.validateMixin(m, mcVersion, mapping as MappingType))
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalMixins: mixins.length,
              validMixins: results.filter(r => r.isValid).length,
              invalidMixins: results.filter(r => !r.isValid).length,
              results,
            }, null, 2),
          }],
        };
      } else if (source.endsWith('.java')) {
        const sourceCode = readFileSync(source, 'utf8');
        mixin = mixinService.parseMixinSource(sourceCode, source);
      } else {
        // Assume directory
        const mixins = mixinService.parseMixinsFromDirectory(source);
        const results = await Promise.all(
          mixins.map(m => mixinService.validateMixin(m, mcVersion, mapping as MappingType))
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalMixins: mixins.length,
              validMixins: results.filter(r => r.isValid).length,
              invalidMixins: results.filter(r => !r.isValid).length,
              results,
            }, null, 2),
          }],
        };
      }
    } else {
      // Assume it's source code
      mixin = mixinService.parseMixinSource(source);
    }

    if (!mixin) {
      return {
        content: [{ type: 'text', text: 'No @Mixin annotation found in source' }],
        isError: true,
      };
    }

    const result = await mixinService.validateMixin(mixin, mcVersion, mapping as MappingType);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to analyze mixin', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for validate_access_widener
export async function handleValidateAccessWidener(args: unknown) {
  const { content, mcVersion, mapping = 'yarn' } = ValidateAccessWidenerSchema.parse(args);

  logger.info(`Validating access widener for MC ${mcVersion} (${mapping})`);

  const awService = getAccessWidenerService();

  try {
    let accessWidener;

    // Check if content is a file path
    if (existsSync(content)) {
      accessWidener = awService.parseAccessWidenerFile(content);
    } else {
      accessWidener = awService.parseAccessWidener(content);
    }

    const validation = await awService.validateAccessWidener(
      accessWidener,
      mcVersion,
      mapping as MappingType
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          accessWidener: {
            namespace: accessWidener.namespace,
            version: accessWidener.version,
            entryCount: accessWidener.entries.length,
          },
          validation,
        }, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to validate access widener', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for compare_versions_detailed
export async function handleCompareVersionsDetailed(args: unknown) {
  const { fromVersion, toVersion, mapping, packages, maxClasses } = CompareVersionsDetailedSchema.parse(args);

  logger.info(`Comparing ${fromVersion} vs ${toVersion} (detailed, ${mapping})`);

  const astDiffService = getAstDiffService();

  try {
    const diff = await astDiffService.compareVersionsDetailed(
      fromVersion,
      toVersion,
      mapping as MappingType,
      { packages, maxClasses }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(diff, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to compare versions', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for index_minecraft_version
export async function handleIndexVersion(args: unknown) {
  const { version, mapping } = IndexVersionSchema.parse(args);

  logger.info(`Indexing ${version}/${mapping}`);

  const searchService = getSearchIndexService();

  try {
    // Check if already indexed
    if (searchService.isIndexed(version, mapping as MappingType)) {
      const stats = searchService.getStats(version, mapping as MappingType);
      return {
        content: [{
          type: 'text',
          text: `Version ${version}/${mapping} is already indexed.\n\nStats:\n${JSON.stringify(stats, null, 2)}`,
        }],
      };
    }

    const result = await searchService.indexVersion(
      version,
      mapping as MappingType,
      (current, total, className) => {
        if (current % 100 === 0) {
          logger.info(`Indexing: ${current}/${total} - ${className}`);
        }
      }
    );

    return {
      content: [{
        type: 'text',
        text: `Indexing complete!\n\nFiles indexed: ${result.fileCount}\nDuration: ${result.duration}ms`,
      }],
    };
  } catch (error) {
    logger.error('Failed to index version', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for search_indexed
export async function handleSearchIndexed(args: unknown) {
  const { query, version, mapping, types, limit = 100 } = SearchIndexedSchema.parse(args);

  logger.info(`Searching indexed: ${query} in ${version}/${mapping}`);

  const searchService = getSearchIndexService();

  try {
    const results = searchService.search(
      query,
      version,
      mapping as MappingType,
      { types: types as Array<'class' | 'method' | 'field'>, limit }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query,
          version,
          mapping,
          count: results.length,
          results,
        }, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to search', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for get_documentation
export async function handleGetDocumentation(args: unknown) {
  const { className } = GetDocumentationSchema.parse(args);

  logger.info(`Getting documentation for ${className}`);

  const docService = getDocumentationService();

  try {
    const docs = await docService.getRelatedDocumentation(className);

    if (docs.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No documentation found for ${className}`,
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(docs, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to get documentation', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Handler for search_documentation
export async function handleSearchDocumentation(args: unknown) {
  const { query } = SearchDocumentationSchema.parse(args);

  logger.info(`Searching documentation: ${query}`);

  const docService = getDocumentationService();

  try {
    const results = docService.searchDocumentation(query);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query,
          count: results.length,
          results,
        }, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to search documentation', error);
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
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
    case 'remap_mod_jar':
      return handleRemapModJar(args);
    case 'find_mapping':
      return handleFindMapping(args);
    case 'search_minecraft_code':
      return handleSearchMinecraftCode(args);
    case 'compare_versions':
      return handleCompareVersions(args);
    // Phase 2 tools
    case 'analyze_mixin':
      return handleAnalyzeMixin(args);
    case 'validate_access_widener':
      return handleValidateAccessWidener(args);
    case 'compare_versions_detailed':
      return handleCompareVersionsDetailed(args);
    case 'index_minecraft_version':
      return handleIndexVersion(args);
    case 'search_indexed':
      return handleSearchIndexed(args);
    case 'get_documentation':
      return handleGetDocumentation(args);
    case 'search_documentation':
      return handleSearchDocumentation(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
