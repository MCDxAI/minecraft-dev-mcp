# AGENT HANDBOOK – Minecraft Dev MCP

Reference for AI/agent operators working in this repo. Grounded in `CLAUDE.md` and current project state.

## Project Snapshot
- MCP server that lets agents decompile, remap, search, and analyze Minecraft (1.14+; obfuscated through 1.21.11).
- Phase 1 & 2 complete (core + advanced tools); 29 integration tests green as of 2025-12-06.
- Phase 3 focus: third-party mod analysis; missing piece is decompiling remapped mod JARs (see TODO).
- Stack: Node 18+/ESM-only (`"type": "module"`), TS 5.7, Java 17+ (21+ for newest MC), better-sqlite3, VineFlower decompiler, tiny-remapper.

## What Agents Should Prioritize
- Keep ESM intact: no CommonJS, ensure `.js` extensions on local imports after build.
- Registry extraction must use the obfuscated **server JAR** with version-aware bundler flag; never the client JAR.
- Yarn remapping is two-step: official → intermediary → yarn; do not collapse into one pass.
- Respect cache layout in platform app data (`jars/`, `mappings/`, `remapped/`, `decompiled/{version}/{mapping}/`, `registry/{version}/`, `resources/`, `search-index/`, `cache.db`).
- VineFlower drops `libraries/`, `versions/`, `logs/` in CWD during runs; temporary and gitignored.

## Architecture Wayfinder (src/)
- `services/`: `version-manager` (JARs), `mapping-service` (Yarn/Mojmap/Intermediary), `remap-service` (two-step Yarn), `decompile-service` (VineFlower), `registry-service` (data generator on server JAR), `source-service` (pipeline orchestrator).
- `java/`: `tiny-remapper`, `vineflower`, `mc-data-gen` (bundler vs legacy invocation), `java-process` (exec wrapper).
- `downloaders/`: Mojang assets/mappings, Yarn mappings, Java tool JARs.
- `cache/`: cache manager + SQLite metadata DB.
- `utils/paths.ts`: resolves OS-specific cache roots.

## Available MCP Tools (for LLM surfaces)
- Phase 1 core: `get_minecraft_source`, `decompile_minecraft_version`, `list_minecraft_versions`, `get_registry_data`.
- Phase 2 analysis: `remap_mod_jar`, `find_mapping`, `search_minecraft_code`, `compare_versions`, `analyze_mixin`, `validate_access_widener`, `compare_versions_detailed`, `index_minecraft_version`, `search_indexed`, `get_documentation`, `search_documentation`.
- Phase 3: `analyze_mod_jar` (metadata/mixins/bytecode scan). Missing: decompile remapped mod JARs.

## Critical Behaviors & Pitfalls
- **Registry paths**: MC ≥1.21 writes `reports/registries.json`; <1.21 uses `generated/reports/registries.json`. Names are singular (`block`, `item`, `entity`), auto-prefixed with `minecraft:` if absent.
- **Java invocation**: MC 1.18+ bundler needs `-DbundlerMainClass=net.minecraft.data.Main`; pre-1.18 uses `-cp` mode.
- **Performance**: first decompile downloads/remaps (~400–500 MB/version). Caching makes subsequent requests near-instant.
- **Integrity**: downloads are SHA-verified; cache rebuilds on corruption; Java processes run with timeouts and memory caps.

## Testing & Commands
- Fast suite: `npm test` (vitest, targets 1.21.10 pipeline end-to-end).
- Manual/versioned suites: `npm run test:manual` (Yarn 1.21.10/1.20.1/1.19.4), `npm run test:manual:mojmap` (+ version-specific overrides).
- Dev/build: `npm run dev` (tsx watch), `npm run build`, `npm run typecheck`, `npm run lint[:fix]`.
- Full sweep: `npm run test:all` (CI + manual).

## Active TODO / Gaps
- Add **mod JAR decompilation** after remapping (reuse VineFlower); target output under `decompiled-mods/{mod-id}/{version}/{mapping}/`. New tool name suggestion: `decompile_mod_jar` or `remap_mod_jar` with `decompile` flag.

## Quick Playbooks
- Retrieve class source: ensure version cached → `get_minecraft_source(version, className, mapping)`; triggers download/remap/decompile if missing.
- Extract registries: use `registry-service` with server JAR and version-aware path detection; fail fast on wrong registry names.
- Add new mapping type: extend `MappingType`, add downloader, wire into `mapping-service`, add tests.
- Add manual test for version: copy template under `__tests__/manual/vX.Y.Z`, add script `test:manual:X.Y.Z`.

## Support Files & References
- Primary context: `CLAUDE.md` (architecture, constraints, known issues).
- Manual test guide: `__tests__/manual/README.md`.
