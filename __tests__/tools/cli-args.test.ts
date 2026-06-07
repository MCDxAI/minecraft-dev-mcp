import { describe, expect, it, vi } from 'vitest';
import { coerceFlagValue, parseArgs } from '../../src/cli.js';
import { tools } from '../../src/server/tools.js';

// A stable, known tool name to drive parseArgs tests.
const TOOL = tools[0].name;

describe('coerceFlagValue', () => {
  it('keeps string-typed values as raw strings (no JSON guessing)', () => {
    // Regression: "1.20" must not become the number 1.2, "42" must stay "42".
    expect(coerceFlagValue('1.20', 'string')).toBe('1.20');
    expect(coerceFlagValue('26', 'string')).toBe('26');
    expect(coerceFlagValue('true', 'string')).toBe('true');
    expect(coerceFlagValue('net.minecraft.world.entity.Entity', 'string')).toBe(
      'net.minecraft.world.entity.Entity',
    );
  });

  it('defaults to raw string when the type is unknown', () => {
    expect(coerceFlagValue('1.20')).toBe('1.20');
    expect(coerceFlagValue('hello')).toBe('hello');
  });

  it('coerces number / integer types', () => {
    expect(coerceFlagValue('50', 'number')).toBe(50);
    expect(coerceFlagValue('3', 'integer')).toBe(3);
    // Non-numeric value for a number field falls back to the raw string.
    expect(coerceFlagValue('abc', 'number')).toBe('abc');
  });

  it('coerces boolean types', () => {
    expect(coerceFlagValue('true', 'boolean')).toBe(true);
    expect(coerceFlagValue('1', 'boolean')).toBe(true);
    expect(coerceFlagValue('false', 'boolean')).toBe(false);
    expect(coerceFlagValue('0', 'boolean')).toBe(false);
  });

  it('parses array / object types as JSON', () => {
    expect(coerceFlagValue('[1,2,3]', 'array')).toEqual([1, 2, 3]);
    expect(coerceFlagValue('{"a":1}', 'object')).toEqual({ a: 1 });
    // Invalid JSON falls back to the raw string.
    expect(coerceFlagValue('not json', 'array')).toBe('not json');
  });
});

describe('parseArgs', () => {
  it('returns the tool name with no params when only the tool is given', () => {
    expect(parseArgs([TOOL])).toEqual({ tool: TOOL, params: {} });
  });

  it('keeps string-typed flags as strings (schema-driven)', () => {
    // get_minecraft_source.version is type "string" in the schema.
    const { params } = parseArgs([TOOL, '--version', '1.20', '--mapping', 'yarn']);
    expect(params).toEqual({ version: '1.20', mapping: 'yarn' });
  });

  it('parses --key=value flags', () => {
    const { params } = parseArgs([TOOL, '--version=1.21.10', '--mapping=mojmap']);
    expect(params).toEqual({ version: '1.21.10', mapping: 'mojmap' });
  });

  it('coerces number-typed flags via the schema', () => {
    // startLine / maxLines are type "number".
    const { params } = parseArgs([
      TOOL,
      '--version',
      '1.21.10',
      '--startLine',
      '10',
      '--maxLines',
      '200',
    ]);
    expect(params).toMatchObject({ startLine: 10, maxLines: 200 });
  });

  it('treats a bare trailing flag as true', () => {
    const { params } = parseArgs([TOOL, '--version', '1.21.10', '--someFlag']);
    expect(params.someFlag).toBe(true);
  });

  it('does not consume a following flag as a value', () => {
    const { params } = parseArgs([TOOL, '--someFlag', '--version', '1.21.10']);
    expect(params).toEqual({ someFlag: true, version: '1.21.10' });
  });

  it('rejects a bare -- flag with an empty key', () => {
    // parseArgs calls process.exit on error; assert it throws/exits rather than
    // silently producing an empty-string key.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => parseArgs([TOOL, '--'])).toThrow('exit:1');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
