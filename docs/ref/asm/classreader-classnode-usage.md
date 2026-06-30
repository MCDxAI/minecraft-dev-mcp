# Reading .class / JARs into ClassNode (VERBATIM usage reference)

Verbatim API surface from `ClassReader.java` (saved at `docs/ref/asm/ClassReader.java`) and the
asm-tree object model (see `class-tree-api.md`). The ASM user guide at `asm.ow2.io/usage.html`
is Anubis-PoW-bot-blocked for automated fetchers; this doc reconstructs the canonical idiom from
the authoritative source Javadoc.

## Constructors (verbatim from ClassReader.java)

```java
/** Constructs a new {@link ClassReader} object. …
 * @param b the bytecode of the class to be read. */
public ClassReader(final byte[] b);

/** Constructs a new {@link ClassReader} object. …
 * @param b the bytecode of the class to be read.
 * @param off the start offset of the class data in b.
 * @param len the length of the class data in b. */
public ClassReader(final byte[] b, final int off, final int len);

/** Constructs a new {@link ClassReader} object. …
 * @param inputStream an input stream from which to read the class. */
public ClassReader(final InputStream inputStream) throws IOException;

/** Constructs a new {@link ClassReader} object. …
 * @param name the binary name of the class to be read. The class path is used to
 *     find the corresponding class file (for instance `java/lang/Object`). */
public ClassReader(final String name) throws IOException;

/** Constructs a new {@link ClassReader} object. …
 * @param name the binary name of the class to be read. */
public ClassReader(final String name, final Attribute[] attrs) throws IOException;
```

## Parsing-option constants (verbatim from ClassReader.java)

```java
/** Flag to skip the Code attribute. If this flag is set the Code attribute is neither parsed nor
 * sent to {@link ClassVisitor#visitMethod} as the methods are visited. The method nodes keep
 * access/name/desc/signature/exceptions/annotations — exactly what a metadata-only dump needs. */
static final int SKIP_CODE = 1;

/** Flag to skip the SourceFile, SourceDebugExtension, LocalVariableTable,
 * LocalVariableTypeTable, LineNumberTable and MethodParameters attributes. … */
static final int SKIP_DEBUG = 2;

/** Flag to skip the StackMap and StackMapTable informal attributes. … */
static final int SKIP_FRAMES = 4;

/** Flag to expand the stack map frames. … */
static final int EXPAND_FRAMES = 8;

/** Flag to return as many attributes as possible, including the Code attribute, used for class
 * comparison or for type conformance. … */
static final int SKIP_ASSERTS = 16;
```

**Metadata-only recommendation:** pass `ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG |
ClassReader.SKIP_FRAMES`. With `SKIP_CODE`, `MethodNode.instructions`/`maxStack`/`maxLocals`/
`localVariables` are NOT populated, but **access, name, desc, signature, exceptions, annotations
(visible/invisible), parameters, and annotationDefault remain** — exactly what a metadata dumper
needs.

## Canonical idiom (from ClassReader.java + asm-tree semantics)

```java
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;

// Read class bytes from a file or JAR entry, then:
ClassReader reader = new ClassReader(bytes);
ClassNode node = new ClassNode();          // == new ClassNode(Opcodes.ASM9)
reader.accept(node, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);

// node.access, node.name, node.superName, node.interfaces, node.fields, node.methods,
// node.recordComponents, node.innerClasses, node.nestHostClass, node.nestMembers,
// node.permittedSubclasses, node.visibleAnnotations, node.invisibleAnnotations are all populated.
```

## JAR iteration recipe (standard JDK API)

```java
import java.util.jar.JarFile;
import java.util.jar.JarEntry;
import java.io.InputStream;

try (JarFile jar = new JarFile(path)) {
  Enumeration<JarEntry> entries = jar.entries();
  while (entries.hasMoreElements()) {
    JarEntry entry = entries.nextElement();
    if (!entry.getName().endsWith(".class")) continue;
    byte[] bytes;
    try (InputStream in = jar.getInputStream(entry)) {
      bytes = in.readAllBytes();
    }
    ClassNode node = new ClassNode();
    new ClassReader(bytes).accept(
        node,
        ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES
    );
    // serialize node to JSON here
  }
}
```

## Reading order (from ClassNode.accept / ClassVisitor)

When a `ClassNode` is visited via `ClassReader.accept(classNode, flags)`, the visitor methods are
called in this order (per the ClassReader source): `visit` (version/access/name/superName/
interfaces/permittedSubclasses) → `visitSource` → `visitModule` → `visitNestHost` →
`visitOuterClass` → annotations (visible then invisible) → type annotations → attrs →
`visitNestMembers` → `visitRecordComponent`* → `visitField`* → `visitMethod`* → `visitEnd`.

The `*` items are repeated for each record component / field / method. This order is what
populates the corresponding `ClassNode` lists.
