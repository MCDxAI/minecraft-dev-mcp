# Minecraft Dev MCP Server

> **MCP Server for Minecraft Mod Development** - Access decompiled Minecraft source code through Claude Desktop and other MCP clients.

A comprehensive Model Context Protocol (MCP) server that provides LLMs with the ability to decompile Minecraft JARs, apply mappings (Yarn, Mojmap), and expose deobfuscated source code for AI-assisted Fabric mod development.

## Features

- ✅ **Automatic Decompilation** - Download, remap, and decompile any Minecraft version (1.21.1+)
- ✅ **Multiple Mapping Types** - Support for Yarn and Mojmap (official) mappings
- ✅ **Smart Caching** - Central cache system avoids re-downloading/re-decompiling
- ✅ **Source Code Access** - Get decompiled Java source for any Minecraft class
- ✅ **Registry Data** - Extract block, item, entity, and other registry information
- ✅ **Production-Grade Tools** - Uses Vineflower decompiler and tiny-remapper

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Java 17+** - Required for decompilation tools
  - Check: `java -version`
  - Install: [Adoptium](https://adoptium.net/) or [Oracle JDK](https://www.oracle.com/java/technologies/downloads/)

## Installation

### Option 1: NPM (Recommended)

```bash
npm install -g @minecraft-dev/mcp-server
```

### Option 2: From Source

```bash
git clone https://github.com/your-org/minecraft-dev-mcp.git
cd minecraft-dev-mcp
npm install
npm run build
```

## Quick Start

### 1. Configure Claude Desktop

Add to your Claude Desktop config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

If installed from source:
```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "node",
      "args": ["/path/to/minecraft-dev-mcp/dist/index.js"]
    }
  }
}
```

### 2. Restart Claude Desktop

Restart Claude Desktop to load the MCP server.

### 3. Start Using

In Claude Desktop, you can now ask questions like:

```
"Show me the Entity class from Minecraft 1.21.10 using Yarn mappings"

"Decompile Minecraft 1.21.10 with Mojmap"

"What blocks are registered in Minecraft 1.21.10?"
```

## Available Tools

### `get_minecraft_source`
Get decompiled source code for a specific class.

**Parameters:**
- `version` (string) - Minecraft version (e.g., "1.21.10")
- `className` (string) - Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")
- `mapping` ("yarn" | "mojmap") - Mapping type to use

**Example:**
```typescript
{
  "version": "1.21.10",
  "className": "net.minecraft.world.entity.Entity",
  "mapping": "yarn"
}
```

### `decompile_minecraft_version`
Decompile an entire Minecraft version (runs once, then cached).

**Parameters:**
- `version` (string) - Minecraft version
- `mapping` ("yarn" | "mojmap") - Mapping type
- `force` (boolean, optional) - Force re-decompilation

**Example:**
```typescript
{
  "version": "1.21.10",
  "mapping": "yarn"
}
```

### `list_minecraft_versions`
List available and cached Minecraft versions.

**Returns:**
```json
{
  "cached": ["1.21.10"],
  "available": ["1.21.10", "1.21.9", "..."],
  "total_available": 800
}
```

### `get_registry_data`
Get Minecraft registry data (blocks, items, entities, etc.).

**Parameters:**
- `version` (string) - Minecraft version
- `registry` (string, optional) - Specific registry (e.g., "blocks", "items")

**Example:**
```typescript
{
  "version": "1.21.10",
  "registry": "blocks"
}
```

## Architecture

### Cache Structure

All data is cached in a platform-specific directory:

- **Windows:** `%APPDATA%\minecraft-dev-mcp`
- **macOS:** `~/Library/Application Support/minecraft-dev-mcp`
- **Linux:** `~/.config/minecraft-dev-mcp`

**Cache Layout:**
```
minecraft-dev-mcp/
├── jars/                  # Downloaded Minecraft client JARs
├── mappings/              # Yarn/Mojmap mapping files
├── remapped/              # Remapped JARs (intermediary -> named)
├── decompiled/            # Decompiled source code
│   └── 1.21.10/
│       ├── yarn/          # Yarn-mapped source
│       └── mojmap/        # Mojmap-mapped source
├── registry/              # Registry data (blocks, items, etc.)
├── resources/             # Downloaded tools (Vineflower, tiny-remapper)
├── cache.db               # SQLite metadata database
└── minecraft-dev-mcp.log  # Log file
```

**Cache Size:**
- ~400-500 MB per Minecraft version (JAR + mappings + decompiled source)
- Vineflower + tiny-remapper: ~1 MB (one-time download)

### Technology Stack

- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Decompiler:** [Vineflower 1.11.2](https://github.com/Vineflower/vineflower) (Java 17+ decompiler)
- **Remapper:** [tiny-remapper 0.10.3](https://github.com/FabricMC/tiny-remapper) (FabricMC's bytecode remapper)
- **Mappings:**
  - **Yarn:** [FabricMC Yarn](https://fabricmc.net/wiki/documentation:yarn) (community mappings)
  - **Mojmap:** [Official Mojang Mappings](https://www.minecraft.net/en-us/article/minecraft-snapshot-19w36a) (official names)
- **Database:** [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (metadata caching)

## Configuration

### Environment Variables

- `CACHE_DIR` - Override cache directory location
- `LOG_LEVEL` - Set logging level (`DEBUG`, `INFO`, `WARN`, `ERROR`)

**Example:**
```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp",
      "env": {
        "CACHE_DIR": "/custom/cache/path",
        "LOG_LEVEL": "DEBUG"
      }
    }
  }
}
```

## Workflow Examples

### Example 1: First-Time Decompilation

When you request source code for the first time:

1. **Downloads** Minecraft 1.21.10 client JAR (~50 MB)
2. **Downloads** Yarn mappings (~5 MB)
3. **Remaps** JAR from obfuscated to Yarn names (~2 min)
4. **Decompiles** all classes with Vineflower (~3 min)
5. **Returns** requested class source code

**Total:** ~5 minutes first time

### Example 2: Subsequent Requests (Cached)

When you request another class from the same version:

1. **Reads** from cached decompiled source
2. **Returns** class source code

**Total:** ~50ms (instant)

## Troubleshooting

### Java Not Found

**Error:** `Java 17+ is required but not found`

**Solution:**
1. Install Java 17+ from [Adoptium](https://adoptium.net/)
2. Verify: `java -version` shows 17 or higher
3. Ensure Java is in your PATH

### Decompilation Fails

**Error:** `Decompilation failed: ...`

**Solutions:**
1. Check disk space (need ~500 MB per version)
2. Check logs: `%APPDATA%\minecraft-dev-mcp\minecraft-dev-mcp.log`
3. Try force re-decompile: `{ "version": "1.21.10", "mapping": "yarn", "force": true }`
4. Clear cache and retry

### Mappings Not Available

**Error:** `Yarn mappings not available for version X.X.X`

**Solution:**
- Yarn mappings only support 1.21.1+
- Try using `"mapping": "mojmap"` instead

## Development

### Building from Source

```bash
git clone https://github.com/your-org/minecraft-dev-mcp.git
cd minecraft-dev-mcp
npm install
npm run build
```

### Running Tests

```bash
npm test
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Development Mode

```bash
npm run dev
```

## Performance

### Benchmarks (Minecraft 1.21.10 with Yarn)

| Operation | First Time | Cached |
|-----------|------------|--------|
| Download JAR | ~30s | Instant |
| Download Mappings | ~5s | Instant |
| Remap JAR | ~2 min | Instant |
| Decompile (8000+ classes) | ~3 min | Instant |
| Get Class Source | ~5 min | <100ms |

**Hardware:** Intel i7-12700K, 32GB RAM, SSD

## Contributing

Contributions welcome! Please see [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and type check
5. Submit a pull request

## License

MIT License - see [LICENSE](./LICENSE) file for details

## Credits

- **Vineflower** - Modern Java decompiler by [Vineflower Team](https://github.com/Vineflower/vineflower)
- **tiny-remapper** - JAR remapping tool by [FabricMC](https://github.com/FabricMC)
- **Yarn Mappings** - Community mappings by [FabricMC](https://fabricmc.net/)
- **MCP SDK** - Protocol implementation by [Anthropic](https://github.com/modelcontextprotocol/typescript-sdk)

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/minecraft-dev-mcp/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-org/minecraft-dev-mcp/discussions)
- **Documentation:** [ARCHITECTURE.md](./ARCHITECTURE.md)

---

**Built with ❤️ for the Minecraft modding community**
