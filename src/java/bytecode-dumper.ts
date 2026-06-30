import { readFile } from 'node:fs/promises';
import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { BytecodeDumpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizePath } from '../utils/path-converter.js';
import { type JavaProcessResult, executeJavaProcess } from './java-process.js';

/**
 * A record component (from the JVM {@code Record} attribute).
 *
 * `descriptor` is the erased JVM field descriptor (e.g. {@code "I"}, {@code "Ljava/lang/String;"}).
 * `signature` is the generic signature, or {@code null}.
 */
export interface BytecodeRecordComponent {
  name: string;
  descriptor: string;
  signature: string | null;
}

/**
 * An inner-class relationship (from the {@code InnerClasses} attribute).
 *
 * {@code outerName}/{@code innerName} may be {@code null} (e.g. for anonymous/local classes).
 */
export interface BytecodeInnerClass {
  name: string | null;
  outerName: string | null;
  innerName: string | null;
  access: number;
  flags: string[];
}

/** A field, with its raw access bits, decoded flag names, and erased descriptor. */
export interface BytecodeField {
  name: string;
  access: number;
  flags: string[];
  desc: string;
  signature: string | null;
  /** Constant initializer value ({@code ConstantValue}), or {@code null}. */
  value: number | string | boolean | null;
}

/** A method (no instructions — the dumper runs with SKIP_CODE). */
export interface BytecodeMethod {
  name: string;
  access: number;
  flags: string[];
  desc: string;
  signature: string | null;
  /** Internal names of declared thrown exceptions ({@code throws} clause). */
  exceptions: string[];
}

/**
 * Authoritative bytecode metadata for a single class.
 *
 * Mirrors the JSON emitted by {@code tools/bytecode-dumper} exactly. All names are in internal
 * form (slashes). {@code isSealed} is derived from {@code permittedSubclasses !== null} (there is
 * no {@code ACC_SEALED} flag). {@code canonicalConstructor} is pre-computed for records.
 */
export interface BytecodeClass {
  name: string;
  access: number;
  flags: string[];
  superName: string | null;
  interfaces: string[];
  signature: string | null;
  isInterface: boolean;
  isEnum: boolean;
  isRecord: boolean;
  isAnnotation: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  isSealed: boolean;
  nestHost: string | null;
  nestMembers: string[] | null;
  permittedSubclasses: string[] | null;
  recordComponents: BytecodeRecordComponent[] | null;
  /** Records only: the canonical {@code <init>} descriptor (e.g. {@code "(II)V"}), else null. */
  canonicalConstructor: string | null;
  innerClasses: BytecodeInnerClass[];
  fields: BytecodeField[];
  methods: BytecodeMethod[];
}

/** Top-level dumper output: always an array of classes, even for single-class input. */
export interface BytecodeDump {
  classes: BytecodeClass[];
}

/**
 * Minimal runtime guard for {@link BytecodeDump}.
 *
 * The Java tool's stdout/file output is `JSON.parse`d into an unknown shape. We
 * validate it before casting so a version skew or unexpected error object
 * surfaces a clear {@link BytecodeDumpError} instead of a downstream crash on
 * `result.classes.forEach` (or similar NPEs).
 */
function isBytecodeDump(value: unknown): value is BytecodeDump {
  return (
    typeof value === 'object' &&
    value !== null &&
    'classes' in value &&
    Array.isArray((value as { classes: unknown }).classes)
  );
}

export interface BytecodeDumpOptions {
  /**
   * Optional output file. When provided, the Java tool writes JSON to this path (cleaner for
   * large JARs) and the wrapper reads it back. When omitted, JSON is parsed from stdout.
   */
  outputPath?: string;
  /** Optional progress callback (receives stderr lines, e.g. summary + skip warnings). */
  onProgress?: (message: string) => void;
}

/**
 * Wrapper for the bundled ASM bytecode-dumper JAR.
 *
 * Provides authoritative bytecode facts (raw access flags, erased descriptors, record components,
 * canonical constructor, inner-class relationships) — ground truth that decompiled {@code .java}
 * cannot be relied on for. Powers future access-transformer validation (issue #12).
 */
export class BytecodeDumperWrapper {
  private jarPath: string | null = null;

  /**
   * Resolve the bundled bytecode-dumper JAR (synchronous — it is source-built, not downloaded).
   * Throws with build instructions if the JAR has not been built.
   */
  private ensureJar(): string {
    if (!this.jarPath) {
      this.jarPath = getJavaResourceDownloader().getBytecodeDumperJar();
    }
    return this.jarPath;
  }

  /**
   * Dump bytecode metadata for a JAR or single {@code .class} file.
   *
   * @param jarOrClassPath Path to a {@code .jar} (all {@code .class} entries are processed) or a
   *   single {@code .class} file.
   * @param options Optional {@code outputPath} (file mode) and {@code onProgress} callback.
   * @returns The parsed {@link BytecodeDump}.
   * @throws {BytecodeDumpError} if the Java process fails or the output is not valid JSON.
   */
  async dump(jarOrClassPath: string, options: BytecodeDumpOptions = {}): Promise<BytecodeDump> {
    const jarPath = this.ensureJar();
    const { outputPath, onProgress } = options;

    // Normalize the output path up front so the Java process and the read-back use the same path.
    const normalizedOutput = outputPath ? normalizePath(outputPath) : undefined;
    const args: string[] = normalizedOutput ? [jarOrClassPath, normalizedOutput] : [jarOrClassPath];

    logger.info(
      `Bytecode dump: ${jarOrClassPath}${normalizedOutput ? ` -> ${normalizedOutput}` : ' (stdout)'}`,
    );

    let result: JavaProcessResult;
    try {
      result = await executeJavaProcess(jarPath, args, {
        maxMemory: '1G',
        minMemory: '128M',
        timeout: 5 * 60 * 1000, // 5 minutes
        onStderr: (data) => {
          const line = data.trim();
          if (line) {
            logger.debug(`BytecodeDumper: ${line}`);
            onProgress?.(line);
          }
        },
      });
    } catch (error) {
      throw new BytecodeDumpError(
        jarOrClassPath,
        `BytecodeDumper failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    let jsonText: string;
    let parsed: unknown;
    try {
      if (normalizedOutput) {
        jsonText = await readFile(normalizedOutput, 'utf8');
      } else {
        jsonText = result.stdout;
      }
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new BytecodeDumpError(
        jarOrClassPath,
        `BytecodeDumper produced unparseable output: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Validate the parsed shape before returning: a version skew or an error
    // object emitted by the Java tool would otherwise NPE downstream. Surface the
    // stderr tail (same channel executeJavaProcess exposes) for diagnostics.
    if (!isBytecodeDump(parsed)) {
      const stderrTail = (result.stderr || '').slice(-500);
      throw new BytecodeDumpError(
        jarOrClassPath,
        `BytecodeDumper produced unexpected JSON (expected { classes: [...] }); stderr tail: ${stderrTail}`,
      );
    }
    return parsed;
  }
}

// Singleton instance
let bytecodeDumperInstance: BytecodeDumperWrapper | undefined;

export function getBytecodeDumper(): BytecodeDumperWrapper {
  if (!bytecodeDumperInstance) {
    bytecodeDumperInstance = new BytecodeDumperWrapper();
  }
  return bytecodeDumperInstance;
}
