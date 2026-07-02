/**
 * Pure edit-distance + filesystem suggestion helpers.
 *
 * Originally inlined in `access-widener-service.ts`; extracted so the Access
 * Transformer validator (and any future member-targeting validator) reuses the
 * exact same "did you mean" logic. Nothing here performs I/O of its own beyond
 * the optional directory scan in `findSimilarClassFile`.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Classic Levenshtein edit distance between two strings. */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/** Two names are "similar" when their case-insensitive edit distance is ≤ 2. */
export function isSimilar(a: string, b: string): boolean {
  return levenshteinDistance(a.toLowerCase(), b.toLowerCase()) <= 2;
}

/** Return the first candidate within the similarity threshold, else null. */
export function findSimilarName(target: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (isSimilar(target, candidate)) return candidate;
  }
  return null;
}

/**
 * Best-effort "did you mean" lookup for a missing class within a decompiled
 * source tree. Splits the fully-qualified name into package + simple name,
 * lists the package directory, and returns the closest similar class name
 * (fully re-qualified) if one is within the edit-distance threshold.
 */
export function findSimilarClassFile(className: string, basePath: string): string | null {
  const simpleName = className.split('.').pop() || className;
  const packagePath = className
    .substring(0, className.length - simpleName.length - 1)
    .replace(/\./g, '/');
  const packageDir = join(basePath, packagePath);

  if (!existsSync(packageDir)) {
    return null;
  }

  try {
    const files = readdirSync(packageDir);
    const javaFiles = files.filter((f) => f.endsWith('.java'));

    for (const file of javaFiles) {
      const name = file.replace('.java', '');
      if (isSimilar(simpleName, name)) {
        // Slice the package prefix and append the suggestion directly. Using
        // className.replace(simpleName, name) would corrupt the result when a
        // package segment equals the simple name (e.g. `com.Block.Block`).
        const packagePrefix = className.substring(0, className.length - simpleName.length);
        return `${packagePrefix}${name}`;
      }
    }
  } catch {
    return null;
  }

  return null;
}
