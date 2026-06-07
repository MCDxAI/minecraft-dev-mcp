import { type SpawnOptions, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Resolve how to launch the CLI. Prefers the built dist entry when present
 * (and when MCP_E2E_USE_DIST=1), otherwise falls back to running the source
 * through tsx so tests work without a prior build.
 */
function getCliCommand(): { command: string; baseArgs: string[] } {
  const projectRoot = process.cwd();
  const distEntry = join(projectRoot, 'dist', 'cli.js');
  const useDist = process.env.MCP_E2E_USE_DIST === '1';

  if (useDist && existsSync(distEntry)) {
    return { command: process.execPath, baseArgs: [distEntry] };
  }

  const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const srcEntry = join(projectRoot, 'src', 'cli.ts');
  return { command: process.execPath, baseArgs: [tsxCli, srcEntry] };
}

/**
 * Run the minecraft-dev CLI with the given args and capture its output.
 */
export function runCli(args: string[], timeoutMs = 60000): Promise<CliResult> {
  const { command, baseArgs } = getCliCommand();

  const options: SpawnOptions = {
    cwd: process.cwd(),
    env: { ...process.env, LOG_LEVEL: 'ERROR' },
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...baseArgs, ...args], options);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${timeoutMs}ms (args: ${args.join(' ')})`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
