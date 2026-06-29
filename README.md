<div align="center">

# Minecraft Dev MCP

**A Model Context Protocol server that gives AI assistants native access to Minecraft mod development tools — decompile, remap, search, and analyze Minecraft source code directly from your AI workflow.**

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat) ![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.0.4-purple?style=flat) ![Java](https://img.shields.io/badge/Java-17%2B-f97316?style=flat) ![WSL](https://img.shields.io/badge/WSL-Compatible-0078d4?style=flat)

</div>

---

<div align="center">

## Quick Start

### Prerequisites

| Requirement | Details |
| --- | --- |
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) |
| **Java 17+** | Required for decompilation and remapping • Verify with `java -version` • [Adoptium](https://adoptium.net/) or [Oracle JDK](https://www.oracle.com/java/technologies/downloads/) |

### Installation

| Method | Command |
| --- | --- |
| **NPM (Recommended)** | `npm install -g @mcdxai/minecraft-dev-mcp` |
| **NPX (No Install)** | Use `npx -y @mcdxai/minecraft-dev-mcp` directly in config |
| **From Source** | See the [Development](#development) section |

### Claude Desktop

Add to your Claude Desktop configuration file:

| Platform | Config Path |
| --- | --- |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

</div>

**NPM installation:**

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

**NPX (no installation required):**

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "npx",
      "args": ["-y", "@mcdxai/minecraft-dev-mcp"]
    }
  }
}
```

<div align="center">

### Claude Code

Add to `.claude/settings.local.json` in your project, or to your global Claude Code settings:

</div>

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

---

<div align="center">

## HTTP Transport

For clients or editors that connect over HTTP instead of stdio, start the server in HTTP mode. It uses the MCP Streamable HTTP transport with per-session isolation.

| Flag | Description |
| --- | --- |
| `--http` | Start with the Streamable HTTP transport instead of stdio |
| `--port <number>` | Port to listen on (default: `3000`) — also implies `--http` |
| `--host <address>` | Host to bind to (default: `127.0.0.1`) |

</div>

```bash
minecraft-dev-mcp --http --port 3000
```

The MCP endpoint is `http://<host>:<port>/mcp` (POST to call, GET for the SSE stream, DELETE to end a session). Each client gets its own session, so multiple clients can connect concurrently.

> **Security:** the default host `127.0.0.1` enables the SDK's DNS-rebinding protection automatically. Binding to a non-loopback host (e.g. `--host 0.0.0.0`) disables that protection — only do so on a trusted network, ideally behind a reverse proxy or auth.

---

<div align="center">

## CLI

A standalone CLI (`minecraft-dev-cli`) invokes the same tools directly — no MCP client required — for scripts, skills, and automation. Arguments are **flags-only** (`--key value` or `--key=value`) to avoid the JSON-quoting issues positional JSON arguments cause in PowerShell and other shells.

</div>

```bash
# List every tool with its parameters
minecraft-dev-cli list-tools

# Invoke a tool with flags
minecraft-dev-cli get_minecraft_source --version 1.21.10 --className net.minecraft.world.entity.Entity --mapping yarn

# Boolean / numeric / JSON values are coerced automatically
minecraft-dev-cli analyze_mod_jar --jarPath C:\mods\example.jar --includeAllClasses true
```

Output is always JSON: `{ "success": true, "tool": "...", "result": ... }` on success, or `{ "success": false, "tool": "...", "error": "..." }` with exit code `1` on failure. Run `minecraft-dev-cli help` for full usage.

---

<div align="center">

## Features

| Feature | Description |
| --- | --- |
| **On-demand decompilation** | Download, remap, and decompile any Minecraft version (1.14+) on first use — cached for instant access afterward |
| **Multiple mapping namespaces** | Yarn, Mojmap (official), Intermediary, and obfuscated — translate any symbol between them with `find_mapping` |
| **Decompiled source access** | Retrieve Java source for any Minecraft class with optional line-range filtering |
| **Mod JAR analysis** | Analyze Fabric, Quilt, Forge, and NeoForge mods — metadata, mixins, dependencies, entry points — and decompile them |
| **Mixin & Access Widener validation** | Validate Mixin annotations and `.accesswidener` files against decompiled source with error reporting and fix suggestions |
| **Version diff** | Class-level and AST-level diff between any two Minecraft versions — method signatures, field changes, breaking changes |
| **Full-text search** | SQLite FTS5 indexes for fast BM25-ranked search across Minecraft and mod source |

20 tools across 4 categories — see [docs/tools.md](docs/tools.md) for the full reference.

</div>

---

<div align="center">

## Common Workflows

| Workflow | Steps |
| --- | --- |
| **First-time source access** | Call `get_minecraft_source` — server downloads, remaps, and decompiles (~5 min first run). Subsequent requests for the same version return in ~50 ms from cache. |
| **Analyze a third-party mod** | `analyze_mod_jar` → `remap_mod_jar` → `decompile_mod_jar` → `search_mod_code` or `index_mod` + `search_mod_indexed` |
| **Validate a Fabric mixin** | `analyze_mixin` with your Java source or file path — validates targets, injection points, and method selectors against the decompiled MC version. |
| **Find breaking changes between versions** | `compare_versions` for a high-level overview, then `compare_versions_detailed` scoped to specific packages for full AST-level diffs. |
| **Fast broad search** | `index_minecraft_version` once, then `search_indexed` with FTS5 queries: `entity AND damage`, `"onBlockBreak"`, `tick*`, `BlockEntity NOT render`. |
| **Translate obfuscated names** | `find_mapping` with `sourceMapping: "official"` to look up the Yarn or Mojmap equivalent for any class, method, or field. |

</div>

---

<div align="center">

## Version Support

| Version Range | Yarn | Mojmap | Notes |
| --- | --- | --- | --- |
| **1.14 – 1.21.11** | Full support | Full support | Obfuscated — two-step remapping required (official → intermediary → named) |
| **26.1+** | Not available | Full support | Deobfuscated by Mojang — no remapping needed, classes already human-readable |

Yarn mappings are discontinued after 1.21.11, which is the last obfuscated Minecraft version. All 26.1+ releases ship with readable class and method names and only require Mojmap.

**Tested versions:** 1.19.4 · 1.20.1 · 1.21.10 · 1.21.11 · 26.1-snapshot-8 · 26.1-snapshot-9

</div>

---

<div align="center">

## Configuration

| Environment Variable | Description |
| --- | --- |
| `CACHE_DIR` | Override the default cache directory location |
| `LOG_LEVEL` | Logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |

</div>

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

---

<div align="center">

## Cache Location

Downloaded JARs, mappings, decompiled source, and search databases live in a platform-specific cache directory shared across all workspaces (~400–500 MB per Minecraft version).

| Platform | Cache Path |
| --- | --- |
| **Windows** | `%APPDATA%\minecraft-dev-mcp` |
| **macOS** | `~/Library/Application Support/minecraft-dev-mcp` |
| **Linux / WSL** | `~/.config/minecraft-dev-mcp` |

</div>

Delete the directory to clear the cache — the server re-downloads anything missing on next use. To relocate the cache anywhere on disk, set the `CACHE_DIR` environment variable (see [Configuration](#configuration)).

<div align="center">

### Cache Contents

| Path | Contents |
| --- | --- |
| `jars/` | Client and server JARs |
| `mappings/` | Yarn, Mojmap, and Intermediary mapping files |
| `remapped/` | Remapped JARs |
| `decompiled/<version>/<mapping>/` | Decompiled Minecraft source |
| `decompiled-mods/<modId>/<modVersion>/<mapping>/` | Decompiled third-party mod source |
| `registry/<version>/` | Extracted registry data (blocks, items, entities) |
| `resources/` | Java tool JARs (VineFlower, tiny-remapper) |
| `cache.db` | SQLite metadata database |
| `search_index.db` | SQLite FTS5 full-text search index |
| `minecraft-dev-mcp.log` | Server log file |

</div>

---

<div align="center">

## Development

| Task | Command |
| --- | --- |
| **Install dependencies** | `npm install` |
| **Build** | `npm run build` |
| **Dev mode (hot reload)** | `npm run dev` |
| **Tests** | `npm test` |

</div>

**Build from source:**

```bash
git clone https://github.com/MCDxAI/minecraft-dev-mcp.git
cd minecraft-dev-mcp
npm install
npm run build
```

---

<div align="center">

## Troubleshooting

| Issue | Solution |
| --- | --- |
| **Java not found** — `Java 17+ is required but not found` | Install Java 17+ from [Adoptium](https://adoptium.net/) • Verify with `java -version` • Ensure `java` is on your PATH |
| **Decompilation fails** | Check available disk space (~500 MB per version) • Review `%APPDATA%\minecraft-dev-mcp\minecraft-dev-mcp.log` • Force re-decompile by passing `"force": true` |
| **Yarn not available** — `Yarn mappings not available for version X` | Yarn is only supported for 1.14–1.21.11 • Use `mojmap` for 26.1+ versions |
| **Class not found** | Use the fully qualified class name (e.g., `net.minecraft.world.entity.Entity`) • Verify the version is decompiled |
| **Registry returns no data** | Registry names use singular form: `block`, `item`, `entity` — not `blocks`, `items`, `entities` |
| **WSL path error** | Both `/mnt/c/path/to/file` and `C:\path\to\file` are accepted for all JAR path parameters |

</div>

---

<div align="center">

## Credits

| Project | Details |
| --- | --- |
| **VineFlower** | Modern Java decompiler by the [Vineflower Team](https://github.com/Vineflower/vineflower) |
| **tiny-remapper** | JAR remapping tool by [FabricMC](https://github.com/FabricMC) |
| **Yarn Mappings** | Community-maintained mappings by [FabricMC](https://fabricmc.net/) |
| **MCP SDK** | Protocol implementation by [Anthropic](https://github.com/modelcontextprotocol/typescript-sdk) |

</div>
