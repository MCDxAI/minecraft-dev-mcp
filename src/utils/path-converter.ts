import { getWslDistroName, isWindowsHost, isWslHost } from './platform.js';

/**
 * Path conversion utilities for WSL/Windows cross-platform support
 *
 * Handles bidirectional path translation:
 * - WSL paths (/mnt/c/...) <-> Windows paths (C:\...)
 * - Native WSL paths (/home/...) <-> UNC paths (\\wsl$\...)
 */

/**
 * Check if a path is a Windows drive path (e.g., C:\, D:/)
 */
export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Check if a path is a WSL mount path (e.g., /mnt/c/...)
 */
export function isWslMountPath(path: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(path);
}

/**
 * Check if a path is a UNC WSL path (e.g., \\wsl$\Ubuntu\...)
 */
export function isUncWslPath(path: string): boolean {
  return /^\\\\wsl\$\\/i.test(path) || /^\/\/wsl\$\//i.test(path);
}

/**
 * Convert WSL path to Windows path
 *
 * Examples:
 * - /mnt/c/Users/test -> C:\Users\test
 * - /mnt/d/project -> D:\project
 * - /home/user/project -> \\wsl$\Ubuntu\home\user\project
 */
export function convertToWindowsPath(wslPath: string): string {
  if (!wslPath) {
    return wslPath;
  }

  // If already a Windows path, normalize slashes and return
  if (isWindowsDrivePath(wslPath)) {
    return wslPath.replace(/\//g, '\\');
  }

  // If already a UNC WSL path, return as-is
  if (wslPath.startsWith('\\\\wsl$\\')) {
    return wslPath;
  }

  // Convert /mnt/c/project -> C:\project
  if (wslPath.startsWith('/mnt/')) {
    const parts = wslPath.substring(5).split('/');
    const drive = parts[0].toUpperCase();
    const pathParts = parts.slice(1);
    const suffix = pathParts.join('\\');
    return suffix ? `${drive}:\\${suffix}` : `${drive}:\\`;
  }

  // Convert native WSL path to UNC: /home/user -> \\wsl$\Ubuntu\home\user
  if (wslPath.startsWith('/')) {
    const distro = getWslDistroName();
    return `\\\\wsl$\\${distro}${wslPath.replace(/\//g, '\\')}`;
  }

  return wslPath;
}

/**
 * Convert Windows path to WSL path
 *
 * Examples:
 * - C:\Users\test -> /mnt/c/Users/test
 * - D:\project -> /mnt/d/project
 * - \\wsl$\Ubuntu\home\user -> /home/user
 */
export function convertToWslPath(windowsPath: string): string {
  if (!windowsPath) {
    return windowsPath;
  }

  const normalized = windowsPath.replace(/\\/g, '/');

  // Convert UNC WSL path: //wsl$/Ubuntu/home/user -> /home/user
  if (normalized.toLowerCase().startsWith('//wsl$/')) {
    const remainder = normalized.substring('//wsl$/'.length);
    const slashIndex = remainder.indexOf('/');
    if (slashIndex === -1) {
      return '/';
    }
    return `/${remainder.substring(slashIndex + 1)}`;
  }

  // Convert drive path: C:/Users/test -> /mnt/c/Users/test
  const driveMatch = normalized.match(/^([A-Za-z]):(\/.*)?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2] ?? '';
    if (!rest || rest === '/') {
      return `/mnt/${drive}`;
    }
    return `/mnt/${drive}${rest}`;
  }

  return normalized;
}

/**
 * Normalize a path for the current host platform
 *
 * When running on Windows: converts WSL paths to Windows paths
 * When running on WSL: converts Windows paths to WSL paths
 * On native Linux (non-WSL): returns path as-is (no conversion)
 *
 * This is the main entry point for path normalization.
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }

  const trimmed = inputPath.trim();

  // On Windows host, convert WSL-style paths to Windows paths
  if (isWindowsHost()) {
    return convertToWindowsPath(trimmed);
  }

  // On WSL host, convert Windows-style paths to WSL paths
  if (isWslHost()) {
    if (isWindowsDrivePath(trimmed) || isUncWslPath(trimmed)) {
      return convertToWslPath(trimmed);
    }
  }

  // On native Linux (non-WSL) or already correct format, return as-is
  return trimmed;
}

/**
 * Normalize an optional path (returns undefined if empty/null)
 */
export function normalizeOptionalPath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return undefined;
  }

  return normalizePath(trimmed);
}

/**
 * Validate that a path exists in a format usable on the current platform
 * Returns an error message if invalid, undefined if valid
 */
export function validatePathFormat(path: string): string | undefined {
  if (!path || !path.trim()) {
    return 'Path is required';
  }

  const trimmed = path.trim();

  // Check for obviously invalid patterns
  if (trimmed.includes('\0')) {
    return 'Path contains null character';
  }

  // On Windows, WSL paths are valid (will be converted)
  // On WSL, Windows paths are valid (will be converted)
  // So most path formats are acceptable

  return undefined;
}

/**
 * Get a user-friendly description of the path format
 * Useful for error messages and documentation
 */
export function describePathFormat(path: string): string {
  if (!path) {
    return 'empty path';
  }

  if (isWindowsDrivePath(path)) {
    return 'Windows drive path';
  }

  if (isWslMountPath(path)) {
    return 'WSL mount path';
  }

  if (isUncWslPath(path)) {
    return 'UNC WSL path';
  }

  if (path.startsWith('/')) {
    return 'Unix path';
  }

  return 'relative path';
}
