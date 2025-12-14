import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from './logger.js';

/**
 * Ensure directory exists, create if not
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    logger.debug(`Creating directory: ${dir}`);
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Atomic file write - write to temp file, then rename
 */
export async function writeFileAtomic(filePath: string, content: string | Buffer): Promise<void> {
  const dir = dirname(filePath);
  ensureDir(dir);

  const tempPath = `${filePath}.tmp`;
  try {
    writeFileSync(tempPath, content);
    // On Windows, need to delete target first
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    // Rename is atomic
    if (existsSync(tempPath)) {
      writeFileSync(filePath, readFileSync(tempPath));
      unlinkSync(tempPath);
    }
  } catch (error) {
    // Cleanup temp file on error
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

/**
 * Safe file existence check
 */
export function fileExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}
