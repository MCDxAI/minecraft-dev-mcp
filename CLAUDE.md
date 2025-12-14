# Claude Code Context - Minecraft Dev MCP

This document provides essential context for working with the Minecraft Dev MCP codebase.

## Project Overview

This is a **Model Context Protocol (MCP) server** that provides AI assistants with access to decompiled Minecraft source code, registry data, and modding tools. It enables LLMs to help developers with Minecraft mod development by providing accurate, version-specific source code and game data.

## Release Status

- Phase 1 & 2 complete (core services, remap/decompile/search/compare) as of 2025-12-06; 29 integration tests pass end-to-end.
- Phase 3 focus: third-party mod analysis; missing piece is decompiling remapped mod JARs (see TODO below).

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
   - Uses tiny-remapper 0.12.0 (multi-threaded ASM remapper)

2. **vineflower.ts** - Wraps VineFlower JAR for decompilation
   - **Creates temporary folders**: `libraries/`, `versions/`, `logs/` in CWD during decompilation
   - These are VineFlower's workspace files and should be gitignored
   - Defaults align with Vineflower 1.11.2 (`-dgs=1 -hdc=0 -asc=1 -rsy=1 -lit=1`)

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
- Central cache is shared across workspaces; expect ~400–450 MB per MC version (JAR + mappings + remapped + decompiled + registry).

## Build & ESM Requirements

- ESM-only: `package.json` must keep `"type": "module"`; `tsconfig` uses `"module": "ES2022"`/bundler resolution.
- Local imports must include `.js` extensions after build (e.g., `./utils.js`), not `.ts`.
- No CommonJS `require`; all tooling/scripts assume ES modules.

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

## Error Handling, Security, and Performance Notes

- Network work uses retries/backoff; Java processes run with timeouts and stderr capture.
- Integrity checks: SHA-1/256 verification on downloads; cache rebuild on corruption.
- Security: path traversal guardrails on class names and file writes; Java processes memory-capped.
- Performance: favors lazy decompilation, parallel workers, and LRU-style cache eviction; compress/evict old versions if storage is tight.

## Reference Tools

- FabricMod-Remapper — exemplar for two-phase Yarn remapping strategy (official → intermediary → yarn).
- mojang2tiny — reference implementation for converting Mojang mappings to Tiny v2.
- tiny-remapper — upstream bytecode remapper we wrap; check changelog for behavior changes.

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

## MCP Tools Reference

### Phase 1 Tools (Core)
1. **`get_minecraft_source`** - Get decompiled source for a Minecraft class
2. **`decompile_minecraft_version`** - Trigger full decompilation of a version
3. **`list_minecraft_versions`** - List available and cached versions
4. **`get_registry_data`** - Get registry data (blocks, items, entities)

### Phase 2 Tools (Advanced Analysis)
5. **`remap_mod_jar`** - Remap Fabric mod JARs to human-readable names
6. **`find_mapping`** - Lookup symbol mappings between namespaces
7. **`search_minecraft_code`** - Regex search in decompiled source
8. **`compare_versions`** - Compare classes/registries between versions
9. **`analyze_mixin`** - Analyze and validate Mixin code
10. **`validate_access_widener`** - Validate access widener files
11. **`compare_versions_detailed`** - AST-level version comparison
12. **`index_minecraft_version`** - Create full-text search index
13. **`search_indexed`** - Fast FTS5 search on indexed versions
14. **`get_documentation`** - Get documentation for a class
15. **`search_documentation`** - Search documentation

### Phase 3 Tools (Mod Analysis)
16. **`analyze_mod_jar`** - Analyze third-party mod JAR files

#### `analyze_mod_jar` Tool

Analyzes a mod JAR file to extract comprehensive metadata. Supports Fabric, Quilt, Forge, and NeoForge mods.

**Input**:
```typescript
{
  jarPath: string;           // Local path to the mod JAR file
  includeAllClasses?: boolean; // Include full class list (can be large)
  includeRawMetadata?: boolean; // Include raw fabric.mod.json, mixin configs
}
```

**Output** includes:
- **Mod metadata**: ID, version, name, description, authors, license
- **Compatibility**: Minecraft version, loader version, Java version, environment (client/server)
- **Dependencies**: Required, optional, incompatible mods with version constraints
- **Entry points**: Main, client, server initializers with class references
- **Mixins**: Config files, packages, mixin class lists (common/client/server)
- **Class analysis**: Total count, package breakdown, mixin detection via bytecode
- **Nested JARs**: Jar-in-Jar dependencies

**Example usage** (for LLM):
```
analyze_mod_jar({ jarPath: "C:/mods/meteor-client-1.21.10-32.jar" })
```

Returns JSON with full mod analysis including detected loader type, all dependencies, entry points, and mixin configurations.

## Phase 3 Services

### `mod-analyzer-service.ts`

Analyzes third-party mod JARs without requiring Java. Performs:

1. **Loader Detection**: Checks for `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`
2. **Metadata Parsing**: Extracts mod ID, version, dependencies from loader-specific files
3. **Mixin Analysis**: Parses mixin config JSON files, extracts packages and class lists
4. **Bytecode Analysis**: Scans `.class` files for `@Mixin` annotations in constant pool
5. **Class Statistics**: Counts classes per package, identifies entry points

**Key types** (`src/types/minecraft.ts`):
- `ModLoader`: `'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown'`
- `ModAnalysisResult`: Complete analysis output structure
- `ModClass`: Class metadata including mixin detection
- `ModMixinConfig`: Parsed mixin configuration

## Missing Functionality / Future Enhancements

### Mod JAR Decompilation (TODO)

**Current State**: The `remap_mod_jar` tool successfully remaps Fabric mod JARs from intermediary to human-readable mappings (yarn/mojmap), converting all Minecraft class references inside the JAR to use named mappings.

**Missing**: There is no tool to **decompile the remapped JAR** to readable source code.

**Current Workflow**:
1. ✅ `remap_mod_jar` - Remap intermediary → yarn/mojmap (Minecraft class references)
2. ❌ **Missing** - Decompile remapped JAR to readable Java source
3. ✅ `analyze_mod_jar` - Extract metadata from JAR (works on original or remapped)

**Desired Workflow**:
1. `remap_mod_jar` - Remap the mod JAR
2. `decompile_mod_jar` - Decompile remapped JAR using VineFlower (same as Minecraft decompilation)
3. Browse/search decompiled mod source with human-readable Minecraft class names

**Implementation Notes**:
- Can reuse existing VineFlower integration from `decompile-service.ts`
- Output structure: `AppData/minecraft-dev-mcp/decompiled-mods/{mod-id}/{version}/{mapping}/`
- Tool name: `decompile_mod_jar` or add `decompile?: boolean` parameter to `remap_mod_jar`
- Would enable full mod source code analysis for educational/compatibility purposes

**Use Cases**:
- Understanding how other mods work for compatibility
- Learning mod development techniques
- Debugging mod interactions
- Educational reference for Minecraft modding patterns
