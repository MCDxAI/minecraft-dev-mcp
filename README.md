<div align="center">
  <h1>Minecraft Dev MCP Server</h1>
</div>

<div align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat">
  <img src="https://img.shields.io/badge/TypeScript-5.7.2-3178c6?style=flat">
  <img src="https://img.shields.io/badge/MCP%20SDK-1.0.4-purple?style=flat">
  <img src="https://img.shields.io/badge/Java-17%2B-orange?style=flat">
  <img src="https://img.shields.io/badge/Vitest-2.1.8-729B1B?style=flat">
  <img src="https://img.shields.io/badge/Biome-1.9.4-60a5fa?style=flat">
  <img src="https://img.shields.io/badge/better--sqlite3-11.7.0-003B57?style=flat">
  <img src="https://img.shields.io/badge/Zod-3.24.1-3e67b1?style=flat">
  <img src="https://img.shields.io/badge/WSL-Compatible-0078d4?style=flat">
</div>

<div align="center">
  <p>A comprehensive Model Context Protocol (MCP) server that enables AI agents and agentic CLIs (Claude Code, OpenAI Codex, etc.) to work seamlessly with Minecraft mod development. Provides decompilation, mapping translation (Yarn, Mojmap, Intermediary), mod analysis, mixin validation, version comparison, and deobfuscated source code access. Built with full WSL compatibility to support agentic tools running in WSL on Windows (like Codex) and native Windows environments (like Claude Code).</p>
</div>

<div align="center">
  <h1>Core Capabilities</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Feature</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Automatic Decompilation</b></td>
    <td>Download, remap, and decompile any Minecraft version (1.14+)</td>
  </tr>
  <tr>
    <td><b>Multiple Mapping Types</b></td>
    <td>Support for Yarn, Mojmap (official), Intermediary, and obfuscated mappings</td>
  </tr>
  <tr>
    <td><b>Smart Caching</b></td>
    <td>Central cache system avoids re-downloading/re-decompiling</td>
  </tr>
  <tr>
    <td><b>Source Code Access</b></td>
    <td>Get decompiled Java source for any Minecraft class with full-text search</td>
  </tr>
  <tr>
    <td><b>Registry Data</b></td>
    <td>Extract block, item, entity, and other registry information</td>
  </tr>
  <tr>
    <td><b>Mod Analysis</b></td>
    <td>Remap, validate mixins, analyze access wideners, and extract mod metadata</td>
  </tr>
  <tr>
    <td><b>Version Comparison</b></td>
    <td>Compare Minecraft versions with class-level and AST-level diff analysis</td>
  </tr>
  <tr>
    <td><b>Documentation Access</b></td>
    <td>Search and access Minecraft/Fabric documentation and usage hints</td>
  </tr>
  <tr>
    <td><b>Production-Grade Tools</b></td>
    <td>Uses Vineflower decompiler, tiny-remapper, and SQLite FTS5 indexing</td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Prerequisites</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Requirement</th>
    <th>Details</th>
  </tr>
  <tr>
    <td><b>Node.js 18+</b></td>
    <td><a href="https://nodejs.org/">Download Node.js</a></td>
  </tr>
  <tr>
    <td><b>Java 17+</b></td>
    <td>Required for decompilation tools<br>Check: <code>java -version</code><br>Install: <a href="https://adoptium.net/">Adoptium</a> or <a href="https://www.oracle.com/java/technologies/downloads/">Oracle JDK</a></td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Installation</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Method</th>
    <th>Instructions</th>
  </tr>
  <tr>
    <td><b>NPM (Recommended)</b></td>
    <td>
      <pre>npm install -g @mcdxai/minecraft-dev-mcp</pre>
    </td>
  </tr>
  <tr>
    <td><b>From Source</b></td>
    <td>
      <pre>git clone https://github.com/MCDxAI/minecraft-dev-mcp.git
cd minecraft-dev-mcp
npm install
npm run build</pre>
    </td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Quick Start</h1>
</div>

<div align="center">
  <h2>Claude Desktop Setup</h2>
</div>

<div align="center">

Add to your Claude Desktop config file:

<table>
  <tr>
    <th>Platform</th>
    <th>Config Path</th>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><code>%APPDATA%\Claude\claude_desktop_config.json</code></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><code>~/Library/Application Support/Claude/claude_desktop_config.json</code></td>
  </tr>
  <tr>
    <td><b>Linux</b></td>
    <td><code>~/.config/Claude/claude_desktop_config.json</code></td>
  </tr>
</table>

</div>

<div align="center">
  <h3>NPM Installation</h3>
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

<div align="center">
  <h3>NPX (No Installation)</h3>
</div>

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
  <h3>Source Installation</h3>
</div>

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

<div align="center">
  <p>Restart Claude Desktop to load the MCP server.</p>
</div>

---

<div align="center">
  <h2>Claude Code Setup</h2>
</div>

<div align="center">

Add to `.claude/settings.local.json` in your project:

</div>

<div align="center">
  <h3>Global Installation</h3>
</div>

```bash
npm install -g @mcdxai/minecraft-dev-mcp
```

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

<div align="center">
  <h3>NPX (No Installation)</h3>
</div>

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
  <p>The MCP server will be available immediately in Claude Code.</p>
</div>

---

<div align="center">
  <h2>Start Using</h2>
</div>

<div align="center">

In Claude Desktop, you can now ask questions like:

<table>
  <tr>
    <th>Category</th>
    <th>Example Query</th>
  </tr>
  <tr>
    <td><b>Source Access</b></td>
    <td><code>"Show me the Entity class from Minecraft 1.21.10 using Yarn mappings"</code></td>
  </tr>
  <tr>
    <td><b>Decompilation</b></td>
    <td><code>"Decompile Minecraft 1.21.10 with Mojmap"</code></td>
  </tr>
  <tr>
    <td><b>Registry Data</b></td>
    <td><code>"What blocks are registered in Minecraft 1.21.10?"</code></td>
  </tr>
  <tr>
    <td><b>Code Search</b></td>
    <td><code>"Search for all methods containing 'onBlockBreak' in 1.21.10"</code></td>
  </tr>
  <tr>
    <td><b>Version Diff</b></td>
    <td><code>"Compare Minecraft 1.21.10 and 1.21.11 to find breaking changes"</code></td>
  </tr>
  <tr>
    <td><b>Mod Analysis</b></td>
    <td><code>"Analyze the meteor-client.jar file and show me its dependencies"</code></td>
  </tr>
  <tr>
    <td><b>Mixin Validation</b></td>
    <td><code>"Validate this mixin code against Minecraft 1.21.10"</code></td>
  </tr>
  <tr>
    <td><b>Mapping Lookup</b></td>
    <td><code>"Convert the obfuscated class 'abc' to Yarn names for 1.21.10"</code></td>
  </tr>
</table>

</div>

<div align="center">
  <h1>Available Tools</h1>
</div>

<div align="center">
  <p>16 powerful tools organized into three capability tiers</p>
</div>

<div align="center">

<table>
  <tr>
    <th>Phase</th>
    <th>Tools</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Phase 1: Core Decompilation</b></td>
    <td>4 tools</td>
    <td>Essential decompilation, source access, version management, and registry data</td>
  </tr>
  <tr>
    <td><b>Phase 2: Advanced Analysis</b></td>
    <td>11 tools</td>
    <td>Mod JAR remapping, mapping lookups, code search, version comparison, mixin/access widener validation, indexing, and documentation</td>
  </tr>
  <tr>
    <td><b>Phase 3: Mod Analysis</b></td>
    <td>1 tool</td>
    <td>Comprehensive third-party mod JAR analysis for Fabric, Quilt, Forge, and NeoForge</td>
  </tr>
</table>

</div>

---

<div align="center">
  <h2>Phase 1: Core Decompilation Tools</h2>
</div>

<div align="center">
  <h3>get_minecraft_source</h3>
</div>

<div align="center">

Get decompiled source code for a specific Minecraft class.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version (e.g., "1.21.10")</td>
  </tr>
  <tr>
    <td><code>className</code></td>
    <td>string</td>
    <td>Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type to use</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "version": "1.21.10",
  "className": "net.minecraft.world.entity.Entity",
  "mapping": "yarn"
}
```

<div align="center">
  <h3>decompile_minecraft_version</h3>
</div>

<div align="center">

Decompile an entire Minecraft version (runs once, then cached).

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type</td>
  </tr>
  <tr>
    <td><code>force</code></td>
    <td>boolean (optional)</td>
    <td>Force re-decompilation</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "version": "1.21.10",
  "mapping": "yarn"
}
```

<div align="center">
  <h3>list_minecraft_versions</h3>
</div>

<div align="center">
  <p>List available and cached Minecraft versions.</p>
</div>

<div align="center">
  <h3>Returns</h3>
</div>

```json
{
  "cached": ["1.21.10"],
  "available": ["1.21.10", "1.21.9", "..."],
  "total_available": 800
}
```

<div align="center">
  <h3>get_registry_data</h3>
</div>

<div align="center">

Get Minecraft registry data (blocks, items, entities, etc.).

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version</td>
  </tr>
  <tr>
    <td><code>registry</code></td>
    <td>string (optional)</td>
    <td>Specific registry (e.g., "blocks", "items", "entities")</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "version": "1.21.10",
  "registry": "blocks"
}
```

---

<div align="center">
  <h2>Phase 2: Advanced Analysis Tools</h2>
</div>

<div align="center">
  <h3>remap_mod_jar</h3>
</div>

<div align="center">

Remap Fabric mod JARs from intermediary to human-readable mappings.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>inputJar</code></td>
    <td>string</td>
    <td>Path to input mod JAR (WSL or Windows path)</td>
  </tr>
  <tr>
    <td><code>outputJar</code></td>
    <td>string</td>
    <td>Path for output remapped JAR (WSL or Windows path)</td>
  </tr>
  <tr>
    <td><code>mcVersion</code></td>
    <td>string</td>
    <td>Minecraft version the mod is for</td>
  </tr>
  <tr>
    <td><code>toMapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Target mapping type</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "inputJar": "/mnt/c/mods/mymod.jar",
  "outputJar": "/mnt/c/mods/mymod-remapped.jar",
  "mcVersion": "1.21.10",
  "toMapping": "yarn"
}
```

<div align="center">
  <h3>find_mapping</h3>
</div>

<div align="center">

Look up symbol mappings between different mapping systems.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>symbol</code></td>
    <td>string</td>
    <td>Symbol to look up (class, method, or field name)</td>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version</td>
  </tr>
  <tr>
    <td><code>sourceMapping</code></td>
    <td>"official" | "intermediary" | "yarn" | "mojmap"</td>
    <td>Source mapping type</td>
  </tr>
  <tr>
    <td><code>targetMapping</code></td>
    <td>"official" | "intermediary" | "yarn" | "mojmap"</td>
    <td>Target mapping type</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "symbol": "Entity",
  "version": "1.21.10",
  "sourceMapping": "yarn",
  "targetMapping": "mojmap"
}
```

<div align="center">
  <h3>search_minecraft_code</h3>
</div>

<div align="center">

Search decompiled Minecraft source code using regex patterns.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version</td>
  </tr>
  <tr>
    <td><code>query</code></td>
    <td>string</td>
    <td>Search query (regex pattern or literal)</td>
  </tr>
  <tr>
    <td><code>searchType</code></td>
    <td>"class" | "method" | "field" | "content" | "all"</td>
    <td>Type of search to perform</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type</td>
  </tr>
  <tr>
    <td><code>limit</code></td>
    <td>number (optional)</td>
    <td>Maximum results (default: 50)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "version": "1.21.10",
  "query": "onBlockBreak",
  "searchType": "method",
  "mapping": "yarn",
  "limit": 20
}
```

<div align="center">
  <h3>compare_versions</h3>
</div>

<div align="center">

Compare two Minecraft versions to find differences.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>fromVersion</code></td>
    <td>string</td>
    <td>Source Minecraft version</td>
  </tr>
  <tr>
    <td><code>toVersion</code></td>
    <td>string</td>
    <td>Target Minecraft version</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type to use</td>
  </tr>
  <tr>
    <td><code>category</code></td>
    <td>"classes" | "registry" | "all" (optional)</td>
    <td>What to compare (default: all)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "fromVersion": "1.21.10",
  "toVersion": "1.21.11",
  "mapping": "yarn",
  "category": "all"
}
```

<div align="center">
  <h3>analyze_mixin</h3>
</div>

<div align="center">

Analyze and validate Mixin code against Minecraft source.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>source</code></td>
    <td>string</td>
    <td>Mixin source code or path to JAR/directory (WSL or Windows)</td>
  </tr>
  <tr>
    <td><code>mcVersion</code></td>
    <td>string</td>
    <td>Minecraft version to validate against</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap" (optional)</td>
    <td>Mapping type (default: yarn)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "source": "/path/to/MyMixin.java",
  "mcVersion": "1.21.10",
  "mapping": "yarn"
}
```

<div align="center">
  <h3>validate_access_widener</h3>
</div>

<div align="center">

Validate Fabric Access Widener files against Minecraft source.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>content</code></td>
    <td>string</td>
    <td>Access widener content or path to .accesswidener file</td>
  </tr>
  <tr>
    <td><code>mcVersion</code></td>
    <td>string</td>
    <td>Minecraft version to validate against</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap" (optional)</td>
    <td>Mapping type (default: yarn)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "content": "/path/to/mymod.accesswidener",
  "mcVersion": "1.21.10"
}
```

<div align="center">
  <h3>compare_versions_detailed</h3>
</div>

<div align="center">

Compare versions with detailed AST-level analysis.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>fromVersion</code></td>
    <td>string</td>
    <td>Source Minecraft version</td>
  </tr>
  <tr>
    <td><code>toVersion</code></td>
    <td>string</td>
    <td>Target Minecraft version</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type to use</td>
  </tr>
  <tr>
    <td><code>packages</code></td>
    <td>string[] (optional)</td>
    <td>Specific packages to compare</td>
  </tr>
  <tr>
    <td><code>maxClasses</code></td>
    <td>number (optional)</td>
    <td>Maximum classes (default: 1000)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "fromVersion": "1.21.10",
  "toVersion": "1.21.11",
  "mapping": "yarn",
  "packages": ["net.minecraft.entity"]
}
```

<div align="center">
  <h3>index_minecraft_version</h3>
</div>

<div align="center">

Create a full-text search index for fast searching.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version to index</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "version": "1.21.10",
  "mapping": "yarn"
}
```

<div align="center">
  <h3>search_indexed</h3>
</div>

<div align="center">

Fast full-text search using pre-built index (requires index_minecraft_version first).

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>query</code></td>
    <td>string</td>
    <td>Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)</td>
  </tr>
  <tr>
    <td><code>version</code></td>
    <td>string</td>
    <td>Minecraft version</td>
  </tr>
  <tr>
    <td><code>mapping</code></td>
    <td>"yarn" | "mojmap"</td>
    <td>Mapping type</td>
  </tr>
  <tr>
    <td><code>types</code></td>
    <td>("class" | "method" | "field")[] (optional)</td>
    <td>Entry types to search</td>
  </tr>
  <tr>
    <td><code>limit</code></td>
    <td>number (optional)</td>
    <td>Maximum results (default: 100)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "query": "entity AND damage",
  "version": "1.21.10",
  "mapping": "yarn",
  "types": ["method"],
  "limit": 50
}
```

<div align="center">
  <h3>get_documentation</h3>
</div>

<div align="center">

Get documentation for Minecraft classes and concepts.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>className</code></td>
    <td>string</td>
    <td>Class name to get documentation for</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "className": "Entity"
}
```

<div align="center">
  <h3>search_documentation</h3>
</div>

<div align="center">

Search for documentation across all Minecraft/Fabric topics.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>query</code></td>
    <td>string</td>
    <td>Search query</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "query": "block entity"
}
```

---

<div align="center">
  <h2>Phase 3: Mod Analysis Tools</h2>
</div>

<div align="center">
  <h3>analyze_mod_jar</h3>
</div>

<div align="center">

Analyze third-party mod JARs to extract comprehensive metadata.

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>jarPath</code></td>
    <td>string</td>
    <td>Local path to mod JAR file (WSL or Windows path)</td>
  </tr>
  <tr>
    <td><code>includeAllClasses</code></td>
    <td>boolean (optional)</td>
    <td>Include full class list (default: false)</td>
  </tr>
  <tr>
    <td><code>includeRawMetadata</code></td>
    <td>boolean (optional)</td>
    <td>Include raw metadata files (default: false)</td>
  </tr>
</table>

</div>

<div align="center">

**Supports:** Fabric, Quilt, Forge, and NeoForge mods

**Returns:** Mod ID, version, dependencies, entry points, mixin configurations, class statistics, and more

</div>

<div align="center">
  <h3>Example</h3>
</div>

```json
{
  "jarPath": "C:\\mods\\meteor-client.jar",
  "includeAllClasses": false,
  "includeRawMetadata": true
}
```

<div align="center">
  <h1>Architecture</h1>
</div>

<div align="center">
  <h2>Cache Structure</h2>
</div>

<div align="center">

All data is cached in a platform-specific directory:

<table>
  <tr>
    <th>Platform</th>
    <th>Cache Directory</th>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><code>%APPDATA%\minecraft-dev-mcp</code></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><code>~/Library/Application Support/minecraft-dev-mcp</code></td>
  </tr>
  <tr>
    <td><b>Linux</b></td>
    <td><code>~/.config/minecraft-dev-mcp</code></td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Cache Layout</h3>
</div>

<div align="center">
<table>
  <tr>
    <th>Directory</th>
    <th>Contents</th>
  </tr>
  <tr>
    <td><code>jars/</code></td>
    <td>Downloaded Minecraft client JARs</td>
  </tr>
  <tr>
    <td><code>mappings/</code></td>
    <td>Yarn/Mojmap mapping files</td>
  </tr>
  <tr>
    <td><code>remapped/</code></td>
    <td>Remapped JARs (intermediary → named)</td>
  </tr>
  <tr>
    <td><code>decompiled/</code></td>
    <td>Decompiled source code<br><code>└── 1.21.10/</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;├── yarn/</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;└── mojmap/</code></td>
  </tr>
  <tr>
    <td><code>registry/</code></td>
    <td>Registry data (blocks, items, etc.)</td>
  </tr>
  <tr>
    <td><code>search-index/</code></td>
    <td>SQLite FTS5 full-text search indexes<br><code>└── 1.21.10-yarn.db</code></td>
  </tr>
  <tr>
    <td><code>resources/</code></td>
    <td>Downloaded tools (Vineflower, tiny-remapper)</td>
  </tr>
  <tr>
    <td><code>cache.db</code></td>
    <td>SQLite metadata database</td>
  </tr>
  <tr>
    <td><code>minecraft-dev-mcp.log</code></td>
    <td>Log file</td>
  </tr>
</table>
</div>

<div align="center">
  <h3>Cache Size</h3>
</div>

<div align="center">
<table>
  <tr>
    <th>Component</th>
    <th>Size</th>
  </tr>
  <tr>
    <td><b>Minecraft Version</b></td>
    <td>~400-500 MB per version (JAR + mappings + decompiled source)</td>
  </tr>
  <tr>
    <td><b>Search Index</b></td>
    <td>~50-100 MB per index (optional, created on-demand with index_minecraft_version)</td>
  </tr>
  <tr>
    <td><b>Decompiler Tools</b></td>
    <td>~1 MB for Vineflower + tiny-remapper (one-time download)</td>
  </tr>
</table>
</div>

<div align="center">
  <h2>Technology Stack</h2>
</div>

<div align="center">
<table>
  <tr>
    <th>Component</th>
    <th>Technology</th>
  </tr>
  <tr>
    <td><b>MCP SDK</b></td>
    <td><a href="https://github.com/modelcontextprotocol/typescript-sdk">@modelcontextprotocol/sdk 1.0.4</a></td>
  </tr>
  <tr>
    <td><b>Decompiler</b></td>
    <td><a href="https://github.com/Vineflower/vineflower">Vineflower 1.11.2</a> (Java 17+ decompiler)</td>
  </tr>
  <tr>
    <td><b>Remapper</b></td>
    <td><a href="https://github.com/FabricMC/tiny-remapper">tiny-remapper 0.10.3</a> (FabricMC's bytecode remapper)</td>
  </tr>
  <tr>
    <td><b>Yarn Mappings</b></td>
    <td><a href="https://fabricmc.net/wiki/documentation:yarn">FabricMC Yarn</a> (community mappings)</td>
  </tr>
  <tr>
    <td><b>Mojmap</b></td>
    <td><a href="https://www.minecraft.net/en-us/article/minecraft-snapshot-19w36a">Official Mojang Mappings</a></td>
  </tr>
  <tr>
    <td><b>Database</b></td>
    <td><a href="https://github.com/WiseLibs/better-sqlite3">better-sqlite3</a> (metadata caching & FTS5 indexing)</td>
  </tr>
  <tr>
    <td><b>JAR Parsing</b></td>
    <td><a href="https://github.com/cthackers/adm-zip">adm-zip</a> (mod JAR analysis & bytecode extraction)</td>
  </tr>
  <tr>
    <td><b>Schema Validation</b></td>
    <td><a href="https://github.com/colinhacks/zod">Zod</a> (tool input validation)</td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Version Support</h1>
</div>

<div align="center">

**Supported Minecraft Versions:** 1.14+ (any version with available mappings)

<table>
  <tr>
    <th>Version Range</th>
    <th>Yarn Mappings</th>
    <th>Mojmap</th>
    <th>Notes</th>
  </tr>
  <tr>
    <td><b>1.14 - 1.21.11</b></td>
    <td>✅ Full Support</td>
    <td>✅ Full Support</td>
    <td>Obfuscated versions requiring remapping</td>
  </tr>
  <tr>
    <td><b>26.1+</b></td>
    <td>❌ Not Available</td>
    <td>✅ Official Names</td>
    <td>Deobfuscated by Mojang (no remapping needed)</td>
  </tr>
</table>

</div>

<div align="center">
  <h3>Important Notes</h3>
</div>

<div align="center">
<table>
  <tr>
    <th>Topic</th>
    <th>Details</th>
  </tr>
  <tr>
    <td><b>Last Obfuscated Version</b></td>
    <td>1.21.11 is the last obfuscated Minecraft version</td>
  </tr>
  <tr>
    <td><b>Yarn Mapping Status</b></td>
    <td>Discontinued after 1.21.11 (obfuscation removal makes them unnecessary)</td>
  </tr>
  <tr>
    <td><b>Future Versions</b></td>
    <td>Versions 26.1+ ship with official deobfuscated code</td>
  </tr>
  <tr>
    <td><b>Tested Versions</b></td>
    <td>1.19.4, 1.20.1, 1.21.10, 1.21.11 (latest)</td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Configuration</h1>
</div>

<div align="center">
  <h2>Environment Variables</h2>
</div>

<div align="center">
<table>
  <tr>
    <th>Variable</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>CACHE_DIR</code></td>
    <td>Override cache directory location</td>
  </tr>
  <tr>
    <td><code>LOG_LEVEL</code></td>
    <td>Set logging level (<code>DEBUG</code>, <code>INFO</code>, <code>WARN</code>, <code>ERROR</code>)</td>
  </tr>
</table>
</div>

<div align="center">
  <h3>Example</h3>
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

<div align="center">
  <h1>Workflow Examples</h1>
</div>

<div align="center">
  <h2>Example 1: First-Time Decompilation</h2>
</div>

<div align="center">

When you request source code for the first time:

<table>
  <tr>
    <th>Step</th>
    <th>Action</th>
    <th>Time</th>
  </tr>
  <tr>
    <td>1</td>
    <td>Download Minecraft 1.21.10 client JAR (~50 MB)</td>
    <td>~30s</td>
  </tr>
  <tr>
    <td>2</td>
    <td>Download Yarn mappings (~5 MB)</td>
    <td>~5s</td>
  </tr>
  <tr>
    <td>3</td>
    <td>Remap JAR from obfuscated to Yarn names</td>
    <td>~2 min</td>
  </tr>
  <tr>
    <td>4</td>
    <td>Decompile all classes with Vineflower</td>
    <td>~3 min</td>
  </tr>
  <tr>
    <td>5</td>
    <td>Return requested class source code</td>
    <td>Instant</td>
  </tr>
  <tr>
    <td><b>Total</b></td>
    <td colspan="2">~5 minutes first time</td>
  </tr>
</table>

</div>

<div align="center">
  <h2>Example 2: Subsequent Requests (Cached)</h2>
</div>

<div align="center">

When you request another class from the same version:

<table>
  <tr>
    <th>Step</th>
    <th>Action</th>
    <th>Time</th>
  </tr>
  <tr>
    <td>1</td>
    <td>Read from cached decompiled source</td>
    <td>~50ms</td>
  </tr>
  <tr>
    <td>2</td>
    <td>Return class source code</td>
    <td>Instant</td>
  </tr>
  <tr>
    <td><b>Total</b></td>
    <td colspan="2">~50ms (instant)</td>
  </tr>
</table>

</div>

<div align="center">
  <h1>Troubleshooting</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Issue</th>
    <th>Solution</th>
  </tr>
  <tr>
    <td><b>Java Not Found</b><br><code>Java 17+ is required but not found</code></td>
    <td>
      1. Install Java 17+ from <a href="https://adoptium.net/">Adoptium</a><br>
      2. Verify: <code>java -version</code> shows 17 or higher<br>
      3. Ensure Java is in your PATH
    </td>
  </tr>
  <tr>
    <td><b>Decompilation Fails</b><br><code>Decompilation failed: ...</code></td>
    <td>
      1. Check disk space (need ~500 MB per version)<br>
      2. Check logs: <code>%APPDATA%\minecraft-dev-mcp\minecraft-dev-mcp.log</code><br>
      3. Try force re-decompile: <code>{ "force": true }</code><br>
      4. Clear cache and retry
    </td>
  </tr>
  <tr>
    <td><b>Mappings Not Available</b><br><code>Yarn mappings not available for version X.X.X</code></td>
    <td>
      Yarn mappings support 1.14-1.21.11 (discontinued after 1.21.11)<br>
      Mojmap supports 1.14.4+<br>
      For versions 26.1+, use Mojmap (Minecraft is now deobfuscated by default)
    </td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Development</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Task</th>
    <th>Command</th>
  </tr>
  <tr>
    <td><b>Build from Source</b></td>
    <td>
      <pre>git clone https://github.com/MCDxAI/minecraft-dev-mcp.git
cd minecraft-dev-mcp
npm install
npm run build</pre>
    </td>
  </tr>
  <tr>
    <td><b>Run Tests</b></td>
    <td><code>npm test</code></td>
  </tr>
  <tr>
    <td><b>Type Check</b></td>
    <td><code>npm run typecheck</code></td>
  </tr>
  <tr>
    <td><b>Lint</b></td>
    <td><code>npm run lint</code><br><code>npm run lint:fix</code></td>
  </tr>
  <tr>
    <td><b>Development Mode</b></td>
    <td><code>npm run dev</code></td>
  </tr>
</table>
</div>

<div align="center">
  <h1>License</h1>
</div>

<div align="center">
  <p>MIT License - see <a href="./LICENSE">LICENSE</a> file for details</p>
</div>

<div align="center">
  <h1>Credits</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Project</th>
    <th>Link</th>
  </tr>
  <tr>
    <td><b>Vineflower</b></td>
    <td>Modern Java decompiler by <a href="https://github.com/Vineflower/vineflower">Vineflower Team</a></td>
  </tr>
  <tr>
    <td><b>tiny-remapper</b></td>
    <td>JAR remapping tool by <a href="https://github.com/FabricMC">FabricMC</a></td>
  </tr>
  <tr>
    <td><b>Yarn Mappings</b></td>
    <td>Community mappings by <a href="https://fabricmc.net/">FabricMC</a></td>
  </tr>
  <tr>
    <td><b>MCP SDK</b></td>
    <td>Protocol implementation by <a href="https://github.com/modelcontextprotocol/typescript-sdk">Anthropic</a></td>
  </tr>
</table>
</div>

<div align="center">
  <h1>Support</h1>
</div>

<div align="center">
<table>
  <tr>
    <th>Resource</th>
    <th>Link</th>
  </tr>
  <tr>
    <td><b>Issues</b></td>
    <td><a href="https://github.com/MCDxAI/minecraft-dev-mcp/issues">GitHub Issues</a></td>
  </tr>
  <tr>
    <td><b>Discussions</b></td>
    <td><a href="https://github.com/MCDxAI/minecraft-dev-mcp/discussions">GitHub Discussions</a></td>
  </tr>
  <tr>
    <td><b>Documentation</b></td>
    <td><a href="./ARCHITECTURE.md">ARCHITECTURE.md</a></td>
  </tr>
</table>
</div>

<div align="center">
  <p><strong>Built with ❤️ for the Minecraft modding community</strong></p>
</div>
