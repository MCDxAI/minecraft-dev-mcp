/**
 * Java symbol extraction via tree-sitter.
 *
 * Parses decompiled Java source into an AST and walks only the *direct*
 * members of named classes/interfaces/enums/records. This deliberately
 * excludes methods declared inside anonymous/local classes (which live in
 * nested expression scopes, not as direct class members), and unlike a
 * line-based regex it correctly captures methods/fields whose types contain
 * qualified names (dots), generics with spaces, type annotations, and
 * constructors — all of which the previous regex silently dropped.
 */
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import { logger } from './logger.js';

// `tree-sitter` v0.21.x ships as CommonJS with `export = Parser`; default import
// resolves to the Parser class under esModuleInterop. The parser is stateless
// across parses (input passed to parse()), so one shared instance is safe.
const parser = new Parser();
parser.setLanguage(Java);

export type JavaEntryType = 'class' | 'method' | 'field';

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

function collapse(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Build a one-line "signature" context for a declaration: the source from the
 * node start up to its body (exclusive), or the whole node if it has no body
 * (e.g. abstract / interface methods).
 */
function signatureContext(node: Parser.SyntaxNode, source: string): string {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : node.endIndex;
  return collapse(source.slice(node.startIndex, end));
}

/**
 * Extract searchable symbols (classes, methods, fields) from Java source.
 *
 * Returns one entry per named class plus one entry per direct method/field
 * member, attributed to the fully-qualified declaring class. Members of
 * anonymous and local classes are intentionally omitted.
 */
export function extractJavaSymbols(source: string): JavaSymbol[] {
  const symbols: JavaSymbol[] = [];

  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (err) {
    logger.warn('tree-sitter parse failed, skipping file:', err);
    return symbols;
  }

  const root = tree.rootNode;

  // Resolve the package so we can qualify top-level type names.
  let pkg = '';
  for (const child of root.namedChildren) {
    if (child.type === 'package_declaration') {
      const m = child.text.match(/package\s+([\w.]+)\s*;/);
      if (m) pkg = m[1];
      break;
    }
  }

  const visitBody = (body: Parser.SyntaxNode, qualifiedName: string): void => {
    for (const member of body.namedChildren) {
      if (TYPE_DECLARATIONS.has(member.type)) {
        const simple = member.childForFieldName('name')?.text ?? '';
        if (!simple) continue;
        const nestedQ = `${qualifiedName}.${simple}`;
        symbols.push({
          declaringClass: nestedQ,
          entryType: 'class',
          symbol: simple,
          context: signatureContext(member, source),
          line: member.startPosition.row + 1,
        });
        const childBody = member.childForFieldName('body');
        if (childBody) visitBody(childBody, nestedQ);
      } else if (MEMBER_METHODS.has(member.type)) {
        const name = member.childForFieldName('name')?.text;
        if (!name) continue;
        symbols.push({
          declaringClass: qualifiedName,
          entryType: 'method',
          symbol: name,
          context: signatureContext(member, source),
          line: member.startPosition.row + 1,
        });
      } else if (MEMBER_FIELDS.has(member.type)) {
        const typeText = member.childForFieldName('type')?.text ?? '';
        // `declarator` is a repeated field (e.g. `int a, b = 2, c;`) —
        // childrenForFieldName returns all variable_declarator nodes.
        for (const d of member.childrenForFieldName('declarator')) {
          const name = d.childForFieldName('name')?.text;
          if (!name) continue;
          symbols.push({
            declaringClass: qualifiedName,
            entryType: 'field',
            symbol: name,
            context: collapse(typeText ? `${typeText} ${d.text}` : d.text),
            line: d.startPosition.row + 1,
          });
        }
      } else if (member.type === 'enum_constant') {
        const name = member.childForFieldName('name')?.text;
        if (!name) continue;
        symbols.push({
          declaringClass: qualifiedName,
          entryType: 'field',
          symbol: name,
          context: collapse(member.text),
          line: member.startPosition.row + 1,
        });
      } else if (member.type === 'enum_body_declarations') {
        // tree-sitter wraps an enum's constructors / methods / fields that
        // follow the constants+semicolon in this container node.
        visitBody(member, qualifiedName);
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
    symbols.push({
      declaringClass: qualifiedName,
      entryType: 'class',
      symbol: simple,
      context: signatureContext(child, source),
      line: child.startPosition.row + 1,
    });
    const body = child.childForFieldName('body');
    if (body) visitBody(body, qualifiedName);
  }
  // Note: tree-sitter v0.21.x has no Tree.delete(); native memory is GC-managed.

  return symbols;
}
