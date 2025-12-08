#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger.js';
import { verifyJavaVersion } from './java/java-process.js';
import { tools, handleToolCall } from './server/tools.js';
import {
  resources,
  resourceTemplates,
  handleReadResource,
} from './server/resources.js';
import { closeDatabase } from './cache/database.js';

/**
 * Minecraft Dev MCP Server
 * Provides decompiled Minecraft source code access for LLM-assisted mod development
 */

class MinecraftDevMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
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

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing tools');
      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug('Listing resources');
      return { resources };
    });

    // List resource templates
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      logger.debug('Listing resource templates');
      return { resourceTemplates };
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      logger.info(`Reading resource: ${request.params.uri}`);

      try {
        const result = await handleReadResource(request.params.uri);
        return result;
      } catch (error) {
        logger.error(`Resource read failed: ${request.params.uri}`, error);
        throw error;
      }
    });
  }

  private setupErrorHandling(): void {
    // Handle server errors
    this.server.onerror = (error) => {
      logger.error('Server error', error);
    };

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

    // Start server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('Minecraft Dev MCP Server started');
    logger.info('Server is ready to accept requests');
  }
}

// Start the server
const server = new MinecraftDevMCPServer();
server.start().catch((error) => {
  logger.error('Failed to start server', error);
  // Don't use console.error - it breaks MCP stdio protocol
  process.exit(1);
});
