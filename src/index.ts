#!/usr/bin/env node

import crypto from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { closeDatabase } from './cache/database.js';
import { verifyJavaVersion } from './java/java-process.js';
import { handleReadResource, resourceTemplates, resources } from './server/resources.js';
import { handleToolCall, tools } from './server/tools.js';
import { logger } from './utils/logger.js';

/**
 * Minecraft Dev MCP Server
 * Provides decompiled Minecraft source code access for LLM-assisted mod development
 */

const DEFAULT_HTTP_PORT = 3000;
// Default to loopback so the SDK enables DNS-rebinding protection automatically.
// Bind to 0.0.0.0 only when explicitly requested via --host.
const DEFAULT_HTTP_HOST = '127.0.0.1';

interface TransportOptions {
  mode: 'stdio' | 'http';
  host: string;
  port: number;
}

/**
 * Parse transport selection from CLI args.
 * `--http` or `--port <n>` selects HTTP; otherwise stdio.
 */
function parseTransportOptions(args: string[]): TransportOptions {
  const portIndex = args.indexOf('--port');
  const hasPort = portIndex !== -1 && args[portIndex + 1] !== undefined;
  const mode = hasPort || args.includes('--http') ? 'http' : 'stdio';

  let port = DEFAULT_HTTP_PORT;
  if (hasPort) {
    const parsed = Number.parseInt(args[portIndex + 1], 10);
    if (!Number.isNaN(parsed)) {
      port = parsed;
    }
  }

  const hostIndex = args.indexOf('--host');
  const host =
    hostIndex !== -1 && args[hostIndex + 1] !== undefined ? args[hostIndex + 1] : DEFAULT_HTTP_HOST;

  return { mode, host, port };
}

/**
 * Resolve the MCP session id from the `mcp-session-id` header, falling back to
 * a `?sessionId=` query parameter for browser clients that use the native
 * EventSource API (which cannot set custom headers).
 *
 * When the id comes from the query, it is copied into the request header so the
 * SDK transport's internal session validation (which only reads the header)
 * accepts it.
 */
function resolveSessionId(req: ExpressRequest): string | undefined {
  const header = req.headers['mcp-session-id'];
  if (typeof header === 'string') {
    return header;
  }

  const query = req.query.sessionId;
  if (typeof query === 'string' && query.length > 0) {
    req.headers['mcp-session-id'] = query;
    return query;
  }

  return undefined;
}

class MinecraftDevMCPServer {
  constructor() {
    this.setupErrorHandling();
  }

  /**
   * Build a fresh MCP Server with all request handlers attached.
   * A new instance is created per stdio process and per HTTP session.
   */
  private createServer(): Server {
    const server = new Server(
      {
        name: 'minecraft-dev-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    server.onerror = (error) => {
      logger.error('Server error', error);
    };

    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing tools');
      return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      logger.info(`Tool called: ${request.params.name}`);

      try {
        const result = await handleToolCall(request.params.name, request.params.arguments);
        return result;
      } catch (error) {
        logger.error(`Tool execution failed: ${request.params.name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });

    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug('Listing resources');
      return { resources };
    });

    // List resource templates
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      logger.debug('Listing resource templates');
      return { resourceTemplates };
    });

    // Handle resource reads
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      logger.info(`Reading resource: ${request.params.uri}`);

      try {
        const result = await handleReadResource(request.params.uri);
        return result;
      } catch (error) {
        logger.error(`Resource read failed: ${request.params.uri}`, error);
        throw error;
      }
    });

    return server;
  }

  private setupErrorHandling(): void {
    // Handle process errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      this.cleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', reason);
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully');
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      this.cleanup();
      process.exit(0);
    });
  }

  private cleanup(): void {
    logger.info('Cleaning up resources');
    closeDatabase();
  }

  async start(): Promise<void> {
    // Verify Java installation
    try {
      await verifyJavaVersion(17);
    } catch (error) {
      logger.error('Java verification failed', error);
      // Don't use console.error - it breaks MCP stdio protocol
      // Error will be logged to file and server will exit
      process.exit(1);
    }

    const options = parseTransportOptions(process.argv.slice(2));

    if (options.mode === 'http') {
      await this.startHttp(options.host, options.port);
    } else {
      await this.startStdio();
    }
  }

  private async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.createServer().connect(transport);

    logger.info('Minecraft Dev MCP Server started on stdio');
    logger.info('Server is ready to accept requests');
  }

  private async startHttp(host: string, port: number): Promise<void> {
    // createMcpExpressApp wires express.json() and, for localhost hosts,
    // DNS-rebinding protection. Binding to non-localhost hosts is opt-in.
    const app = createMcpExpressApp({ host });

    // One transport per active session, keyed by the MCP session id.
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    app.post('/mcp', async (req, res) => {
      try {
        const sessionId = resolveSessionId(req);
        let transport = sessionId ? transports[sessionId] : undefined;

        if (!transport && isInitializeRequest(req.body)) {
          // New session: create a transport + server and register on init.
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              transports[id] = transport as StreamableHTTPServerTransport;
              logger.info(`HTTP session initialized: ${id}`);
            },
          });

          transport.onclose = () => {
            if (transport?.sessionId) {
              delete transports[transport.sessionId];
              logger.info(`HTTP session closed: ${transport.sessionId}`);
            }
          };

          await this.createServer().connect(transport);
        } else if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error('Error handling HTTP request', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal Server Error' },
            id: null,
          });
        }
      }
    });

    // GET (SSE stream) and DELETE (session teardown) reuse the session transport.
    const handleSessionRequest = async (req: ExpressRequest, res: ExpressResponse) => {
      const sessionId = resolveSessionId(req);
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error('Error handling HTTP session request', error);
        if (!res.headersSent) {
          res.status(500).send('Internal Server Error');
        }
      }
    };

    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    app.listen(port, host, () => {
      logger.info(`Minecraft Dev MCP Server started with HTTP transport on ${host}:${port}`);
      logger.info(`Endpoint: http://${host}:${port}/mcp`);
    });
  }
}

// Start the server
const server = new MinecraftDevMCPServer();
server.start().catch((error) => {
  logger.error('Failed to start server', error);
  // Don't use console.error - it breaks MCP stdio protocol
  process.exit(1);
});
