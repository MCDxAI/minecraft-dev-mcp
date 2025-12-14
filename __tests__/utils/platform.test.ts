import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHostPlatform,
  getWindowsShellPath,
  getWslDistroName,
  isCrossPlatformEnvironment,
  isWindowsHost,
  isWslHost,
  resetPlatformCache,
} from '../../src/utils/platform.js';

/**
 * Platform Detection Tests
 *
 * Tests the platform detection utilities for WSL/Windows cross-platform support.
 * Adapted from gradle-mcp-server platform detection tests.
 */

describe('Platform Detection', () => {
  beforeEach(() => {
    // Reset cached values before each test
    resetPlatformCache();
  });

  afterEach(() => {
    // Restore environment after each test
    vi.unstubAllEnvs();
    resetPlatformCache();
  });

  describe('getHostPlatform', () => {
    it('should return a valid platform string', () => {
      const platform = getHostPlatform();
      expect(typeof platform).toBe('string');
      expect(['win32', 'linux', 'darwin', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(
        platform,
      );
    });
  });

  describe('isWindowsHost', () => {
    it('should return a boolean', () => {
      const result = isWindowsHost();
      expect(typeof result).toBe('boolean');
    });

    it('should return consistent values on repeated calls', () => {
      const first = isWindowsHost();
      const second = isWindowsHost();
      expect(first).toBe(second);
    });
  });

  describe('isWslHost', () => {
    it('should return a boolean', () => {
      const result = isWslHost();
      expect(typeof result).toBe('boolean');
    });

    it('should return consistent values on repeated calls', () => {
      const first = isWslHost();
      const second = isWslHost();
      expect(first).toBe(second);
    });

    it('should detect WSL when WSL_DISTRO_NAME is set', () => {
      // This test only works on Linux
      if (getHostPlatform() !== 'linux') {
        return;
      }

      resetPlatformCache();
      vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu');

      // Re-check - if we're on Linux with WSL_DISTRO_NAME, it should detect WSL
      const result = isWslHost();
      expect(result).toBe(true);
    });
  });

  describe('getWslDistroName', () => {
    it('should return WSL_DISTRO_NAME when set', () => {
      vi.stubEnv('WSL_DISTRO_NAME', 'TestDistro');
      expect(getWslDistroName()).toBe('TestDistro');
    });

    it('should default to Ubuntu when not set', () => {
      vi.stubEnv('WSL_DISTRO_NAME', '');
      expect(getWslDistroName()).toBe('Ubuntu');
    });
  });

  describe('getWindowsShellPath', () => {
    it('should return a non-empty string', () => {
      const shellPath = getWindowsShellPath();
      expect(typeof shellPath).toBe('string');
      expect(shellPath.length).toBeGreaterThan(0);
    });

    it('should use ComSpec when available', () => {
      vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe');
      resetPlatformCache();

      const result = getWindowsShellPath();
      expect(result).toBe('C:\\Windows\\System32\\cmd.exe');
    });

    it('should use COMSPEC (uppercase) when ComSpec not available', () => {
      vi.stubEnv('ComSpec', '');
      vi.stubEnv('COMSPEC', 'D:\\Windows\\System32\\cmd.exe');
      resetPlatformCache();

      const result = getWindowsShellPath();
      expect(result).toBe('D:\\Windows\\System32\\cmd.exe');
    });

    it('should fall back to default path when neither COMSPEC is set', () => {
      vi.stubEnv('ComSpec', '');
      vi.stubEnv('COMSPEC', '');
      vi.stubEnv('SystemRoot', 'C:\\Windows');
      resetPlatformCache();

      const result = getWindowsShellPath();
      expect(result).toContain('cmd.exe');
    });
  });

  describe('isCrossPlatformEnvironment', () => {
    it('should return a boolean', () => {
      const result = isCrossPlatformEnvironment();
      expect(typeof result).toBe('boolean');
    });

    it('should match isWslHost for cross-platform detection', () => {
      // Currently, cross-platform is only detected for WSL
      const crossPlatform = isCrossPlatformEnvironment();
      const wsl = isWslHost();
      expect(crossPlatform).toBe(wsl);
    });
  });

  describe('resetPlatformCache', () => {
    it('should allow re-detection of platform after reset', () => {
      // Get initial values
      const first = isWindowsHost();

      // Reset cache
      resetPlatformCache();

      // Should still return consistent values for same platform
      const second = isWindowsHost();
      expect(first).toBe(second);
    });
  });
});
