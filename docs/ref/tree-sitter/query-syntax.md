# Tree-sitter Query Language — Syntax Reference (VERBATIM)

Sources (old tree-sitter docs, now only in the Wayback Machine):
- https://web.archive.org/web/2023/https://tree-sitter.github.io/tree-sitter/using-parsers  ("Pattern Matching with Queries" section)
- https://web.archive.org/web/2021/https://tree-sitter.github.io/tree-sitter/syntax-highlighting

## Pattern Matching with Queries
(verbatim from tree-sitter "Using Parsers" → Queries section)

Many code analysis tasks involve searching for patterns in syntax trees. Tree-sitter provides a small declarative language for expressing these patterns and searching for matches.

A query consists of one or more patterns, where each pattern is an S-expression that matches a certain set of nodes in a syntax tree. The expression to match a given node consists of a pair of parentheses containing two things: the node's type, and optionally, a series of other S-expressions that match the node's children. For example, this pattern would match any `binary_expression` node whose children are both `number_literal` nodes:

    (binary_expression (number_literal) (number_literal))

Children can also be omitted. For example, this would match any `binary_expression` where at least one child is a `string_literal` node:

    (binary_expression (string_literal))

### Fields
In general, it's a good idea to make patterns more specific by specifying field names associated with child nodes. You do this by prefixing a child pattern with a field name followed by a colon. For example, this pattern would match an `assignment_expression` node where the `left` child is a `member_expression` whose `object` is a `call_expression`.

    (assignment_expression left: (member_expression object: (call_expression)))

You can also constrain a pattern so that it only matches nodes that lack a certain field. To do this, add a field name prefixed by a `!` within the parent pattern. For example, this pattern would match a class declaration with no type parameters:

    (class_declaration name: (identifier) @class_name !type_parameters)

### Anonymous vs named nodes
The parenthesized syntax for writing nodes only applies to named nodes. To match specific anonymous nodes, you write their name between double quotes. For example, this pattern would match any `binary_expression` where the operator is `!=` and the right side is `null`:

    (binary_expression operator: "!=" right: (null))

### Captures (@name)
Captures allow you to associate names with specific nodes in a pattern, so that you can later refer to those nodes by those names. Capture names are written after the nodes that they refer to, and start with an `@` character.

    (assignment_expression left: (identifier) @the-function-name right: (function))

    (class_declaration name: (identifier) @the-class-name
      body: (class_body (method_definition name: (property_identifier) @the-method-name)))

### Quantifiers (+ * ?)
You can match a repeating sequence of sibling nodes using the postfix `+` and `*` repetition operators, which work analogously to the `+` and `*` operators in regular expressions. The `+` operator matches one or more repetitions of a pattern, and the `*` operator matches zero or more.

    (comment)+

    (class_declaration (decorator)* @the-decorator name: (identifier) @the-name)

You can also mark a node as optional using the `?` operator:

    (call_expression function: (identifier) @the-function
      arguments: (arguments (string)? @the-string-arg))

### Grouping
You can also use parentheses for grouping a sequence of sibling nodes:

    ( (comment) (function_declaration) )

Any of the quantification operators mentioned above (`+`, `*`, and `?`) can also be applied to groups. For example, this pattern would match a comma-separated series of numbers:

    ( (number) ("," (number))* )

### Alternation ([])
An alternation is written as a pair of square brackets (`[]`) containing a list of alternative patterns. This is similar to character classes from regular expressions.

    (call_expression function: [
      (identifier) @function
      (member_expression property: (property_identifier) @method)
    ])

    [ "break" "delete" "else" "for" "function" "if" "return" "try" "while" ] @keyword

### Wildcard (_)
A wildcard node is represented with an underscore (`_`), it matches any node. There are two types, `(_)` will match any named node, and `_` will match any named or anonymous node.

    (call (_) @call.inner)

### The anchor operator (.)
The anchor operator, `.`, is used to constrain the ways in which child patterns are matched.
- A `.` before the first child → child only matches when it is the first named node in the parent:

      (array . (identifier) @the-element)

- A `.` after a pattern's last child → that child only matches nodes that are the last named child of their parent:

      (block (_) @last-expression .)

- A `.` between two child patterns → patterns only match nodes that are immediate siblings (given `a.b.c.d`, matches consecutive pairs `a,b`  `b,c`  `c,d`):

      (dotted_name (identifier) @prev-id . (identifier) @next-id)

The restrictions placed on a pattern by an anchor operator ignore anonymous nodes.

### Predicates (#…)
You can specify arbitrary metadata and conditions associated with a pattern by adding predicate S-expressions anywhere within your pattern. Predicate S-expressions start with a predicate name beginning with a `#` character. After that, they can contain an arbitrary number of `@`-prefixed capture names or strings.

Tree-Sitter's CLI supports the following predicates by default:

**Equality predicates** — first argument must be a capture; second can be a capture (compare the two captures' text) or a string (compare the first capture's text). Base predicate `#eq?`, complement `#not-eq?`.

    ((identifier) @variable.builtin (#eq? @variable.builtin "self"))

    ( (pair key: (property_identifier) @key-name value: (identifier) @value-name)
      (#eq? @key-name @value-name) )

The prefix `any-` is for use with quantified captures — `#any-eq?` matches if ANY of the nodes match (by default a quantified capture matches only if ALL nodes match):

    ((comment)+ @comment.empty (#any-eq? @comment.empty "//"))

**Match (regexp) predicates** — first argument must be a capture, the second a string containing a regular expression. (Rust regex flavor — see ESM-interop notes.)

    ((identifier) @constant (#match? @constant "^[A-Z][A-Z_]+"))

    ((comment)+ @comment.documentation (#match? @comment.documentation "^///\\s+.*"))

    ((comment)+ @injection.content
      . (import_declaration (import_spec path: (interpreted_string_literal) @_import_c))
      (#eq? @_import_c "\"C\"")
      (#match? @injection.content "^//"))

**any-of?** — match a capture against multiple strings; matches if equal to any:

    ((identifier) @variable.builtin (#any-of? @variable.builtin "arguments" "module" "console" "window" "document"))

Predicate family recap (bindings-supported): the `eq` and `match` predicates each accept `not-` and `any-` prefixes → `#eq?`, `#not-eq?`, `#any-eq?`, `#match?`, `#not-match?`, `#any-match?`, plus `#any-of?`.

> Note (verbatim): "Predicates are not handled directly by the Tree-sitter C library. They are just exposed in a structured form so that higher-level code can perform the filtering. However, higher-level bindings to Tree-sitter like the Rust Crate or the WebAssembly binding do implement a few common predicates like the #eq?, #match?, and #any-of? predicates." The Node binding exposes captures/matches via `Query.matches`/`Query.captures`; evaluate predicates in JS.

### Query execution (C API, mirrored by Node `Query.matches`/`Query.captures`)
    TSQuery *ts_query_new(const TSLanguage *language, const char *source, uint32_t source_len,
                          uint32_t *error_offset, TSQueryError *error_type);
    typedef enum { TSQueryErrorNone = 0, TSQueryErrorSyntax, TSQueryErrorNodeType,
                   TSQueryErrorField, TSQueryErrorCapture } TSQueryError;
    TSQueryCursor *ts_query_cursor_new(void);
    void ts_query_cursor_exec(TSQueryCursor *, const TSQuery *, TSNode);
    typedef struct { TSNode node; uint32_t index; } TSQueryCapture;
    typedef struct { uint32_t id; uint16_t pattern_index; uint16_t capture_count;
                     const TSQueryCapture *captures; } TSQueryMatch;
    bool ts_query_cursor_next_match(TSQueryCursor *, TSQueryMatch *match);

In the Node binding: `new Parser.Query(language, source)` → `query.matches(node, options?)` returns `QueryMatch[]` where `QueryMatch = { pattern: number, captures: QueryCapture[] }` and `QueryCapture = { name: string, node: SyntaxNode }`.

## Syntax-highlighting queries (verbatim, from "Syntax Highlighting")
Tree-sitter's syntax highlighting is based on tree queries. Highlighting is controlled by three query files (conventionally `.scm`):
- **highlights** — uses arbitrary capture names (`keyword`, `function`, `type`, `property`, `string`; dot-separated like `function.builtin`) mapped to colors. Example:

      ; highlights.scm
      "func" @keyword
      "return" @keyword
      (type_identifier) @type
      (int_literal) @number
      (function_declaration name: (identifier) @function)

- **locals** — fixed capture names with special meaning: `@local.scope`, `@local.definition`, `@local.reference`. Disable a pattern for nodes identified as local variables with the predicate `(#is-not? local)`:

      ; locals.scm
      (method) @local.scope
      (do_block) @local.scope
      (method_parameters (identifier) @local.definition)
      (block_parameters (identifier) @local.definition)
      (assignment left:(identifier) @local.definition)
      (identifier) @local.reference

- **injections** — captures `@injection.content` and `@injection.language`; force a language via `#set!`:

      ((heredoc_body (heredoc_end) @injection.language) @injection.content)
      ((heredoc_body) @injection.content (#set! injection.language "ruby"))
