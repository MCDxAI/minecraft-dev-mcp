/**
 * Full-Text Search Index Service
 *
 * Provides fast, indexed full-text search across decompiled Minecraft source code
 * using SQLite FTS5 (Full-Text Search version 5).
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { SearchIndexError } from '../utils/errors.js';
import { getCacheDir, getDecompiledPath } from '../utils/paths.js';
import { getCacheManager } from '../cache/cache-manager.js';
import type {
  RankedSearchResult,
  MappingType,
} from '../types/minecraft.js';

/**
 * Search Index Service using SQLite FTS5
 */
export class SearchIndexService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    const cacheDir = getCacheDir();
    this.dbPath = join(cacheDir, 'search_index.db');
  }

  /**
   * Initialize the database connection
   */
  private getDb(): Database.Database {
    if (!this.db) {
      // Ensure cache directory exists
      const cacheDir = getCacheDir();
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent access
      this.db.pragma('journal_mode = WAL');

      // Create tables if they don't exist
      this.initializeTables();
    }
    return this.db;
  }

  /**
   * Initialize database tables
   */
  private initializeTables(): void {
    const db = this.db!;

    // Check if the old contentless FTS5 table exists and drop it
    // (v1 used content='' which creates a contentless table that can't be queried)
    const tableInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'"
    ).get() as { sql: string } | undefined;

    if (tableInfo && tableInfo.sql.includes("content=''")) {
      logger.info('Dropping old contentless FTS5 table for upgrade');
      db.exec('DROP TABLE IF EXISTS search_index');
      db.exec('DELETE FROM index_metadata'); // Clear metadata since index is gone
    }

    // Main content table with FTS5 - stores full content for retrieval
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        version,
        mapping,
        class_name,
        file_path,
        entry_type,
        symbol,
        context,
        line,
        tokenize='porter unicode61'
      );
    `);

    // Metadata table to track indexed versions
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_metadata (
        version TEXT NOT NULL,
        mapping TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        file_count INTEGER NOT NULL,
        PRIMARY KEY (version, mapping)
      );
    `);
  }

  /**
   * Check if a version is already indexed
   */
  isIndexed(version: string, mapping: MappingType): boolean {
    const db = this.getDb();
    const result = db.prepare(
      'SELECT 1 FROM index_metadata WHERE version = ? AND mapping = ?'
    ).get(version, mapping);
    return !!result;
  }

  /**
   * Index a decompiled Minecraft version
   */
  async indexVersion(
    version: string,
    mapping: MappingType,
    onProgress?: (current: number, total: number, className: string) => void,
  ): Promise<{ fileCount: number; duration: number }> {
    const startTime = Date.now();
    const cacheManager = getCacheManager();

    // Check if decompiled source exists
    if (!cacheManager.hasDecompiledSource(version, mapping)) {
      throw new SearchIndexError(
        version,
        mapping,
        `Source not decompiled. Run decompile_minecraft_version first.`,
      );
    }

    const decompiledPath = getDecompiledPath(version, mapping);
    logger.info(`Indexing ${version}/${mapping} from ${decompiledPath}`);

    // Clear existing index for this version/mapping
    this.clearIndex(version, mapping);

    const db = this.getDb();
    const insertStmt = db.prepare(`
      INSERT INTO search_index (version, mapping, class_name, file_path, entry_type, symbol, context, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Collect all Java files
    const files: string[] = [];
    const walkDir = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.name.endsWith('.java')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        logger.warn(`Failed to read directory ${dir}:`, error);
      }
    };

    walkDir(decompiledPath);

    // Index files in a transaction for better performance
    const insertMany = db.transaction((entries: Array<{
      className: string;
      filePath: string;
      entryType: string;
      symbol: string;
      context: string;
      line: number;
    }>) => {
      for (const entry of entries) {
        insertStmt.run(
          version,
          mapping,
          entry.className,
          entry.filePath,
          entry.entryType,
          entry.symbol,
          entry.context,
          entry.line,
        );
      }
    });

    let processedCount = 0;

    // Process files in batches
    const batchSize = 100;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, Math.min(i + batchSize, files.length));
      const entries: Array<{
        className: string;
        filePath: string;
        entryType: string;
        symbol: string;
        context: string;
        line: number;
      }> = [];

      for (const filePath of batch) {
        try {
          const relativePath = filePath.substring(decompiledPath.length + 1).replace(/\\/g, '/');
          const className = relativePath.replace(/\//g, '.').replace('.java', '');
          const source = readFileSync(filePath, 'utf8');

          // Index the class itself
          entries.push({
            className,
            filePath: relativePath,
            entryType: 'class',
            symbol: className.split('.').pop() || className,
            context: this.extractClassContext(source),
            line: 1,
          });

          // Index methods and fields
          const members = this.extractMembers(source);
          for (const member of members) {
            entries.push({
              className,
              filePath: relativePath,
              entryType: member.type,
              symbol: member.name,
              context: member.context,
              line: member.line,
            });
          }

          processedCount++;
          if (onProgress && processedCount % 50 === 0) {
            onProgress(processedCount, files.length, className);
          }
        } catch (error) {
          logger.warn(`Failed to index ${filePath}:`, error);
        }
      }

      // Insert batch
      insertMany(entries);
    }

    // Update metadata
    db.prepare(
      'INSERT OR REPLACE INTO index_metadata (version, mapping, indexed_at, file_count) VALUES (?, ?, ?, ?)'
    ).run(version, mapping, Date.now(), files.length);

    const duration = Date.now() - startTime;
    logger.info(`Indexed ${files.length} files in ${duration}ms`);

    return { fileCount: files.length, duration };
  }

  /**
   * Extract class context (first line with class declaration)
   */
  private extractClassContext(source: string): string {
    const lines = source.split('\n');
    for (const line of lines) {
      if (line.match(/(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum)\s+\w+/)) {
        return line.trim().substring(0, 300);
      }
    }
    return lines[0]?.trim().substring(0, 300) || '';
  }

  /**
   * Extract methods and fields from source
   */
  private extractMembers(source: string): Array<{
    type: 'method' | 'field';
    name: string;
    context: string;
    line: number;
  }> {
    const members: Array<{
      type: 'method' | 'field';
      name: string;
      context: string;
      line: number;
    }> = [];

    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match method declarations
      const methodMatch = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:native\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?[\w<>,\[\]]+\s+(\w+)\s*\(/);
      if (methodMatch) {
        members.push({
          type: 'method',
          name: methodMatch[1],
          context: line.trim().substring(0, 300),
          line: i + 1,
        });
        continue;
      }

      // Match field declarations
      const fieldMatch = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:volatile\s+)?[\w<>,\[\]]+\s+(\w+)\s*[;=]/);
      if (fieldMatch && !line.includes('(')) {
        members.push({
          type: 'field',
          name: fieldMatch[1],
          context: line.trim().substring(0, 300),
          line: i + 1,
        });
      }
    }

    return members;
  }

  /**
   * Clear index for a specific version/mapping
   */
  clearIndex(version: string, mapping: MappingType): void {
    const db = this.getDb();
    db.prepare('DELETE FROM search_index WHERE version = ? AND mapping = ?').run(version, mapping);
    db.prepare('DELETE FROM index_metadata WHERE version = ? AND mapping = ?').run(version, mapping);
  }

  /**
   * Search the index using FTS5 full-text search
   */
  search(
    query: string,
    version: string,
    mapping: MappingType,
    options: {
      /** Entry types to search (class, method, field) */
      types?: Array<'class' | 'method' | 'field'>;
      /** Maximum results */
      limit?: number;
      /** Search in context/content as well */
      includeContext?: boolean;
    } = {},
  ): RankedSearchResult[] {
    const { types, limit = 100, includeContext = true } = options;

    // Check if indexed
    if (!this.isIndexed(version, mapping)) {
      throw new SearchIndexError(
        version,
        mapping,
        `Version not indexed. Run index_minecraft_version first.`,
      );
    }

    const db = this.getDb();

    // Build FTS5 query
    // Escape special FTS5 characters and prepare for search
    // Remove quotes and special chars that could break FTS5 syntax
    const sanitizedQuery = query
      .replace(/['"]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .trim();

    // Build type filter
    let typeFilter = '';
    if (types && types.length > 0) {
      const typeList = types.map(t => `'${t}'`).join(',');
      typeFilter = `AND entry_type IN (${typeList})`;
    }

    // For FTS5, we use a simple prefix search with the * operator
    // The query "Entity*" will match "Entity", "EntityPlayer", etc.
    const ftsQuery = `${sanitizedQuery}*`;

    // Execute search with BM25 ranking
    const sql = `
      SELECT
        class_name,
        file_path,
        line,
        entry_type,
        symbol,
        context,
        version,
        mapping,
        bm25(search_index) as score,
        snippet(search_index, 5, '<mark>', '</mark>', '...', 32) as highlighted
      FROM search_index
      WHERE search_index MATCH ?
        AND version = ?
        AND mapping = ?
        ${typeFilter}
      ORDER BY bm25(search_index)
      LIMIT ?
    `;

    try {
      const results = db.prepare(sql).all(ftsQuery, version, mapping, limit) as Array<{
        class_name: string;
        file_path: string;
        line: number;
        entry_type: string;
        symbol: string;
        context: string;
        version: string;
        mapping: string;
        score: number;
        highlighted: string;
      }>;

      return results.map(row => ({
        className: row.class_name,
        filePath: row.file_path,
        line: row.line,
        entryType: row.entry_type as 'class' | 'method' | 'field' | 'content',
        symbol: row.symbol,
        context: row.context,
        version: row.version,
        mapping: row.mapping,
        score: Math.abs(row.score), // BM25 returns negative scores
        highlightedContext: row.highlighted,
      }));
    } catch (error) {
      // If FTS query syntax is invalid, try LIKE-based prefix search
      logger.warn(`FTS query failed, trying LIKE search: ${error}`);

      // Determine which columns to search
      const likeCondition = includeContext
        ? '(symbol LIKE ? OR context LIKE ?)'
        : 'symbol LIKE ?';

      const prefixSql = `
        SELECT
          class_name,
          file_path,
          line,
          entry_type,
          symbol,
          context,
          version,
          mapping,
          0 as score
        FROM search_index
        WHERE ${likeCondition}
          AND version = ?
          AND mapping = ?
          ${typeFilter}
        LIMIT ?
      `;

      const likePattern = `%${sanitizedQuery}%`;
      const params = includeContext
        ? [likePattern, likePattern, version, mapping, limit]
        : [likePattern, version, mapping, limit];

      const results = db.prepare(prefixSql).all(...params) as Array<{
        class_name: string;
        file_path: string;
        line: number;
        entry_type: string;
        symbol: string;
        context: string;
        version: string;
        mapping: string;
        score: number;
      }>;

      return results.map(row => ({
        className: row.class_name,
        filePath: row.file_path,
        line: row.line,
        entryType: row.entry_type as 'class' | 'method' | 'field' | 'content',
        symbol: row.symbol,
        context: row.context,
        version: row.version,
        mapping: row.mapping,
        score: 0,
      }));
    }
  }

  /**
   * Search for classes by name (fast)
   */
  searchClasses(
    query: string,
    version: string,
    mapping: MappingType,
    limit = 50,
  ): RankedSearchResult[] {
    return this.search(query, version, mapping, {
      types: ['class'],
      limit,
      includeContext: false,
    });
  }

  /**
   * Search for methods by name
   */
  searchMethods(
    query: string,
    version: string,
    mapping: MappingType,
    limit = 50,
  ): RankedSearchResult[] {
    return this.search(query, version, mapping, {
      types: ['method'],
      limit,
      includeContext: false,
    });
  }

  /**
   * Search for fields by name
   */
  searchFields(
    query: string,
    version: string,
    mapping: MappingType,
    limit = 50,
  ): RankedSearchResult[] {
    return this.search(query, version, mapping, {
      types: ['field'],
      limit,
      includeContext: false,
    });
  }

  /**
   * Full-text search across all content
   */
  searchContent(
    query: string,
    version: string,
    mapping: MappingType,
    limit = 50,
  ): RankedSearchResult[] {
    return this.search(query, version, mapping, {
      limit,
      includeContext: true,
    });
  }

  /**
   * Get index statistics
   */
  getStats(version: string, mapping: MappingType): {
    isIndexed: boolean;
    fileCount: number;
    indexedAt: Date | null;
    classCount: number;
    methodCount: number;
    fieldCount: number;
  } {
    const db = this.getDb();

    const metadata = db.prepare(
      'SELECT file_count, indexed_at FROM index_metadata WHERE version = ? AND mapping = ?'
    ).get(version, mapping) as { file_count: number; indexed_at: number } | undefined;

    if (!metadata) {
      return {
        isIndexed: false,
        fileCount: 0,
        indexedAt: null,
        classCount: 0,
        methodCount: 0,
        fieldCount: 0,
      };
    }

    const counts = db.prepare(`
      SELECT entry_type, COUNT(*) as count
      FROM search_index
      WHERE version = ? AND mapping = ?
      GROUP BY entry_type
    `).all(version, mapping) as Array<{ entry_type: string; count: number }>;

    const countMap = new Map(counts.map(c => [c.entry_type, c.count]));

    return {
      isIndexed: true,
      fileCount: metadata.file_count,
      indexedAt: new Date(metadata.indexed_at),
      classCount: countMap.get('class') || 0,
      methodCount: countMap.get('method') || 0,
      fieldCount: countMap.get('field') || 0,
    };
  }

  /**
   * List all indexed versions
   */
  listIndexedVersions(): Array<{ version: string; mapping: string; indexedAt: Date; fileCount: number }> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM index_metadata ORDER BY indexed_at DESC').all() as Array<{
      version: string;
      mapping: string;
      indexed_at: number;
      file_count: number;
    }>;

    return rows.map(row => ({
      version: row.version,
      mapping: row.mapping,
      indexedAt: new Date(row.indexed_at),
      fileCount: row.file_count,
    }));
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let searchIndexServiceInstance: SearchIndexService | undefined;

export function getSearchIndexService(): SearchIndexService {
  if (!searchIndexServiceInstance) {
    searchIndexServiceInstance = new SearchIndexService();
  }
  return searchIndexServiceInstance;
}
