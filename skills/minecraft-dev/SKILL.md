---
name: minecraft-dev
description: Use this skill whenever the user wants to look up Minecraft source, mod source, mod loader source, mappings, registries, versions, version differences, access transformers, mixin information, documentation, or code search results with minecraft-dev-cli. Also use it for Fabric, Forge, Quilt, and NeoForge source lookups.
---

# Minecraft Dev CLI Lookup

Use `minecraft-dev-cli` to inspect Minecraft code, mod and loader JARs, mappings, registries, versions, and docs.

## Version format note

Use the actual Minecraft version the user is working with. Modern releases use the newer `26.1.x` naming style, for example `26.1.2`.

- `1.14` through `1.21.11` support both `yarn` and `mojmap`.
- `26.1+` uses `mojmap` only.
- Yarn mappings stop at `1.21.11`.

## Workflow

1. Identify whether the user needs Minecraft source, mod source, mod loader metadata, mappings, registries, docs, validation, or version diffing.
2. Pick the narrowest tool that answers the request.
3. Run `minecraft-dev-cli <tool> --key value` or `minecraft-dev-cli <tool> --key=value`.
4. Parse the JSON response and return only the useful result.
5. If the request is vague, ask for the class name, file path, symbol, JAR path, or Minecraft version.

## Tool List

### Core Minecraft source
- `get_minecraft_source` — get decompiled source for one Minecraft class.
- `decompile_minecraft_version` — decompile an entire Minecraft version into cache.
- `list_minecraft_versions` — list available and cached Minecraft versions.
- `get_registry_data` — extract block, item, entity, and other registry data.
- `search_minecraft_code` — regex search through decompiled Minecraft source.
- `index_minecraft_version` — build a fast full-text index for Minecraft source.
- `search_indexed` — run fast indexed searches against Minecraft source.

### Mappings and comparison
- `find_mapping` — translate class, method, and field names between mapping systems.
- `remap_mod_jar` — remap a Fabric mod JAR to readable names.
- `compare_versions` — compare two Minecraft versions at a high level.
- `compare_versions_detailed` — compare versions with AST-level API detail.

### Validation and documentation
- `analyze_mixin` — validate Mixin targets and injections against Minecraft source.
- `validate_access_widener` — validate access widener targets against Minecraft source.
- `validate_access_transformer` — validate a Forge/NeoForge access transformer (`.cfg`) against Minecraft source (mojmap-only); flags bad targets/signatures, record canonical-constructor crashes, inner-class accessibility, and conflicting modifiers.
- `get_documentation` — fetch documentation hints for a Minecraft class or concept.
- `search_documentation` — search known Minecraft and Fabric docs.

### Mod source and mod loader source
- `analyze_mod_jar` — inspect a mod or loader JAR for metadata, dependencies, entrypoints, mixins, and loader info.
- `decompile_mod_jar` — decompile a mod or loader JAR into readable Java source.
- `search_mod_code` — regex search through decompiled mod or loader source.
- `index_mod` — build a fast full-text index for decompiled mod or loader source.
- `search_mod_indexed` — run fast indexed searches against mod or loader source.

Use `minecraft-dev-cli list-tools` or `minecraft-dev-cli help` when you need quick CLI usage.

Read `references/tools.md` only when you need parameter details or example commands.

## Command Pattern

```bash
minecraft-dev-cli <tool> --key value --key2 value2
```

All commands return JSON with:
- `success`
- `tool`
- `result` or `error`

## Examples

### List versions
```bash
minecraft-dev-cli list_minecraft_versions
```

### List tool schemas
```bash
minecraft-dev-cli list-tools
```

### Get Minecraft source
```bash
minecraft-dev-cli get_minecraft_source --version 26.1.2 --className net.minecraft.world.entity.Entity --mapping mojmap
```

### Get mod or loader metadata
```bash
minecraft-dev-cli analyze_mod_jar --jarPath C:\mods\neoforge-26.1.2-universal.jar
```

### Decompile mod or loader source
```bash
minecraft-dev-cli decompile_mod_jar --jarPath C:\mods\neoforge-26.1.2-universal.jar --mapping mojmap
```

### Search mod or loader source
```bash
minecraft-dev-cli search_mod_code --modId neoforge --modVersion 26.1.2 --query DeferredRegister --searchType class --mapping mojmap
```

### Find a mapping
```bash
minecraft-dev-cli find_mapping --symbol a --version 1.21.1 --sourceMapping official --targetMapping mojmap
```

## Notes

- Use `analyze_mod_jar` first when the user asks about a loader JAR, NeoForge internals, dependencies, entrypoints, or mixins.
- Use `decompile_mod_jar` before `search_mod_code` or `index_mod`.
- Use indexed search for broad or repeated searches.
- `decompile_minecraft_version` also supports `--jarPath` for local Forge/NeoForge patched Minecraft JARs. In that mode, use `--mapping mojmap` and a version cache key like `1.21.1-neoforge-21.1.72`.
- Registry examples should use singular names like `block`, `item`, and `entity`.
- If a user asks about CLI usage, always show flags-only examples.
