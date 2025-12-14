import { platform, release } from 'node:os';

/**
 * Platform detection utilities for WSL/Windows cross-platform support
 */

/**
 * Cached platform detection results
 */
let _isWslHost: boolean | null = null;
let _isWindowsHost: boolean | null = null;
let _windowsShellPath: string | null = null;

/**
 * Get the current Node.js platform
 */
export function getHostPlatform(): NodeJS.Platform {
  return platform();
}

/**
 * Check if running on native Windows
 */
export function isWindowsHost(): boolean {
  if (_isWindowsHost === null) {
    _isWindowsHost = platform() === 'win32';
  }
  return _isWindowsHost;
}

/**
 * Detect whether we're running inside WSL (Linux kernel, Windows userland)
 * Checks for WSL_DISTRO_NAME environment variable and kernel release string
 */
export function isWslHost(): boolean {
  if (_isWslHost === null) {
    const hostPlatform = platform();

    if (hostPlatform !== 'linux') {
      _isWslHost = false;
    } else if (process.env.WSL_DISTRO_NAME) {
      _isWslHost = true;
    } else {
      try {
        _isWslHost = release().toLowerCase().includes('microsoft');
      } catch {
        _isWslHost = false;
      }
    }
  }
  return _isWslHost;
}

/**
 * Get the WSL distribution name
 * Defaults to 'Ubuntu' if not set
 */
export function getWslDistroName(): string {
  return process.env.WSL_DISTRO_NAME || 'Ubuntu';
}

/**
 * Resolve the Windows command shell path
 * Falls back to C:\Windows\System32\cmd.exe if COMSPEC isn't set
 */
export function getWindowsShellPath(): string {
  if (_windowsShellPath === null) {
    const comSpec = process.env.ComSpec || process.env.COMSPEC;
    if (comSpec) {
      _windowsShellPath = comSpec;
    } else {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      _windowsShellPath = `${systemRoot}\\System32\\cmd.exe`;
    }
  }
  return _windowsShellPath;
}

/**
 * Check if we're in a cross-platform environment (WSL accessing Windows or vice versa)
 */
export function isCrossPlatformEnvironment(): boolean {
  return isWslHost();
}

/**
 * Reset cached values (useful for testing)
 */
export function resetPlatformCache(): void {
  _isWslHost = null;
  _isWindowsHost = null;
  _windowsShellPath = null;
}
