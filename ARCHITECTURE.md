# Minecraft Dev MCP - Architecture Blueprint

**Version**: 1.0.0
**Date**: 2025-12-05
**Status**: Rapid Development - Single Session Implementation
**Module System**: ESM (ES Modules) - MANDATORY

## Executive Summary

**minecraft-dev-mcp** is a comprehensive MCP (Model Context Protocol) server built in TypeScript that provides LLMs with the ability to decompile Minecraft JARs, apply mappings (Yarn, Mojmap), and expose deobfuscated source code for AI-assisted Fabric mod development.

### Core Goal
Enable LLMs to access decompiled, human-readable Minecraft source code by:
1. Downloading Minecraft JARs (any version)
2. Downloading mappings (Yarn, Mojmap, Intermediary)
3. Decompiling JARs using Vineflower/CFR
4. Remapping bytecode using tiny-remapper
5. Exposing source code through MCP resources/tools

### Key Innovation
**Single central cache** in `%APPDATA%/minecraft-dev-mcp` (or equivalent) that works across multiple workspaces, ensuring the LLM can simply specify a Minecraft version and get instant access to decompiled source.

---

## Research Summary (2025 State-of-the-Art)

### Decompilers
- **Vineflower v1.11.2** (March 2025) - Modern Java decompiler, best accuracy
  - Supports Java 21+
  - Requires Java 17+ runtime
  - Best for modern Minecraft versions
  - [Source](https://github.com/Vineflower/vineflower)

- **CFR 0.151+** - Alternative decompiler
  - Java 6 codebase (highly portable)
  - Handles Java 13+ features
  - Fallback option
  - [Source](https://www.benf.org/other/cfr/)

### Mapping Systems (2025 Update)
**CRITICAL**: Minecraft is transitioning away from obfuscation:
- **Yarn** - Available up to Minecraft 1.21.10 (current version)
- **Mojang Official Mappings** - Now the standard (Minecraft removing obfuscation)
- **Intermediary** - Stable cross-version identifiers (Fabric)
- **Parchment** - Parameter names (optional enhancement)

[Source](https://fabricmc.net/2025/10/31/obfuscation.html)

### Remapping Tools
- **tiny-remapper 0.12.0** - FabricMC's official bytecode remapper
  - Multi-threaded, ASM-based
  - Supports Tiny v1/v2, SRG, ProGuard formats
  - Production-grade with hierarchy propagation
  - [Source](https://github.com/FabricMC/tiny-remapper)

### TypeScript MCP SDK
- **@modelcontextprotocol/sdk** (latest)
  - Official TypeScript implementation
  - Zod schema validation
  - Stdio and HTTP transports
  - [Source](https://github.com/modelcontextprotocol/typescript-sdk)

### Java-TypeScript Interop
Best approach: **Child process execution**
- Use Node.js `child_process` to spawn Java processes
- Pass JARs as CLI arguments
- Capture stdout/stderr for progress
- [Source](https://stackoverflow.com/questions/12892195)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LLM / Claude Desktop                         │
│                     (MCP Client)                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │ MCP Protocol (stdio/HTTP)
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│             minecraft-dev-mcp TypeScript Server                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│  │   MCP Tools     │  │  MCP Resources  │  │ Cache Manager   ││
│  │  - decompile    │  │  - source://    │  │  - Version DB   ││
│  │  - get_source   │  │  - mappings://  │  │  - JAR cache    ││
│  │  - remap_jar    │  │  - registry://  │  │  - Decompiled   ││
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘│
│           │                    │                     │          │
│           └────────────────────┴─────────────────────┘          │
│                              │                                  │
│  ┌──────────────────────────┴──────────────────────────────┐  │
│  │              Core Services Layer                         │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ VersionManager │ MappingService │ DecompileService │    │  │
│  │ JarDownloader  │ RemapService   │ RegistryExtractor│    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ↓                             ↓
    ┌─────────────────────┐       ┌────────────────────────┐
    │  Java Process Pool  │       │  Central Cache Store   │
    ├─────────────────────┤       ├────────────────────────┤
    │ - tiny-remapper.jar │       │ %APPDATA%/             │
    │ - vineflower.jar    │       │  minecraft-dev-mcp/    │
    │ - MC server.jar     │       │  ├─ jars/              │
    │   (data generator)  │       │  ├─ mappings/          │
    └─────────────────────┘       │  ├─ decompiled/        │
                                  │  ├─ cache.db (SQLite)  │
                                  └────────────────────────┘
```

### Component Breakdown

#### 1. MCP Server Layer (TypeScript)
**Location**: `src/server/`

**Responsibilities**:
- Expose MCP tools and resources
- Handle protocol communication
- Validate inputs with Zod schemas
- Orchestrate service calls
- Error handling and logging

**Key Files**:
- `index.ts` - Server entry point, transport setup
- `tools.ts` - Tool definitions and handlers
- `resources.ts` - Resource definitions and handlers
- `prompts.ts` - Prompt templates (optional)

#### 2. Core Services Layer (TypeScript)
**Location**: `src/services/`

**VersionManager** (`version-manager.ts`):
- Tracks available Minecraft versions
- Downloads JARs from Mojang's version manifest
- Handles bundled JARs (1.20.5+)
- Manages cache metadata

**MappingService** (`mapping-service.ts`):
- Downloads mappings from FabricMC Maven / Mojang
- Parses Tiny v1, Tiny v2, ProGuard formats
- Caches mapping files
- Provides mapping translation (Yarn ↔ Mojmap)

**DecompileService** (`decompile-service.ts`):
- Spawns Vineflower/CFR processes
- Manages decompilation jobs
- Progress tracking
- Source file organization

**RemapService** (`remap-service.ts`):
- Wraps tiny-remapper JAR execution
- Two-phase remapping (TinyRemapper + ASM)
- Handles classpath resolution
- Preserves resources/metadata

**RegistryExtractor** (`registry-extractor.ts`):
- Runs Minecraft's data generator
- Extracts registry JSON (blocks, items, entities)
- Caches registry data per version
- Handles bundled JAR extraction

#### 3. Cache Management Layer (TypeScript)
**Location**: `src/cache/`

**CacheManager** (`cache-manager.ts`):
- Central cache coordinator
- SQLite database for metadata
- File system operations
- Cache invalidation
- Storage optimization

**Schema**:
```sql
CREATE TABLE versions (
  version TEXT PRIMARY KEY,
  jar_path TEXT,
  jar_sha256 TEXT,
  mappings_version TEXT,
  decompiled_path TEXT,
  created_at INTEGER,
  last_accessed INTEGER
);

CREATE TABLE mappings (
  id INTEGER PRIMARY KEY,
  mc_version TEXT,
  mapping_type TEXT, -- 'yarn', 'mojmap', 'intermediary'
  file_path TEXT,
  downloaded_at INTEGER
);

CREATE TABLE decompile_jobs (
  id INTEGER PRIMARY KEY,
  version TEXT,
  status TEXT, -- 'pending', 'running', 'completed', 'failed'
  progress REAL,
  started_at INTEGER,
  completed_at INTEGER
);
```

#### 4. Java Integration Layer (TypeScript)
**Location**: `src/java/`

**JavaProcess** (`java-process.ts`):
- Spawn Java child processes
- Stream stdout/stderr
- Progress parsing
- Error handling
- Process lifecycle management

**TinyRemapperWrapper** (`tiny-remapper.ts`):
- Build CLI arguments for tiny-remapper
- Execute remapping workflow
- Handle configuration options

**VineflowerWrapper** (`vineflower.ts`):
- Build CLI arguments for Vineflower
- Execute decompilation
- Parse progress output

**MinecraftDataGenerator** (`mc-data-gen.ts`):
- Execute Minecraft's --reports generator
- Handle bundled JAR unbundling
- Extract registry JSON

---

## Directory Structure

```
minecraft-dev-mcp/
├── src/
│   ├── server/
│   │   ├── index.ts               # Main server entry
│   │   ├── tools.ts               # MCP tool definitions
│   │   ├── resources.ts           # MCP resource handlers
│   │   └── prompts.ts             # Prompt templates
│   ├── services/
│   │   ├── version-manager.ts     # MC version management
│   │   ├── mapping-service.ts     # Mapping download/parse
│   │   ├── decompile-service.ts   # Decompilation orchestration
│   │   ├── remap-service.ts       # Remapping orchestration
│   │   └── registry-extractor.ts  # Registry data extraction
│   ├── cache/
│   │   ├── cache-manager.ts       # Central cache
│   │   ├── database.ts            # SQLite operations
│   │   └── file-store.ts          # File system helpers
│   ├── java/
│   │   ├── java-process.ts        # Base Java executor
│   │   ├── tiny-remapper.ts       # tiny-remapper wrapper
│   │   ├── vineflower.ts          # Vineflower wrapper
│   │   └── mc-data-gen.ts         # MC data generator
│   ├── parsers/
│   │   ├── tiny-v1.ts             # Tiny v1 parser
│   │   ├── tiny-v2.ts             # Tiny v2 parser
│   │   ├── proguard.ts            # ProGuard parser
│   │   └── version-manifest.ts   # Mojang manifest parser
│   ├── downloaders/
│   │   ├── mojang-downloader.ts   # MC JAR downloader
│   │   ├── fabric-maven.ts        # Fabric Maven client
│   │   └── http-client.ts         # Base HTTP client
│   ├── models/
│   │   ├── version.ts             # Version models
│   │   ├── mapping.ts             # Mapping models
│   │   ├── class-info.ts          # Java class models
│   │   └── registry.ts            # Registry models
│   ├── utils/
│   │   ├── logger.ts              # Logging utility
│   │   ├── paths.ts               # Path helpers
│   │   └── hash.ts                # SHA-256 hashing
│   └── types/
│       ├── mcp.ts                 # MCP type definitions
│       └── minecraft.ts           # Minecraft types
├── resources/
│   ├── jars/
│   │   ├── tiny-remapper-0.12.0-fat.jar
│   │   └── vineflower-1.11.2.jar
│   └── templates/
│       └── ...
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── package.json
├── tsconfig.json
├── .mcp.json                      # MCP server config
└── README.md
```

---

## MCP API Design

### Tools

#### 1. `get_minecraft_source`
Get decompiled source code for a specific Minecraft class.

**Input Schema**:
```typescript
{
  version: string;          // e.g., "1.21.10"
  className: string;        // e.g., "net.minecraft.world.entity.Entity"
  mapping: "yarn" | "mojmap";
}
```

**Output**:
```typescript
{
  content: [{
    type: "text",
    text: "// Decompiled Java source..."
  }]
}
```

#### 2. `search_minecraft_code`
Search for classes/methods/fields in Minecraft source.

**Input Schema**:
```typescript
{
  version: string;
  query: string;            // e.g., "EntityType"
  searchType: "class" | "method" | "field" | "all";
  mapping: "yarn" | "mojmap";
  limit?: number;
}
```

**Output**:
```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      results: [
        { type: "class", name: "EntityType", package: "net.minecraft.world.entity" },
        { type: "method", name: "getType", class: "Entity", signature: "()EntityType<Entity>" }
      ]
    })
  }]
}
```

#### 3. `decompile_minecraft_version`
Trigger decompilation of a Minecraft version (if not cached).

**Input Schema**:
```typescript
{
  version: string;
  mapping: "yarn" | "mojmap";
  force?: boolean;          // Re-decompile even if cached
}
```

**Output**:
```typescript
{
  content: [{
    type: "text",
    text: "Decompilation completed. Classes: 8376, Time: 45s"
  }]
}
```

#### 4. `list_minecraft_versions`
List available/cached Minecraft versions.

**Output**:
```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      cached: ["1.21.10", "1.20.4"],
      available: ["1.21.10", "1.21.9", ...]
    })
  }]
}
```

#### 5. `get_registry_data`
Get registry data (blocks, items, entities).

**Input Schema**:
```typescript
{
  version: string;
  registry: "blocks" | "items" | "entities" | "all";
}
```

#### 6. `remap_mod_jar`
Remap a Fabric mod JAR from intermediary to named mappings.

**Input Schema**:
```typescript
{
  inputJar: string;
  outputJar: string;
  mcVersion: string;
  toMapping: "yarn" | "mojmap";
  decompile?: boolean;
}
```

#### 7. `find_mapping`
Look up a specific mapping.

**Input Schema**:
```typescript
{
  symbol: string;           // e.g., "class_123" or "WorldRenderer"
  version: string;
  sourceMapping: "intermediary" | "yarn" | "mojmap";
  targetMapping: "intermediary" | "yarn" | "mojmap";
}
```

#### 8. `compare_versions`
Compare two Minecraft versions (breaking changes).

**Input Schema**:
```typescript
{
  fromVersion: string;
  toVersion: string;
  mapping: "yarn" | "mojmap";
  category?: "api" | "mappings" | "registry" | "all";
}
```

### Resources

#### 1. `minecraft://source/{version}/{mapping}/{className}`
Read decompiled source for a class.

Example: `minecraft://source/1.21.10/yarn/net.minecraft.world.entity.Entity`

#### 2. `minecraft://mappings/{version}/{mapping}`
Access mapping file contents.

Example: `minecraft://mappings/1.21.10/yarn`

#### 3. `minecraft://registry/{version}/{registryType}`
Access registry data.

Example: `minecraft://registry/1.21.10/blocks`

#### 4. `minecraft://versions/list`
List all cached versions.

---

## Workflow Examples

### Workflow 1: First-Time Decompile

```
User: "Show me the Entity class from Minecraft 1.21.10 with Yarn mappings"

LLM calls: get_minecraft_source({
  version: "1.21.10",
  className: "net.minecraft.world.entity.Entity",
  mapping: "yarn"
})

minecraft-dev-mcp:
  1. Check cache: No decompiled source for 1.21.10/yarn
  2. VersionManager: Download minecraft_server.1.21.10.jar (if not cached)
  3. MappingService: Download Yarn 1.21.10 mappings (if not cached)
  4. RemapService: Run tiny-remapper to remap JAR
  5. DecompileService: Run Vineflower on remapped JAR
  6. CacheManager: Store decompiled source
  7. Return: Entity.java source code

Time: ~2-3 minutes first time
```

### Workflow 2: Cached Access

```
User: "Show me the ItemStack class from Minecraft 1.21.10"

LLM calls: get_minecraft_source({
  version: "1.21.10",
  className: "net.minecraft.world.item.ItemStack",
  mapping: "yarn"
})

minecraft-dev-mcp:
  1. Check cache: Found decompiled source for 1.21.10/yarn
  2. Read: %APPDATA%/minecraft-dev-mcp/decompiled/1.21.10/yarn/net/minecraft/world/item/ItemStack.java
  3. Return: ItemStack.java source code

Time: ~50ms
```

### Workflow 3: Registry Query

```
User: "List all entities in Minecraft 1.21.10"

LLM calls: get_registry_data({
  version: "1.21.10",
  registry: "entities"
})

minecraft-dev-mcp:
  1. Check cache: No registry data for 1.21.10
  2. VersionManager: Download minecraft_server.1.21.10.jar (if not cached)
  3. RegistryExtractor: Run data generator (--reports)
  4. Parse: generated/reports/registries.json
  5. CacheManager: Store registry data
  6. Return: Entity registry JSON

Time: ~30s first time, ~10ms cached
```

---

## Technical Implementation Details

### Tiny-Remapper Integration

**Two-Phase Strategy** (learned from FabricMod-Remapper):

**Phase 1: TinyRemapper (Java)**
```bash
java -jar tiny-remapper-0.12.0-fat.jar \
  input.jar \
  output-phase1.jar \
  mappings.tiny \
  intermediary \
  named \
  --threads=4 \
  --rebuild-source-filenames
```

**Phase 2: ASM Bytecode Remapping** (if needed)
Custom TypeScript implementation or additional Java tool for:
- InvokeDynamic remapping
- String constant remapping
- Bootstrap method handling

**Rationale**: TinyRemapper handles 95% of cases, but some edge cases (lambdas, reflection) need additional processing.

### Vineflower Integration

```bash
java -jar vineflower-1.11.2.jar \
  -dgs=1 \              # Decompile generics signatures
  -hdc=0 \              # Don't hide default constructor
  -asc=1 \              # ASCII strings
  -rsy=1 \              # Remove synthetic
  -lit=1 \              # Literals as is
  input-remapped.jar \
  output-dir/
```

**TypeScript Wrapper**:
```typescript
class VineflowerWrapper {
  async decompile(
    inputJar: string,
    outputDir: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const process = spawn('java', [
      '-jar', VINEFLOWER_JAR_PATH,
      '-dgs=1', '-hdc=0', '-asc=1', '-rsy=1', '-lit=1',
      inputJar,
      outputDir
    ]);

    // Parse stdout for progress: "Decompiling class net/minecraft/..."
    process.stdout.on('data', (data) => {
      const match = data.toString().match(/Decompiling class (\d+)\/(\d+)/);
      if (match && onProgress) {
        onProgress(parseInt(match[1]), parseInt(match[2]));
      }
    });

    return new Promise((resolve, reject) => {
      process.on('close', (code) => {
        code === 0 ? resolve() : reject(new Error(`Exit code ${code}`));
      });
    });
  }
}
```

### Mapping Download URLs

**Yarn Mappings**:
```
https://maven.fabricmc.net/net/fabricmc/yarn/{version}/yarn-{version}-v2.jar
https://maven.fabricmc.net/net/fabricmc/yarn/{version}/yarn-{version}.jar (Tiny v1)
```

**Intermediary**:
```
https://maven.fabricmc.net/net/fabricmc/intermediary/{version}/intermediary-{version}-v2.jar
```

**Mojang Mappings**:
```
1. GET https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
2. Find version entry → GET version.json
3. Extract downloads.client_mappings.url or downloads.server_mappings.url
4. Download ProGuard format mappings
```

**Version Manifest**:
```
https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
```

### Minecraft JAR Download

```
1. GET version_manifest_v2.json
2. Find version → GET {version}.json
3. downloads.server.url → minecraft_server.{version}.jar
```

**Bundled JAR Handling (1.20.5+)**:
```bash
# Detect: Check for META-INF/versions/ or bundler-metadata.json
java -jar minecraft_server.1.21.10.jar --output unbundled/
# Output: unbundled/versions/1.21.10/server-1.21.10.jar
```

### Registry Data Generation

```bash
java -DbundlerMainClass=net.minecraft.data.Main \
  -jar minecraft_server.1.21.10.jar \
  --reports \
  --server \
  --output ./generated

# For bundled JARs (1.20.5+):
java -cp unbundled/versions/{version}/server-{version}.jar \
  net.minecraft.data.Main \
  --reports \
  --server \
  --output ./generated
```

Output: `generated/reports/`:
- `registries.json` (all registries)
- `blocks.json` (block properties)
- `commands.json` (command syntax)

### Cache Structure

```
%APPDATA%/minecraft-dev-mcp/  (Windows)
~/Library/Application Support/minecraft-dev-mcp/  (macOS)
~/.config/minecraft-dev-mcp/  (Linux)

├── jars/
│   ├── minecraft_server.1.21.10.jar
│   ├── minecraft_server.1.20.4.jar
│   └── ...
├── mappings/
│   ├── yarn-1.21.10-v2.tiny
│   ├── intermediary-1.21.10.tiny
│   ├── mojmap-1.21.10.txt
│   └── ...
├── remapped/
│   ├── 1.21.10-yarn.jar
│   ├── 1.20.4-mojmap.jar
│   └── ...
├── decompiled/
│   ├── 1.21.10/
│   │   ├── yarn/
│   │   │   └── net/minecraft/.../*.java
│   │   └── mojmap/
│   │       └── net/minecraft/.../*.java
│   └── 1.20.4/
│       └── ...
├── registry/
│   ├── 1.21.10/
│   │   ├── registries.json
│   │   └── blocks.json
│   └── ...
├── cache.db  (SQLite)
└── minecraft-dev-mcp.log
```

**Cache Size Estimates**:
- Server JAR: ~50 MB per version
- Mappings: ~5-10 MB per version
- Remapped JAR: ~50 MB per version
- Decompiled source: ~200-300 MB per version (8000+ classes)
- Registry data: ~10 MB per version

**Total per version**: ~400-450 MB
**Typical usage (3 versions cached)**: ~1.2-1.5 GB

---

## Error Handling Strategy

### Error Categories

1. **Network Errors** (download failures)
   - Retry with exponential backoff
   - Fallback mirrors
   - Cache partial downloads

2. **Java Process Errors** (decompile/remap failures)
   - Capture stderr
   - Parse error messages
   - Return actionable feedback to LLM

3. **Cache Corruption**
   - SHA-256 verification
   - Automatic re-download
   - Cache rebuild

4. **Invalid Input**
   - Zod schema validation
   - Clear error messages
   - Suggest corrections

### Example Error Handling

```typescript
try {
  const source = await decompileService.getSource(version, className, mapping);
  return { content: [{ type: "text", text: source }] };
} catch (error) {
  if (error instanceof VersionNotFoundError) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Minecraft version ${version} not found. Available versions: ${availableVersions.join(', ')}`
      }]
    };
  }

  if (error instanceof DecompilationError) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Decompilation failed: ${error.message}. Try specifying a different mapping or check logs.`
      }]
    };
  }

  // Unexpected errors
  logger.error('Unexpected error', error);
  return {
    isError: true,
    content: [{
      type: "text",
      text: `Internal error occurred. Check logs for details.`
    }]
  };
}
```

---

## Performance Optimizations

### 1. Lazy Decompilation
Only decompile requested classes, not entire JAR upfront.

**Strategy**:
- On first request, remap entire JAR (unavoidable)
- Decompile only requested classes
- Cache decompiled classes individually
- Background task: Decompile all classes over time

### 2. Parallel Processing
Use worker threads for CPU-intensive tasks.

```typescript
import { Worker } from 'worker_threads';

async function decompileInParallel(classes: string[]): Promise<void> {
  const workers = Array.from({ length: os.cpus().length }, () =>
    new Worker('./decompile-worker.js')
  );

  // Distribute classes across workers
  // ...
}
```

### 3. Incremental Updates
When new Minecraft version released, use previous version's decompiled source as baseline.

### 4. Smart Caching
- LRU eviction for least-accessed versions
- Compress old decompiled sources
- Configurable cache size limit

---

## Security Considerations

### 1. Path Traversal Prevention
```typescript
function validateClassName(className: string): void {
  if (className.includes('..') || className.includes('\\')) {
    throw new SecurityError('Invalid class name');
  }
}
```

### 2. JAR Verification
```typescript
async function verifyJarIntegrity(jarPath: string, expectedSha1: string): Promise<void> {
  const actualSha1 = await computeSha1(jarPath);
  if (actualSha1 !== expectedSha1) {
    throw new IntegrityError('JAR verification failed');
  }
}
```

### 3. Process Sandboxing
Limit Java process resources:
```typescript
spawn('java', ['-Xmx2G', '-Xms512M', ...], {
  timeout: 5 * 60 * 1000,  // 5 minute timeout
  killSignal: 'SIGKILL'
});
```

### 4. Input Validation
All inputs validated with Zod before processing.

---

## Testing Strategy

### Unit Tests
- Mapping parsers (Tiny v1/v2, ProGuard)
- Cache operations
- Path utilities
- Schema validation

### Integration Tests
- Full decompilation workflow
- Remapping workflow
- Download and cache
- MCP protocol compliance

### E2E Tests
- Real Minecraft version decompilation
- LLM interaction simulation
- Multi-workspace cache sharing

### Performance Tests
- Decompilation speed benchmarks
- Cache hit/miss ratios
- Memory usage profiling

---

## Deployment and Distribution

### NPM Package
```json
{
  "name": "@your-org/minecraft-dev-mcp",
  "version": "1.0.0",
  "bin": {
    "minecraft-dev-mcp": "./dist/index.js"
  },
  "files": [
    "dist/",
    "resources/"
  ]
}
```

### Installation
```bash
npm install -g @your-org/minecraft-dev-mcp
```

### Configuration (.mcp.json)
```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp",
      "env": {
        "CACHE_DIR": "/custom/cache/path",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## Future Enhancements

### Phase 2 Features
1. **Mixin Support** - Analyze and validate Mixin code
2. **Access Widener Support** - Handle Fabric access wideners
3. **Multi-Version Diffing** - Show API changes between versions
4. **Code Search** - Full-text search across decompiled source
5. **Documentation Integration** - Link to Fabric/Minecraft wiki

### Phase 3 Features
1. **Hot Reload** - Watch for new Minecraft snapshots
2. **Custom Mappings** - Support custom mapping formats
3. **Mod Analysis** - Analyze third-party mod JARs
4. **Performance Profiling** - Identify bottlenecks in mods
5. **Web UI** - Optional web interface for cache management

---

## References

### Research Sources

**Decompilers**:
- [Vineflower Documentation](https://vineflower.org/)
- [CFR Official Site](https://www.benf.org/other/cfr/)

**Mappings**:
- [Fabric Mappings Documentation](https://wiki.fabricmc.net/tutorial:mappings)
- [Tiny v2 Specification](https://wiki.fabricmc.net/documentation:tiny2)
- [Fabric Obfuscation Removal Announcement](https://fabricmc.net/2025/10/31/obfuscation.html)

**Remapping**:
- [tiny-remapper GitHub](https://github.com/FabricMC/tiny-remapper)
- [FabricMod-Remapper](https://github.com/HuntingDev/FabricMod-Remapper)

**MCP SDK**:
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Documentation](https://modelcontextprotocol.io/)

**Java-TypeScript Interop**:
- [java-caller NPM](https://www.npmjs.com/package/java-caller)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)

---

## Appendix: Reference Codebases Analysis

Based on exploration of 4 existing MCP servers in `ai_reference/`:

### 1. linkie-mcp-server
- **Lesson**: Clean API wrapper pattern for external services
- **Reuse**: Mapping lookup patterns, namespace handling
- **Limitation**: No local processing, API-dependent

### 2. minecraft-registry-mcp
- **Lesson**: Excellent JAR download and bundled JAR handling
- **Reuse**: Version management, registry extraction logic
- **Limitation**: No actual decompilation

### 3. minecraft-versiondiff-mcp
- **Lesson**: Sophisticated mapping parsing and caching
- **Reuse**: Tiny v2 parser, SQLite caching strategy, mapping downloader
- **Limitation**: Simplified bytecode analysis

### 4. mixin-mcp-server
- **Lesson**: Bytecode parsing with python-javatools
- **Reuse**: JAR scanning patterns, class loading strategy
- **Limitation**: Python-only, no remapping

**Synthesis**: Our unified TypeScript server will combine:
- JAR handling from minecraft-registry-mcp
- Mapping parsing from minecraft-versiondiff-mcp
- Caching strategy from all four
- NEW: Actual decompilation and remapping

---

## Rapid Development Strategy

### Core Principles

**MANDATORY ESM Configuration**:
- All TypeScript files use ESM syntax (`import`/`export`, not `require`)
- `package.json` MUST include `"type": "module"`
- `tsconfig.json` MUST use `"module": "ES2022"` or higher
- All imports MUST include `.js` extensions for local files
- Example: `import { foo } from './utils.js'` (note .js, not .ts)

**Test-Driven Development (TDD)**:
- Write unit test alongside EVERY implementation
- Test must pass before moving to next component
- Use Vitest for fast ESM-native testing
- Test coverage target: 80%+ for core services

**Continuous Quality Checks**:
- Run TypeScript compiler (`tsc --noEmit`) after each file
- Run linter (ESLint/Biome) after each module
- Fix all errors before proceeding
- Zero tolerance for type `any` (use `unknown` if needed)

**Incremental Build Strategy**:
1. **Foundation Layer** → Test → Typecheck → Lint
2. **Service Layer** → Test → Typecheck → Lint
3. **Integration Layer** → Test → Typecheck → Lint
4. **API Layer** → Test → Typecheck → Lint
5. **E2E Validation** → Test → Typecheck → Lint

### Implementation Order

#### 1. Foundation Layer
```
├── Setup project (package.json, tsconfig.json)
│   └─ Test: Verify ESM imports work
├── Logging utility (utils/logger.ts)
│   └─ Test: Log levels, file output
├── Path utilities (utils/paths.ts)
│   └─ Test: Cache dir resolution across platforms
├── Hash utilities (utils/hash.ts)
│   └─ Test: SHA-256 computation
└── Base error classes (utils/errors.ts)
    └─ Test: Error hierarchy
```

#### 2. Data Layer
```
├── SQLite database wrapper (cache/database.ts)
│   └─ Test: CRUD operations, migrations
├── File store helpers (cache/file-store.ts)
│   └─ Test: Atomic writes, directory creation
└── Cache manager (cache/cache-manager.ts)
    └─ Test: Version tracking, cache invalidation
```

#### 3. Parser Layer
```
├── Version manifest parser (parsers/version-manifest.ts)
│   └─ Test: Parse real Mojang JSON
├── Tiny v2 parser (parsers/tiny-v2.ts)
│   └─ Test: Parse Yarn mapping fixture
├── Tiny v1 parser (parsers/tiny-v1.ts)
│   └─ Test: Parse legacy mapping fixture
└── ProGuard parser (parsers/proguard.ts)
    └─ Test: Parse Mojmap fixture
```

#### 4. Downloader Layer
```
├── HTTP client (downloaders/http-client.ts)
│   └─ Test: Mock fetch, retry logic
├── Mojang downloader (downloaders/mojang-downloader.ts)
│   └─ Test: Mock version manifest download
└── Fabric Maven client (downloaders/fabric-maven.ts)
    └─ Test: Mock mapping download
```

#### 5. Java Integration Layer
```
├── Java process wrapper (java/java-process.ts)
│   └─ Test: Spawn mock Java process
├── Vineflower wrapper (java/vineflower.ts)
│   └─ Test: Build correct CLI args
├── TinyRemapper wrapper (java/tiny-remapper.ts)
│   └─ Test: Build correct CLI args
└── MC data generator (java/mc-data-gen.ts)
    └─ Test: Detect bundled JAR
```

#### 6. Service Layer
```
├── VersionManager (services/version-manager.ts)
│   └─ Test: Download, cache, bundled JAR handling
├── MappingService (services/mapping-service.ts)
│   └─ Test: Download, parse, cache mappings
├── RemapService (services/remap-service.ts)
│   └─ Test: Remap workflow (mocked Java)
├── DecompileService (services/decompile-service.ts)
│   └─ Test: Decompile workflow (mocked Java)
└── RegistryExtractor (services/registry-extractor.ts)
    └─ Test: Extract registry (mocked Java)
```

#### 7. MCP API Layer
```
├── MCP tools (server/tools.ts)
│   └─ Test: Zod validation, tool execution
├── MCP resources (server/resources.ts)
│   └─ Test: Resource URI parsing
└── MCP server (server/index.ts)
    └─ Test: Stdio transport, protocol compliance
```

#### 8. Integration Testing
```
└── E2E test: Download MC 1.21.10, decompile one class
```

### Quality Gates

Each component MUST pass:
1. **Unit tests** (95%+ coverage for that module)
2. **Type check** (`tsc --noEmit`)
3. **Lint check** (ESLint/Biome)
4. **Runtime validation** (smoke test if applicable)

### Development Workflow

```bash
# For each component:
1. Write implementation (e.g., logger.ts)
2. Write test (e.g., logger.test.ts)
3. npm test -- logger.test.ts
4. npm run typecheck
5. npm run lint
6. Fix any issues → Repeat 3-5 until green
7. Commit and move to next component
```

### Tooling Setup

**package.json scripts**:
```json
{
  "type": "module",
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "build": "tsc",
    "dev": "tsx watch src/server/index.ts"
  }
}
```

**tsconfig.json (ESM)**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Error Recovery Strategy

If a test fails:
1. **Do NOT proceed** to next component
2. Debug using `console.log` or debugger
3. Fix implementation or test
4. Re-run all quality gates
5. Only move forward when 100% green

### Performance Optimization Points

Optimize during implementation (not as separate phase):
- Use streams for large file operations
- Implement lazy loading for parsers
- Add connection pooling for HTTP requests
- Use worker threads for CPU-intensive tasks (if needed)

---

**End of Architecture Blueprint**
