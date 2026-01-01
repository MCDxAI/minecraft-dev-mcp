package dev.minecraftdev;

import net.fabricmc.mappingio.MappedElementKind;
import net.fabricmc.mappingio.MappingReader;
import net.fabricmc.mappingio.MappingWriter;
import net.fabricmc.mappingio.format.MappingFormat;
import net.fabricmc.mappingio.format.proguard.ProGuardFileReader;
import net.fabricmc.mappingio.tree.MappingTree;
import net.fabricmc.mappingio.tree.MemoryMappingTree;

import java.io.BufferedReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * CLI wrapper for mapping-io to convert ProGuard + Intermediary mappings to Tiny v2.
 * <p>
 * This tool merges Mojang's ProGuard mappings with Fabric's Intermediary mappings
 * to produce a Tiny v2 file suitable for tiny-remapper.
 * <p>
 * Usage: java -jar mapping-io-cli.jar <proguard.txt> <intermediary.tiny> <output.tiny>
 * <p>
 * Input formats:
 * - ProGuard: Mojang's official mappings (named -> obfuscated)
 * - Intermediary: Fabric's Tiny v2 mappings (official -> intermediary)
 * <p>
 * Output format:
 * - Tiny v2 with namespaces: intermediary -> named
 *   (suitable for remapping from intermediary to human-readable Mojang names)
 * <p>
 * Algorithm:
 * 1. Read ProGuard and build lookup maps: obfuscated -> named
 * 2. Read Intermediary tree (official -> intermediary)
 * 3. For each class/field/method, lookup named mapping by obfuscated name
 * 4. Write output tree with intermediary -> named namespaces
 */
public class MappingIoCli {

    // Lookup maps: obfuscated name -> named name
    // For fields/methods, key is "className;memberName;desc"
    private final Map<String, String> classMap = new HashMap<>();
    private final Map<String, String> fieldMap = new HashMap<>();
    private final Map<String, String> methodMap = new HashMap<>();

    // Reverse class map: named class -> obfuscated class (for ProGuard descriptor remapping)
    private final Map<String, String> classNamedToObf = new HashMap<>();

    // Additional map: obfuscated class -> intermediary class (for descriptor remapping)
    private final Map<String, String> classObfToIntermediary = new HashMap<>();

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.err.println("Usage: mapping-io-cli <proguard.txt> <intermediary.tiny> <output.tiny>");
            System.err.println();
            System.err.println("Merges ProGuard and Intermediary mappings to produce Tiny v2 output.");
            System.err.println("Output has namespaces: intermediary -> named");
            System.exit(1);
        }

        Path proguardPath = Path.of(args[0]);
        Path intermediaryPath = Path.of(args[1]);
        Path outputPath = Path.of(args[2]);

        if (!Files.exists(proguardPath)) {
            System.err.println("Error: ProGuard file not found: " + proguardPath);
            System.exit(1);
        }
        if (!Files.exists(intermediaryPath)) {
            System.err.println("Error: Intermediary file not found: " + intermediaryPath);
            System.exit(1);
        }

        new MappingIoCli().run(proguardPath, intermediaryPath, outputPath);
    }

    private void run(Path proguardPath, Path intermediaryPath, Path outputPath) throws Exception {
        System.out.println("Reading ProGuard mappings: " + proguardPath);
        System.out.println("Reading Intermediary mappings: " + intermediaryPath);
        System.out.println("Output: " + outputPath);

        // Step 1: Read ProGuard and build lookup maps
        System.out.println("[1/4] Building ProGuard lookup maps...");
        buildProGuardLookupMaps(proguardPath);
        System.out.println("  Classes: " + classMap.size());
        System.out.println("  Fields: " + fieldMap.size());
        System.out.println("  Methods: " + methodMap.size());

        // Step 2: Read Intermediary mappings
        System.out.println("[2/4] Reading Intermediary mappings...");
        MemoryMappingTree intermediaryTree = new MemoryMappingTree();
        MappingReader.read(intermediaryPath, intermediaryTree);
        System.out.println("  Source namespace: " + intermediaryTree.getSrcNamespace());
        System.out.println("  Destination namespaces: " + intermediaryTree.getDstNamespaces());
        System.out.println("  Classes: " + intermediaryTree.getClasses().size());

        // Verify intermediary has expected namespaces
        if (!"official".equals(intermediaryTree.getSrcNamespace())) {
            throw new IllegalStateException("Expected intermediary source namespace 'official', got: "
                + intermediaryTree.getSrcNamespace());
        }
        int intermediaryNsIdx = intermediaryTree.getDstNamespaces().indexOf("intermediary");
        if (intermediaryNsIdx < 0) {
            throw new IllegalStateException("Intermediary file missing 'intermediary' namespace");
        }

        // Build obfuscated -> intermediary class map for descriptor remapping
        for (MappingTree.ClassMapping cls : intermediaryTree.getClasses()) {
            String obfClass = cls.getSrcName();
            String intermediaryClass = cls.getDstName(intermediaryNsIdx);
            if (obfClass != null && intermediaryClass != null) {
                classObfToIntermediary.put(obfClass, intermediaryClass);
            }
        }
        System.out.println("  Obf->Intermediary class mappings: " + classObfToIntermediary.size());

        // Step 3: Build output tree with intermediary -> named
        System.out.println("[3/4] Merging mappings...");
        MemoryMappingTree outputTree = new MemoryMappingTree();
        buildOutputTree(intermediaryTree, intermediaryNsIdx, outputTree);
        System.out.println("  Output namespaces: " + outputTree.getSrcNamespace() + " -> " + outputTree.getDstNamespaces());
        System.out.println("  Classes with named mappings: " + outputTree.getClasses().size());

        // Step 4: Write output
        System.out.println("[4/4] Writing Tiny v2 output...");
        if (outputPath.getParent() != null) {
            Files.createDirectories(outputPath.getParent());
        }
        try (MappingWriter writer = MappingWriter.create(outputPath, MappingFormat.TINY_2_FILE)) {
            outputTree.accept(writer);
        }

        // Count output stats
        int fieldCount = 0;
        int methodCount = 0;
        for (MappingTree.ClassMapping cls : outputTree.getClasses()) {
            fieldCount += cls.getFields().size();
            methodCount += cls.getMethods().size();
        }

        System.out.println();
        System.out.println("Conversion complete!");
        System.out.println("  Output file: " + outputPath);
        System.out.println("  Classes: " + outputTree.getClasses().size());
        System.out.println("  Fields: " + fieldCount);
        System.out.println("  Methods: " + methodCount);
    }

    /**
     * Build lookup maps from ProGuard file.
     * ProGuard format: named_name -> obfuscated_name
     * We create maps: obfuscated_name -> named_name
     */
    private void buildProGuardLookupMaps(Path proguardPath) throws Exception {
        MemoryMappingTree proguardTree = new MemoryMappingTree();
        try (BufferedReader reader = Files.newBufferedReader(proguardPath)) {
            // Read with named as source, official as dest
            ProGuardFileReader.read(reader, "named", "official", proguardTree);
        }

        int officialNsIdx = proguardTree.getDstNamespaces().indexOf("official");
        if (officialNsIdx < 0) {
            throw new IllegalStateException("ProGuard tree missing 'official' namespace");
        }

        // First pass: build class maps (both directions)
        for (MappingTree.ClassMapping cls : proguardTree.getClasses()) {
            String namedClass = cls.getSrcName(); // source is "named"
            String obfClass = cls.getDstName(officialNsIdx); // dest is "official" (obfuscated)

            if (obfClass != null && namedClass != null) {
                classMap.put(obfClass, namedClass);
                classNamedToObf.put(namedClass, obfClass);
            }
        }

        // Second pass: build field/method maps with properly remapped descriptors
        for (MappingTree.ClassMapping cls : proguardTree.getClasses()) {
            String namedClass = cls.getSrcName();
            String obfClass = cls.getDstName(officialNsIdx);

            if (obfClass == null) continue;

            // Build field maps
            for (MappingTree.FieldMapping field : cls.getFields()) {
                String namedField = field.getSrcName();
                String obfField = field.getDstName(officialNsIdx);
                String namedDesc = field.getSrcDesc();

                if (obfField != null && namedField != null) {
                    // Remap descriptor from named class names to obfuscated class names
                    String obfDesc = remapDescriptorNamedToObf(namedDesc);

                    // Key: obfClass;obfField;obfDesc
                    String key = obfClass + ";" + obfField + ";" + (obfDesc != null ? obfDesc : "");
                    fieldMap.put(key, namedField);
                    // Also add key without desc for fallback matching
                    fieldMap.put(obfClass + ";" + obfField, namedField);
                }
            }

            // Build method maps
            for (MappingTree.MethodMapping method : cls.getMethods()) {
                String namedMethod = method.getSrcName();
                String obfMethod = method.getDstName(officialNsIdx);
                String namedDesc = method.getSrcDesc();

                if (obfMethod != null && namedMethod != null) {
                    // Remap descriptor from named class names to obfuscated class names
                    String obfDesc = remapDescriptorNamedToObf(namedDesc);

                    // Key: obfClass;obfMethod;obfDesc
                    String key = obfClass + ";" + obfMethod + ";" + (obfDesc != null ? obfDesc : "");
                    methodMap.put(key, namedMethod);
                    // Also add key without desc for fallback
                    methodMap.put(obfClass + ";" + obfMethod, namedMethod);
                }
            }
        }
    }

    /**
     * Remap class references in a descriptor from named to obfuscated.
     * E.g., "(Lnet/minecraft/world/phys/Vec3;)V" -> "(Lftm;)V"
     */
    private String remapDescriptorNamedToObf(String desc) {
        if (desc == null) return null;

        StringBuilder result = new StringBuilder();
        int i = 0;
        while (i < desc.length()) {
            char c = desc.charAt(i);
            if (c == 'L') {
                // Object type - find the semicolon
                int end = desc.indexOf(';', i);
                if (end < 0) {
                    result.append(desc.substring(i));
                    break;
                }
                String namedClassName = desc.substring(i + 1, end);
                String obfClassName = classNamedToObf.get(namedClassName);
                if (obfClassName == null) {
                    obfClassName = namedClassName; // keep as-is if not found (e.g., java/lang classes)
                }
                result.append('L').append(obfClassName).append(';');
                i = end + 1;
            } else if (c == '[') {
                // Array - just append and continue
                result.append(c);
                i++;
            } else {
                // Primitive or other
                result.append(c);
                i++;
            }
        }
        return result.toString();
    }

    /**
     * Build output tree with intermediary -> named namespaces.
     * Iterates through intermediary tree and looks up named mappings.
     */
    private void buildOutputTree(MemoryMappingTree intermediaryTree, int intermediaryNsIdx,
                                  MemoryMappingTree outputTree) throws Exception {
        // Start visiting the output tree
        if (outputTree.visitHeader()) {
            outputTree.visitNamespaces("intermediary", java.util.List.of("named"));
        }

        if (outputTree.visitContent()) {
            for (MappingTree.ClassMapping cls : intermediaryTree.getClasses()) {
                String obfClass = cls.getSrcName(); // official/obfuscated
                String intermediaryClass = cls.getDstName(intermediaryNsIdx);

                if (intermediaryClass == null) continue;

                // Look up named class
                String namedClass = classMap.get(obfClass);
                if (namedClass == null) {
                    // No named mapping, use intermediary as fallback
                    namedClass = intermediaryClass;
                }

                // Visit class
                if (outputTree.visitClass(intermediaryClass)) {
                    outputTree.visitDstName(MappedElementKind.CLASS, 0, namedClass);

                    if (outputTree.visitElementContent(MappedElementKind.CLASS)) {
                        // Visit fields
                        for (MappingTree.FieldMapping field : cls.getFields()) {
                            String obfField = field.getSrcName();
                            String intermediaryField = field.getDstName(intermediaryNsIdx);
                            String desc = field.getSrcDesc();

                            if (intermediaryField == null) continue;

                            // Look up named field
                            String namedField = null;
                            if (obfClass != null && obfField != null) {
                                // Try with desc first
                                String key = obfClass + ";" + obfField + ";" + (desc != null ? desc : "");
                                namedField = fieldMap.get(key);
                                // Fallback without desc
                                if (namedField == null) {
                                    namedField = fieldMap.get(obfClass + ";" + obfField);
                                }
                            }
                            if (namedField == null) {
                                namedField = intermediaryField; // fallback
                            }

                            // Remap the descriptor from obfuscated to named
                            String namedDesc = remapDescriptor(desc);

                            if (outputTree.visitField(intermediaryField, namedDesc)) {
                                outputTree.visitDstName(MappedElementKind.FIELD, 0, namedField);
                                outputTree.visitElementContent(MappedElementKind.FIELD);
                            }
                        }

                        // Visit methods
                        for (MappingTree.MethodMapping method : cls.getMethods()) {
                            String obfMethod = method.getSrcName();
                            String intermediaryMethod = method.getDstName(intermediaryNsIdx);
                            String desc = method.getSrcDesc();

                            if (intermediaryMethod == null) continue;

                            // Look up named method
                            String namedMethod = null;
                            if (obfClass != null && obfMethod != null) {
                                // Try with desc first
                                String key = obfClass + ";" + obfMethod + ";" + (desc != null ? desc : "");
                                namedMethod = methodMap.get(key);
                                // Fallback without desc
                                if (namedMethod == null) {
                                    namedMethod = methodMap.get(obfClass + ";" + obfMethod);
                                }
                            }
                            if (namedMethod == null) {
                                namedMethod = intermediaryMethod; // fallback
                            }

                            // Remap the descriptor from obfuscated to named
                            String namedDesc = remapDescriptor(desc);

                            if (outputTree.visitMethod(intermediaryMethod, namedDesc)) {
                                outputTree.visitDstName(MappedElementKind.METHOD, 0, namedMethod);
                                outputTree.visitElementContent(MappedElementKind.METHOD);
                            }
                        }
                    }
                }
            }
        }

        outputTree.visitEnd();
    }

    /**
     * Remap class references in a descriptor from obfuscated to intermediary.
     * Since the output has source namespace "intermediary", descriptors must use
     * intermediary class names, not named ones.
     */
    private String remapDescriptor(String desc) {
        if (desc == null) return null;

        StringBuilder result = new StringBuilder();
        int i = 0;
        while (i < desc.length()) {
            char c = desc.charAt(i);
            if (c == 'L') {
                // Object type - find the semicolon
                int end = desc.indexOf(';', i);
                if (end < 0) {
                    result.append(desc.substring(i));
                    break;
                }
                String obfClassName = desc.substring(i + 1, end);
                // Remap to INTERMEDIARY, not named!
                String intermediaryClassName = classObfToIntermediary.get(obfClassName);
                if (intermediaryClassName == null) {
                    intermediaryClassName = obfClassName; // keep as-is if not found
                }
                result.append('L').append(intermediaryClassName).append(';');
                i = end + 1;
            } else if (c == '[') {
                // Array - just append and continue
                result.append(c);
                i++;
            } else {
                // Primitive or other
                result.append(c);
                i++;
            }
        }
        return result.toString();
    }
}
