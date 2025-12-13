<div align="center">
  <h1>Minecraft Dev MCP Server</h1>
  <p><strong>MCP Server for Minecraft Mod Development</strong></p>
  <p>Access decompiled Minecraft source code through Claude Desktop and other MCP clients</p>
</div>

<div align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat">
  <img src="https://img.shields.io/badge/TypeScript-5.7.2-blue?style=flat">
  <img src="https://img.shields.io/badge/MCP%20SDK-1.0.4-purple?style=flat">
  <img src="https://img.shields.io/badge/Java-17%2B-orange?style=flat">
  <img src="https://img.shields.io/badge/Vitest-2.1.8-yellow?style=flat">
</div>

<div align="center">
  <p>A comprehensive Model Context Protocol (MCP) server that provides LLMs with the ability to decompile Minecraft JARs, apply mappings (Yarn, Mojmap), and expose deobfuscated source code for AI-assisted Fabric mod development.</p>
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
    <td>Download, remap, and decompile any Minecraft version (1.21.1+)</td>
  </tr>
  <tr>
    <td><b>Multiple Mapping Types</b></td>
    <td>Support for Yarn and Mojmap (official) mappings</td>
  </tr>
  <tr>
    <td><b>Smart Caching</b></td>
    <td>Central cache system avoids re-downloading/re-decompiling</td>
  </tr>
  <tr>
    <td><b>Source Code Access</b></td>
    <td>Get decompiled Java source for any Minecraft class</td>
  </tr>
  <tr>
    <td><b>Registry Data</b></td>
    <td>Extract block, item, entity, and other registry information</td>
  </tr>
  <tr>
    <td><b>Production-Grade Tools</b></td>
    <td>Uses Vineflower decompiler and tiny-remapper</td>
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
      <pre>npm install -g @minecraft-dev/mcp-server</pre>
    </td>
  </tr>
  <tr>
    <td><b>From Source</b></td>
    <td>
      <pre>git clone https://github.com/your-org/minecraft-dev-mcp.git
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
  <h2>1. Configure Claude Desktop</h2>
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

**NPM Installation:**

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

**Source Installation:**

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
  <h2>2. Restart Claude Desktop</h2>
</div>

<div align="center">
  <p>Restart Claude Desktop to load the MCP server.</p>
</div>

<div align="center">
  <h2>3. Start Using</h2>
</div>

<div align="center">

In Claude Desktop, you can now ask questions like:

<table>
  <tr>
    <td><code>"Show me the Entity class from Minecraft 1.21.10 using Yarn mappings"</code></td>
  </tr>
  <tr>
    <td><code>"Decompile Minecraft 1.21.10 with Mojmap"</code></td>
  </tr>
  <tr>
    <td><code>"What blocks are registered in Minecraft 1.21.10?"</code></td>
  </tr>
</table>

</div>

<div align="center">
  <h1>Available Tools</h1>
</div>

<div align="center">
  <h2>get_minecraft_source</h2>
</div>

<div align="center">

Get decompiled source code for a specific class.

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

**Example:**

```json
{
  "version": "1.21.10",
  "className": "net.minecraft.world.entity.Entity",
  "mapping": "yarn"
}
```

<div align="center">
  <h2>decompile_minecraft_version</h2>
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

**Example:**

```json
{
  "version": "1.21.10",
  "mapping": "yarn"
}
```

<div align="center">
  <h2>list_minecraft_versions</h2>
</div>

<div align="center">
  <p>List available and cached Minecraft versions.</p>
</div>

**Returns:**

```json
{
  "cached": ["1.21.10"],
  "available": ["1.21.10", "1.21.9", "..."],
  "total_available": 800
}
```

<div align="center">
  <h2>get_registry_data</h2>
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
    <td>Specific registry (e.g., "blocks", "items")</td>
  </tr>
</table>

</div>

**Example:**

```json
{
  "version": "1.21.10",
  "registry": "blocks"
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

**Cache Layout:**

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

**Cache Size:**
- ~400-500 MB per Minecraft version (JAR + mappings + decompiled source)
- Vineflower + tiny-remapper: ~1 MB (one-time download)

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
    <td><a href="https://github.com/modelcontextprotocol/typescript-sdk">@modelcontextprotocol/sdk</a></td>
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
    <td><a href="https://github.com/WiseLibs/better-sqlite3">better-sqlite3</a> (metadata caching)</td>
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
</table>

**Total:** ~5 minutes first time

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
</table>

**Total:** ~50ms (instant)

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
      Yarn mappings only support 1.21.1+<br>
      Try using <code>"mapping": "mojmap"</code> instead
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
      <pre>git clone https://github.com/your-org/minecraft-dev-mcp.git
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
    <td><a href="https://github.com/your-org/minecraft-dev-mcp/issues">GitHub Issues</a></td>
  </tr>
  <tr>
    <td><b>Discussions</b></td>
    <td><a href="https://github.com/your-org/minecraft-dev-mcp/discussions">GitHub Discussions</a></td>
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
