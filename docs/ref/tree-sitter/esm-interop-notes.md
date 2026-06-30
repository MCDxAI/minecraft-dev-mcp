# tree-sitter v0.25.x + tree-sitter-java 0.23.x — ESM Interop Notes

Locked versions: **node-tree-sitter (npm `tree-sitter`) ^0.25.x** (latest 0.25.1),
**tree-sitter-java ^0.23.5**. Compatibility is confirmed by node-tree-sitter 0.25.1's own
`package.json`, which lists `"tree-sitter-java": "^0.23.5"` as a devDependency.

## How the modules resolve (from `tree-sitter.d.ts` v0.25.1, verbatim shape)
The types file declares a single merged module:
```ts
declare module "tree-sitter" {
  class Parser { /* parse, setLanguage, getLanguage, reset, … */ }
  namespace Parser {
    export type Options / Point / Range / Edit / Logger / Input
    export interface SyntaxNode { … }
    export interface TreeCursor { … }
    export interface Tree { … }
    export interface QueryCapture { name; node }
    export interface QueryMatch { pattern; captures }
    export type QueryOptions { … }
    export class Query { constructor(language, source); matches(); captures(); … }
    export class LookaheadIterator { … }
  }
}
```
The runtime does `module.exports = Parser` (the class) with the `Parser` namespace merged
onto it. Consequences:
- `require('tree-sitter')` / `import Parser from 'tree-sitter'` → the **Parser constructor directly**,
  with `Parser.Query`, `Parser.SyntaxNode`, etc. accessible as static namespace members.
- `Query` is **`Parser.Query`** (nested). Construct via `new Parser.Query(language, source)`.
- `tree-sitter-java`'s **default export is the Language object** (the `TSLanguage` instance), so
  `import Java from 'tree-sitter-java'` gives you the language to pass to `setLanguage` and `Query`.

## tsconfig needs
The package ships `"types": "tree-sitter.d.ts"`. Because it uses `module.exports = Parser` (CJS)
with a `declare module` ambient declaration, ESM consumers need:
- `"esModuleInterop": true` (so `import Parser from 'tree-sitter'` binds to `module.exports`), and
- `"allowSyntheticDefaultImports": true` (implied by esModuleInterop; needed for type-checking
  `import Java from 'tree-sitter-java'`).
This project already builds ESM-only (`"type": "module"`, `module: "ES2022"`), so ensure these two
flags are set; local imports keep `.js` extensions per repo convention.

## Minimal working ESM .ts example
> Derived from the v0.25.1 `.d.ts` module shape + project memory. Not executed here (web-agent has
> no runtime) — validate with `npm run typecheck` after wiring.
```ts
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';

const parser = new Parser();
parser.setLanguage(Java);

const tree = parser.parse('public class Foo { void bar() {} }');
const root = tree.rootNode;            // Parser.SyntaxNode
console.log(root.type);                // 'program'

// v0.25 Query API — Query lives under the Parser namespace
const query = new Parser.Query(
  Java,
  '(method_declaration name: (identifier) @method.name)'
);
for (const match of query.matches(root)) {        // QueryMatch[]
  for (const cap of match.captures) {             // QueryCapture[]
    console.log(cap.name, cap.node.text);         // 'method.name' 'bar'
  }
}
// or, ordered captures:
for (const cap of query.captures(root)) {
  console.log(cap.name, cap.node.text);
}
```
Notes:
- `Query` constructor signature: `new Parser.Query(language: Language, source: string | Buffer)`.
- `query.matches(node, options?)` → `QueryMatch[]`; `query.captures(node, options?)` → `QueryCapture[]`.
- `QueryOptions` fields: `startPosition`, `endPosition`, `startIndex`, `endIndex`, `matchLimit`
  (>0 and <=65536), `maxStartDepth`, `timeoutMicros` (deprecated), `progressCallback`.
- Predicates (`#eq?`, `#match?`, …) are NOT evaluated by the C library or the Node binding —
  they are returned structurally; filter in JS (see query-syntax.md).

## v0.21 → v0.25 breaking changes (changelog verbatim, from node-tree-sitter GitHub releases)
There is **no `CHANGELOG.md` file** in the repo (404 on master/main). Release notes live on GitHub.
v0.22.0–v0.25.x carry only terse auto-generated notes; the substantive breaking changes are in
**v0.21.0** (verbatim):

> **v0.21.0 — BREAKING CHANGES:**
> - node-tree-sitter now uses Node-API instead of NAN for Node bindings. This requires updating the
>   `binding.cc` file for all languages you want to use by running `tree-sitter generate` with
>   `tree-sitter` 0.22.0 or newer.
> - `SyntaxNode.hasChanges`, `SyntaxNode.hasError` and `SyntaxNode.isMissing` are now properties
>   (they used to be methods).
>
> **Other changes:** add more methods/properties to bring Node inline with Rust bindings; make module
>   context aware; drop Node 14 and 16 support; switch to prebuildify instead of prebuild-install
>   (binaries now stored on npm instead of GitHub Releases).

Implications for THIS project (currently tree-sitter ^0.21.1 → bumping to ^0.25.x):
1. **Grammar compatibility:** node-tree-sitter 0.25 requires Node-API grammars. tree-sitter-java
   **0.23.5 is already Node-API-compatible** (it's node-tree-sitter 0.25.1's own devDependency) —
   so `npm i tree-sitter-java@^0.23.5` works with `tree-sitter@^0.25` with no `tree-sitter generate`
   step needed.
2. **`hasChanges`/`hasError`/`isMissing` are properties, not methods.** Audit `src/utils/java-symbols.ts`
   (and any callers): `node.hasError()` → `node.hasError`, etc. (This change landed in v0.21.0, so if
   the codebase already runs on 0.21.1 it may already comply — verify.)
3. **`Query` is a first-class class (`Parser.Query`)** — new in this line of releases; the project's
   existing "hand-walked" extractor in `java-symbols.ts` does not use it yet, so adopting it is purely
   additive (no migration of old Query calls).
4. **Node 18+ required** (Node 14/16 dropped in v0.21.0) — the project already requires Node 18+, so OK.
5. Binaries ship via npm prebuilds (prebuildify) — `node-gyp-build` resolves them at `install`; no
   GitHub Releases download. `"install": "node-gyp-build"` in package.json.

## Refactor-critical excerpt — `class Query` + query result types (verbatim from `tree-sitter.d.ts` v0.25.1)
```ts
export interface QueryCapture {
  /** The name that was used to capture the node in the query */
  name: string;
  /** The captured syntax node */
  node: SyntaxNode;
}

export interface QueryMatch {
  /** The index of the pattern that was matched. Each pattern in a query is assigned a numeric index in sequence. */
  pattern: number;
  /** Array of nodes that were captured in the pattern match */
  captures: QueryCapture[];
}

export type QueryOptions = {
  startPosition?: Point;
  endPosition?: Point;
  startIndex?: number;
  endIndex?: number;
  /** The maximum number of in-progress matches for this cursor. The limit must be > 0 and <= 65536. */
  matchLimit?: number;
  /** The maximum start depth for a query cursor. … */
  maxStartDepth?: number;
  /** @deprecated Use the progressCallback */
  timeoutMicros?: number;
  progressCallback?: (index: number) => boolean;
};

export class Query {
  /** The maximum number of in-progress matches for this cursor. */
  readonly matchLimit: number;
  /** Create a new query from a string containing one or more S-expression patterns. … */
  constructor(language: Language, source: string | Buffer);
  /** Iterate over all of the individual captures in the order that they appear. … @returns An array of captures */
  captures(node: SyntaxNode, options?: QueryOptions): QueryCapture[];
  /** Iterate over all of the matches in the order that they were found. … @returns An array of matches */
  matches(node: SyntaxNode, options?: QueryOptions): QueryMatch[];
  disableCapture(captureName: string): void;
  disablePattern(patternIndex: number): void;
  isPatternGuaranteedAtStep(byteOffset: number): boolean;
  isPatternRooted(patternIndex: number): boolean;
  isPatternNonLocal(patternIndex: number): boolean;
  startIndexForPattern(patternIndex: number): number;
  endIndexForPattern(patternIndex: number): number;
  didExceedMatchLimit(): boolean;
}
```
(Note: `Query`/`QueryCursor` have **no dedicated typedoc page** — only `QueryMatch`/`QueryCapture`
interfaces render in typedoc. The `.d.ts` is the only complete source; that's why it's saved raw at
`docs/ref/tree-sitter/tree-sitter.d.ts`.)
