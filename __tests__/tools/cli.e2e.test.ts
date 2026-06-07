import { describe, expect, it } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';

/**
 * CLI process-level E2E tests.
 *
 * These spawn the actual CLI entrypoint and assert on its stdout/stderr/exit code.
 * They intentionally cover only the paths that need neither Java nor network
 * (help, list-tools, argument errors) so they stay fast and run in the default suite.
 */
describe('minecraft-dev CLI (process E2E)', () => {
  it('prints help and exits 0 with no arguments', async () => {
    const { exitCode, stdout } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Minecraft Dev CLI');
    expect(stdout).toContain('USAGE:');
  });

  it('prints help for the help command', async () => {
    const { exitCode, stdout } = await runCli(['help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('AVAILABLE TOOLS:');
  });

  it('lists all tools as valid JSON', async () => {
    const { exitCode, stdout } = await runCli(['list-tools']);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.total).toBe(20);
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools).toHaveLength(20);

    const names = parsed.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get_minecraft_source');
    expect(names).toContain('decompile_minecraft_version');

    // Every tool entry exposes its parameter schema.
    for (const tool of parsed.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
    }
  });

  it('errors with exit 1 and JSON for an unknown tool', async () => {
    const { exitCode, stderr } = await runCli(['not_a_real_tool']);
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(stderr);
    expect(parsed.error).toContain('Unknown tool: not_a_real_tool');
  });

  it('rejects positional arguments after a valid tool', async () => {
    const { exitCode, stderr } = await runCli(['get_minecraft_source', 'oops']);
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(stderr);
    expect(parsed.error).toContain('Unexpected positional argument: oops');
  });
});
