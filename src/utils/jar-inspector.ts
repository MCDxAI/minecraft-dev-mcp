import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { ensureDir } from './file-utils.js';
import { logger } from './logger.js';

/**
 * Type of content in a JAR's central directory.
 *
 * Determined by deterministic scan:
 *   any .class entry  -> 'compiled' (decompile via VineFlower)
 *   else any .java    -> 'sources'  (extract directly)
 *   else              -> 'empty'    (caller should error)
 */
export type JarContentType = 'compiled' | 'sources' | 'empty';

export interface JarInspection {
  type: JarContentType;
  classCount: number;
  javaCount: number;
}

/**
 * Inspect a JAR by reading its central directory only (no decompression).
 * Decision rule:
 *   any .class -> 'compiled'  (covers mixed JARs too — they need decompile)
 *   else any .java -> 'sources'
 *   else -> 'empty'
 */
export function inspectJar(jarPath: string): JarInspection {
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries();

  let classCount = 0;
  let javaCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (name.endsWith('.class')) {
      classCount++;
    } else if (name.endsWith('.java')) {
      javaCount++;
    }
  }

  let type: JarContentType;
  if (classCount > 0) {
    type = 'compiled';
  } else if (javaCount > 0) {
    type = 'sources';
  } else {
    type = 'empty';
  }

  return { type, classCount, javaCount };
}

/**
 * Extract all .java entries from a sources JAR into outputDir, preserving
 * package paths. Skips META-INF and any non-.java files.
 *
 * Returns the number of .java files written.
 */
export function extractSourcesJar(jarPath: string, outputDir: string): number {
  ensureDir(outputDir);
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries();

  let written = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (!name.endsWith('.java')) continue;
    if (name.startsWith('META-INF/')) continue;

    const targetPath = join(outputDir, name);
    ensureDir(dirname(targetPath));
    writeFileSync(targetPath, entry.getData());
    written++;
  }

  logger.info(`Extracted ${written} .java files from ${jarPath} to ${outputDir}`);
  return written;
}
