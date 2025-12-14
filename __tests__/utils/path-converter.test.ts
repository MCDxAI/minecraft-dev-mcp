import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convertToWindowsPath,
  convertToWslPath,
  describePathFormat,
  isUncWslPath,
  isWindowsDrivePath,
  isWslMountPath,
  normalizeOptionalPath,
  normalizePath,
  validatePathFormat,
} from '../../src/utils/path-converter.js';
import { resetPlatformCache } from '../../src/utils/platform.js';

/**
 * Path Converter Tests
 *
 * Tests the bidirectional path translation between WSL and Windows paths.
 * Adapted from gradle-mcp-server path handling tests.
 */

describe('Path Converter', () => {
  beforeEach(() => {
    // Reset platform cache before each test
    resetPlatformCache();
  });

  afterEach(() => {
    // Restore environment after each test
    vi.unstubAllEnvs();
    resetPlatformCache();
  });

  describe('isWindowsDrivePath', () => {
    it('should detect Windows drive paths with backslashes', () => {
      expect(isWindowsDrivePath('C:\\Users\\test')).toBe(true);
      expect(isWindowsDrivePath('D:\\project\\code')).toBe(true);
      expect(isWindowsDrivePath('E:\\')).toBe(true);
    });

    it('should detect Windows drive paths with forward slashes', () => {
      expect(isWindowsDrivePath('C:/Users/test')).toBe(true);
      expect(isWindowsDrivePath('D:/project/code')).toBe(true);
    });

    it('should not detect non-Windows paths', () => {
      expect(isWindowsDrivePath('/mnt/c/Users/test')).toBe(false);
      expect(isWindowsDrivePath('/home/user/project')).toBe(false);
      expect(isWindowsDrivePath('relative/path')).toBe(false);
      expect(isWindowsDrivePath('')).toBe(false);
    });
  });

  describe('isWslMountPath', () => {
    it('should detect WSL mount paths', () => {
      expect(isWslMountPath('/mnt/c/Users/test')).toBe(true);
      expect(isWslMountPath('/mnt/d/project')).toBe(true);
      expect(isWslMountPath('/mnt/e/')).toBe(true);
      expect(isWslMountPath('/mnt/c')).toBe(true);
    });

    it('should not detect non-WSL mount paths', () => {
      expect(isWslMountPath('C:\\Users\\test')).toBe(false);
      expect(isWslMountPath('/home/user/project')).toBe(false);
      expect(isWslMountPath('/mnt')).toBe(false);
      expect(isWslMountPath('/mnt/')).toBe(false);
    });
  });

  describe('isUncWslPath', () => {
    it('should detect UNC WSL paths with backslashes', () => {
      expect(isUncWslPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true);
      expect(isUncWslPath('\\\\wsl$\\Debian\\home')).toBe(true);
    });

    it('should detect UNC WSL paths with forward slashes', () => {
      expect(isUncWslPath('//wsl$/Ubuntu/home/user')).toBe(true);
      expect(isUncWslPath('//wsl$/Debian/home')).toBe(true);
    });

    it('should not detect non-UNC paths', () => {
      expect(isUncWslPath('C:\\Users\\test')).toBe(false);
      expect(isUncWslPath('/home/user')).toBe(false);
      expect(isUncWslPath('/mnt/c/Users')).toBe(false);
    });
  });

  describe('convertToWindowsPath', () => {
    it('should convert /mnt paths to Windows paths', () => {
      expect(convertToWindowsPath('/mnt/c/Users/test')).toBe('C:\\Users\\test');
      expect(convertToWindowsPath('/mnt/d/project/code')).toBe('D:\\project\\code');
      expect(convertToWindowsPath('/mnt/e/')).toBe('E:\\');
    });

    it('should handle native WSL paths with WSL$ UNC', () => {
      // Mock WSL_DISTRO_NAME environment variable
      vi.stubEnv('WSL_DISTRO_NAME', 'TestDistro');

      const result = convertToWindowsPath('/home/user/project');
      expect(result).toBe('\\\\wsl$\\TestDistro\\home\\user\\project');
    });

    it('should default to Ubuntu distro when WSL_DISTRO_NAME not set', () => {
      vi.stubEnv('WSL_DISTRO_NAME', '');

      const result = convertToWindowsPath('/home/user/project');
      expect(result).toContain('\\\\wsl$\\Ubuntu\\');
    });

    it('should pass through Windows paths unchanged (normalized)', () => {
      expect(convertToWindowsPath('C:\\Users\\test')).toBe('C:\\Users\\test');
      expect(convertToWindowsPath('D:\\project\\code')).toBe('D:\\project\\code');
    });

    it('should normalize forward slashes to backslashes for Windows paths', () => {
      expect(convertToWindowsPath('C:/Users/test/project')).toBe('C:\\Users\\test\\project');
    });

    it('should handle empty paths', () => {
      expect(convertToWindowsPath('')).toBe('');
    });

    it('should handle root drive paths', () => {
      expect(convertToWindowsPath('/mnt/c')).toBe('C:\\');
    });
  });

  describe('convertToWslPath', () => {
    it('should convert Windows drive letters to WSL paths', () => {
      expect(convertToWslPath('C:\\Users\\test\\proj')).toBe('/mnt/c/Users/test/proj');
      expect(convertToWslPath('D:/workspace')).toBe('/mnt/d/workspace');
    });

    it('should convert UNC WSL paths back to Linux paths', () => {
      const result = convertToWslPath('\\\\wsl$\\Ubuntu-22.04\\home\\user\\repo');
      expect(result).toBe('/home/user/repo');
    });

    it('should handle drive root paths', () => {
      expect(convertToWslPath('C:\\')).toBe('/mnt/c');
      expect(convertToWslPath('C:')).toBe('/mnt/c');
    });

    it('should normalize backslashes to forward slashes', () => {
      expect(convertToWslPath('C:\\path\\to\\file')).toBe('/mnt/c/path/to/file');
    });

    it('should handle empty paths', () => {
      expect(convertToWslPath('')).toBe('');
    });
  });

  describe('normalizePath', () => {
    // Note: These tests verify the normalization logic works correctly
    // In actual execution, behavior depends on isWindowsHost() and isWslHost()

    it('should handle empty paths', () => {
      expect(normalizePath('')).toBe('');
    });

    it('should trim whitespace from paths', () => {
      const result = normalizePath('  /home/user/project  ');
      // On Windows, Unix paths get converted to Windows UNC paths
      // On Linux/WSL, they stay as Unix paths
      // Either way, whitespace should be trimmed
      expect(result).not.toMatch(/^\s/);
      expect(result).not.toMatch(/\s$/);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should preserve well-formed paths', () => {
      // On Windows, WSL paths get converted; on non-Windows they stay as-is
      const path = '/home/user/project';
      const result = normalizePath(path);
      // Result depends on platform, but should be a valid path
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('normalizeOptionalPath', () => {
    it('should return undefined for empty paths', () => {
      expect(normalizeOptionalPath('')).toBeUndefined();
      expect(normalizeOptionalPath(undefined)).toBeUndefined();
    });

    it('should return undefined for whitespace-only paths', () => {
      expect(normalizeOptionalPath('   ')).toBeUndefined();
    });

    it('should normalize valid paths', () => {
      const result = normalizeOptionalPath('/home/user/project');
      expect(result).toBeDefined();
      expect(result?.length).toBeGreaterThan(0);
    });
  });

  describe('validatePathFormat', () => {
    it('should reject empty paths', () => {
      expect(validatePathFormat('')).toBe('Path is required');
      expect(validatePathFormat('   ')).toBe('Path is required');
    });

    it('should reject paths with null characters', () => {
      expect(validatePathFormat('/path/with\0null')).toBe('Path contains null character');
    });

    it('should accept valid paths', () => {
      expect(validatePathFormat('/mnt/c/Users/test')).toBeUndefined();
      expect(validatePathFormat('C:\\Users\\test')).toBeUndefined();
      expect(validatePathFormat('/home/user')).toBeUndefined();
    });
  });

  describe('describePathFormat', () => {
    it('should describe Windows drive paths', () => {
      expect(describePathFormat('C:\\Users\\test')).toBe('Windows drive path');
      expect(describePathFormat('D:/project')).toBe('Windows drive path');
    });

    it('should describe WSL mount paths', () => {
      expect(describePathFormat('/mnt/c/Users/test')).toBe('WSL mount path');
    });

    it('should describe UNC WSL paths', () => {
      expect(describePathFormat('\\\\wsl$\\Ubuntu\\home')).toBe('UNC WSL path');
    });

    it('should describe Unix paths', () => {
      expect(describePathFormat('/home/user')).toBe('Unix path');
    });

    it('should describe relative paths', () => {
      expect(describePathFormat('relative/path')).toBe('relative path');
    });

    it('should describe empty paths', () => {
      expect(describePathFormat('')).toBe('empty path');
    });
  });
});
