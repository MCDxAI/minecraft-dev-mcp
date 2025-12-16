import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { normalizeOptionalPath } from './path-converter.js';

// Re-export path conversion utilities for convenience
export {
  convertToWindowsPath,
  convertToWslPath,
  normalizePath,
  normalizeOptionalPath,
  isWindowsDrivePath,
  isWslMountPath,
  validatePathFormat,
  describePathFormat,
} from './path-converter.js';

/**
 * Get the platform-specific cache directory for minecraft-dev-mcp
 * Windows: %APPDATA%/minecraft-dev-mcp
 * macOS: ~/Library/Application Support/minecraft-dev-mcp
 * Linux/WSL: ~/.config/minecraft-dev-mcp
 *
 * WSL2 Support:
 * - Set CACHE_DIR environment variable to use a unified cache location
 * - Example: CACHE_DIR="/mnt/c/Users/YourName/AppData/Roaming/minecraft-dev-mcp"
 * - The path will be automatically normalized for the current platform
 */
export function getCacheDir(): string {
  // Allow override via environment variable (supports both WSL and Windows paths)
  if (process.env.CACHE_DIR) {
    // Normalize the path for the current platform
    const normalized = normalizeOptionalPath(process.env.CACHE_DIR);
    if (normalized) {
      return normalized;
    }
  }

  const os = platform();
  const home = homedir();

  switch (os) {
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'minecraft-dev-mcp');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'minecraft-dev-mcp');
    default: // linux and others (including WSL)
      return join(home, '.config', 'minecraft-dev-mcp');
  }
}

/**
 * Get subdirectories within the cache
 */
export const paths = {
  cache: getCacheDir(),
  jars: () => join(getCacheDir(), 'jars'),
  mappings: () => join(getCacheDir(), 'mappings'),
  remapped: () => join(getCacheDir(), 'remapped'),
  decompiled: () => join(getCacheDir(), 'decompiled'),
  decompiledMods: () => join(getCacheDir(), 'decompiled-mods'),
  registry: () => join(getCacheDir(), 'registry'),
  resources: () => join(getCacheDir(), 'resources'),
  database: () => join(getCacheDir(), 'cache.db'),
  logFile: () => join(getCacheDir(), 'minecraft-dev-mcp.log'),
};

/**
 * Get decompiled source path for a specific version and mapping
 */
export function getDecompiledPath(version: string, mapping: string): string {
  return join(paths.decompiled(), version, mapping);
}

/**
 * Get remapped JAR path
 */
export function getRemappedJarPath(version: string, mapping: string): string {
  return join(paths.remapped(), `${version}-${mapping}.jar`);
}

/**
 * Get client JAR path
 */
export function getVersionJarPath(version: string): string {
  return join(paths.jars(), `minecraft_client.${version}.jar`);
}

/**
 * Get server JAR path
 */
export function getServerJarPath(version: string): string {
  return join(paths.jars(), `minecraft_server.${version}.jar`);
}

/**
 * Get mapping file path
 */
export function getMappingPath(version: string, mappingType: string): string {
  return join(paths.mappings(), `${mappingType}-${version}.tiny`);
}

/**
 * Get raw Mojang ProGuard mapping file path
 * This is the unprocessed .txt file from Mojang
 */
export function getMojmapRawPath(version: string): string {
  return join(paths.mappings(), `mojmap-raw-${version}.txt`);
}

/**
 * Get converted Mojmap mapping file path (Tiny v2 format)
 * This is the processed file ready for tiny-remapper
 */
export function getMojmapTinyPath(version: string): string {
  return join(paths.mappings(), `mojmap-tiny-${version}.tiny`);
}

/**
 * Get the directory for mojang2tiny conversion output
 */
export function getMojmapConversionDir(version: string): string {
  return join(paths.mappings(), 'mojmap-conversion', version);
}

/**
 * Get registry data path
 */
export function getRegistryPath(version: string): string {
  return join(paths.registry(), version);
}

/**
 * Normalize class name to file path
 * e.g., "net.minecraft.world.entity.Entity" -> "net/minecraft/world/entity/Entity.java"
 */
export function classNameToPath(className: string): string {
  return `${className.replace(/\./g, '/')}.java`;
}

/**
 * Convert file path to class name
 * e.g., "net/minecraft/world/entity/Entity.java" -> "net.minecraft.world.entity.Entity"
 */
export function pathToClassName(filePath: string): string {
  return filePath.replace(/\//g, '.').replace(/\.java$/, '');
}

/**
 * Get decompiled mod source path for a specific mod ID, version, and mapping
 */
export function getDecompiledModPath(modId: string, modVersion: string, mapping: string): string {
  return join(paths.decompiledMods(), modId, modVersion, mapping);
}
