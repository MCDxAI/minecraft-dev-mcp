# Mixin Annotation AST Structure (tree-sitter-java)

Ground-truth dump of how tree-sitter-java represents SpongePowered Mixin
annotations. Captured 2026-06-29 via `scripts/probe-mixin-ast.ts` and
`scripts/probe-mixin-ast2.ts` against tree-sitter-java 0.23.x.

This is the authoritative reference for parsing mixin source via the AST
(no regex).

## Node hierarchy summary

Annotations attach to a declaration's **`modifiers`** named child (this holds
for `class_declaration`, `method_declaration`, `field_declaration`,
`constructor_declaration` alike — so `@Mixin` on a class and `@Inject` on a
method are found the same way).

```
modifiers
├── annotation            ← with arguments:  @Foo(...)
│   ├── name: identifier | scoped_identifier
│   └── arguments: annotation_argument_list
└── marker_annotation     ← no parens:        @Foo
    └── name: identifier | scoped_identifier
```

## `annotation_argument_list` children

The argument list can contain, in any combination:

| Child node type                | Meaning / example                                  |
|--------------------------------|----------------------------------------------------|
| `element_value_pair`           | Named arg: `key = value` (e.g. `method = "tick"`)  |
| `string_literal` (bare)        | Single bare string: `@Accessor("size")`, `@At("HEAD")` |
| `class_literal` (bare)         | Single bare class: `@Mixin(Entity.class)`           |
| `annotation` / `marker_annotation` (bare) | Nested anno as bare value              |
| `element_value_array_initializer` | Bare array: `@Mixin({A.class, B.class})`         |

### Decision rule for single-arg vs named-args forms

- If the `annotation_argument_list` contains **only `element_value_pair`s**
  → use the `elementValuePairs` map. BUT Java allows the shorthand where a
  single-arg annotation's lone argument omits the key (e.g. `@Mixin(Entity.class)`
  is shorthand for `@Mixin(value = Entity.class)`). Distinguish:
- If the list contains a **bare value** (string_literal / class_literal /
  annotation, NOT inside an element_value_pair) → that's the `elementValue`.

> **Critical:** `@At("HEAD")` and `@At(value = "INVOKE", target = "...")` are
> BOTH valid. The first has a bare `string_literal`; the second has
> `element_value_pair`s. Handle both.

## `element_value_pair`

Always has fields:
- `key`: `identifier` — `.text` is the arg name (`method`, `at`, `cancellable`, `priority`, `target`, `value`, `require`).
- `value`: one of `annotation` | `marker_annotation` | `element_value_array_initializer` | `expression` (covers string_literal, boolean `true`/`false`, integer literals, class_literal).

## Value node → text mapping (verified)

| Value node type          | `.text` example        | How to read the value                       |
|--------------------------|------------------------|---------------------------------------------|
| `string_literal`         | `"tick"` (WITH quotes) | Read the inner **`string_fragment`** child's `.text` (= `tick`), OR strip surrounding quotes. **Do NOT use the string_literal text directly.** |
| `class_literal`          | `Entity.class`         | First named child is the type (`type_identifier` → simple, `scoped_identifier` → qualified). Read **that type child's `.text`** → `Entity` / `net.minecraft.Entity`. Drop the `.class`. |
| `true` / `false`         | `true`                 | `.text === 'true'`                          |
| `decimal_integer_literal`| `500`                  | `parseInt(.text, 10)`                       |
| `annotation` (nested)    | `@At("HEAD")`          | Recurse → produces a nested structured anno |
| `element_value_array_initializer` | `{...}`       | Iterate named children → array of values    |

## `element_value_array_initializer`

Children (multiple): each is a `class_literal`, `string_literal`, nested
`annotation`, `expression`, or another `element_value_array_initializer`.

Examples observed:
- `@Mixin({Entity.class, net.minecraft.entity.LivingEntity.class})` → 2 `class_literal` children.
- `method = {"a", "b"}` → 2 `string_literal` children.

## `annotation.name`

- Simple: `(identifier) ["Mixin"]` → name = `Mixin`.
- Qualified: `(scoped_identifier ...) ["org.spongepowered.asm.mixin.injection.At"]` → name = full dotted form.

`childForFieldName('name')?.text` returns the correct name in both cases.

## Concrete worked examples

### `@Mixin({Entity.class, net.minecraft.entity.LivingEntity.class})`
```
annotation
  name: identifier ["Mixin"]
  arguments: annotation_argument_list
    element_value_array_initializer
      class_literal → type_identifier ["Entity"]
      class_literal → scoped_identifier ["net.minecraft.entity.LivingEntity"]
```
→ targets = `["Entity", "net.minecraft.entity.LivingEntity"]`

### `@Mixin(value = {Entity.class}, priority = 500)`
```
annotation
  name: identifier ["Mixin"]
  arguments: annotation_argument_list
    element_value_pair key=["value"] value=element_value_array_initializer(class_literal[Entity])
    element_value_pair key=["priority"] value=decimal_integer_literal["500"]
```
→ targets = `["Entity"]`, priority = `500`

### `@Inject(method = "tick", at = @At("HEAD"))`
```
annotation
  name: identifier ["Inject"]
  arguments: annotation_argument_list
    element_value_pair key=["method"] value=string_literal (fragment "tick")
    element_value_pair key=["at"] value=annotation(@At, bare elementValue string "HEAD")
```

### `@Inject(method = "tick", at = @At(value="INVOKE", target="..."), cancellable = true)`
- `method` → string `"tick"`
- `at` → nested annotation with `value="INVOKE"`, `target="Lx;y()V"`
- `cancellable` → boolean `true`

### `@Accessor("size")`
```
annotation
  name: identifier ["Accessor"]
  arguments: annotation_argument_list
    string_literal (fragment "size")    ← BARE value (no element_value_pair wrapper)
```
→ elementValue = string `"size"`

### `@Accessor` (no args)
```
marker_annotation
  name: identifier ["Accessor"]
```
→ no arguments; target must be inferred from method name.

### `@Shadow @Mutable` (stacked marker annotations)
Two separate `marker_annotation` nodes in the same `modifiers`. Each parsed
independently.

## Field/method declaration fields needed

From a `method_declaration` / `field_declaration` symbol (already captured by
`extractJavaSymbols` in `src/utils/java-symbols.ts`):

- `symbol` — member name (method or field)
- `entryType` — `'method'` | `'field'`
- `returnType` — method return type (for `@Shadow` methods)
- `fieldType` — field type (for `@Shadow` fields)
- `annotations` — array of `JavaAnnotation` (will be enriched with structured args)
- `modifiers` — includes `abstract` / `static` / `native` for inference

For the mixin class symbol:
- `declaringClass` — fully qualified (e.g. `com.example.mixin.EntityMixin`) → `MixinClass.className`
- `annotations` — includes `@Mixin`

## Backward-compat constraints (must preserve)

- `parseMixinSource(source, sourcePath?)` signature and `MixinClass | null` return.
- `MixinClass.className` is fully qualified (package + class).
- `MixinClass.targets` are the names AS WRITTEN (simple `Entity` or qualified
  `net.minecraft.entity.LivingEntity` — both appear in real mods).
- `MixinInjection.targetMethod` is a single string. When `method` is an array,
  take the **first** element (matches the legacy regex's de-facto behavior; the
  descriptor validator resolves one method at a time).
- `@Accessor`/`@Invoker` target inference: strip `get`/`set`/`is` (accessor) or
  `invoke`/`call` (invoker) prefix, lowercase the first remaining char.
- `null` return for non-mixin source (no `@Mixin` annotation found).
