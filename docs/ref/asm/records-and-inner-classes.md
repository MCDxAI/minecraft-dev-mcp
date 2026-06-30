# Records & Inner Classes — JVM Attributes & ASM Exposure (VERBATIM)

Verbatim from JVM spec §4 (saved at `docs/ref/asm/jvms-4.html`) and the asm-tree source (saved as
`*.java`; summarized in `class-tree-api.md`).

## InnerClasses attribute — JVM §4.7.6 (verbatim structure)

```
InnerClasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    {   u2 inner_class_info_index;
        u2 outer_class_info_index;
        u2 inner_name_index;
        u2 inner_class_access_flags;
    } classes[number_of_classes];
}
```

**Rules (verbatim):** Every `CONSTANT_Class_info` entry in the constant pool table whose name
contains a class C which is not a package member must be represented in the `classes` array. A class
or interface C is a member of its immediately enclosing class if the methods and fields of C are
accessible to members of the enclosing class. The inner class is the member of a class or interface
if `inner_name_index` is not zero. `outer_class_info_index` == 0 if C is top-level/local/anonymous.
`inner_name_index` == 0 if C is anonymous.

Nested-class access flags: see `access-flags.md` → "JVM spec §4.7.6-A".

**ASM exposure:** `ClassNode.innerClasses` is `List<InnerClassNode>`, with each `InnerClassNode`
having `name` (inner internal name), `outerName` (enclosing internal name, may be null),
`innerName` (simple name, null for anonymous/local), and `access` (flags as originally declared in
source).

---

## Record attribute — JVM §4.7.30 (verbatim structure)

```
Record_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 components_count;
    record_component_info components[components_count];
}

record_component_info {
    u2            name_index;
    u2            descriptor_index;
    u2            attributes_count;
    attribute_info attributes[attributes_count];
}
```

**Rules:** A `Record` attribute is permitted on a class file if and only if the class is a record
class. The class must have `ACC_FINAL` set. The canonical constructor, accessor methods, and the
fields corresponding to the record components are implied by the components array.

**ASM exposure:** `ClassNode.recordComponents` is `List<RecordComponentNode>`; each node has `name`,
`descriptor` (erased JVM field descriptor), `signature` (generic, may be null), and annotation
lists. The class itself also has `ACC_RECORD` (0x10000) set in `ClassNode.access`.

---

## Canonical constructor detection

The canonical constructor is the `<init>` method whose descriptor equals the in-order
concatenation of the record components' field descriptors. Concretely:

```java
// node is a ClassNode with recordComponents populated
if ((node.access & Opcodes.ACC_RECORD) != 0 && node.recordComponents != null) {
  StringBuilder canonicalDesc = new StringBuilder("(");
  for (RecordComponentNode rc : node.recordComponents) canonicalDesc.append(rc.descriptor);
  canonicalDesc.append(")V");
  String target = canonicalDesc.toString();
  MethodNode canonicalCtor = node.methods.stream()
      .filter(m -> "<init>".equals(m.name) && target.equals(m.desc))
      .findFirst().orElse(null);
}
```

(If a record has only one constructor, it is the canonical constructor. Records may also have a
compact/canonical form and additional custom constructors.)

---

## NestHost attribute — JVM §4.7.28 (verbatim)

```
NestHost_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 host_class_index;
}
```

At most one `NestHost` attribute per class file. `host_class_index` → a `CONSTANT_Class_info` entry
naming the nest host.

**ASM exposure:** `ClassNode.nestHostClass` is a `String` (internal name of the nest host), or null.

## NestMembers attribute — JVM §4.7.29 (verbatim)

```
NestMembers_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

A class file must not have both a `NestHost` and a `NestMembers` attribute.

**ASM exposure:** `ClassNode.nestMembers` is `List<String>` (internal names of nest members), or null.

## PermittedSubclasses attribute — JVM §4.7.31 (verbatim)

```
PermittedSubclasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

Indicates a sealed class/interface. Must NOT coexist with `ACC_FINAL` on a class ("sealed is
distinct from final"). There is **no `ACC_SEALED` flag** — sealed-ness is solely encoded by this
attribute.

**ASM exposure:** `ClassNode.permittedSubclasses` is `List<String>` (internal names of permitted
subclasses), or null. Requires ASM9 to read.
