/**
 * Java symbol + signature extraction via tree-sitter.
 *
 * Parses decompiled Java source into an AST and walks only the *direct*
 * members of named classes/interfaces/enums/records. This deliberately
 * excludes methods declared inside anonymous/local classes (which live in
 * nested expression scopes, not as direct class members), and unlike a
 * line-based regex it correctly captures methods/fields whose types contain
 * qualified names (dots), generics with spaces, type annotations, and
 * constructors — all of which the previous regex silently dropped.
 *
 * Two public entry points share one recursive tree walk (`extractTypes`):
 *
 * - `extractJavaSymbols(source)` — flat list of searchable entries
 *   (`JavaSymbol`): one per named class plus one per direct method/field
 *   member, attributed to the fully-qualified declaring class. Members of
 *   anonymous/local classes are intentionally omitted. This is the index-time
 *   shape consumed by the search-index service; it now also carries optional
 *   structured fields (modifiers, returnType, parameters, throws, kind,
 *   superclass, interfaces, recordComponents, …) for richer tooling.
 *
 * - `extractJavaSignatures(source)` — grouped `ClassSignature[]` (one per
 *   named type, including nested) for AST-level diffing, mapping onto the
 *   shapes defined in `src/types/minecraft.ts`.
 *
 * tree-sitter binding: we use the community fork `@keqingmoe/tree-sitter`
 * instead of upstream `tree-sitter` because upstream ships no prebuilt native
 * binaries (forcing a node-gyp compile on every platform, and it lacks working
 * arm64 support — see node-tree-sitter issues #261/#286). The fork ships
 * prebuilds for darwin/linux/win32 on both x64 and arm64, so it installs and
 * runs out of the box. Its API/ABI shape matches upstream node-tree-sitter, and
 * it is tested against tree-sitter-java 0.23.5 (the version we depend on).
 *
 * Interop note: `tree-sitter-java`'s default export is the Language object. Its
 * TypeScript `Language` type is structurally incompatible with `Parser.Language`
 * (its `language` field is `unknown` vs the self-referential tree-sitter type),
 * but the values are runtime-compatible. We cast through `unknown` to satisfy
 * `strict` mode without resorting to `any`. The parser is stateless across
 * parses (input passed to parse()), so one shared instance is safe.
 */
import Parser from '@keqingmoe/tree-sitter';
import Java from 'tree-sitter-java';
import type {
  ClassSignature,
  FieldSignature,
  JavaParameter,
  MethodSignature,
} from '../types/minecraft.js';
import { logger } from './logger.js';

// Re-export JavaParameter so consumers importing from this module get it too.
export type { JavaParameter } from '../types/minecraft.js';

type Node = Parser.SyntaxNode;

// tree-sitter-java's Language is structurally incompatible with the fork's
// Parser.Language (see file header), but runtime-compatible.
type TreeSitterLanguage = Parser.Language;
const javaLang = Java as unknown as TreeSitterLanguage;

const parser = new Parser();
parser.setLanguage(javaLang);

export type JavaEntryType = 'class' | 'method' | 'field';

/** Kind of a named Java type declaration. */
export type JavaClassKind = 'class' | 'interface' | 'enum' | 'record' | 'annotation';

/**
 * A single structured annotation-argument value, mirroring the tree-sitter-java
 * annotation_argument_list / element_value AST. Captures the literal kinds
 * (string, class reference, boolean, number), nested annotations (@At(...)),
 * and array initializers (`{...}`). Consumers (e.g. the mixin parsers) read the
 * `kind` discriminator to pull out typed values without touching raw source.
 */
export type AnnotationValue =
  | { kind: 'string'; value: string }
  | { kind: 'class'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'array'; value: AnnotationValue[] }
  | { kind: 'annotation'; value: StructuredAnnotation };

/**
 * Structured annotation-argument model mirroring the tree-sitter-java
 * annotation_argument_list AST. Captures both the named-arg form
 * (`element_value_pair`: `method = "tick"`) and the single bare-arg shorthand
 * (`@Accessor("size")`, `@Mixin(Entity.class)`, `@At("HEAD")`). `marker_annotation`
 * nodes (no parens) populate only `name` + an empty `elementValuePairs` map.
 */
export interface StructuredAnnotation {
  /** Simple or qualified name as written (e.g. "Mixin", "org.spongepowered.asm.mixin.injection.At"). */
  name: string;
  /** Named arguments: key -> value (method="tick", at=@At(...), cancellable=true). Empty if none. */
  elementValuePairs: Record<string, AnnotationValue>;
  /** Single bare value for the shorthand single-arg form. Undefined for named-arg or marker annotations. */
  elementValue?: AnnotationValue;
}

/**
 * A method/field/class annotation. `descriptor` is the annotation's simple or
 * qualified name as written in source (e.g. "Nullable",
 * "org.jetbrains.annotations.NotNull"). The tree-sitter AST does NOT expose a
 * JVM descriptor string, so we keep the source name here. `parsed` carries the
 * structured argument model; it is populated for `annotation` nodes (with
 * parens) and present-but-empty for `marker_annotation` nodes (no parens).
 */
export interface JavaAnnotation {
  /** Simple or qualified annotation name as written in source. */
  descriptor: string;
  /** Structured argument model. Always defined for annotations produced by `extractAnnotations`. */
  parsed?: StructuredAnnotation;
}

export interface JavaSymbol {
  /** Fully-qualified declaring class, e.g. net.minecraft.core.BlockPos.MutableBlockPos */
  declaringClass: string;
  entryType: JavaEntryType;
  /** Simple member name (simple class name for class entries). */
  symbol: string;
  /** Signature / declaration text, collapsed to one line, for context search. */
  context: string;
  /** 1-based line number where the declaration begins. */
  line: number;

  // --- Structured fields (optional; populated where applicable) ---

  /** Type kind. Set on `class` entries only. */
  kind?: JavaClassKind;
  /** Modifier keywords (e.g. ['public', 'static', 'final']). */
  modifiers?: string[];
  /** Return type (methods only; undefined for constructors). */
  returnType?: string;
  /** Parameters (methods/constructors only). */
  parameters?: JavaParameter[];
  /** Thrown type names (methods/constructors only). */
  throws?: string[];
  /** Raw generic parameter text, e.g. '<T extends Number>' (methods/classes). */
  typeParameters?: string;
  /** Declared field type (fields only). */
  fieldType?: string;
  /** True for constructor method entries. */
  isConstructor?: boolean;
  /** Convenience: member/class carries the `static` modifier. */
  isStatic?: boolean;
  /** Convenience: member/class carries the `final` modifier. */
  isFinal?: boolean;
  /** Annotations on the member/class (best-effort). */
  annotations?: JavaAnnotation[];
  /** Superclass type text (class entries only). */
  superclass?: string;
  /** Implemented interface type texts (class entries only). */
  interfaces?: string[];
  /** Record header components (record class entries only). */
  recordComponents?: JavaParameter[];
}

/** Named type declarations whose direct members we recurse into. */
const TYPE_DECLARATIONS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
]);

/**
 * Method-like members (constructors are indexed under the `method` entry type).
 * `method_declaration` covers both class methods and interface methods; the
 * `body` field is absent for abstract / interface methods.
 */
const MEMBER_METHODS = new Set([
  'method_declaration',
  'constructor_declaration',
  'compact_constructor_declaration',
  'annotation_type_element_declaration',
]);

/**
 * Field-like declarations. tree-sitter-java uses a distinct `constant_declaration`
 * node type for interface constants, but both share the `type` + multiple
 * `declarator` (variable_declarator) structure of `field_declaration`.
 */
const MEMBER_FIELDS = new Set(['field_declaration', 'constant_declaration']);

/**
 * Java modifier keywords we recognize from a `modifiers` node's text. Keyword
 * modifiers are anonymous tokens in the grammar, so they only appear via the
 * node's `.text` (not its named children, which are annotations).
 */
const MODIFIER_KEYWORDS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'final',
  'abstract',
  'synchronized',
  'volatile',
  'transient',
  'native',
  'default',
  'strictfp',
  'sealed',
  'non-sealed',
  'nonsealed',
]);

/** Constructor-shaped member node types. */
const CONSTRUCTOR_TYPES = new Set(['constructor_declaration', 'compact_constructor_declaration']);

function collapse(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Build a one-line "signature" context for a declaration: the source from the
 * node start up to its body (exclusive), or the whole node if it has no body
 * (e.g. abstract / interface methods).
 */
function signatureContext(node: Node, source: string): string {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : node.endIndex;
  return collapse(source.slice(node.startIndex, end));
}

/** Map a tree-sitter-java type-declaration node type to a `JavaClassKind`. */
function classKindOf(nodeType: string): JavaClassKind {
  switch (nodeType) {
    case 'class_declaration':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'enum_declaration':
      return 'enum';
    case 'record_declaration':
      return 'record';
    case 'annotation_type_declaration':
      return 'annotation';
    default:
      return 'class';
  }
}

/**
 * Extract keyword modifiers from a declaration node. Modifier keywords live in
 * a `modifiers` named child as anonymous tokens, so we split the node's text on
 * whitespace and keep only recognized keywords (this also drops annotation text
 * that shares the `modifiers` node span).
 */
function extractModifiers(node: Node): string[] {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  if (!mods) return [];
  return mods.text.split(/\s+/).filter((t) => t.length > 0 && MODIFIER_KEYWORDS.has(t));
}

/**
 * Parse a single annotation-argument value node into the structured
 * `AnnotationValue` discriminated union. See `docs/ref/mixin-annotation-ast.md`
 * for the ground-truth node-type -> value mapping (string_literal reads its
 * string_fragment child; class_literal reads its type child; booleans,
 * integer/floating literals, array initializers, and nested annotations recurse).
 */
function parseAnnotationValue(node: Node): AnnotationValue {
  switch (node.type) {
    case 'string_literal': {
      const fragment = node.namedChildren.find((c) => c.type === 'string_fragment');
      if (fragment) return { kind: 'string', value: fragment.text };
      // Fallback if a string_fragment child is ever absent.
      const t = node.text;
      return { kind: 'string', value: t.length >= 2 ? t.slice(1, -1) : t };
    }
    case 'class_literal': {
      // First named child is the type (type_identifier simple, scoped_identifier qualified).
      const typeChild = node.namedChildren[0];
      return { kind: 'class', value: typeChild?.text ?? '' };
    }
    case 'true':
      return { kind: 'boolean', value: true };
    case 'false':
      return { kind: 'boolean', value: false };
    case 'decimal_integer_literal':
    case 'hex_integer_literal':
    case 'octal_integer_literal':
    case 'binary_integer_literal':
    case 'decimal_floating_point_literal':
    case 'hex_floating_point_literal':
      return { kind: 'number', value: Number(node.text) };
    case 'element_value_array_initializer':
      return { kind: 'array', value: node.namedChildren.map((c) => parseAnnotationValue(c)) };
    case 'annotation':
      return { kind: 'annotation', value: parseAnnotation(node) };
    case 'marker_annotation':
      return {
        kind: 'annotation',
        value: { name: node.childForFieldName('name')?.text ?? '', elementValuePairs: {} },
      };
    default:
      // Any other expression node (rare in annotations) — best-effort stringify.
      return { kind: 'string', value: node.text };
  }
}

/**
 * Build a `StructuredAnnotation` from an `annotation` node. Walks the
 * `arguments` (annotation_argument_list) named child, routing each
 * `element_value_pair` into `elementValuePairs` and any bare value (the
 * shorthand single-arg form) into `elementValue`.
 */
function parseAnnotation(node: Node): StructuredAnnotation {
  const name = node.childForFieldName('name')?.text ?? '';
  const elementValuePairs: Record<string, AnnotationValue> = {};
  let elementValue: AnnotationValue | undefined;
  const args = node.childForFieldName('arguments');
  if (args) {
    for (const child of args.namedChildren) {
      if (child.type === 'element_value_pair') {
        const key = child.childForFieldName('key')?.text;
        const valueNode = child.childForFieldName('value');
        if (key && valueNode) {
          elementValuePairs[key] = parseAnnotationValue(valueNode);
        }
      } else {
        elementValue = parseAnnotationValue(child);
      }
    }
  }
  const result: StructuredAnnotation = { name, elementValuePairs };
  if (elementValue !== undefined) result.elementValue = elementValue;
  return result;
}

/**
 * Annotation extraction. Annotations are `annotation` / `marker_annotation`
 * named children nested inside a declaration's `modifiers` node. Each is parsed
 * into a `StructuredAnnotation` (carrying the typed argument model) and exposed
 * via `JavaAnnotation.parsed` alongside the legacy `descriptor` name.
 */
function extractAnnotations(node: Node): JavaAnnotation[] {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  if (!mods) return [];
  const out: JavaAnnotation[] = [];
  for (const c of mods.namedChildren) {
    if (c.type === 'annotation') {
      const parsed = parseAnnotation(c);
      out.push({ descriptor: parsed.name, parsed });
    } else if (c.type === 'marker_annotation') {
      const name = c.childForFieldName('name')?.text;
      if (name) out.push({ descriptor: name, parsed: { name, elementValuePairs: {} } });
    }
  }
  return out;
}

/** Extract the superclass type text (e.g. "Base"), or undefined. */
function extractSuperclass(node: Node): string | undefined {
  const sc = node.childForFieldName('superclass');
  return sc?.namedChildren[0]?.text;
}

/**
 * Extract implemented interface type texts. The `interfaces` field is a
 * `super_interfaces` node wrapping a `type_list`; iterating the type_list's
 * named children yields each interface type robustly (handles generics with
 * commas such as `Comparator<Foo>`).
 */
function extractInterfaces(node: Node): string[] {
  const si = node.childForFieldName('interfaces');
  if (!si) return [];
  const typeList = si.namedChildren.find((c) => c.type === 'type_list');
  return typeList ? typeList.namedChildren.map((c) => c.text) : [];
}

/**
 * Extract the `permits` clause type texts for sealed types (Java 17+). The
 * `permits` field is a `permits` node wrapping a `type_list`, mirroring
 * `super_interfaces`; iterating the type_list's named children yields each
 * permitted type robustly (handles generics such as `Box<Number>` and qualified
 * names such as `net.mc.Circle`). Returns [] for non-sealed types.
 */
function extractPermits(node: Node): string[] {
  const p = node.childForFieldName('permits');
  if (!p) return [];
  const typeList = p.namedChildren.find((c) => c.type === 'type_list');
  return typeList ? typeList.namedChildren.map((c) => c.text) : [];
}

/**
 * Extract thrown type names from a `throws` clause. The `throws` node's named
 * children are the individual type nodes, which we read directly (avoids
 * splitting issues with qualified names).
 */
function extractThrows(node: Node): string[] {
  const thr = node.namedChildren.find((c) => c.type === 'throws');
  if (!thr) return [];
  return thr.namedChildren.map((c) => c.text);
}

/** Read a declaration's `type` field, appending any trailing `dimensions` (e.g. `[]`). */
function typeWithDimensions(node: Node, fallback = ''): string {
  const typeText = node.childForFieldName('type')?.text;
  const dims = node.childForFieldName('dimensions')?.text ?? '';
  return typeText ? `${typeText}${dims}` : fallback;
}

/**
 * Extract structured parameters from a `formal_parameters` node. Handles
 * `formal_parameter`, varargs `spread_parameter`, and array `dimensions`.
 * `receiver_parameter` nodes (e.g. `Foo this`) are skipped.
 */
function extractParameters(paramsNode: Node | null | undefined): JavaParameter[] {
  if (!paramsNode) return [];
  const out: JavaParameter[] = [];
  for (const p of paramsNode.namedChildren) {
    if (p.type === 'formal_parameter') {
      out.push({
        name: p.childForFieldName('name')?.text,
        type: typeWithDimensions(p),
      });
    } else if (p.type === 'spread_parameter') {
      // `int... nums` — the type is the non-decorative named child; the name
      // lives in an inner `variable_declarator`.
      const typeChild = p.namedChildren.find(
        (c) =>
          c.type !== 'modifiers' &&
          c.type !== 'annotation' &&
          c.type !== 'marker_annotation' &&
          c.type !== 'variable_declarator',
      );
      const declarator = p.namedChildren.find((c) => c.type === 'variable_declarator');
      out.push({
        name: declarator?.childForFieldName('name')?.text,
        type: typeChild?.text ?? '',
        isVarArgs: true,
      });
    }
  }
  return out;
}

/**
 * Split raw generic-parameter text (e.g. "<T, U extends List<T>>") into its
 * top-level components, respecting `<>` nesting. Used to populate
 * `MethodSignature.typeParameters` (a `string[]`).
 */
function splitTypeParams(text: string): string[] {
  const inner = text.replace(/^</, '').replace(/>$/, '').trim();
  if (!inner) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '<') {
      depth++;
      current += ch;
    } else if (ch === '>') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Internal structured representation of a single method/field member. */
interface MemberInfo {
  memberKind: 'method' | 'field';
  symbolName: string;
  line: number;
  context: string;
  modifiers: string[];
  annotations: JavaAnnotation[];
  // method-specific
  isConstructor?: boolean;
  returnType?: string;
  parameters?: JavaParameter[];
  throwsList?: string[];
  typeParameters?: string;
  // field-specific
  fieldType?: string;
  constantValue?: string;
}

/** Internal structured representation of a named type declaration. */
interface TypeInfo {
  classKind: JavaClassKind;
  simpleName: string;
  qualifiedName: string;
  pkg: string;
  line: number;
  context: string;
  modifiers: string[];
  annotations: JavaAnnotation[];
  superclass?: string;
  interfaces: string[];
  /** Permitted subclasses for sealed types (source form). Empty for non-sealed. */
  permits: string[];
  typeParameters?: string;
  recordComponents?: JavaParameter[];
  /** Direct children in source order (members and nested types interleaved). */
  elements: TypeElement[];
}

type TypeElement = { el: 'member'; member: MemberInfo } | { el: 'type'; type: TypeInfo };

/** Build method/constructor member info from a method-shaped node. */
function methodInfoFromNode(member: Node, source: string): MemberInfo {
  const isConstructor = CONSTRUCTOR_TYPES.has(member.type);
  const modifiers = extractModifiers(member);
  const returnType = isConstructor ? undefined : typeWithDimensions(member, 'void');
  const paramsNode = member.childForFieldName('parameters');
  const parameters = paramsNode ? extractParameters(paramsNode) : undefined;
  const throwsList = extractThrows(member);
  const typeParameters = member.childForFieldName('type_parameters')?.text;
  return {
    memberKind: 'method',
    symbolName: member.childForFieldName('name')?.text ?? '',
    line: member.startPosition.row + 1,
    context: signatureContext(member, source),
    modifiers,
    annotations: extractAnnotations(member),
    isConstructor,
    returnType,
    parameters,
    throwsList: throwsList.length > 0 ? throwsList : undefined,
    typeParameters,
  };
}

/** Build field member info from a field/constant declaration + declarator. */
function fieldInfoFromDeclarator(member: Node, declarator: Node, typeText: string): MemberInfo {
  const dims = declarator.childForFieldName('dimensions')?.text ?? '';
  const fieldType = typeText ? `${typeText}${dims}` : typeText;
  return {
    memberKind: 'field',
    symbolName: declarator.childForFieldName('name')?.text ?? '',
    line: declarator.startPosition.row + 1,
    context: collapse(fieldType ? `${fieldType} ${declarator.text}` : declarator.text),
    modifiers: extractModifiers(member),
    annotations: extractAnnotations(member),
    fieldType,
    constantValue: declarator.childForFieldName('value')?.text,
  };
}

/**
 * Build field member info for an enum constant. Enum constants are implicitly
 * `public static final` (JLS), so those keywords are merged in.
 */
function fieldInfoFromEnumConstant(member: Node): MemberInfo {
  const explicit = extractModifiers(member);
  const modifiers = Array.from(new Set(['public', 'static', 'final', ...explicit]));
  return {
    memberKind: 'field',
    symbolName: member.childForFieldName('name')?.text ?? '',
    line: member.startPosition.row + 1,
    context: collapse(member.text),
    modifiers,
    annotations: extractAnnotations(member),
  };
}

/** Build type info from a type-declaration node. */
function typeInfoFromNode(
  node: Node,
  qualifiedName: string,
  pkg: string,
  source: string,
): TypeInfo {
  const classKind = classKindOf(node.type);
  return {
    classKind,
    simpleName: node.childForFieldName('name')?.text ?? '',
    qualifiedName,
    pkg,
    line: node.startPosition.row + 1,
    context: signatureContext(node, source),
    modifiers: extractModifiers(node),
    annotations: extractAnnotations(node),
    superclass: extractSuperclass(node),
    interfaces: extractInterfaces(node),
    permits: extractPermits(node),
    typeParameters: node.childForFieldName('type_parameters')?.text,
    recordComponents:
      classKind === 'record' ? extractParameters(node.childForFieldName('parameters')) : undefined,
    elements: [],
  };
}

/**
 * Core recursive walk. Parses `source` once and returns one `TypeInfo` per
 * top-level named type (with nested types embedded in `elements`). Mirrors the
 * original traversal: direct members only, attributed to the fully-qualified
 * declaring class, excluding anonymous/local-class bodies.
 */
function extractTypes(source: string): TypeInfo[] {
  const top: TypeInfo[] = [];

  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (err) {
    logger.warn('tree-sitter parse failed, skipping file:', err);
    return top;
  }

  const root = tree.rootNode;

  // Resolve the package so we can qualify top-level type names.
  let pkg = '';
  for (const child of root.namedChildren) {
    if (child.type === 'package_declaration') {
      // package_declaration has no `name` field; the package name is its
      // identifier / scoped_identifier named child (possibly preceded by
      // package annotations). Reading the node directly avoids a source regex.
      const nameNode = child.namedChildren.find(
        (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
      );
      pkg = nameNode?.text ?? '';
      break;
    }
  }

  const visitBody = (body: Node, owner: TypeInfo): void => {
    for (const member of body.namedChildren) {
      if (TYPE_DECLARATIONS.has(member.type)) {
        const simple = member.childForFieldName('name')?.text ?? '';
        if (!simple) continue;
        const nestedQ = `${owner.qualifiedName}.${simple}`;
        const nestedType = typeInfoFromNode(member, nestedQ, pkg, source);
        owner.elements.push({ el: 'type', type: nestedType });
        const childBody = member.childForFieldName('body');
        if (childBody) visitBody(childBody, nestedType);
      } else if (MEMBER_METHODS.has(member.type)) {
        const name = member.childForFieldName('name')?.text;
        if (!name) continue;
        owner.elements.push({ el: 'member', member: methodInfoFromNode(member, source) });
      } else if (MEMBER_FIELDS.has(member.type)) {
        const typeText = member.childForFieldName('type')?.text ?? '';
        // `declarator` is a repeated field (e.g. `int a, b = 2, c;`) —
        // childrenForFieldName returns all variable_declarator nodes.
        for (const d of member.childrenForFieldName('declarator')) {
          const name = d.childForFieldName('name')?.text;
          if (!name) continue;
          owner.elements.push({
            el: 'member',
            member: fieldInfoFromDeclarator(member, d, typeText),
          });
        }
      } else if (member.type === 'enum_constant') {
        const name = member.childForFieldName('name')?.text;
        if (!name) continue;
        owner.elements.push({ el: 'member', member: fieldInfoFromEnumConstant(member) });
      } else if (member.type === 'enum_body_declarations') {
        // tree-sitter wraps an enum's constructors / methods / fields that
        // follow the constants+semicolon in this container node.
        visitBody(member, owner);
      }
      // static_initializer / instance-initializer `block` / stray `;` -> ignored.
      // Anonymous-class methods live under object_creation_expression (an
      // expression, not a body member) and local classes live under block
      // statements, so neither is reached by this direct-member walk.
    }
  };

  for (const child of root.namedChildren) {
    if (!TYPE_DECLARATIONS.has(child.type)) continue;
    const simple = child.childForFieldName('name')?.text ?? '';
    if (!simple) continue;
    const qualifiedName = pkg ? `${pkg}.${simple}` : simple;
    const typeInfo = typeInfoFromNode(child, qualifiedName, pkg, source);
    top.push(typeInfo);
    const body = child.childForFieldName('body');
    if (body) visitBody(body, typeInfo);
  }
  // tree-sitter native memory is GC-managed (the Node Tree binding has
  // no manual delete() call); we rely on garbage collection here.

  return top;
}

/** Flatten a type tree into the flat `JavaSymbol[]` shape (depth-first, source order). */
function toSymbols(types: TypeInfo[], out: JavaSymbol[]): void {
  for (const t of types) {
    out.push(typeToSymbol(t));
    for (const el of t.elements) {
      if (el.el === 'member') {
        out.push(memberToSymbol(el.member, t.qualifiedName));
      } else {
        toSymbols([el.type], out);
      }
    }
  }
}

function typeToSymbol(t: TypeInfo): JavaSymbol {
  return {
    declaringClass: t.qualifiedName,
    entryType: 'class',
    symbol: t.simpleName,
    context: t.context,
    line: t.line,
    kind: t.classKind,
    modifiers: t.modifiers,
    annotations: t.annotations.length > 0 ? t.annotations : undefined,
    superclass: t.superclass,
    interfaces: t.interfaces.length > 0 ? t.interfaces : undefined,
    typeParameters: t.typeParameters,
    recordComponents:
      t.recordComponents && t.recordComponents.length > 0 ? t.recordComponents : undefined,
    isStatic: t.modifiers.includes('static'),
    isFinal: t.modifiers.includes('final'),
  };
}

function memberToSymbol(m: MemberInfo, declaringClass: string): JavaSymbol {
  const sym: JavaSymbol = {
    declaringClass,
    entryType: m.memberKind,
    symbol: m.symbolName,
    context: m.context,
    line: m.line,
    modifiers: m.modifiers,
    annotations: m.annotations.length > 0 ? m.annotations : undefined,
    isStatic: m.modifiers.includes('static'),
    isFinal: m.modifiers.includes('final'),
  };
  if (m.memberKind === 'method') {
    sym.isConstructor = m.isConstructor;
    sym.returnType = m.returnType;
    sym.parameters = m.parameters;
    sym.throws = m.throwsList;
    sym.typeParameters = m.typeParameters;
  } else {
    sym.fieldType = m.fieldType;
  }
  return sym;
}

/**
 * Extract searchable symbols (classes, methods, fields) from Java source.
 *
 * Returns one entry per named class plus one entry per direct method/field
 * member, attributed to the fully-qualified declaring class. Members of
 * anonymous and local classes are intentionally omitted. Each entry also
 * carries optional structured fields (modifiers, signatures, etc.).
 */
export function extractJavaSymbols(source: string): JavaSymbol[] {
  const symbols: JavaSymbol[] = [];
  toSymbols(extractTypes(source), symbols);
  return symbols;
}

/** Flatten a type tree into `ClassSignature[]` (one per named type, including nested). */
function toSignatures(types: TypeInfo[], out: ClassSignature[]): void {
  for (const t of types) {
    out.push(typeToSignature(t));
    const nested = t.elements
      .filter((e): e is { el: 'type'; type: TypeInfo } => e.el === 'type')
      .map((e) => e.type);
    toSignatures(nested, out);
  }
}

function memberToMethodSignature(m: MemberInfo): MethodSignature {
  const params = m.parameters ?? [];
  return {
    name: m.symbolName,
    returnType: m.isConstructor ? '' : (m.returnType ?? 'void'),
    parameters: params.map((p) => (p.isVarArgs ? `${p.type}...` : p.type)),
    modifiers: m.modifiers,
    throws: m.throwsList ?? [],
    typeParameters: m.typeParameters ? splitTypeParams(m.typeParameters) : undefined,
  };
}

function memberToFieldSignature(m: MemberInfo): FieldSignature {
  return {
    name: m.symbolName,
    type: m.fieldType ?? '',
    modifiers: m.modifiers,
    constantValue: m.constantValue,
  };
}

/**
 * Convert a dot-qualified source name (e.g. "net.mc.Outer.Inner") into the
 * JVM-style inner-class name ("net.mc.Outer$Inner"). Package separators stay
 * as dots; only the class-nesting segments after the top-level class become `$`.
 */
function toInnerClassName(qualifiedName: string, pkg: string): string {
  const prefix = pkg ? `${pkg}.` : '';
  if (prefix && !qualifiedName.startsWith(prefix)) return qualifiedName;
  const chain = qualifiedName.slice(prefix.length);
  const parts = chain.split('.');
  if (parts.length < 2) return qualifiedName;
  return `${prefix}${parts[0]}$${parts.slice(1).join('$')}`;
}

function typeToSignature(t: TypeInfo): ClassSignature {
  const methods: MethodSignature[] = [];
  const fields: FieldSignature[] = [];
  for (const el of t.elements) {
    if (el.el === 'member') {
      if (el.member.memberKind === 'method') {
        methods.push(memberToMethodSignature(el.member));
      } else {
        fields.push(memberToFieldSignature(el.member));
      }
    }
  }
  const innerClasses = t.elements
    .filter((e): e is { el: 'type'; type: TypeInfo } => e.el === 'type')
    .map((e) => toInnerClassName(e.type.qualifiedName, t.pkg));

  return {
    name: t.qualifiedName,
    package: t.pkg,
    simpleName: t.simpleName,
    isInterface: t.classKind === 'interface',
    isEnum: t.classKind === 'enum',
    isAbstract: t.classKind === 'class' && t.modifiers.includes('abstract'),
    isRecord: t.classKind === 'record',
    isFinal: t.modifiers.includes('final'),
    superclass: t.superclass,
    interfaces: t.interfaces,
    permits: t.permits.length > 0 ? t.permits : undefined,
    typeParameters: t.typeParameters,
    recordComponents: t.recordComponents,
    methods,
    fields,
    innerClasses,
  };
}

/**
 * Extract grouped `ClassSignature` objects from Java source, one per named type
 * (including nested types). Constructors are emitted as methods whose `name` is
 * the simple class name (matching the source token) and whose `returnType` is
 * the empty string. This shape is consumed by the AST-diff service; it is a
 * richer, tree-sitter-backed alternative to its legacy regex extractor.
 */
export function extractJavaSignatures(source: string): ClassSignature[] {
  const signatures: ClassSignature[] = [];
  toSignatures(extractTypes(source), signatures);
  return signatures;
}
