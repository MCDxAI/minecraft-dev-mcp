# Manual Version-Specific Tests

This directory contains comprehensive integration tests for specific Minecraft versions. These tests verify that the MCP server works correctly with older/legacy versions.

## Why Manual Tests?

- **CI Performance**: Main test suite only tests latest version (currently 1.21.11) to keep CI builds fast
- **Legacy Support**: Verifies compatibility with older Minecraft versions (1.19.x, 1.20.x, etc.)
- **Version-Specific**: Each directory has its own test constants and fixtures
- **Comprehensive**: Full pipeline tests (JAR download → mapping → remap → decompile → registry)

## Directory Structure

```
manual/
├── v1.21.10/          # Last obfuscated stable before 1.21.11
│   ├── test-constants.ts
│   └── full-suite.test.ts
├── v1.20.1/           # Legacy version (1.20.x era)
│   ├── test-constants.ts
│   └── full-suite.test.ts
└── v1.19.4/           # Older legacy version (1.19.x era)
    ├── test-constants.ts
    └── full-suite.test.ts
```

## Running Manual Tests

### Run All Manual Tests
```bash
npm run test:manual
```

### Run Specific Version
```bash
npm run test:manual:1.21.10
npm run test:manual:1.20.1
npm run test:manual:1.19.4
```

### Run Everything (CI + Manual)
```bash
npm run test:all
```

## Adding New Version Tests

To add tests for a new Minecraft version:

1. Create version directory: `__tests__/manual/vX.XX.X/`
2. Create `test-constants.ts`:
   ```typescript
   export const TEST_VERSION = 'X.XX.X';
   export const TEST_MAPPING = 'yarn' as const;
   ```
3. Create `full-suite.test.ts` (copy from existing version)
4. Add npm script to `package.json`:
   ```json
   "test:manual:X.XX.X": "vitest __tests__/manual/vX.XX.X"
   ```

## Test Coverage

Each version's test suite verifies:

- ✅ Client JAR download from Mojang
- ✅ Server JAR download (for registry extraction)
- ✅ Yarn mapping download from Fabric Maven
- ✅ JAR remapping (2-step process for Yarn)
- ✅ Full source code decompilation
- ✅ Individual class source retrieval (Entity, Item, Vec3d)
- ✅ Registry data extraction (blocks, items)
- ✅ Error handling (missing classes, invalid versions)

## Timeouts

Manual tests have long timeouts due to large downloads:
- JAR download: 2 minutes
- Remapping: 5 minutes
- Decompilation: 10 minutes
- Registry extraction: 5 minutes

## Important Notes

### First Run
First run will download ~400-500 MB per version:
- Minecraft client JAR (~50 MB)
- Minecraft server JAR (~50 MB)
- Yarn mappings (~5 MB)
- Remapped JAR (~50 MB)
- Decompiled source (~200-300 MB)

### Caching
Subsequent runs are much faster (instant) due to caching.

### Version Support
- **1.21.11**: Last obfuscated Minecraft version (Yarn available)
- **1.21.10**: Previous stable version
- **1.20.x**: Legacy version, fully supported
- **1.19.x**: Older legacy version, fully supported
- **26.1+**: Future deobfuscated versions (will require code changes)

### Yarn Mappings
After Minecraft 1.21.11, Yarn mappings will be discontinued as Mojang removes obfuscation from the game. Tests for versions ≥26.1 will need to use official mappings or a new deobfuscated workflow.

## CI Configuration

The main `vitest.config.ts` excludes manual tests:
```typescript
exclude: ['__tests__/manual/**']
```

Manual tests use `vitest.manual.config.ts` which only includes them:
```typescript
include: ['__tests__/manual/**/*.test.ts']
```

This keeps CI fast while still allowing comprehensive version testing on demand.
