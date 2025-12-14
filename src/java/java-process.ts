import { spawn } from 'node:child_process';
import { JavaProcessError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizeOptionalPath, normalizePath } from '../utils/path-converter.js';

export interface JavaProcessOptions {
  maxMemory?: string; // e.g., "2G"
  minMemory?: string; // e.g., "512M"
  timeout?: number; // milliseconds
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onProgress?: (current: number, total: number) => void;
  mainClass?: string; // If provided, use -cp instead of -jar
  jvmArgs?: string[]; // Additional JVM arguments (e.g., ['-DbundlerMainClass=net.minecraft.data.Main'])
  cwd?: string; // Working directory for the Java process (supports WSL and Windows paths)
}

export interface JavaProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a Java process with monitoring
 *
 * WSL2/Windows Support:
 * - jarPath and args containing file paths are automatically normalized for the current platform
 * - Supports both Windows (C:\...) and WSL (/mnt/c/...) path formats
 */
export async function executeJavaProcess(
  jarPath: string,
  args: string[],
  options: JavaProcessOptions = {},
): Promise<JavaProcessResult> {
  const {
    maxMemory = '2G',
    minMemory = '512M',
    timeout = 10 * 60 * 1000, // 10 minutes default
    onStdout,
    onStderr,
    mainClass,
    jvmArgs = [],
    cwd,
  } = options;

  // Normalize paths for cross-platform support (WSL/Windows)
  const normalizedJarPath = normalizePath(jarPath);
  const normalizedCwd = normalizeOptionalPath(cwd);

  // Normalize file path arguments (paths that look like absolute paths)
  const normalizedArgs = args.map((arg) => {
    // Normalize arguments that look like absolute file paths
    if (arg.startsWith('/') || arg.startsWith('\\') || /^[A-Za-z]:/.test(arg)) {
      return normalizePath(arg);
    }
    return arg;
  });

  // Build JVM arguments
  const baseJvmArgs = [`-Xmx${maxMemory}`, `-Xms${minMemory}`, ...jvmArgs];

  // Build full command based on whether we're using -cp or -jar
  let javaArgs: string[];
  if (mainClass) {
    // Use -cp with explicit main class (legacy format)
    javaArgs = [...baseJvmArgs, '-cp', normalizedJarPath, mainClass, ...normalizedArgs];
  } else {
    // Use -jar (standard format)
    javaArgs = [...baseJvmArgs, '-jar', normalizedJarPath, ...normalizedArgs];
  }

  logger.info(`Executing Java: java ${javaArgs.join(' ')}`);

  return new Promise((resolve, reject) => {
    const spawnOptions: { stdio: ['ignore', 'pipe', 'pipe']; cwd?: string } = {
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    // Add working directory if provided
    if (normalizedCwd) {
      spawnOptions.cwd = normalizedCwd;
    }

    const process = spawn('java', javaArgs, spawnOptions);

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        logger.warn('Java process timeout - killing');
        process.kill('SIGKILL');
        reject(new Error(`Java process timeout after ${timeout}ms`));
      }, timeout);
    }

    process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;

      if (onStdout) {
        onStdout(text);
      }

      logger.debug(`[Java stdout] ${text.trim()}`);
    });

    process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;

      if (onStderr) {
        onStderr(text);
      }

      logger.debug(`[Java stderr] ${text.trim()}`);
    });

    process.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      logger.error('Java process error', error);
      reject(error);
    });

    process.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      const exitCode = code ?? -1;
      logger.info(`Java process exited with code ${exitCode}`);

      if (exitCode !== 0) {
        reject(new JavaProcessError(`java -jar ${jarPath} ${args.join(' ')}`, exitCode, stderr));
      } else {
        resolve({ exitCode, stdout, stderr });
      }
    });
  });
}

/**
 * Check if Java is available and get version
 */
export async function getJavaVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('java', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';

    process.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Java not found or not working'));
        return;
      }

      // Parse version from output (e.g., "java version "17.0.1"" or "openjdk version "21"")
      const match = output.match(/version "([^"]+)"/);
      if (match) {
        resolve(match[1]);
      } else {
        reject(new Error('Could not parse Java version'));
      }
    });

    process.on('error', () => {
      reject(new Error('Java not found - please install Java 17 or higher'));
    });
  });
}

/**
 * Verify Java version meets minimum requirements
 */
export async function verifyJavaVersion(minimumMajor = 17): Promise<void> {
  const version = await getJavaVersion();
  logger.info(`Java version: ${version}`);

  // Extract major version (handles both "17.0.1" and "1.8.0" formats)
  let major: number;
  const parts = version.split('.');

  if (parts[0] === '1') {
    // Old format: 1.8.0
    major = Number.parseInt(parts[1], 10);
  } else {
    // New format: 17.0.1
    major = Number.parseInt(parts[0], 10);
  }

  if (major < minimumMajor) {
    throw new Error(
      `Java ${minimumMajor}+ required, but found version ${version} (major: ${major})`,
    );
  }

  logger.info(`Java version ${version} meets minimum requirement (${minimumMajor}+)`);
}
