# Signature Attribute & JVM Descriptors (VERBATIM)

Verbatim from JVM spec §4 (saved at `docs/ref/asm/jvms-4.html`).

## Signature attribute — JVM §4.7.9 (verbatim structure)

```
Signature_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 signature_index;
}
```

At most one `Signature` attribute per `ClassFile`, `field_info`, `method_info`, or
`record_component_info` structure.

> A `Signature` attribute stores a signature for a class, interface, constructor, method, field, or
> record component whose declaration uses type variables or parameterized types.

## §4.7.9.1 — JVM-erased descriptor vs generic signature

The JVM stores **two** representations of types:

- **Erased descriptor** (`desc`): the JVM-level type after type erasure. This is what
  method/field resolution and access transformers target.
  - Example: `desc = "(Ljava/lang/Object;)V"`
- **Generic signature** (`signature`): full generic type information including type variables.
  - Example: `signature = "<T:Ljava/lang/Object;>(TT;)V"`

**Access-transformer validators care about the erased `desc`** — ATs target JVM-level members
(`public net.mc.Foo m(I)V` matches the descriptor, not the generic signature).

ASM storage: `ClassNode.signature`, `FieldNode.signature`, `MethodNode.signature`,
`RecordComponentNode.signature` (all `String`, may be null). Erased types live in `name`/`desc`/
`descriptor`.

---

## §4.3.2 — Field descriptors (verbatim grammar)

**Table 4.3-A: Field Descriptor interpretation**

| BaseType Character | Type | Interpretation |
|---|---|---|
| `B` | `byte` | signed byte |
| `C` | `char` | Unicode character code point in the Basic Multilingual Plane, encoded with UTF-16 |
| `D` | `double` | double-precision floating-point value |
| `F` | `float` | single-precision floating-point value |
| `I` | `int` | integer |
| `J` | `long` | long integer |
| `L` Classname `;` | reference | an instance of class Classname |
| `S` | `short` | signed short |
| `Z` | `boolean` | `true` or `false` |
| `[` | reference | one array dimension |

**Grammar:**

```
FieldDescriptor:
    BaseType
    ObjectType
    ArrayType

BaseType:
    (one of)
    B C D F I J S Z

ObjectType:
    L ClassName ;

ArrayType:
    [ ComponentType

ComponentType:
    FieldType

FieldType:
    BaseType
    ObjectType
    ArrayType
```

For example, the descriptor for `int` is `I`, for `Thread` is `Ljava/lang/Thread;`, and for a
two-dimensional `double` array is `[[D`.

## §4.3.3 — Method descriptors (verbatim grammar)

A method descriptor contains zero or more parameter descriptors, representing the types of
parameters that the method takes, and a return descriptor, representing the type of the value (if
any) that the method returns.

```
MethodDescriptor:
    ( {ParameterDescriptor} ) ReturnDescriptor

ParameterDescriptor:
    FieldType

ReturnDescriptor:
    FieldType
    VoidDescriptor

VoidDescriptor:
    V
```

For example, the method descriptor for the method:
```java
Object m(int i, double d, Thread t)
```
is: `(IDLjava/lang/Thread;)Ljava/lang/Object;`

The method descriptor for the method `void notify()` is `()V`.

---

## Practical notes for the ASM dumper / AT validator

- For each `FieldNode`, emit `descriptor = node.desc` (erased). `node.signature` is optional extra
  generic info.
- For each `MethodNode`, emit `descriptor = node.desc` (erased). The AT signature
  `<class> <name>(<params>)<return>` matches this erased form.
- The `Opcodes` constants do not cover type codes — use the grammar above to encode/decode.
- The `org.objectweb.asm.Type` class is a helper for parsing descriptors
  (`Type.getReturnType(desc)`, `Type.getArgumentTypes(desc)`, `Type.getType(...)`); it is not
  required but convenient.
