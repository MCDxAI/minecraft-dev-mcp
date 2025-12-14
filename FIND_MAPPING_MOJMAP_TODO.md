# find_mapping Tool - Mojmap Support Limitation

## Issue Summary

The `find_mapping` MCP tool does not correctly support looking up Mojang class names.

## Technical Details

### Current Behavior

In `src/services/mapping-service.ts`, the `lookupMapping()` method:

1. Always uses **Yarn mappings** as the lookup source (line 318):
   ```typescript
   const mappingPath = await this.getMappings(version, 'yarn');
   ```

2. Maps `'mojmap'` to `'official'` namespace (line 408-409):
   ```typescript
   case 'mojmap':
     return 'official'; // Mojmap uses obfuscated -> named, but we only have official
   ```

### The Problem

- Yarn mappings contain: `official` (obfuscated), `intermediary`, and `named` (Yarn names)
- Yarn mappings do **NOT** contain Mojang's human-readable names
- Mojang names like `net.minecraft.world.entity.Entity` only exist in the converted Mojmap tiny file

### What Doesn't Work

```
find_mapping({
  symbol: "net.minecraft.world.entity.Entity",  // Mojang name
  sourceMapping: "mojmap",
  targetMapping: "intermediary"
})
```

This won't find anything because the Yarn file doesn't contain Mojang names.

### What Does Work

- `yarn` -> `intermediary` (works)
- `intermediary` -> `yarn` (works)
- `official` -> `intermediary` (works)
- `intermediary` -> `official` (works)

## Proposed Fix

Modify `lookupMapping()` to:

1. When `sourceMapping` or `targetMapping` is `'mojmap'`, load the Mojmap tiny file instead of Yarn
2. The Mojmap tiny file has namespaces: `intermediary` and `named` (Mojang names)
3. Map `'mojmap'` to `'named'` namespace instead of `'official'`

### Implementation Notes

- The converted Mojmap file is at: `getMojmapTinyPath(version)`
- Path: `mappings/mojmap-tiny-{version}.tiny`
- Namespaces in file: `intermediary`, `named`

## Priority

Low - This is a pre-existing limitation, not a regression. The core Mojmap remapping functionality works correctly.

## Related Files

- `src/services/mapping-service.ts` - `lookupMapping()` method
- `src/server/tools.ts` - `find_mapping` tool handler
