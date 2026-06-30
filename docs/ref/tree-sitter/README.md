# tree-sitter Reference Docs

Verbatim reference material for the Java-parsing refactor (adopting the tree-sitter
**Query** language API and bumping the Node binding).

## Locked versions
| Package | Version |
|---|---|
| `tree-sitter` (Node binding, node-tree-sitter) | **^0.25.x** (latest 0.25.1) |
| `tree-sitter-java` | **^0.23.5** |

## Files
| File | Description |
|---|---|
| `tree-sitter.d.ts` | Verbatim `tree-sitter.d.ts` (v0.25.1) — the authoritative Node API: `Parser`, `SyntaxNode`, `Tree`, `TreeCursor`, `Language`, `Query`, `QueryMatch`, `QueryCapture`, `QueryOptions`. (typedoc is generated from this file.) |
| `query-syntax.md` | Verbatim tree-sitter query-language docs: S-expression patterns, fields, `!field`, captures `@name`, quantifiers `+ * ?`, grouping, alternation `[]`, wildcard `_`, anchor `.`, and all predicates (`#eq?` `#not-eq?` `#any-eq?` `#match?` `#not-match?` `#any-match?` `#any-of?`). |
| `java-grammar-node-types.json` | Verbatim `node-types.json` for tree-sitter-java v0.23.5 — every node type with exact `fields`/`children`/`subtypes` (4585 lines). |
| `esm-interop-notes.md` | ESM import patterns for v0.25.x + tree-sitter-java 0.23.x, tsconfig needs, a working `.ts` example, and the verbatim v0.21→v0.25 breaking-change changelog. |

## Provenance
- Node API: https://github.com/tree-sitter/node-tree-sitter/blob/v0.25.1/tree-sitter.d.ts
- Query syntax: old tree-sitter docs (now Wayback-only):
  https://web.archive.org/web/2023/https://tree-sitter.github.io/tree-sitter/using-parsers ,
  https://web.archive.org/web/2021/https://tree-sitter.github.io/tree-sitter/syntax-highlighting
- Java node types: https://github.com/tree-sitter/tree-sitter-java/blob/v0.23.5/src/node-types.json
- Changelog: https://github.com/tree-sitter/node-tree-sitter/releases (no CHANGELOG.md file exists)
