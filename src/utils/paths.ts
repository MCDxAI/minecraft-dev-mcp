import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Get the platform-specific cache directory for minecraft-dev-mcp
 * Windows: %APPDATA%/minecraft-dev-mcp
 * macOS: ~/Library/Application Support/minecraft-dev-mcp
 * Linux: ~/.config/minecraft-dev-mcp
 */
export function getCacheDir(): string {
  // Allow override via environment variable
  if (process.env.CACHE_DIR) {
    return process.env.CACHE_DIR;
  }

  const os = platform();
  const home = homedir();

  switch (os) {
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'minecraft-dev-mcp');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'minecraft-dev-mcp');
    default: // linux and others
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
  return className.replace(/\./g, '/') + '.java';
}

/**
 * Convert file path to class name
 * e.g., "net/minecraft/world/entity/Entity.java" -> "net.minecraft.world.entity.Entity"
 */
export function pathToClassName(filePath: string): string {
  return filePath.replace(/\//g, '.').replace(/\.java$/, '');
}
