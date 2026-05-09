import { describe, expect, it } from 'vitest';
import { stripPatchedVersion } from '../../src/services/mapping-service.js';

describe('stripPatchedVersion', () => {
  it('strips NeoForge suffix to vanilla MC version', () => {
    expect(stripPatchedVersion('1.21.1-neoforge-21.1.72')).toBe('1.21.1');
  });

  it('strips Forge suffix to vanilla MC version', () => {
    expect(stripPatchedVersion('1.20.1-forge-47.4.0')).toBe('1.20.1');
  });

  it('handles two-part MC versions (no patch)', () => {
    expect(stripPatchedVersion('1.20-forge-46.0.14')).toBe('1.20');
  });

  it('case-insensitive on loader name', () => {
    expect(stripPatchedVersion('1.21.1-NeoForge-21.1.72')).toBe('1.21.1');
  });

  it('returns vanilla version unchanged', () => {
    expect(stripPatchedVersion('1.21.10')).toBe('1.21.10');
    expect(stripPatchedVersion('1.20')).toBe('1.20');
  });

  it('returns unknown-loader strings unchanged (no false stripping)', () => {
    expect(stripPatchedVersion('1.21.1-fancyloader-99')).toBe('1.21.1-fancyloader-99');
  });

  it('returns snapshot-style versions unchanged', () => {
    expect(stripPatchedVersion('26.1-snapshot-9')).toBe('26.1-snapshot-9');
  });
});
