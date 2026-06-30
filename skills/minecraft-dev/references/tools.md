# Tool Reference

Use this file only when you need exact parameters or a more specific example.

## Version format note

Use the actual Minecraft version the user is working with. Modern releases use the newer `26.1.x` naming style, for example `26.1.2`.

- `1.14` through `1.21.11` support both `yarn` and `mojmap`.
- `26.1+` uses `mojmap` only.
- Yarn mappings stop at `1.21.11`.

## Command style

Use flags only with `minecraft-dev-cli`.

Example:

```powershell
minecraft-dev-cli get_minecraft_source --version 26.1.2 --className net.minecraft.world.entity.Entity --mapping mojmap
```

## Core Minecraft source

### `get_minecraft_source`
Get decompiled source for a specific Minecraft class.

Parameters:
- `version`
- `className`
- `mapping`
- optional: `startLine`, `endLine`, `maxLines`

Example:
```bash
minecraft-dev-cli get_minecraft_source --version 26.1.2 --className net.minecraft.world.entity.Entity --mapping mojmap
```

### `decompile_minecraft_version`
Decompile an entire Minecraft version into cache.

Parameters:
- `version`
- `mapping`
- optional: `force`, `jarPath`

Notes:
- `jarPath` is for a local Forge/NeoForge patched Minecraft JAR.
- When `jarPath` is set, `mapping` must be `mojmap`.
- In patched-JAR mode, use a version cache key like `1.21.1-neoforge-21.1.72`.

### `list_minecraft_versions`
List downloadable and cached Minecraft versions.

Parameters: none

### `get_registry_data`
Get block, item, entity, or other registry data.

Parameters:
- `version`
- optional: `registry`

Use singular registry names like `block`, `item`, and `entity`.

### `search_minecraft_code`
Regex search through decompiled Minecraft source.

Parameters:
- `version`
- `query`
- `searchType`
- `mapping`
- optional: `limit`

### `index_minecraft_version`
Build a full-text index for Minecraft source.

Parameters:
- `version`
- `mapping`

### `search_indexed`
Run FTS5 queries against indexed Minecraft source.

Parameters:
- `query`
- `version`
- `mapping`
- optional: `types`, `limit`

## Mappings and comparison

### `find_mapping`
Translate a class, method, or field name between mapping systems.

Parameters:
- `symbol`
- `version`
- `sourceMapping`
- `targetMapping`

Example:
```bash
minecraft-dev-cli find_mapping --symbol a --version 1.21.1 --sourceMapping official --targetMapping mojmap
```

### `remap_mod_jar`
Remap a mod JAR to readable names.

Parameters:
- `inputJar`
- `outputJar`
- `toMapping`
- optional: `mcVersion`

Example:
```bash
minecraft-dev-cli remap_mod_jar --inputJar C:\mods\example-mod.jar --outputJar C:\mods\example-mod-mojmap.jar --toMapping mojmap
```

### `compare_versions`
Compare classes or registries between two versions.

Parameters:
- `fromVersion`
- `toVersion`
- `mapping`
- optional: `category`

### `compare_versions_detailed`
Run AST-level comparison between two versions.

Parameters:
- `fromVersion`
- `toVersion`
- `mapping`
- optional: `packages`, `maxClasses`

## Validation and documentation

### `analyze_mixin`
Validate Mixin source against Minecraft source.

Parameters:
- `source`
- `mcVersion`
- optional: `mapping`

### `validate_access_widener`
Validate an access widener against Minecraft source.

Parameters:
- `content`
- `mcVersion`
- optional: `mapping`

### `get_documentation`
Get docs and usage hints for a class or concept.

Parameters:
- `className`

### `search_documentation`
Search Minecraft and Fabric docs.

Parameters:
- `query`

## Mod source and mod loader source

### `analyze_mod_jar`
Inspect a mod or loader JAR without decompiling it.

Parameters:
- `jarPath`
- optional: `includeAllClasses`, `includeRawMetadata`

Example:
```bash
minecraft-dev-cli analyze_mod_jar --jarPath C:\mods\neoforge-26.1.2-universal.jar
```

### `decompile_mod_jar`
Decompile a mod or loader JAR to readable Java source.

Parameters:
- `jarPath`
- `mapping`
- optional: `modId`, `modVersion`

Example:
```bash
minecraft-dev-cli decompile_mod_jar --jarPath C:\mods\neoforge-26.1.2-universal.jar --mapping mojmap
```

### `search_mod_code`
Regex search through decompiled mod or loader source.

Parameters:
- `modId`
- `modVersion`
- `query`
- `searchType`
- `mapping`
- optional: `limit`

Example:
```bash
minecraft-dev-cli search_mod_code --modId neoforge --modVersion 26.1.2 --query DeferredRegister --searchType class --mapping mojmap
```

### `index_mod`
Build a full-text index for decompiled mod or loader source.

Parameters:
- `modId`
- `modVersion`
- `mapping`
- optional: `force`

### `search_mod_indexed`
Run FTS5 queries against indexed mod or loader source.

Parameters:
- `query`
- `modId`
- `modVersion`
- `mapping`
- optional: `types`, `limit`
