/**
 * Base error class for minecraft-dev-mcp
 */
export class MinecraftDevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Version not found in Mojang's version manifest
 */
export class VersionNotFoundError extends MinecraftDevError {
  constructor(
    public version: string,
    message?: string,
  ) {
    super(message || `Minecraft version ${version} not found`);
  }
}

/**
 * Download failed after retries
 */
export class DownloadError extends MinecraftDevError {
  constructor(
    public url: string,
    message?: string,
  ) {
    super(message || `Failed to download from ${url}`);
  }
}

/**
 * Decompilation process failed
 */
export class DecompilationError extends MinecraftDevError {
  constructor(
    public version: string,
    message?: string,
  ) {
    super(message || `Decompilation failed for version ${version}`);
  }
}

/**
 * Remapping process failed
 */
export class RemappingError extends MinecraftDevError {
  constructor(
    public version: string,
    public mapping: string,
    message?: string,
  ) {
    super(message || `Remapping failed for version ${version} with mapping ${mapping}`);
  }
}

/**
 * Mapping not available for this version
 */
export class MappingNotFoundError extends MinecraftDevError {
  constructor(
    public version: string,
    public mappingType: string,
    message?: string,
  ) {
    super(message || `Mapping ${mappingType} not available for version ${version}`);
  }
}

/**
 * Class not found in decompiled source
 */
export class ClassNotFoundError extends MinecraftDevError {
  constructor(
    public className: string,
    public version: string,
    message?: string,
  ) {
    super(message || `Class ${className} not found in version ${version}`);
  }
}

/**
 * Cache corruption detected
 */
export class CacheCorruptionError extends MinecraftDevError {
  constructor(
    public path: string,
    message?: string,
  ) {
    super(message || `Cache corruption detected at ${path}`);
  }
}

/**
 * Java process execution failed
 */
export class JavaProcessError extends MinecraftDevError {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr?: string,
  ) {
    super(`Java process failed with exit code ${exitCode}: ${command}\n${stderr || ''}`);
  }
}

/**
 * Security error (path traversal, etc.)
 */
export class SecurityError extends MinecraftDevError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Invalid input validation error
 */
export class ValidationError extends MinecraftDevError {
  constructor(
    public field: string,
    message?: string,
  ) {
    super(message || `Validation failed for field: ${field}`);
  }
}

/**
 * Registry extraction failed
 */
export class RegistryExtractionError extends MinecraftDevError {
  constructor(
    public version: string,
    message?: string,
  ) {
    super(message || `Registry extraction failed for version ${version}`);
  }
}
