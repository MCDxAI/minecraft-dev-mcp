/**
 * Bytecode Index Service
 *
 * Provides authoritative per-class bytecode metadata for a remapped Minecraft
 * JAR, backed by the bundled ASM bytecode-dumper. This is the ground truth the
 * Access Transformer validator runs against.
 *
 * WHY BYTECODE (not decompiled `.java`): decompiled source OMITS compiler-
 * generated members — a record's canonical constructor and its component
 * accessors (`value()`, `name()`, …) never appear in VineFlower output. Parsing
 * source therefore reports those implicit members as "not found", producing
 * false positives (issue #12). The bytecode has every member with its true
 * access flags and erased descriptors — exactly what an AT is applied to at
 * load time (and exactly what `javap` shows). Validating against the JAR is the
 * single, consistent source of truth.
 *
 * CACHING: the remapped JAR (`remapped/{version}-{mapping}.jar`) is a
 * deterministic byproduct of decompilation and never changes for a given
 * (version, mapping) — so metadata derived from it is inherently fresh. We keep
 * a small, incremental, on-disk cache next to the JAR
 * (`{version}-{mapping}.bytecode.json`) that grows as classes are requested. The
 * cache stores the JAR's size+mtime signature; if the JAR is rebuilt (e.g.
 * `decompile_minecraft_version --force`) the signature changes and the cache is
 * discarded automatically. Only the handful of classes an AT actually targets
 * are ever dumped — never the whole ~15k-class JAR.
 */

import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { type BytecodeClass, getBytecodeDumper } from '../java/bytecode-dumper.js';
import type { MappingType } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { getRemappedJarPath } from '../utils/paths.js';

/** On-disk cache shape. `classes` maps an internal name → metadata, or `null` (known-absent). */
interface BytecodeCacheFile {
  /** `${size}:${mtimeMs}` of the remapped JAR the cache was built from. */
  signature: string;
  /** Internal class name (slashes, `$`) → metadata, or `null` when the JAR has no such class. */
  classes: Record<string, BytecodeClass | null>;
}

/** Compute the invalidation signature for a remapped JAR (size + mtime). */
function jarSignature(jarPath: string): string {
  const st = statSync(jarPath);
  return `${st.size}:${st.mtimeMs}`;
}

/** Path of the sidecar cache file for a remapped JAR. */
function cachePathFor(jarPath: string): string {
  return jarPath.replace(/\.jar$/i, '.bytecode.json');
}

/**
 * Resolves bytecode metadata for specific classes of a remapped Minecraft JAR,
 * with an incremental on-disk cache. Stateless between calls apart from the
 * cache file (safe for the short-lived CLI process).
 */
export class BytecodeIndexService {
  /**
   * Return bytecode metadata for the requested internal class names (slash/`$`
   * form, no `.class`). Classes absent from the JAR are simply omitted from the
   * returned map (and remembered as absent so they are not re-dumped).
   *
   * @throws if the remapped JAR does not exist — callers should check
   *   `hasRemappedJar` first and surface a "run decompile first" message.
   */
  async getClassBytecode(
    version: string,
    mapping: MappingType,
    internalNames: string[],
  ): Promise<Map<string, BytecodeClass>> {
    const jarPath = getRemappedJarPath(version, mapping);
    if (!existsSync(jarPath)) {
      throw new Error(`Remapped JAR not found: ${jarPath}`);
    }

    const signature = jarSignature(jarPath);
    const cachePath = cachePathFor(jarPath);
    let cache = this.loadCache(cachePath, signature);

    const wanted = [...new Set(internalNames)];
    // Object.hasOwn (not `n in`) so an internal name colliding with an
    // Object.prototype key (`toString`, `constructor`, …) can't be mistaken for
    // an already-cached entry and silently skipped.
    const missing = wanted.filter((n) => !Object.hasOwn(cache.classes, n));

    if (missing.length > 0) {
      const dumped = await this.dumpClasses(jarPath, missing);
      // Re-read the cache right before writing and merge into THAT: a concurrent
      // call may have dumped other classes while we awaited, and blindly saving
      // our older snapshot would drop them (lost update). Disk only grows for a
      // fixed signature, so the reload is a superset of what we started with.
      cache = this.loadCache(cachePath, signature);
      for (const name of missing) {
        // `null` = confirmed absent from the JAR, so we never re-dump it.
        cache.classes[name] = dumped.get(name) ?? null;
      }
      this.saveCache(cachePath, cache);
    }

    const result = new Map<string, BytecodeClass>();
    for (const name of wanted) {
      const entry = cache.classes[name];
      if (entry) result.set(name, entry);
    }
    return result;
  }

  /**
   * List every class's internal name in the remapped JAR via a central-directory
   * scan (no bytecode dumped). Used to build package-scoped "did you mean"
   * suggestion pools for class-not-found errors. Returns `[]` when the JAR is
   * absent — suggestions are a nicety, never a hard dependency.
   */
  listClassNames(version: string, mapping: MappingType): string[] {
    const jarPath = getRemappedJarPath(version, mapping);
    if (!existsSync(jarPath)) return [];
    const names: string[] = [];
    for (const entry of new AdmZip(jarPath).getEntries()) {
      const n = entry.entryName;
      if (n.endsWith('.class')) names.push(n.slice(0, -'.class'.length));
    }
    return names;
  }

  /** Delete the sidecar cache for a (version, mapping). Used by force-clear paths. */
  clearCache(version: string, mapping: MappingType): void {
    const cachePath = cachePathFor(getRemappedJarPath(version, mapping));
    if (existsSync(cachePath)) {
      try {
        unlinkSync(cachePath);
      } catch (error) {
        logger.debug(`Failed to clear bytecode cache ${cachePath}: ${String(error)}`);
      }
    }
  }

  /**
   * Load the sidecar cache, returning a fresh empty cache when the file is
   * missing, unparseable, or built from a different JAR (signature mismatch).
   */
  private loadCache(cachePath: string, signature: string): BytecodeCacheFile {
    if (existsSync(cachePath)) {
      try {
        const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<BytecodeCacheFile>;
        if (
          parsed &&
          parsed.signature === signature &&
          typeof parsed.classes === 'object' &&
          parsed.classes !== null
        ) {
          return { signature, classes: parsed.classes as Record<string, BytecodeClass | null> };
        }
      } catch (error) {
        logger.debug(`Ignoring corrupt bytecode cache ${cachePath}: ${String(error)}`);
      }
    }
    return { signature, classes: {} };
  }

  /** Persist the cache atomically (write-temp + rename) so a crash cannot truncate it. */
  private saveCache(cachePath: string, cache: BytecodeCacheFile): void {
    const tmp = `${cachePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(cache), 'utf8');
      renameSync(tmp, cachePath);
    } catch (error) {
      // A failed cache write is non-fatal — validation still works, just uncached.
      // Clean up the temp file if the rename never happened, so a failed write
      // doesn't leave an orphan next to the cache.
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        // best-effort
      }
      logger.debug(`Failed to persist bytecode cache ${cachePath}: ${String(error)}`);
    }
  }

  /**
   * Dump the requested classes from the remapped JAR. Extracts only their
   * `.class` entries into a tiny temporary JAR and runs the bundled dumper once
   * over it, so a 19-entry AT touches ~10 classes instead of the whole JAR.
   */
  private async dumpClasses(
    jarPath: string,
    internalNames: string[],
  ): Promise<Map<string, BytecodeClass>> {
    const source = new AdmZip(jarPath);
    const subset = new AdmZip();
    let added = 0;
    for (const name of internalNames) {
      const entry = source.getEntry(`${name}.class`);
      if (entry) {
        subset.addFile(`${name}.class`, entry.getData());
        added++;
      }
    }

    const result = new Map<string, BytecodeClass>();
    if (added === 0) {
      return result; // none of the requested classes exist in the JAR
    }

    // Random suffix in addition to pid+time: two calls in the same millisecond
    // must not collide on the temp path (one deleting the other's file mid-read).
    const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpJar = join(tmpdir(), `mdm-at-bytecode-${unique}.jar`);
    subset.writeZip(tmpJar);
    try {
      const dump = await getBytecodeDumper().dump(tmpJar);
      for (const cls of dump.classes) {
        result.set(cls.name, cls);
      }
    } finally {
      try {
        unlinkSync(tmpJar);
      } catch {
        // best-effort temp cleanup
      }
    }
    return result;
  }
}

// Singleton instance
let bytecodeIndexServiceInstance: BytecodeIndexService | undefined;

export function getBytecodeIndexService(): BytecodeIndexService {
  if (!bytecodeIndexServiceInstance) {
    bytecodeIndexServiceInstance = new BytecodeIndexService();
  }
  return bytecodeIndexServiceInstance;
}
