import { describe, expect, it } from 'vitest';
import { parseArgs, parseFlagValue } from '../../src/cli.js';
import { tools } from '../../src/server/tools.js';

// A stable, known tool name to drive parseArgs tests.
const TOOL = tools[0].name;

describe('parseFlagValue', () => {
  it('coerces booleans', () => {
    expect(parseFlagValue('true')).toBe(true);
    expect(parseFlagValue('false')).toBe(false);
  });

  it('coerces JSON literals', () => {
    expect(parseFlagValue('42')).toBe(42);
    expect(parseFlagValue('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseFlagValue('{"a":1}')).toEqual({ a: 1 });
  });

  it('leaves non-JSON strings as raw strings', () => {
    expect(parseFlagValue('net.minecraft.world.entity.Entity')).toBe(
      'net.minecraft.world.entity.Entity',
    );
    expect(parseFlagValue('yarn')).toBe('yarn');
  });
});

describe('parseArgs', () => {
  it('returns the tool name with no params when only the tool is given', () => {
    expect(parseArgs([TOOL])).toEqual({ tool: TOOL, params: {} });
  });

  it('parses --key value flags', () => {
    const { tool, params } = parseArgs([TOOL, '--version', '1.21.10', '--mapping', 'yarn']);
    expect(tool).toBe(TOOL);
    expect(params).toEqual({ version: '1.21.10', mapping: 'yarn' });
  });

  it('parses --key=value flags', () => {
    const { params } = parseArgs([TOOL, '--version=1.21.10', '--mapping=mojmap']);
    expect(params).toEqual({ version: '1.21.10', mapping: 'mojmap' });
  });

  it('treats a bare trailing flag as true', () => {
    const { params } = parseArgs([TOOL, '--force']);
    expect(params).toEqual({ force: true });
  });

  it('coerces flag values via parseFlagValue', () => {
    const { params } = parseArgs([TOOL, '--limit', '50', '--includeAllClasses', 'true']);
    expect(params).toEqual({ limit: 50, includeAllClasses: true });
  });

  it('does not consume a following flag as a value', () => {
    const { params } = parseArgs([TOOL, '--force', '--version', '1.21.10']);
    expect(params).toEqual({ force: true, version: '1.21.10' });
  });
});
