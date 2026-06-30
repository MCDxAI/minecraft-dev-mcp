# ASM asm-tree API Reference (VERBATIM field documentation)

Verbatim Javadoc + field signatures copied from OW2 ASM source, mirrored at
`github.com/consulo/objectweb-asm` (9.x fork). The full source files are saved alongside this doc:

- `ClassNode.java`, `FieldNode.java`, `MethodNode.java`, `RecordComponentNode.java`,
  `InnerClassNode.java`, `AnnotationNode.java`, `TypeAnnotationNode.java`, `ModuleNode.java`,
  `ParameterNode.java`, `LocalVariableNode.java`, `TryCatchBlockNode.java`
- `Opcodes.java` (access flags), `ClassReader.java` (reading), `jvms-4.html` (JVM spec §4)

**Locked version: ASM 9.10.1** (`org.ow2.asm:asm`, `asm-tree`, `asm-util`, `asm-commons`;
BSD-3-Clause; supports Java 25 class files via `Opcodes.ASM9`). The asm-tree object-model field
structure is stable across ASM 9.0–9.10.1, so these docs are correct for the locked version.

---

## ClassNode — every field (verbatim)

```java
/** The class version. The minor version is stored in the 16 most significant bits, and the major
 * version in the 16 least significant bits. */
public int version;
/** The class's access flags (see {@link org.objectweb.asm.Opcodes}). This field also indicates if
 * the class is deprecated {@link Opcodes#ACC_DEPRECATED} or a record {@link Opcodes#ACC_RECORD}. */
public int access;
/** The internal name of this class (see {@link org.objectweb.asm.Type#getInternalName()}). */
public String name;
/** The signature of this class. May be {@literal null}. */
public String signature;
/** The internal of name of the super class (see {@link org.objectweb.asm.Type#getInternalName()}).
 * For interfaces, the super class is {@link Object}. May be {@literal null}, but only for the
 * {@link Object} class. */
public String superName;
/** The internal names of the interfaces directly implemented by this class (see {@link
 * org.objectweb.asm.Type#getInternalName()}). */
public List<String> interfaces;
/** The name of the source file from which this class was compiled. May be {@literal null}. */
public String sourceFile;
/** The correspondence between source and compiled elements of this class. May be {@literal null}. */
public String sourceDebug;
/** The module stored in this class. May be {@literal null}. */
public ModuleNode module;
/** The internal name of the enclosing class of this class (see {@link
 * org.objectweb.asm.Type#getInternalName()}). Must be {@literal null} if this class has no
 * enclosing class, or if it is a local or anonymous class. */
public String outerClass;
/** The name of the method that contains the class, or {@literal null} if the class has no
 * enclosing class, or is not enclosed in a method or constructor of its enclosing class (e.g. if
 * it is enclosed in an instance initializer, static initializer, instance variable initializer,
 * or class variable initializer). */
public String outerMethod;
/** The descriptor of the method that contains the class, or {@literal null} if the class has no
 * enclosing class, or is not enclosed in a method or constructor of its enclosing class (e.g. if
 * it is enclosed in an instance initializer, static initializer, instance variable initializer,
 * or class variable initializer). */
public String outerMethodDesc;
/** The runtime visible annotations of this class. May be {@literal null}. */
public List<AnnotationNode> visibleAnnotations;
/** The runtime invisible annotations of this class. May be {@literal null}. */
public List<AnnotationNode> invisibleAnnotations;
/** The runtime visible type annotations of this class. May be {@literal null}. */
public List<TypeAnnotationNode> visibleTypeAnnotations;
/** The runtime invisible type annotations of this class. May be {@literal null}. */
public List<TypeAnnotationNode> invisibleTypeAnnotations;
/** The non standard attributes of this class. May be {@literal null}. */
public List<Attribute> attrs;
/** The inner classes of this class. */
public List<InnerClassNode> innerClasses;
/** The internal name of the nest host class of this class (see {@link
 * org.objectweb.asm.Type#getInternalName()}). May be {@literal null}. */
public String nestHostClass;
/** The internal names of the nest members of this class (see {@link
 * org.objectweb.asm.Type#getInternalName()}). May be {@literal null}. */
public List<String> nestMembers;
/** The internal names of the permitted subclasses of this class (see {@link
 * org.objectweb.asm.Type#getInternalName()}). May be {@literal null}. */
public List<String> permittedSubclasses;
/** The record components of this class. May be {@literal null}. */
public List<RecordComponentNode> recordComponents;
/** The fields of this class. */
public List<FieldNode> fields;
/** The methods of this class. */
public List<MethodNode> methods;
```

**Constructors:** `public ClassNode()` (uses `Opcodes.ASM9`); `public ClassNode(int api)`.
The `check(int api)` method gates features by API version: `permittedSubclasses` requires ASM9,
`recordComponents`/`ACC_RECORD` requires ASM8, `nestHostClass`/`nestMembers` require ASM7,
`module` requires ASM6, type annotations require ASM5.

---

## FieldNode — every field (verbatim)

```java
/** The field's access flags (see {@link org.objectweb.asm.Opcodes}). This field also indicates if
 * the field is synthetic and/or deprecated. */
public int access;
/** The field's name. */
public String name;
/** The field's descriptor (see {@link org.objectweb.asm.Type}). */
public String desc;
/** The field's signature. May be {@literal null}. */
public String signature;
/** The field's initial value. This field, which may be {@literal null} if the field does not have
 * an initial value, must be an {@link Integer}, a {@link Float}, a {@link Long}, a {@link Double}
 * or a {@link String}. */
public Object value;
/** The runtime visible annotations of this field. May be {@literal null}. */
public List<AnnotationNode> visibleAnnotations;
/** The runtime invisible annotations of this field. May be {@literal null}. */
public List<AnnotationNode> invisibleAnnotations;
/** The runtime visible type annotations of this field. May be {@literal null}. */
public List<TypeAnnotationNode> visibleTypeAnnotations;
/** The runtime invisible type annotations of this field. May be {@literal null}. */
public List<TypeAnnotationNode> invisibleTypeAnnotations;
/** The non standard attributes of this field. May be {@literal null}. */
public List<Attribute> attrs;
```

---

## MethodNode — every field (verbatim)

```java
/** The method's access flags (see {@link Opcodes}). This field also indicates if the method is
 * synthetic and/or deprecated. */
public int access;
/** The method's name. */
public String name;
/** The method's descriptor (see {@link Type}). */
public String desc;
/** The method's signature. May be {@literal null}. */
public String signature;
/** The internal names of the method's exception classes (see {@link Type#getInternalName()}). */
public List<String> exceptions;
/** The method parameter info (access flags and name). */
public List<ParameterNode> parameters;
/** The runtime visible annotations of this method. May be {@literal null}. */
public List<AnnotationNode> visibleAnnotations;
/** The runtime invisible annotations of this method. May be {@literal null}. */
public List<AnnotationNode> invisibleAnnotations;
/** The runtime visible type annotations of this method. May be {@literal null}. */
public List<TypeAnnotationNode> visibleTypeAnnotations;
/** The runtime invisible type annotations of this method. May be {@literal null}. */
public List<TypeAnnotationNode> invisibleTypeAnnotations;
/** The non standard attributes of this method. May be {@literal null}. */
public List<Attribute> attrs;
/** The default value of this annotation interface method. This field must be a {@link Byte},
 * {@link Boolean}, {@link Character}, {@link Short}, {@link Integer}, {@link Long}, {@link
 * Float}, {@link Double}, {@link String} or {@link Type}, or an two elements String array (for
 * enumeration values), a {@link AnnotationNode}, or a {@link List} of values of one of the
 * preceding types. May be {@literal null}. */
public Object annotationDefault;
/** The number of method parameters than can have runtime visible annotations. ... (default 0
 * indicates all parameters described in the method descriptor can have annotations). ... (see
 * https://docs.oracle.com/javase/specs/jvms/se9/html/jvms-4.html#jvms-4.7.18). */
public int visibleAnnotableParameterCount;
/** The runtime visible parameter annotations of this method. These lists are lists of {@link
 * AnnotationNode} objects. May be {@literal null}. */
public List<AnnotationNode>[] visibleParameterAnnotations;
/** The number of method parameters than can have runtime invisible annotations. ... */
public int invisibleAnnotableParameterCount;
/** The runtime invisible parameter annotations of this method. These lists are lists of {@link
 * AnnotationNode} objects. May be {@literal null}. */
public List<AnnotationNode>[] invisibleParameterAnnotations;
/** The instructions of this method. */
public InsnList instructions;
/** The try catch blocks of this method. */
public List<TryCatchBlockNode> tryCatchBlocks;
/** The maximum stack size of this method. */
public int maxStack;
/** The maximum number of local variables of this method. */
public int maxLocals;
/** The local variables of this method. May be {@literal null} */
public List<LocalVariableNode> localVariables;
/** The visible local variable annotations of this method. May be {@literal null} */
public List<LocalVariableAnnotationNode> visibleLocalVariableAnnotations;
/** The invisible local variable annotations of this method. May be {@literal null} */
public List<LocalVariableAnnotationNode> invisibleLocalVariableAnnotations;
```

---

## RecordComponentNode — every field (verbatim)

Class doc: *"A node that represents a record component."*

```java
/** The record component name. */
public String name;
/** The record component descriptor (see {@link org.objectweb.asm.Type}). */
public String descriptor;
/** The record component signature. May be {@literal null}. */
public String signature;
/** The runtime visible annotations of this record component. May be {@literal null}. */
public List<AnnotationNode> visibleAnnotations;
/** The runtime invisible annotations of this record component. May be {@literal null}. */
public List<AnnotationNode> invisibleAnnotations;
/** The runtime visible type annotations of this record component. May be {@literal null}. */
public List<TypeAnnotationNode> visibleTypeAnnotations;
/** The runtime invisible type annotations of this record component. May be {@literal null}. */
public List<TypeAnnotationNode> invisibleTypeAnnotations;
/** The non standard attributes of this record component. May be {@literal null}. */
public List<Attribute> attrs;
```

Constructor note: api must be one of `Opcodes#ASM8` or `Opcodes#ASM9`.

---

## InnerClassNode — class doc + every field (verbatim)

> A node that represents an inner class. This inner class is not necessarily a member of the
> `ClassNode` containing this object. More precisely, every class or interface C which is
> referenced by a `ClassNode` and which is not a package member must be represented with an
> `InnerClassNode`. The `ClassNode` must reference its nested class or interface members, and its
> enclosing class, if any. See the JVMS 4.7.6 section for more details.

```java
/** The internal name of an inner class (see {@link org.objectweb.asm.Type#getInternalName()}). */
public String name;
/** The internal name of the class to which the inner class belongs (see {@link
 * org.objectweb.asm.Type#getInternalName()}). May be {@literal null}. */
public String outerName;
/** The (simple) name of the inner class inside its enclosing class. Must be {@literal null} if the
 * inner class is not the member of a class or interface (e.g. for local or anonymous classes). */
public String innerName;
/** The access flags of the inner class as originally declared in the source code from which the
 * class was compiled. */
public int access;
```

---

## AnnotationNode — fields (verbatim)

```java
/** The class descriptor of the annotation class. */
public String desc;
/** The name value pairs of this annotation. Each name value pair is stored as two consecutive
 * elements in the list. The name is a {@link String}, and the value may be a {@link Byte}, {@link
 * Short}, {@link Character}, {@link Integer}, {@link Long}, {@link Float}, {@link Double},
 * {@link String}, {@link Type}, {@link AnnotationNode}, or a {@link List} of values of one of the
 * preceding types. */
public List<Object> values;
```

---

## Other node types (see saved source files)

- **TypeAnnotationNode** (`docs/ref/asm/TypeAnnotationNode.java`) — extends `AnnotationNode`;
  adds `int typeRef` and `TypePath typePath`.
- **ModuleNode** (`docs/ref/asm/ModuleNode.java`) — `name`, `access`, `version`, `mainClass`,
  `packages`, `requires`, `exports`, `opens`, `uses`, `provides`.
- **ParameterNode** (`docs/ref/asm/ParameterNode.java`) — `name`, `access`.
- **LocalVariableNode** (`docs/ref/asm/LocalVariableNode.java`) — `name`, `desc`, `signature`,
  `start`, `end`, `index`.
- **TryCatchBlockNode** (`docs/ref/asm/TryCatchBlockNode.java`) — `start`, `end`, `handler`,
  `type`, `visibleTypeAnnotations`, `invisibleTypeAnnotations`.

---

## See also
- `access-flags.md` — every `ACC_*` constant with hex values and targets.
- `classreader-classnode-usage.md` — reading `.class`/JARs into ClassNode; SKIP_* flags.
- `records-and-inner-classes.md` — Record/InnerClasses/NestHost/NestMembers/PermittedSubclasses attributes.
- `signature-attribute.md` — Signature attribute vs erased descriptor grammar.
