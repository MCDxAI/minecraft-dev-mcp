package dev.minecraftdev;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.InnerClassNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.RecordComponentNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * ASM-based bytecode metadata dumper.
 *
 * <p>Reads {@code .class} entries from a JAR (or a single {@code .class} file) and emits
 * authoritative bytecode metadata as JSON: access flags, descriptors, record components,
 * canonical constructor descriptor, inner-class relationships, nest info, and sealed
 * (permitted subclasses) info. Uses the asm-tree {@link ClassNode} object model with
 * {@code SKIP_CODE | SKIP_DEBUG | SKIP_FRAMES} for metadata-only reads.
 *
 * <p>This provides ground-truth facts (the JVM sees erased descriptors and raw flags) that
 * decompiled {@code .java} source cannot be trusted for — the basis for access-transformer
 * validation (issue #12).
 *
 * <p>Usage:
 * <pre>
 *   java -jar bytecode-dumper.jar &lt;input.jar | input.class&gt; [output.json]
 * </pre>
 *
 * <p>With one argument the JSON is written to stdout; with two arguments it is written to the
 * output file (parent directories are created). A short summary line is always written to stderr.
 *
 * <p>Dependencies: only {@code org.ow2.asm:asm} + {@code asm-tree} (locked at 9.10.1). No
 * Gson/Jackson — JSON is emitted by a small hand-rolled writer.
 */
public class BytecodeDumper {

    /** ASM read flags for a metadata-only pass: skip bytecode, debug info, and frames. */
    private static final int READ_FLAGS =
            ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES;

    /** Functional interface for writer callbacks (allows checked {@link IOException} in lambdas). */
    @FunctionalInterface
    private interface IoRunnable {
        void run() throws IOException;
    }

    /** Emits a single string value (allows checked {@link IOException} in lambdas). */
    @FunctionalInterface
    private interface StringEmitter {
        void emit(String s) throws IOException;
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1 || args.length > 2) {
            System.err.println("Usage: bytecode-dumper <input.jar | input.class> [output.json]");
            System.err.println();
            System.err.println("  1 arg : emit JSON to stdout");
            System.err.println("  2 args: write JSON to the output file (creates parent dirs)");
            System.exit(1);
        }

        Path inputPath = Path.of(args[0]);
        if (!Files.exists(inputPath)) {
            System.err.println("Error: input not found: " + inputPath);
            System.exit(1);
        }

        BytecodeDumper dumper = new BytecodeDumper();
        String json;
        int classCount;
        try {
            Result result = dumper.dump(inputPath);
            json = result.json;
            classCount = result.classCount;
        } catch (IOException e) {
            System.err.println("Error reading input: " + e.getMessage());
            System.exit(2);
            return;
        }

        // Summary to stderr (TS wrapper logs this for progress; JSON stays clean on stdout/file).
        System.err.println("BytecodeDumper: processed " + classCount + " classes from " + inputPath);

        if (args.length == 2) {
            Path outputPath = Path.of(args[1]);
            if (outputPath.getParent() != null) {
                Files.createDirectories(outputPath.getParent());
            }
            Files.writeString(outputPath, json);
        } else {
            System.out.print(json);
            System.out.println();
        }
    }

    /** Holds the produced JSON and the number of successfully parsed classes. */
    private record Result(String json, int classCount) {}

    /**
     * Read the input and produce the top-level {@code {"classes": [...]}} JSON document.
     */
    Result dump(Path inputPath) throws IOException {
        JsonWriter w = new JsonWriter();
        int[] count = new int[]{0};

        w.object(() -> {
            w.key("classes");
            w.array(() -> {
                if (isJar(inputPath)) {
                    processJar(inputPath, w, count);
                } else {
                    processClassFile(inputPath, w, count);
                }
            });
        });

        return new Result(w.build(), count[0]);
    }

    private boolean isJar(Path path) {
        String name = path.getFileName().toString().toLowerCase();
        return name.endsWith(".jar") || name.endsWith(".zip");
    }

    /** Iterate every {@code .class} entry in the JAR. Corrupt entries are skipped with a warning. */
    private void processJar(Path jarPath, JsonWriter w, int[] count) throws IOException {
        try (JarFile jar = new JarFile(jarPath.toFile())) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!entry.getName().endsWith(".class")) {
                    continue;
                }
                byte[] bytes;
                try (var in = jar.getInputStream(entry)) {
                    bytes = in.readAllBytes();
                }
                try {
                    ClassNode node = readNode(bytes);
                    writeClass(w, node);
                    count[0]++;
                } catch (Exception e) {
                    // Skip a single corrupt/unreadable class; never abort the whole JAR.
                    System.err.println("BytecodeDumper: skipping " + entry.getName() + ": " + e.getMessage());
                }
            }
        }
    }

    private void processClassFile(Path classPath, JsonWriter w, int[] count) throws IOException {
        byte[] bytes = Files.readAllBytes(classPath);
        ClassNode node = readNode(bytes);
        writeClass(w, node);
        count[0]++;
    }

    private ClassNode readNode(byte[] bytes) {
        ClassReader reader = new ClassReader(bytes);
        ClassNode node = new ClassNode(); // == new ClassNode(Opcodes.ASM9)
        reader.accept(node, READ_FLAGS);
        return node;
    }

    /** Serialize a single {@link ClassNode} to the JSON schema. */
    private void writeClass(JsonWriter w, ClassNode node) throws IOException {
        boolean isRecord = (node.access & Opcodes.ACC_RECORD) != 0;
        boolean isSealed = node.permittedSubclasses != null;

        w.object(() -> {
            w.key("name");
            w.string(node.name);
            w.key("access");
            w.number(node.access);
            w.key("flags");
            writeFlags(w, node.access, Target.CLASS);

            w.key("superName");
            w.stringOrNull(node.superName);

            w.key("interfaces");
            w.array(node.interfaces != null ? node.interfaces : List.of(), w::string);

            w.key("signature");
            w.stringOrNull(node.signature);

            w.key("isInterface");
            w.bool((node.access & Opcodes.ACC_INTERFACE) != 0);
            w.key("isEnum");
            w.bool((node.access & Opcodes.ACC_ENUM) != 0);
            w.key("isRecord");
            w.bool(isRecord);
            w.key("isAnnotation");
            w.bool((node.access & Opcodes.ACC_ANNOTATION) != 0);
            w.key("isAbstract");
            w.bool((node.access & Opcodes.ACC_ABSTRACT) != 0);
            w.key("isFinal");
            w.bool((node.access & Opcodes.ACC_FINAL) != 0);
            w.key("isSealed");
            w.bool(isSealed);

            w.key("nestHost");
            w.stringOrNull(node.nestHostClass);

            w.key("nestMembers");
            if (node.nestMembers == null) {
                w.nullValue();
            } else {
                w.array(node.nestMembers, w::string);
            }

            w.key("permittedSubclasses");
            if (node.permittedSubclasses == null) {
                w.nullValue();
            } else {
                w.array(node.permittedSubclasses, w::string);
            }

            w.key("recordComponents");
            if (node.recordComponents == null) {
                w.nullValue();
            } else {
                w.array(() -> {
                    for (RecordComponentNode rc : node.recordComponents) {
                        w.object(() -> {
                            w.key("name");
                            w.string(rc.name);
                            w.key("descriptor");
                            w.string(rc.descriptor);
                            w.key("signature");
                            w.stringOrNull(rc.signature);
                        });
                    }
                });
            }

            // Canonical constructor descriptor (records only). Pre-computes the issue-#12
            // "records must transform their canonical ctor" check.
            w.key("canonicalConstructor");
            w.stringOrNull(canonicalConstructor(node, isRecord));

            w.key("innerClasses");
            w.array(() -> {
                if (node.innerClasses != null) {
                    for (InnerClassNode ic : node.innerClasses) {
                        w.object(() -> {
                            w.key("name");
                            w.stringOrNull(ic.name);
                            w.key("outerName");
                            w.stringOrNull(ic.outerName);
                            w.key("innerName");
                            w.stringOrNull(ic.innerName);
                            w.key("access");
                            w.number(ic.access);
                            w.key("flags");
                            writeFlags(w, ic.access, Target.INNER);
                        });
                    }
                }
            });

            w.key("fields");
            w.array(() -> {
                if (node.fields != null) {
                    for (FieldNode f : node.fields) {
                        w.object(() -> {
                            w.key("name");
                            w.string(f.name);
                            w.key("access");
                            w.number(f.access);
                            w.key("flags");
                            writeFlags(w, f.access, Target.FIELD);
                            w.key("desc");
                            w.string(f.desc);
                            w.key("signature");
                            w.stringOrNull(f.signature);
                            w.key("value");
                            w.value(f.value);
                        });
                    }
                }
            });

            w.key("methods");
            w.array(() -> {
                if (node.methods != null) {
                    for (MethodNode m : node.methods) {
                        w.object(() -> {
                            w.key("name");
                            w.string(m.name);
                            w.key("access");
                            w.number(m.access);
                            w.key("flags");
                            writeFlags(w, m.access, Target.METHOD);
                            w.key("desc");
                            w.string(m.desc);
                            w.key("signature");
                            w.stringOrNull(m.signature);
                            w.key("exceptions");
                            w.array(m.exceptions != null ? m.exceptions : List.of(), w::string);
                        });
                    }
                }
            });
        });
    }

    /**
     * Compute the canonical constructor descriptor for a record: the {@code <init>} whose
     * descriptor equals the in-order concatenation of the record component descriptors.
     *
     * @return the descriptor (e.g. {@code "(II)V"}) if found, or {@code null} if the class is not
     *     a record or no matching constructor is present.
     */
    private String canonicalConstructor(ClassNode node, boolean isRecord) {
        if (!isRecord || node.recordComponents == null || node.recordComponents.isEmpty()) {
            return null;
        }
        StringBuilder desc = new StringBuilder("(");
        for (RecordComponentNode rc : node.recordComponents) {
            desc.append(rc.descriptor);
        }
        desc.append(")V");
        String target = desc.toString();
        if (node.methods != null) {
            for (MethodNode m : node.methods) {
                if ("<init>".equals(m.name) && target.equals(m.desc)) {
                    return target;
                }
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Access-flag decoding (target-aware; uses JVM spec §4 tables verbatim)
    // ------------------------------------------------------------------

    /** The kind of element whose flags are being decoded (different targets reuse bit 0x0020). */
    private enum Target {
        CLASS,
        FIELD,
        METHOD,
        INNER
    }

    /**
     * Decode the raw {@code access} int into lowercase flag names applicable to the given target.
     *
     * <p>Bit 0x0020 is {@code ACC_SUPER} for classes and {@code ACC_SYNCHRONIZED} for methods; it
     * does not apply to fields or inner-class attributes. Only flags valid for the target per the
     * JVM spec tables are emitted, in a fixed order.
     */
    private void writeFlags(JsonWriter w, int access, Target target) throws IOException {
        w.array(() -> {
            if (has(access, Opcodes.ACC_PUBLIC)) {
                w.string("public");
            }
            if (target != Target.CLASS && has(access, Opcodes.ACC_PRIVATE)) {
                w.string("private");
            }
            if (target != Target.CLASS && has(access, Opcodes.ACC_PROTECTED)) {
                w.string("protected");
            }
            if (target != Target.CLASS && has(access, Opcodes.ACC_STATIC)) {
                w.string("static");
            }
            if (has(access, Opcodes.ACC_FINAL)) {
                w.string("final");
            }
            // 0x0020: super (class) / synchronized (method). Not valid for field/inner.
            if (target == Target.CLASS && has(access, Opcodes.ACC_SUPER)) {
                w.string("super");
            }
            if (target == Target.METHOD && has(access, Opcodes.ACC_SYNCHRONIZED)) {
                w.string("synchronized");
            }
            if (target == Target.FIELD && has(access, Opcodes.ACC_VOLATILE)) {
                w.string("volatile");
            }
            if (target == Target.METHOD && has(access, Opcodes.ACC_BRIDGE)) {
                w.string("bridge");
            }
            if (target == Target.FIELD && has(access, Opcodes.ACC_TRANSIENT)) {
                w.string("transient");
            }
            if (target == Target.METHOD && has(access, Opcodes.ACC_VARARGS)) {
                w.string("varargs");
            }
            if (target == Target.METHOD && has(access, Opcodes.ACC_NATIVE)) {
                w.string("native");
            }
            if (has(access, Opcodes.ACC_INTERFACE)) {
                w.string("interface");
            }
            if (has(access, Opcodes.ACC_ABSTRACT)) {
                w.string("abstract");
            }
            if (target == Target.METHOD && has(access, Opcodes.ACC_STRICT)) {
                w.string("strict");
            }
            if (has(access, Opcodes.ACC_SYNTHETIC)) {
                w.string("synthetic");
            }
            if (has(access, Opcodes.ACC_ANNOTATION)) {
                w.string("annotation");
            }
            if (has(access, Opcodes.ACC_ENUM)) {
                w.string("enum");
            }
            if (target == Target.CLASS && has(access, Opcodes.ACC_MODULE)) {
                w.string("module");
            }
            if (target == Target.CLASS && has(access, Opcodes.ACC_RECORD)) {
                w.string("record");
            }
            // ACC_DEPRECATED (ASM-specific, 0x20000) applies to class/field/method.
            if (target != Target.INNER && has(access, Opcodes.ACC_DEPRECATED)) {
                w.string("deprecated");
            }
        });
    }

    private static boolean has(int access, int flag) {
        return (access & flag) != 0;
    }

    // ------------------------------------------------------------------
    // Minimal hand-rolled JSON writer (no external deps)
    // ------------------------------------------------------------------

    /**
     * A tiny JSON writer that emits compact, valid JSON. Tracks comma placement via a single
     * {@code needComma} flag that resets correctly across nested objects/arrays.
     */
    private static final class JsonWriter {
        private final StringBuilder sb = new StringBuilder();
        private boolean needComma = false;

        String build() {
            return sb.toString();
        }

        void object(IoRunnable body) throws IOException {
            commaIfNeeded();
            sb.append('{');
            needComma = false;
            body.run();
            sb.append('}');
            // A completed value (object/array/scalar) always requires a comma before its sibling.
            needComma = true;
        }

        void array(IoRunnable body) throws IOException {
            commaIfNeeded();
            sb.append('[');
            needComma = false;
            body.run();
            sb.append(']');
            needComma = true;
        }

        /** Emit an array of strings from a {@link List}. */
        void array(List<String> items, StringEmitter emitter) throws IOException {
            array(() -> {
                for (String item : items) {
                    emitter.emit(item);
                }
            });
        }

        void key(String name) throws IOException {
            commaIfNeeded();
            sb.append(escape(name)).append(':');
            needComma = false;
        }

        void string(String s) throws IOException {
            commaIfNeeded();
            sb.append(escape(s));
            needComma = true;
        }

        void stringOrNull(String s) throws IOException {
            if (s == null) {
                nullValue();
            } else {
                string(s);
            }
        }

        void number(long n) throws IOException {
            commaIfNeeded();
            sb.append(n);
            needComma = true;
        }

        void number(double d) throws IOException {
            commaIfNeeded();
            sb.append(d);
            needComma = true;
        }

        void bool(boolean b) throws IOException {
            commaIfNeeded();
            sb.append(b ? "true" : "false");
            needComma = true;
        }

        void nullValue() throws IOException {
            commaIfNeeded();
            sb.append("null");
            needComma = true;
        }

        /** Serialize a constant field initializer value (Integer/Float/Long/Double/String/etc.). */
        void value(Object v) throws IOException {
            if (v == null) {
                nullValue();
                return;
            }
            if (v instanceof String) {
                string((String) v);
            } else if (v instanceof Boolean) {
                bool((Boolean) v);
            } else if (v instanceof Number) {
                if (v instanceof Float || v instanceof Double) {
                    double d = ((Number) v).doubleValue();
                    // NaN/Infinity are not representable as JSON numbers; stringify them.
                    if (Double.isNaN(d) || Double.isInfinite(d)) {
                        string(v.toString());
                    } else {
                        number(d);
                    }
                } else {
                    number(((Number) v).longValue());
                }
            } else {
                // Any other ASM value type: stringify (rare for ConstantValue).
                string(v.toString());
            }
        }

        private void commaIfNeeded() {
            if (needComma) {
                sb.append(',');
            }
        }

        /** Escape a string per JSON rules: quote, backslash, and control chars (as backslash-u escapes). */
        private static String escape(String s) {
            StringBuilder out = new StringBuilder(s.length() + 2);
            out.append('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"' -> out.append("\\\"");
                    case '\\' -> out.append("\\\\");
                    case '\n' -> out.append("\\n");
                    case '\r' -> out.append("\\r");
                    case '\t' -> out.append("\\t");
                    case '\b' -> out.append("\\b");
                    case '\f' -> out.append("\\f");
                    default -> {
                        if (c < 0x20) {
                            out.append(String.format("\\u%04x", (int) c));
                        } else {
                            out.append(c);
                        }
                    }
                }
            }
            out.append('"');
            return out.toString();
        }
    }
}
