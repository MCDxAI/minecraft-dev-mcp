import { existsSync } from 'node:fs';
import type { MappingType } from '../types/minecraft.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import {
  getDecompiledModPath,
  getDecompiledPath,
  getRemappedJarPath,
  getServerJarPath,
  paths,
} from '../utils/paths.js';
import { getDatabase } from './database.js';

export class CacheManager {
  private db = getDatabase();

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    ensureDir(paths.jars());
    ensureDir(paths.mappings());
    ensureDir(paths.remapped());
    ensureDir(paths.decompiled());
    ensureDir(paths.decompiledMods());
    ensureDir(paths.registry());
    ensureDir(paths.resources());
  }

  /**
   * Check if a version JAR is cached
   */
  hasVersionJar(version: string): boolean {
    const cached = this.db.getVersion(version);
    return cached !== undefined && existsSync(cached.jar_path);
  }

  /**
   * Get cached version JAR path
   */
  getVersionJarPath(version: string): string | undefined {
    const cached = this.db.getVersion(version);
    if (cached && existsSync(cached.jar_path)) {
      this.db.updateVersionAccess(version);
      return cached.jar_path;
    }
    return undefined;
  }

  /**
   * Cache a version JAR
   */
  cacheVersionJar(version: string, jarPath: string, sha1: string): void {
    logger.info(`Caching version ${version}`);
    this.db.setVersion({
      version,
      jar_path: jarPath,
      jar_sha1: sha1,
      created_at: Date.now(),
      last_accessed: Date.now(),
    });
  }

  /**
   * Check if server JAR is cached
   */
  hasServerJar(version: string): boolean {
    const serverPath = getServerJarPath(version);
    return existsSync(serverPath);
  }

  /**
   * Get cached server JAR path
   */
  getServerJarPath(version: string): string | undefined {
    const serverPath = getServerJarPath(version);
    if (existsSync(serverPath)) {
      return serverPath;
    }
    return undefined;
  }

  /**
   * Check if mappings are cached
   */
  hasMappings(version: string, mappingType: MappingType): boolean {
    const cached = this.db.getMapping(version, mappingType);
    return cached !== undefined && existsSync(cached.file_path);
  }

  /**
   * Get cached mapping path
   */
  getMappingPath(version: string, mappingType: MappingType): string | undefined {
    const cached = this.db.getMapping(version, mappingType);
    if (cached && existsSync(cached.file_path)) {
      return cached.file_path;
    }
    return undefined;
  }

  /**
   * Cache mappings
   */
  cacheMapping(version: string, mappingType: MappingType, filePath: string): void {
    logger.info(`Caching ${mappingType} mappings for ${version}`);
    this.db.setMapping({
      mc_version: version,
      mapping_type: mappingType,
      file_path: filePath,
      downloaded_at: Date.now(),
    });
  }

  /**
   * Check if decompiled source exists
   */
  hasDecompiledSource(version: string, mapping: MappingType): boolean {
    const path = getDecompiledPath(version, mapping);
    return existsSync(path);
  }

  /**
   * Get decompiled source path
   */
  getDecompiledSourcePath(version: string, mapping: MappingType): string {
    return getDecompiledPath(version, mapping);
  }

  /**
   * Check if remapped JAR exists
   */
  hasRemappedJar(version: string, mapping: MappingType): boolean {
    const path = getRemappedJarPath(version, mapping);
    return existsSync(path);
  }

  /**
   * Get remapped JAR path
   */
  getRemappedJarPath(version: string, mapping: MappingType): string {
    return getRemappedJarPath(version, mapping);
  }

  /**
   * List all cached versions
   */
  listCachedVersions(): string[] {
    return this.db.listVersions().map((v) => v.version);
  }

  /**
   * Create or get decompile job
   */
  getOrCreateJob(version: string, mapping: MappingType): number {
    const existing = this.db.getJob(version, mapping);
    if (existing) {
      return existing.id;
    }
    return this.db.createJob(version, mapping);
  }

  /**
   * Update decompile job progress
   */
  updateJobProgress(jobId: number, progress: number): void {
    this.db.updateJobStatus(jobId, 'running', progress);
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId: number): void {
    this.db.updateJobStatus(jobId, 'completed', 100);
  }

  /**
   * Mark job as failed
   */
  failJob(jobId: number, error: string): void {
    this.db.updateJobStatus(jobId, 'failed', undefined, error);
  }

  /**
   * Check if decompiled mod source exists
   */
  hasDecompiledModSource(modId: string, modVersion: string, mapping: MappingType): boolean {
    const path = getDecompiledModPath(modId, modVersion, mapping);
    return existsSync(path);
  }

  /**
   * Get decompiled mod source path
   */
  getDecompiledModSourcePath(modId: string, modVersion: string, mapping: MappingType): string {
    return getDecompiledModPath(modId, modVersion, mapping);
  }

  /**
   * Create or get mod decompile job
   */
  getOrCreateModJob(
    modId: string,
    modVersion: string,
    mapping: MappingType,
    jarPath: string,
  ): number {
    const existing = this.db.getModJob(modId, modVersion, mapping);
    if (existing) {
      return existing.id;
    }
    return this.db.createModJob(modId, modVersion, mapping, jarPath);
  }

  /**
   * Update mod decompile job progress
   */
  updateModJobProgress(jobId: number, progress: number): void {
    this.db.updateModJobStatus(jobId, 'running', progress);
  }

  /**
   * Mark mod job as completed
   */
  completeModJob(jobId: number): void {
    this.db.updateModJobStatus(jobId, 'completed', 100);
  }

  /**
   * Mark mod job as failed
   */
  failModJob(jobId: number, error: string): void {
    this.db.updateModJobStatus(jobId, 'failed', undefined, error);
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | undefined;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
}
