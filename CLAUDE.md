# Claude Code Context - Minecraft Dev MCP

This document provides essential context for working with the Minecraft Dev MCP codebase.

## Project Overview

This is a **Model Context Protocol (MCP) server** that provides AI assistants with access to decompiled Minecraft source code, registry data, and modding tools. It enables LLMs to help developers with Minecraft mod development by providing accurate, version-specific source code and game data.

## Architecture

### Core Services (`src/services/`)

1. **version-manager.ts** - Downloads and manages Minecraft client/server JARs from Mojang
   - `getVersionJar()` - Downloads client JAR (for remapping/decompilation)
   - `getServerJar()` - Downloads server JAR (for registry extraction)
   - Caches JARs in AppData/config directory

2. **mapping-service.ts** - Downloads and manages mappings (Yarn, Mojmap, Intermediary)
   - Yarn: Community mappings (best for mod development)
   - Mojmap: Official Mojang mappings
   - Intermediary: Fabric's stable intermediate mapping format

3. **remap-service.ts** - Remaps obfuscated Minecraft JARs using mappings
   - Uses tiny-remapper Java tool
   - Converts obfuscated names → human-readable names
   - **Yarn requires 2-step remapping**: obfuscated → intermediary → yarn

4. **decompile-service.ts** - Decompiles remapped JARs to Java source
   - Uses VineFlower decompiler
   - Produces readable Java source code
   - Caches decompiled sources for reuse

5. **registry-service.ts** - Extracts Minecraft registry data (blocks, items, entities, etc.)
   - **CRITICAL**: Must use SERVER JAR, not client JAR
   - Uses Minecraft's built-in data generator (`--reports` flag)
   - Handles both modern (1.18+) and legacy (<1.18) formats

6. **source-service.ts** - Main orchestration service
   - Coordinates version management → remapping → decompilation
   - Provides `getMinecraftSource()` for retrieving specific class source code
   - Handles caching and progress reporting

### Java Tool Wrappers (`src/java/`)

1. **tiny-remapper.ts** - Wraps tiny-remapper JAR for remapping obfuscated classes
   - Handles namespace conversions (official → intermediary → named)

2. **vineflower.ts** - Wraps VineFlower JAR for decompilation
   - **Creates temporary folders**: `libraries/`, `versions/`, `logs/` in CWD during decompilation
   - These are VineFlower's workspace files and should be gitignored

3. **mc-data-gen.ts** - Runs Minecraft's data generator to extract registry data
   - **MC 1.18+**: Uses bundler format: `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar`
   - **MC <1.18**: Uses legacy format: `java -cp server.jar net.minecraft.data.Main`
   - Checks multiple locations for `registries.json`:
     - MC 1.21+: `reports/registries.json`
     - MC <1.21: `generated/reports/registries.json`

4. **java-process.ts** - Low-level Java process execution wrapper
   - Supports both `-jar` and `-cp` modes
   - Handles JVM args (e.g., `-DbundlerMainClass`)
   - Provides timeout, progress tracking, and error handling

### Downloaders (`src/downloaders/`)

1. **mojang-downloader.ts** - Downloads JARs and mappings from Mojang
   - `downloadClientJar()` - Client JAR (for playing/remapping)
   - `downloadServerJar()` - Server JAR (for registry extraction)
   - `downloadMojangMappings()` - Official Mojang mappings
   - All downloads include SHA-1 verification

2. **yarn-downloader.ts** - Downloads Yarn mappings from Fabric Maven
   - Uses Maven API to find available versions
   - Downloads and converts to Tiny v2 format

3. **java-resources.ts** - Downloads Java tool JARs (VineFlower, tiny-remapper)
   - Caches in AppData/resources directory

### Cache Management (`src/cache/`)

1. **cache-manager.ts** - High-level cache operations
   - Checks if versions/mappings/decompiled sources exist
   - Returns cached paths

2. **database.ts** - SQLite database for metadata
   - Tracks versions, mappings, decompilation jobs
   - Stores access times for cache cleanup

### Paths and Storage (`src/utils/paths.ts`)

**Cache Directory Structure**:
- Windows: `%APPDATA%\minecraft-dev-mcp\`
- macOS: `~/Library/Application Support/minecraft-dev-mcp/`
- Linux: `~/.config/minecraft-dev-mcp/`

**Subdirectories**:
- `jars/` - Client and server JARs
  - `minecraft_client.{version}.jar`
  - `minecraft_server.{version}.jar`
- `mappings/` - Mapping files (Tiny format)
- `remapped/` - Remapped JARs
- `decompiled/{version}/{mapping}/` - Decompiled source code
- `registry/{version}/` - Registry data
- `resources/` - Java tool JARs (VineFlower, tiny-remapper)

## Critical Implementation Details

### Registry Extraction (IMPORTANT!)

**Problem Solved**: Registry extraction was failing because it tried to use the remapped client JAR.

**Solution**:
1. **Always use SERVER JAR** - The server JAR has the built-in data generator
2. **Use obfuscated JAR** - Don't remap it, the server JAR runs fine obfuscated
3. **Handle bundler format** - MC 1.18+ uses a bundler format that requires `-DbundlerMainClass`

**Implementation** (`src/services/registry-service.ts`):
```typescript
// Get SERVER JAR (not client!)
const serverJarPath = await this.versionManager.getServerJar(version);

// Run data generator with version-specific format
const registriesFile = await this.dataGen.generateRegistryData(
  serverJarPath,
  registryDir,
  version // Used to detect if bundler format needed
);
```

**Registry Names**:
- Use singular form: `block`, `item`, `entity` (NOT `blocks`, `items`, `entities`)
- Full names include namespace: `minecraft:block`, `minecraft:item`
- The code auto-adds `minecraft:` prefix if not present

### Yarn Mapping Remapping (Two-Step Process)

Yarn mappings require **two separate remapping operations**:

1. **Official → Intermediary**: Remap from obfuscated to Fabric's stable intermediary names
2. **Intermediary → Yarn**: Remap from intermediary to human-readable Yarn names

**Why?** Yarn builds on top of Intermediary to provide stable mappings across Minecraft versions.

**Implementation** (`src/services/remap-service.ts`):
```typescript
// Step 1: official → intermediary
const intermediaryJar = await this.tinyRemapper.remap(
  inputJar,
  intermediaryPath,
  intermediateMappings,
  'official', 'intermediary'
);

// Step 2: intermediary → named (yarn)
const yarnJar = await this.tinyRemapper.remap(
  intermediaryJar,
  outputPath,
  yarnMappings,
  'intermediary', 'named'
);
```

### VineFlower Temporary Files

VineFlower creates these folders in the **current working directory** during decompilation:
- `libraries/` - Extracted Minecraft libraries for dependency resolution
- `versions/` - Minecraft version metadata
- `logs/` - Decompilation logs

**These are temporary and gitignored** - but the actual decompiled sources go to AppData.

## Testing

### Integration Tests (`__tests__/integration.test.ts`)

Tests the entire pipeline end-to-end:
1. Version management (list, download)
2. JAR download and caching
3. Mapping download (Yarn)
4. JAR remapping (Yarn 2-step process)
5. Source code decompilation
6. **Registry extraction** (blocks, items)
7. MCP tool integration
8. Error handling

**Test Configuration** (`vitest.config.ts`):
- `watch: false` - Exit after tests finish (don't watch for changes)
- `testTimeout: 600000` - 10 minute timeout for long operations
- Tests use version `1.21.10` as the test target

**Running Tests**:
```bash
npm test  # Runs all integration tests
```

## Common Tasks

### Adding Support for a New Mapping Type

1. Add the type to `src/types/minecraft.ts`: `MappingType`
2. Create downloader in `src/downloaders/{type}-downloader.ts`
3. Update `mapping-service.ts` to handle the new type
4. Add test cases

### Debugging Registry Extraction Issues

1. Check the Java command being executed (logged by `java-process.ts`)
2. Verify you're using the **server JAR**, not client JAR
3. For MC 1.18+, ensure `-DbundlerMainClass=net.minecraft.data.Main` is present
4. Check `registries.json` location (may be in `reports/` or `generated/reports/`)
5. Verify registry names use singular form (`block` not `blocks`)

### Handling New Minecraft Versions

The code should work automatically, but be aware:
- **MC 1.18+**: Requires bundler format and Java 17+
- **MC 1.21+**: May require Java 21+
- Registry output location may change between versions
- Always test with integration tests

## AI Reference Folder

**IMPORTANT**: The `ai_reference/` folder contains reference implementations and documentation from related projects:
- `minecraft-registry-mcp/` - Python-based registry MCP server (our reference for registry extraction)
- Other Minecraft MCP servers and tools

**NOTE**: This folder is **.gitignored** to keep the repo clean, but you should **ALWAYS read and reference these files** when working on related features. They contain valuable implementation details and solved problems.

**If you see errors** about files not existing in `ai_reference/`, the files ARE there - it's just gitignored. You can still read them with the Read tool.

## Architecture Decisions

### Why Server JAR for Registries?
- Server JAR has built-in data generator (`--reports` flag)
- Client JAR doesn't include data generation tools
- Server JAR can run obfuscated (no remapping needed)

### Why Two-Step Remapping for Yarn?
- Yarn builds on Fabric's Intermediary mappings
- Intermediary provides stable names across versions
- This allows Yarn to update names without breaking between Minecraft versions

### Why VineFlower over Fernflower?
- Better Java 17+ support
- More accurate decompilation
- Better performance on large JARs
- Active maintenance

### Why Tiny v2 Format?
- Standard format for Fabric toolchain
- Supports multiple namespaces in one file
- Compact and efficient
- Well-supported by tools

## Troubleshooting

### "Class not found" errors during registry extraction
→ Using client JAR instead of server JAR. Check `registry-service.ts`.

### Yarn remapping fails
→ Ensure two-step process is happening (official → intermediary → yarn).

### Decompilation creates folders in project directory
→ Expected VineFlower behavior. These folders are gitignored.

### Tests timeout
→ First run downloads ~50MB of JARs. Increase timeout or use cached versions.

### "Java version" errors
→ MC 1.18+ requires Java 17+, MC 1.21+ requires Java 21+.

## Related Documentation

- `ARCHITECTURE.md` - High-level architecture overview
- `BUILD_SUMMARY.md` - Build process and setup
- `INTEGRATION_TEST_STATUS.md` - Test status and known issues
- `ai_reference/minecraft-registry-mcp/` - Python reference implementation
