import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { MappingType } from '../types/minecraft.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';

export interface CachedVersion {
  version: string;
  jar_path: string;
  jar_sha1: string;
  mappings_version?: string;
  decompiled_path?: string;
  created_at: number;
  last_accessed: number;
}

export interface CachedMapping {
  id: number;
  mc_version: string;
  mapping_type: MappingType;
  file_path: string;
  downloaded_at: number;
}

export interface DecompileJob {
  id: number;
  version: string;
  mapping: MappingType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  error_message?: string;
  started_at?: number;
  completed_at?: number;
}

export interface ModDecompileJob {
  id: number;
  mod_id: string;
  mod_version: string;
  mapping: MappingType;
  jar_path: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  error_message?: string;
  started_at?: number;
  completed_at?: number;
}

class CacheDatabase {
  private db: Database.Database;

  constructor() {
    const dbPath = paths.database();
    const dbDir = paths.cache;

    ensureDir(dbDir);

    const isNew = !existsSync(dbPath);
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Always initialize to ensure all tables exist (CREATE TABLE IF NOT EXISTS handles existing tables)
    if (isNew) {
      logger.info('Initializing new cache database');
    }
    this.initialize();
  }

  private initialize(): void {
    // Versions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS versions (
        version TEXT PRIMARY KEY,
        jar_path TEXT NOT NULL,
        jar_sha1 TEXT NOT NULL,
        mappings_version TEXT,
        decompiled_path TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      )
    `);

    // Mappings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mc_version TEXT NOT NULL,
        mapping_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        downloaded_at INTEGER NOT NULL,
        UNIQUE(mc_version, mapping_type)
      )
    `);

    // Decompile jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decompile_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        mapping TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL DEFAULT 0,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        UNIQUE(version, mapping)
      )
    `);

    // Mod decompile jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mod_decompile_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mod_id TEXT NOT NULL,
        mod_version TEXT NOT NULL,
        mapping TEXT NOT NULL,
        jar_path TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL DEFAULT 0,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        UNIQUE(mod_id, mod_version, mapping)
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mappings_version ON mappings(mc_version);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON decompile_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_mod_jobs_status ON mod_decompile_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_mod_jobs_mod_id ON mod_decompile_jobs(mod_id);
    `);

    logger.info('Cache database initialized');
  }

  // Version operations
  getVersion(version: string): CachedVersion | undefined {
    const stmt = this.db.prepare('SELECT * FROM versions WHERE version = ?');
    return stmt.get(version) as CachedVersion | undefined;
  }

  setVersion(version: CachedVersion): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO versions (version, jar_path, jar_sha1, mappings_version, decompiled_path, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      version.version,
      version.jar_path,
      version.jar_sha1,
      version.mappings_version,
      version.decompiled_path,
      version.created_at,
      version.last_accessed,
    );
  }

  updateVersionAccess(version: string): void {
    const stmt = this.db.prepare('UPDATE versions SET last_accessed = ? WHERE version = ?');
    stmt.run(Date.now(), version);
  }

  listVersions(): CachedVersion[] {
    const stmt = this.db.prepare('SELECT * FROM versions ORDER BY last_accessed DESC');
    return stmt.all() as CachedVersion[];
  }

  // Mapping operations
  getMapping(mcVersion: string, mappingType: MappingType): CachedMapping | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM mappings WHERE mc_version = ? AND mapping_type = ?',
    );
    return stmt.get(mcVersion, mappingType) as CachedMapping | undefined;
  }

  setMapping(mapping: Omit<CachedMapping, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO mappings (mc_version, mapping_type, file_path, downloaded_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(mapping.mc_version, mapping.mapping_type, mapping.file_path, mapping.downloaded_at);
  }

  // Decompile job operations
  getJob(version: string, mapping: MappingType): DecompileJob | undefined {
    const stmt = this.db.prepare('SELECT * FROM decompile_jobs WHERE version = ? AND mapping = ?');
    return stmt.get(version, mapping) as DecompileJob | undefined;
  }

  createJob(version: string, mapping: MappingType): number {
    const stmt = this.db.prepare(`
      INSERT INTO decompile_jobs (version, mapping, status, progress, started_at)
      VALUES (?, ?, 'pending', 0, ?)
    `);
    const result = stmt.run(version, mapping, Date.now());
    return result.lastInsertRowid as number;
  }

  updateJobStatus(
    id: number,
    status: DecompileJob['status'],
    progress?: number,
    errorMessage?: string,
  ): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status, id];

    if (progress !== undefined) {
      updates.push('progress = ?');
      params.splice(1, 0, progress);
    }

    if (errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.splice(1, 0, errorMessage);
    }

    if (status === 'running' && progress === 0) {
      updates.push('started_at = ?');
      params.splice(1, 0, Date.now());
    }

    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = ?');
      params.splice(1, 0, Date.now());
    }

    const stmt = this.db.prepare(`UPDATE decompile_jobs SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...params);
  }

  // Mod decompile job operations
  getModJob(modId: string, modVersion: string, mapping: MappingType): ModDecompileJob | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM mod_decompile_jobs WHERE mod_id = ? AND mod_version = ? AND mapping = ?',
    );
    return stmt.get(modId, modVersion, mapping) as ModDecompileJob | undefined;
  }

  createModJob(modId: string, modVersion: string, mapping: MappingType, jarPath: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO mod_decompile_jobs (mod_id, mod_version, mapping, jar_path, status, progress, started_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?)
    `);
    const result = stmt.run(modId, modVersion, mapping, jarPath, Date.now());
    return result.lastInsertRowid as number;
  }

  updateModJobStatus(
    id: number,
    status: ModDecompileJob['status'],
    progress?: number,
    errorMessage?: string,
  ): void {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status, id];

    if (progress !== undefined) {
      updates.push('progress = ?');
      params.splice(1, 0, progress);
    }

    if (errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.splice(1, 0, errorMessage);
    }

    if (status === 'running' && progress === 0) {
      updates.push('started_at = ?');
      params.splice(1, 0, Date.now());
    }

    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = ?');
      params.splice(1, 0, Date.now());
    }

    const stmt = this.db.prepare(
      `UPDATE mod_decompile_jobs SET ${updates.join(', ')} WHERE id = ?`,
    );
    stmt.run(...params);
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let dbInstance: CacheDatabase | undefined;

export function getDatabase(): CacheDatabase {
  if (!dbInstance) {
    dbInstance = new CacheDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = undefined;
  }
}
