# ASM Reference Docs

Verbatim reference material for building the ASM bytecode JSON dumper tool (Stage 5 of the
Java-parsing refactor — authoritative bytecode facts for access-transformer validation).

## Locked versions
| Package | Version |
|---|---|
| `org.ow2.asm:asm` | **9.10.1** |
| `org.ow2.asm:asm-tree` | **9.10.1** |
| `org.ow2.asm:asm-util` | **9.10.1** |
| `org.ow2.asm:asm-commons` | **9.10.1** |
| JDK runtime target | **17+** |
| JVM spec | **SE 21** |

License: **BSD-3-Clause** (permissive). Supports Java 25 class files via `Opcodes.ASM9`.

## Files

### Synthesized reference docs (markdown)

| File | Description |
|---|---|
| `class-tree-api.md` | Every field of ClassNode, FieldNode, MethodNode, RecordComponentNode, InnerClassNode, AnnotationNode — verbatim Javadoc + signatures. |
| `access-flags.md` | Every `ACC_*` constant with hex value + target; JVM spec §4.1-B/§4.5-A/§4.6-A/§4.7.6-A tables. |
| `classreader-classnode-usage.md` | ClassReader constructors, SKIP_* flags, canonical read idiom, JAR iteration recipe. |
| `records-and-inner-classes.md` | Record, InnerClasses, NestHost, NestMembers, PermittedSubclasses attributes + ASM exposure + canonical-ctor detection. |
| `signature-attribute.md` | Signature attribute vs erased descriptor; §4.3.2 field descriptor grammar; §4.3.3 method descriptor grammar. |

### Raw verbatim source (fetched, byte-for-byte)

| File | Source |
|---|---|
| `Opcodes.java` | `consulo/objectweb-asm` mirror — every opcode + access flag constant |
| `ClassReader.java` | `consulo/objectweb-asm` — constructors, SKIP_* constants, accept logic |
| `ClassNode.java` | `consulo/objectweb-asm/asm-tree` — full class model |
| `FieldNode.java` | `consulo/objectweb-asm/asm-tree` |
| `MethodNode.java` | `consulo/objectweb-asm/asm-tree` |
| `RecordComponentNode.java` | `consulo/objectweb-asm/asm-tree` |
| `InnerClassNode.java` | `consulo/objectweb-asm/asm-tree` |
| `AnnotationNode.java` | `consulo/objectweb-asm/asm-tree` |
| `TypeAnnotationNode.java` | `consulo/objectweb-asm/asm-tree` |
| `ModuleNode.java` | `consulo/objectweb-asm/asm-tree` |
| `ParameterNode.java` | `consulo/objectweb-asm/asm-tree` |
| `LocalVariableNode.java` | `consulo/objectweb-asm/asm-tree` |
| `TryCatchBlockNode.java` | `consulo/objectweb-asm/asm-tree` |
| `jvms-4.html` | Oracle JVM spec SE 21 §4 (1.26 MB) — the authoritative class-file spec |

## Provenance
- OW2 source mirror (the OW2 GitLab + asm.ow2.io Javadoc are Anubis-PoW-bot-blocked for automated
  fetchers; the GitHub mirror `consulo/objectweb-asm` is a recent 9.x fork with identical Javadoc
  comments and field structure, stable across ASM 9.0–9.10.1).
- Oracle JVM spec §4: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html
