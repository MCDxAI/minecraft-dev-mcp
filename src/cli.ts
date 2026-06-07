#!/usr/bin/env node

/**
 * Minecraft Dev CLI
 * Command-line interface for invoking MCP tools directly without the MCP protocol.
 * Designed for use in scripts, skills, and automation.
 *
 * Arguments are flags-only (`--key value` or `--key=value`) to avoid the JSON
 * quoting pain that positional JSON arguments cause in PowerShell and other shells.
 */

import { fileURLToPath } from 'node:url';
import { verifyJavaVersion } from './java/java-process.js';
import { handleToolCall, tools } from './server/tools.js';
import { logger } from './utils/logger.js';

// CLI output helper - always emits to stdout, never breaks structured output
function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function outputError(message: string): never {
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
}

/**
 * Coerce a flag value based on the parameter's JSON-schema type.
 *
 * Coercion is schema-driven (not value-guessing) so that string fields keep
 * their literal text: `--version 1.20` stays "1.20" rather than becoming the
 * number 1.2, and `--query 42` stays "42". Only number/boolean/array/object
 * fields are converted.
 */
export function coerceFlagValue(value: string, expectedType?: string): unknown {
  switch (expectedType) {
    case 'number':
    case 'integer': {
      const num = Number(value);
      return Number.isNaN(num) ? value : num;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'array':
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      // string or unknown type -> keep the raw string
      return value;
  }
}

// Print help text
function printHelp(): void {
  const helpText = `
Minecraft Dev CLI - Command-line interface for Minecraft mod development tools

USAGE:
  minecraft-dev-cli <command> [--key value ...]

COMMANDS:
  list-tools           List all available tools with their parameters
  help                 Show this help message
  <tool-name>          Invoke a tool with flags

EXAMPLES:
  # List all available tools
  minecraft-dev-cli list-tools

  # Get Minecraft source for a class
  minecraft-dev-cli get_minecraft_source --version 1.21.10 --className net.minecraft.world.entity.Entity --mapping yarn

  # List available Minecraft versions
  minecraft-dev-cli list_minecraft_versions

  # Analyze a mod JAR
  minecraft-dev-cli analyze_mod_jar --jarPath /path/to/mod.jar

  # Search Minecraft code
  minecraft-dev-cli search_minecraft_code --version 1.21.10 --query Entity --searchType class --mapping yarn

AVAILABLE TOOLS:
${tools.map((t) => `  ${t.name.padEnd(35)} ${t.description.split('.')[0]}`).join('\n')}

For full parameter details on every tool, run: minecraft-dev-cli list-tools

ENVIRONMENT VARIABLES:
  CACHE_DIR   Override the default cache directory location
  LOG_LEVEL   Logging verbosity: DEBUG, INFO, WARN, ERROR

SKILL INTEGRATION:
  This CLI is designed to be called from skills and scripts:
  - Output is always valid JSON
  - Exit code 0 for success, 1 for error
  - Tool results are in the "result" field of the response
`.trim();

  console.log(helpText);
}

// List all tools with their schemas
function listTools(): void {
  const toolList = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  output({
    tools: toolList,
    total: tools.length,
  });
}

export interface ParsedArgs {
  tool: string;
  params: Record<string, unknown>;
}

/**
 * Parse arguments - flags only: tool-name --key value --key2 value2 (or --key=value).
 * A bare trailing flag (no following value) is treated as `true`.
 */
export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) {
    outputError('No command specified. Run "minecraft-dev-cli help" for usage.');
  }

  const command = args[0];

  // Find the tool
  const tool = tools.find((t) => t.name === command);
  if (!tool) {
    outputError(
      `Unknown tool: ${command}\nRun "minecraft-dev-cli list-tools" to see available tools.`,
    );
  }

  const properties = (
    tool.inputSchema as unknown as {
      properties?: Record<string, { type?: string } | undefined>;
    }
  ).properties;

  // Parse parameters
  const params: Record<string, unknown> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      outputError(`Unexpected positional argument: ${arg}\nUse --key value or --key=value flags.`);
    }

    let key: string;
    let value: string | undefined;

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 2) {
      key = arg.slice(2, eqIndex);
      value = arg.slice(eqIndex + 1);
    } else {
      key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        value = nextArg;
        i++;
      }
    }

    if (!key) {
      outputError(`Invalid flag: ${arg}\nUse --key value or --key=value flags.`);
    }

    if (value === undefined) {
      // Bare flag (no value) -> boolean true
      params[key] = true;
    } else {
      params[key] = coerceFlagValue(value, properties?.[key]?.type);
    }
  }

  return { tool: tool.name, params };
}

// Invoke a tool and format output
async function invokeTool(toolName: string, params: Record<string, unknown>): Promise<void> {
  // Most tools shell out to Java; verify it here rather than for help/list-tools.
  try {
    await verifyJavaVersion(17);
  } catch (error) {
    outputError(
      `Java 17+ is required but not found: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  try {
    logger.info(`Invoking tool: ${toolName} with params: ${JSON.stringify(params)}`);

    const result = await handleToolCall(toolName, params);

    if (result.isError) {
      const errorText =
        result.content?.[0]?.type === 'text' ? result.content[0].text : 'Unknown error';

      output({ success: false, tool: toolName, error: errorText });
      process.exit(1);
    }

    // Unwrap and parse the text content if it is JSON
    let parsedResult: unknown = result;
    if (result.content?.[0]?.type === 'text') {
      try {
        parsedResult = JSON.parse(result.content[0].text);
      } catch {
        parsedResult = result.content[0].text;
      }
    }

    output({ success: true, tool: toolName, result: parsedResult });
  } catch (error) {
    logger.error(`Tool invocation failed: ${toolName}`, error);
    output({
      success: false,
      tool: toolName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === 'list-tools') {
    listTools();
    process.exit(0);
  }

  const { tool, params } = parseArgs(args);
  await invokeTool(tool, params);
}

// Run only when executed directly (not when imported by tests)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    outputError(`CLI failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  });
}
