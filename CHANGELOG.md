# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Forge/NeoForge patched Minecraft source tools (Phase 4, 5 tools).** The
  server can now fetch, build, and serve the Minecraft source **as modified by
  Forge/NeoForge** (event hooks, injections) together with the loader's own
  source (`net.minecraftforge.*` / `net.neoforged.*`), mojmap-only. The
  pipeline wraps NeoFormRuntime (`neoform-runtime` 2.0.31, downloaded on
  demand; `--dist joined --neoforge <gav>:userdev --write-result`), requesting
  `gameSourcesWithNeoForge` (merged sources zip, extracted directly — no
  re-decompile loss) and `gameJarWithNeoForge` (registered as the key's
  remapped JAR so `validate_access_transformer` keeps working). Forge artifacts
  resolve through `--add-repository` on the Forge Maven. New tools:
  `list_forge_versions` (loader Maven metadata, Forge recommended builds via
  promotions_slim, NeoForge `-beta` prerelease markers, in-process 24h TTL),
  `decompile_forge_minecraft_version`, `get_forge_source`,
  `search_forge_code`, `compare_vanilla_vs_forge`. All of them are
  thin wrappers over the existing patched-JAR machinery: the tree lands under
  the same opaque `<mc>-<loader>-<loaderVersion>` key, so every vanilla tool
  (`get_minecraft_source`, `search_minecraft_code`, `index_minecraft_version`,
  `search_indexed`, `compare_versions*`) reads it unchanged. NFRT artifacts are
  cached under `jars/patched/<key>/` so `force` rebuilds in seconds. Known
  limits: NeoForge MC 1.20.1 is unsupported (legacy artifact — use `forge`);
  NFRT itself requires Java 21. Shared handler internals
  (`applySourceLineFilters`, `searchDecompiledTree`) were extracted from
  `get_minecraft_source`/`search_minecraft_code` so behavior is unchanged.
  Manual E2E: `npm run test:manual:forge` (NeoForge 1.21.1 verified
  end-to-end locally; the suite is env-configurable for Forge 1.20.1).

### Fixed

- **Flaky cross-file AT conflict test on a cold CI cache.** The tool-level test
  for `extraFiles` conflict detection asserted the conflict *finding* through
  `handleValidateAccessTransformer`, which reaches conflict detection only after
  `validateAccessTransformer` clears its remapped-JAR guard. ATs default to
  `mojmap`, but CI only pre-decompiles `1.21.11/yarn` — the mojmap remap happens
  as a side effect of another suite running in parallel, so on a cold cache the
  assertion raced it and failed. It passed otherwise only because the
  yarn-keyed cache incidentally carries the mojmap JAR. The conflict findings
  (cross-file naming, duplicates, `restrictTo` scoping) now assert against the
  pure `detectAccessTransformerConflicts`, with entries parsed exactly as the
  handler parses them; the tool test keeps the bytecode-independent plumbing
  assertions. No production code changed.

## [1.3.0] - 2026-08-06

Completes the access transformer work tracked in
[#12](https://github.com/MCDxAI/minecraft-dev-mcp/issues/12). Version 1.2.5 was
bumped in the repository but never tagged or published; its changes ship here.

### Added

- **Inherited-member detection for access transformers.** An AT only transforms
  the class it names, so a directive aimed at a member declared on a parent is
  silently inert — the build passes, the game loads, the member stays
  inaccessible. `validate_access_transformer` now resolves the full ancestor
  closure (transitive `superName` + interfaces, ancestors outside the JAR
  skipped) and reports the declaring class along with a paste-ready corrected
  directive. Constructors are excluded, since they are never inherited.
- **Inherited-member detection for access wideners.** Fabric AWs have identical
  semantics: `AccessWidenerClassVisitor` resolves `EntryTriple(className, name,
  descriptor)` through a plain `HashMap.getOrDefault` with no hierarchy walk, so
  an AW naming a subclass for an inherited member widens nothing. Both
  validators share the walk in `src/utils/bytecode-hierarchy.ts` so they cannot
  drift on a rule they both have.
- **Cross-file AT conflict detection** via a new optional `extraFiles` parameter
  on `validate_access_transformer`. Every AT a mod ships is applied together at
  build time, so a conflict spanning two files fails the Forge build exactly
  like one inside a single file. Duplicates and conflicts name both files and
  both lines; findings are restricted to those involving the file under
  validation. Unresolvable paths are reported as `extraFilesNotFound` rather
  than silently dropped.
- **Comma-separated and repeated array flags in the CLI.** Both
  `--extraFiles a.cfg,b.cfg` and `--extraFiles a.cfg --extraFiles b.cfg` now
  work; JSON (`--extraFiles '["a.cfg","b.cfg"]'`) still parses. Non-array flags
  keep last-wins semantics.

### Changed

- **Access transformers and access wideners validate against bytecode, not
  decompiled `.java`.** Decompiled source omits compiler-generated record
  members (canonical constructors, component accessors), which made the
  validators report them as missing — the false positives reported in #12.
  Bytecode carries every member with its true access flags and erased
  descriptors. Per-class results are cached in a
  `remapped/{version}-{mapping}.bytecode.json` sidecar keyed by JAR signature.
- **Record canonical-constructor widening is informational, not an error.**
  Widening the constructor is only required if you instantiate the record;
  reading its components is fine without it. The note is suppressed entirely
  when a sibling AT passed via `extraFiles` widens the constructor.
- **Compact, verdict-first tool output** for `validate_access_transformer`.
- **Access widener class names stay in slash notation.** The parser normalized
  to dots, so suggestions came out as `a.b.C` — which Fabric's reader rejects
  outright (*"Class-names must be specified as a/b/C, not a.b.C"*), meaning a
  pasted suggestion would break the build. The token is now preserved as
  written; lookups already normalized either form via `toInternalName()`.
- The inheritance check runs before the descriptor-mismatch branch, so a class
  declaring `tick(I)V` when the AT asks for `tick()V` is reported as an
  inheritance problem rather than a bad descriptor.

### Fixed

- **Access transformer and widener validation on patched Forge/NeoForge keys.**
  The patched flow does no remapping, so `decompileLocalJar` now copies a
  compiled input JAR to `remapped/{version}-{mapping}.jar` — by definition
  already that key's remapped JAR — letting every bytecode consumer resolve a
  patched key exactly like a vanilla one. Patched *sources* JARs (NFRT /
  ForgeGradle `-sources.jar`) contain no bytecode and cannot be validated; the
  tool now says so instead of telling you to decompile again.
- Hardened the bytecode index cache against concurrent access.

### Internal

- CI builds the committed `bytecode-dumper` JAR and re-runs tests when it
  changes, so the bytecode-gated suites actually execute instead of skipping.
- Lint is enforced in CI; pre-existing Biome findings fixed.
- LF line endings enforced via `.gitattributes`.

## [1.2.4] - 2026-07-06

### Fixed

- Bundled Java tool JARs were missing from the npm package, which broke
  decompilation, source lookup, and the validation tools for npm consumers.

## [1.2.3] - 2026-07-06

### Fixed

- Swapped the `tree-sitter` dependency for the `@keqingmoe/tree-sitter` fork,
  which ships prebuilt binaries for x64 and arm64 on macOS, Linux, and Windows.
  This fixes install failures on arm64, where upstream tree-sitter ships no
  prebuilt binaries.

### Documentation

- Documented the `validate_access_transformer` tool in the README, tools
  reference, and Minecraft dev skill.

## [1.2.2] - 2026-07-02

### Added

- `validate_access_transformer` tool for Forge/NeoForge `.cfg` files
  ([#12](https://github.com/MCDxAI/minecraft-dev-mcp/issues/12)).
- Agent skill for the standalone CLI
  ([#13](https://github.com/MCDxAI/minecraft-dev-mcp/pull/13)).

### Changed

- Java parsing moved to tree-sitter AST + ASM bytecode
  ([#14](https://github.com/MCDxAI/minecraft-dev-mcp/pull/14)).

### Internal

- CI caches the decompiled Minecraft tree in the test workflow.

## [1.2.1] - 2026-06-29

### Fixed

- **`search_indexed` returned incomplete or incorrect results**
  ([#11](https://github.com/MCDxAI/minecraft-dev-mcp/issues/11)). The line-based
  regex symbol extractor dropped roughly 31% of method declarations (qualified,
  generic, and annotated return types; constructors; multi-declarator fields)
  and mis-attributed methods from anonymous classes to their enclosing class. It
  is replaced with a tree-sitter Java AST parser, so `search_indexed` now
  matches `search_minecraft_code`. **Re-index affected versions**
  (`index_minecraft_version` with `force: true`) to pick up the corrected index.
- **CLI produced no output on symlinked Node installs.** On nvm-windows (the
  `C:\nvm4w\nodejs` junction) or `npm link`, every `minecraft-dev-cli` command
  exited 0 with no output: the main-module guard compared `import.meta.url`
  (resolved to the realpath) against `process.argv[1]` (which keeps the symlink
  path), so `main()` never ran. The CLI now resolves the symlink first.

## [1.2.0] - 2026-06-10

### Added

- HTTP transport and a standalone CLI
  ([#10](https://github.com/MCDxAI/minecraft-dev-mcp/pull/10)).
- Support for local Forge/NeoForge patched Minecraft JARs via `jarPath` on
  `decompile_minecraft_version`
  ([#9](https://github.com/MCDxAI/minecraft-dev-mcp/pull/9)).

## [1.1.0] - 2026-03-28

### Fixed

- Unobfuscated-version awareness in `MappingService`, for Minecraft 26.1+
  ([#5](https://github.com/MCDxAI/minecraft-dev-mcp/pull/5),
  [#7](https://github.com/MCDxAI/minecraft-dev-mcp/pull/7)).
- Java executable resolution now uses `JAVA_HOME`, falling back to `java`
  ([#6](https://github.com/MCDxAI/minecraft-dev-mcp/pull/6)).

## [1.0.0] - 2025-12-19

Initial public release.

### Added

- MCP server exposing decompiled Minecraft source, registry data, and modding
  tools, plus Phase 3 third-party mod analysis (analyze, decompile, search,
  index).
- Yarn, Mojmap, and Intermediary mapping support, including the two-step Yarn
  remap (official → intermediary → named).
- Registry extraction via the server JAR's built-in data generator.

[Unreleased]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/v1.2.4...v1.3.0
[1.2.4]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/88fdadd...v1.2.1
[1.2.0]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/84171e1...88fdadd
[1.1.0]: https://github.com/MCDxAI/minecraft-dev-mcp/compare/dae7dcc...84171e1
[1.0.0]: https://github.com/MCDxAI/minecraft-dev-mcp/commits/dae7dcc
