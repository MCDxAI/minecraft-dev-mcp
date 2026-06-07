import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface HttpMcpServer {
  /** Base URL of the MCP endpoint, e.g. http://127.0.0.1:3000/mcp */
  url: string;
  host: string;
  port: number;
  /** Open a new MCP client session against this server. */
  connectClient: (name: string) => Promise<{ client: Client; close: () => Promise<void> }>;
  /** Stop the server process. */
  close: () => Promise<void>;
}

function getServerCommand(): { command: string; baseArgs: string[] } {
  const projectRoot = process.cwd();
  const distEntry = join(projectRoot, 'dist', 'index.js');
  const useDist = process.env.MCP_E2E_USE_DIST === '1';

  if (useDist && existsSync(distEntry)) {
    return { command: process.execPath, baseArgs: [distEntry] };
  }

  const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const srcEntry = join(projectRoot, 'src', 'index.ts');
  return { command: process.execPath, baseArgs: [tsxCli, srcEntry] };
}

/** Grab an ephemeral free port from the OS. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spawn the MCP server in HTTP mode on a free port and wait until it accepts
 * MCP client connections.
 */
export async function startHttpMcpServer(host = '127.0.0.1'): Promise<HttpMcpServer> {
  const port = await getFreePort();
  const { command, baseArgs } = getServerCommand();

  const child: ChildProcess = spawn(
    command,
    [...baseArgs, '--http', '--port', String(port), '--host', host],
    {
      cwd: process.cwd(),
      env: { ...process.env, LOG_LEVEL: 'ERROR' },
      // Logger writes to a file; we only consume stderr for early-exit
      // diagnostics. Ignore stdout so a full pipe buffer can never block the
      // child process.
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );

  const stderrChunks: string[] = [];
  child.stderr?.on('data', (c) => stderrChunks.push(c.toString()));

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const url = `http://${host}:${port}/mcp`;

  const connectClient = async (name: string) => {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name, version: '1.0.0' });
    await client.connect(transport);
    return {
      client,
      close: async () => {
        await client.close();
      },
    };
  };

  // Wait until the server is accepting MCP connections.
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`HTTP server exited early. stderr:\n${stderrChunks.join('')}`);
    }
    try {
      const probe = await connectClient('readiness-probe');
      await probe.close();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  if (lastError) {
    child.kill('SIGKILL');
    throw new Error(
      `HTTP server did not become ready: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }\nstderr:\n${stderrChunks.join('')}`,
    );
  }

  return {
    url,
    host,
    port,
    connectClient,
    close: async () => {
      if (!exited) {
        child.kill('SIGTERM');
        // Give it a moment, then force-kill if still alive.
        await sleep(300);
        if (!exited) child.kill('SIGKILL');
      }
    },
  };
}
