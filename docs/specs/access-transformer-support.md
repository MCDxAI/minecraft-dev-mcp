# Spec: Access Transformer Support (`validate_access_transformer`)

**Tracking:** GitHub issue [#12 — Support for access transformers](https://github.com/MCDxAI/minecraft-dev-mcp/issues/12)
**Author:** rlnt (Relentless) · **Triage:** labeled `enhancement`, assigned GhostTypes · **Opened:** 2026-06-29
**Status:** Implemented (v1.2.2). Revised to bytecode-based validation — see the update note below.

---

## 0. Update — bytecode ground truth (issue #12 follow-up)

The reporter tested v1.2.4 and hit **false positives**: implicit record members —
canonical constructors and component accessors (`value()`, `name()`, …) — were
reported "not found", because they are compiler-generated and **do not appear in
decompiled `.java`**. They forced a fallback to `javap` on the remapped JAR.

The validator therefore now correlates entries against **bytecode**, not
decompiled source. It reads the remapped JAR through the bundled ASM
`bytecode-dumper` (`src/java/bytecode-dumper.ts`, `src/services/bytecode-index-service.ts`),
so it sees exactly what the AT is applied to at load time — the same facts
`javap` shows — with true access flags and erased descriptors. Consequences:

- **Member existence / signature** is an exact bytecode lookup (implicit record
  members included). No more source-omission false positives.
- **Record canonical-constructor widening (§6.2)** is downgraded from a
  guaranteed "the game will crash at runtime" **error-grade** claim to an
  **informational note**: widening the record class alone is fine for reading
  components/codecs; a widened canonical ctor is only needed if you *instantiate*
  the record. It fires only when bytecode shows the ctor is actually narrower
  than the class's new access and no file directive widens it.
- **Constructors are never "overridable"** — the override-narrowing warning (§6.3)
  now excludes `<init>`/`<clinit>` (a prior false positive on `AnyOfCondition`).
- Needs only the **remapped JAR** (produced by `decompile_minecraft_version`);
  results are cached in a `remapped/{version}-{mapping}.bytecode.json` sidecar
  keyed by the JAR's size+mtime signature, so the cache is always fresh and
  never re-dumps the whole JAR.

Sections below marked as tree-sitter/decompiled-source describe the original v1
design and are superseded by this note.

---

## 1. Goal

Add a `validate_access_transformer` MCP tool, parallel to the existing `validate_access_widener`, but for the **Forge/NeoForge** Access Transformer (AT) ecosystem. A validator must parse `.cfg` entries, check signatures, and catch AT-specific quirks.

## 2. The Issue (verbatim)

> A tool to validate access transformers would be great. Check all entries of the transformer, check the signature, etc.
>
> What's special about ATs is that parent classes also need access transformation. There are a few more quirks that could be checked. For example, if you access transform a record to be public, you have to explicitly access transform its CTor as well or the game will crash.

Primary reference: https://docs.neoforged.net/docs/advanced/accesstransformers/

## 3. AT vs Access Widener (AW) — why a separate parser is needed

Both widen class/member visibility at build+load time, but they are **different grammars**.

| Aspect | Forge/NeoForge AT | Fabric AW (existing) |
|---|---|---|
| File | `META-INF/accesstransformer.cfg` | `<modid>.accesswidener` |
| Header | None | Required: `accessWidener v2 named` |
| Keywords | Raw visibility `public/protected/default/private` + `-f`/`+f` suffix | Intent `accessible/extendable/mutable` |
| Member tokens | **Implicit** — 2 tokens = class; 3rd token no `(` = field, has `(` = method | **Explicit** `class`/`method`/`field` keyword |
| Field line | `public net.mc.Foo bar` (**no descriptor**) | `accessible field net/mc/Foo bar I` (**descriptor required**) |
| Method line | `public net.mc.Foo m(I)V` (parens attached) | `accessible method net/mc/Foo m (I)V` (space-separated) |
| Separator | `.` in class names (slashes also accepted) | `/` |
| Final control | First-class: add `+f` / remove `-f` final | Remove via intent only; cannot add final |
| Direction | Can widen **and narrow** | Widening only |
| Scope | Any class (MC, libs, mods) | MC code only |
| Wildcards | `*` (all fields), `*()` (all methods) — discouraged | None |

## 4. AT File Grammar (what the parser must accept)

**Comment:** `#` to end-of-line (including inline after an entry). Blank lines ignored.

**Line forms** (whitespace-split into exactly 2 or 3 tokens):
```
<MODIFIER> <CLASS>                                  # class
<MODIFIER> <CLASS> <FIELDNAME>                      # field  (3rd token has no '(')
<MODIFIER> <CLASS> <METHODNAME>(<PARAMS>)<RETURN>   # method (3rd token has '(')
```

**MODIFIER** = one of `public | protected | default | private`, optionally suffixed (**no space**) with `-f` (remove `ACC_FINAL`) or `+f` (add `ACC_FINAL`). → **12 legal modifier tokens.**

**CLASS** — fully qualified; parser normalizes `.replace('.', '/')` so dots and slashes are both valid. Inner classes via `$` (`net.mc.Crypt$Inner`). When an inner class is targeted, the parser **auto-emits an enclosing-class target** (see quirk 6.1).

**Field** — bare name, **no descriptor**.

**Method descriptor** — JVM form attached to the name with no spaces: `(Ljava/lang/String;JJ)[I`. Return descriptor mandatory (even `V`). Constructors = `<init>`, static init = `<clinit>`. Dots/slashes both accepted inside the descriptor.

**Wildcards** (shotgun ATs; parser-supported, spec-discouraged, may be removed): `*` → all fields; `*()` → all methods. No combined field+method wildcard.

**Conflict rule:** duplicate targets with incompatible modifiers → build fails (`Invalid AT final conflicts`). Validator should detect these.

### Reject (hard parse errors)
- Lines with ≠2 or ≠3 tokens (after stripping `#` comments).
- Unknown modifier keyword (e.g. `publik`), or modifier/final split across tokens (`public -f`).
- Space inside a descriptor; field with a descriptor; method missing a return descriptor.

## 5. JVM descriptor cheat-sheet

| Descriptor | Java type |
|---|---|
| `B C D F I J S Z` | byte char double float int long short boolean |
| `V` | void (return only) |
| `[<x>` | array of `<x>` (e.g. `[[S` = `short[][]`, `[Ljava/lang/String;` = `String[]`) |
| `Linternal/name;` | object of `internal.name` (slashes; inner classes use `$`: `Lcom/Foo$Bar;`) |

## 6. Quirks the validator must check

### 6.1 Parent / enclosing classes need transformation (inner classes) ⭐ in issue
When you target an inner class `Outer$Inner`, Java forbids reaching the nested type through an inaccessible enclosing type. The Forge parser auto-emits an `InnerClassTarget(parent=Outer, inner=Outer$Inner)`.

**Validator behavior:** warn when an inner-class directive (`$` present) is **not** accompanied by an accessible enclosing class (either transformed explicitly in the file, or already public in the decompiled source).

### 6.2 Records — canonical `<init>` must be widened explicitly ⭐ in issue
Making a record `public` does **not** make its canonical constructor public (component accessors do become public, but the ctor does not) — violating record semantics and crashing at runtime. (Source: FabricMC/access-widener#26; applies equally to ATs.)

**Detection:** records carry no canonical-ctor flag, but bytecode stores record components in definition order — reconstruct the ctor signature from those. If a record has only one constructor, it is the canonical one.

**Validator behavior:** if a class is a `record` and an AT widens the **class** to `public`/`protected`, require/warn about a matching `<init>(<components>)` directive at equal-or-wider access.

### 6.3 Other documented quirks (bonus checks)
- **Override gotcha:** a method AT only transforms that exact method; subclass overrides aren't touched → JVM link/verify errors if an override narrows visibility. Warn on overridable (non-`final`, non-`static`, non-`private`, not-in-final-class) method targets.
- **Wildcard usage** — warn (`*` / `*()` are discouraged and may be removed from the spec).
- **Namespace:** Forge dev toolchains are **mojmap-only** post-1.17, so the default `mapping` for this tool should be `mojmap` (not `yarn` like the AW tool). SRG names only matter for legacy Forge.

## 7. Implementation map (mirrors `validate_access_widener`)

| Concern | AW location | AT equivalent (proposed) |
|---|---|---|
| Types | `src/types/minecraft.ts:246-294` | New `AccessTransformer*` types — needs `modifier` (`public/protected/...`±`-f`/`+f`), `finalState`, inferred `memberType` (class/field/method), optional `wildcard` flag |
| Service | `src/services/access-widener-service.ts` | New `src/services/access-transformer-service.ts` — own `parseAccessTransformer()` / `parseEntry()` / `validateAccessTransformer()`. **Must use the tree-sitter AST (`src/utils/java-symbols.ts`) for signature/existence checks — NOT regex.** Reuse: `descriptorToReadable()`, similarity/Levenshtein helpers, decompiled-source lookup pattern. |
| Error classes | `src/utils/errors.ts:173-196` | New `AccessTransformerParseError` / `AccessTransformerValidationError` |
| MCP tool schema | `src/server/tools.ts:139-147` | New `ValidateAccessTransformerSchema` — `content` (path or text), `mcVersion`, `mapping` (default **`mojmap`**) |
| Tool registration | `src/server/tools.ts:500-523` | New tool object `validate_access_transformer` |
| Handler | `src/server/tools.ts:1549-1606` | New `handleValidateAccessTransformer` (same path-or-content normalize via `normalizePath`/`existsSync`) |
| Dispatch | `src/server/tools.ts:2264` | New `case 'validate_access_transformer'` |
| Docs resource | `src/services/documentation-service.ts:490` + `src/server/resources.ts:93,406` | New `getAccessTransformerDocumentation()` + `accesstransformer` topic resource |
| Tests | `__tests__/services/access-widener-service.test.ts` | New `__tests__/services/access-transformer-service.test.ts` |

## 8. Scope

**Must-do (v1):**
1. Parse `.cfg` → entries; reject invalid token counts / modifiers / final suffixes.
2. Infer member type from token shape (no `(` = field, `(` = method, 2 tokens = class).
3. Validate class existence in decompiled source; "did you mean" suggestions.
4. Validate field/method existence **and signature** via the tree-sitter AST (issue explicitly asks to "check the signature" — stricter than the AW tool, which only checks names).
5. Detect duplicate / conflicting targets across the file.

**Quirk checks (issue asks):**
6. Inner-class enclosing-class accessibility warning (6.1).
7. Record + widened class → require canonical `<init>` (6.2).

**Bonus (nice to have):**
8. Override-narrowing warning on non-final/static methods (6.3).
9. Wildcard warning (6.3).

**Out of scope for v1:** multi-file AT sets (`[[accessTransformers]]` in `neoforge.mods.toml`), bytecode-level descriptor reconstruction for records (the decompiled `.java` is sufficient for the record-components heuristic).

## 9. Key risk / note

The existing AW validator validates members against the decompiled `.java` **with regex** (name-only checks). The codebase already fixed this exact class of bug in the FTS5 search index by switching to a **tree-sitter Java AST** (`src/utils/java-symbols.ts`). The AT validator **must** build on the tree-sitter AST from day one — never regex. (See the companion regex-audit note; the AW validator and `ast-diff-service` are flagged for the same refactor.)

## 10. Sources

1. NeoForge docs (primary): https://docs.neoforged.net/docs/advanced/accesstransformers/
2. FMLAT.md spec: https://github.com/MinecraftForge/AccessTransformers/blob/master/FMLAT.md
3. Forge parser source `AccessTransformerList.java`: https://github.com/MinecraftForge/AccessTransformers/blob/master/src/main/java/net/minecraftforge/accesstransformer/parser/AccessTransformerList.java
4. Forge Community Wiki (wildcards + descriptor table): https://forge.gemwire.uk/wiki/Access_Transformers
5. Records gotcha: https://github.com/FabricMC/access-widener/issues/26
