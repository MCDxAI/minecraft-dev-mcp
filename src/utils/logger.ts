import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from './paths.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private logLevel: LogLevel;
  private logFile: string;

  constructor() {
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO');
    const cacheDir = getCacheDir();
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    this.logFile = join(cacheDir, 'minecraft-dev-mcp.log');
  }

  private parseLogLevel(level: string): LogLevel {
    const normalized = level.toUpperCase();
    return LogLevel[normalized as keyof typeof LogLevel] ?? LogLevel.INFO;
  }

  private format(level: string, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}\n`;
  }

  private log(level: LogLevel, levelName: string, message: string, meta?: unknown): void {
    if (level < this.logLevel) return;

    const formatted = this.format(levelName, message, meta);

    // Console output
    if (level >= LogLevel.WARN) {
      console.error(formatted.trim());
    } else {
      console.log(formatted.trim());
    }

    // File output
    try {
      appendFileSync(this.logFile, formatted, 'utf8');
    } catch (error) {
      // Fail silently for file writes
      console.error('Failed to write to log file:', error);
    }
  }

  debug(message: string, meta?: unknown): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log(LogLevel.INFO, 'INFO', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log(LogLevel.WARN, 'WARN', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log(LogLevel.ERROR, 'ERROR', message, meta);
  }
}

export const logger = new Logger();
