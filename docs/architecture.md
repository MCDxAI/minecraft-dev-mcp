# Architecture

## Technology Stack

Built on [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk), [VineFlower 1.11.2](https://github.com/Vineflower/vineflower) (Java decompiler), and [tiny-remapper](https://github.com/FabricMC/tiny-remapper) (FabricMC's bytecode remapper). Mapping data comes from [FabricMC Yarn](https://fabricmc.net/wiki/documentation:yarn) and official Mojang mappings. Metadata caching and FTS5 full-text indexing use [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). Schema validation uses [Zod](https://github.com/colinhacks/zod). Written in TypeScript (ESM-only).

## Remapping Strategy

Yarn mappings require a two-step remapping process due to how FabricMC's mapping system is structured:

| Step | From | To | Mapping File |
| --- | --- | --- | --- |
| **1** | Official (obfuscated) | Intermediary | `intermediary.tiny` |
| **2** | Intermediary | Named (Yarn or Mojmap) | `yarn.tiny` or `mojmap.tiny` |

Intermediary provides stable, version-independent identifiers that bridge between obfuscated official names and human-readable Yarn/Mojmap names.

## Cache Structure

| Platform | Cache Directory |
| --- | --- |
| **Windows** | `%APPDATA%\minecraft-dev-mcp\` |
| **macOS** | `~/Library/Application Support/minecraft-dev-mcp/` |
| **Linux** | `~/.config/minecraft-dev-mcp/` |

| Path | Contents |
| --- | --- |
| `jars/` | Downloaded Minecraft client and server JARs |
| `mappings/` | Yarn, Mojmap, and Intermediary mapping files in Tiny v2 format |
| `remapped/` | Remapped JARs (obfuscated → named) |
| `decompiled/{version}/{mapping}/` | Decompiled Minecraft Java source files |
| `decompiled-mods/{modId}/{modVersion}/{mapping}/` | Decompiled mod source files |
| `registry/{version}/` | Registry data extracted by Minecraft's data generator |
| `resources/` | VineFlower and tiny-remapper JARs (downloaded once) |
| `search_index.db` | SQLite FTS5 indexes for Minecraft and mod source |
| `minecraft-dev-mcp.db` | Metadata, job tracking, and cache state |
| `minecraft-dev-mcp.log` | Server log file |

| Component | Approximate Size |
| --- | --- |
| **Per Minecraft version** | ~400–500 MB (JAR + mappings + remapped JAR + decompiled source) |
| **Per search index** | ~50–100 MB (SQLite FTS5, created on-demand) |
| **Decompiler tools** | ~1 MB (VineFlower + tiny-remapper, one-time download) |
