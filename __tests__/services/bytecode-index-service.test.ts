import { copyFileSync, existsSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BytecodeIndexService } from '../../src/services/bytecode-index-service.js';
import { ensureDir } from '../../src/utils/file-utils.js';
import { getRemappedJarPath } from '../../src/utils/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_JAR = join(__dirname, '..', 'fixtures', 'summoningrituals-mc-stubs.jar');
const DUMPER_JAR = join(
  __dirname,
  '..',
  '..',
  'tools',
  'bytecode-dumper',
  'build',
  'libs',
  'bytecode-dumper-1.0.0.jar',
);

// Runs against the committed fixture JAR via the bundled ASM dumper. Skips when
// the dumper jar isn't built (dev/CI prerequisite, like bytecode-dumper.test).
const describeIndex = existsSync(DUMPER_JAR) && existsSync(FIXTURE_JAR) ? describe : describe.skip;

describeIndex('BytecodeIndexService (remapped-JAR bytecode cache)', () => {
  // Use a throwaway version key so we never touch a real cached version. The
  // service resolves the JAR path from (version, mapping); we stage the fixture
  // JAR there and clean up both the JAR and its sidecar cache afterwards.
  const VERSION = '0.0.0-bytecode-index-test';
  const MAPPING = 'mojmap' as const;

  function stageJar(): { jarPath: string; cachePath: string } {
    const jarPath = getRemappedJarPath(VERSION, MAPPING);
    ensureDir(dirname(jarPath));
    copyFileSync(FIXTURE_JAR, jarPath);
    return { jarPath, cachePath: jarPath.replace(/\.jar$/i, '.bytecode.json') };
  }

  function cleanup(jarPath: string, cachePath: string): void {
    rmSync(jarPath, { force: true });
    rmSync(cachePath, { force: true });
    for (const stray of [`${cachePath}.tmp`]) rmSync(stray, { force: true });
  }

  it('resolves requested classes, omits absent ones, and writes a sidecar cache', async () => {
    const { jarPath, cachePath } = stageJar();
    try {
      const svc = new BytecodeIndexService();
      const map = await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/world/level/storage/loot/IntRange',
        'net/minecraft/advancements/critereon/StatePropertiesPredicate$ExactMatcher',
        'net/minecraft/does/not/Exist',
      ]);

      // Present classes are returned with authoritative bytecode.
      const intRange = map.get('net/minecraft/world/level/storage/loot/IntRange');
      expect(intRange).toBeDefined();
      expect(intRange?.methods.some((m) => m.name === '<init>')).toBe(true);

      // The record's implicit accessor + canonical ctor are present in bytecode.
      const exact = map.get(
        'net/minecraft/advancements/critereon/StatePropertiesPredicate$ExactMatcher',
      );
      expect(exact?.isRecord).toBe(true);
      expect(exact?.canonicalConstructor).toBe('(Ljava/lang/String;)V');
      expect(exact?.methods.some((m) => m.name === 'value')).toBe(true);

      // Absent classes are simply omitted from the map.
      expect(map.has('net/minecraft/does/not/Exist')).toBe(false);

      // The sidecar cache was written next to the JAR.
      expect(existsSync(cachePath)).toBe(true);
    } finally {
      cleanup(jarPath, cachePath);
    }
  }, 60000);

  it('serves a second request from cache without re-reading the JAR', async () => {
    const { jarPath, cachePath } = stageJar();
    try {
      const svc = new BytecodeIndexService();
      await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/world/level/storage/loot/IntRange',
      ]);
      const cacheMtime = statSync(cachePath).mtimeMs;

      // A repeat request for the same (already-cached) class must not rewrite the
      // cache file, since nothing was missing.
      const map = await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/world/level/storage/loot/IntRange',
      ]);
      expect(map.has('net/minecraft/world/level/storage/loot/IntRange')).toBe(true);
      expect(statSync(cachePath).mtimeMs).toBe(cacheMtime);
    } finally {
      cleanup(jarPath, cachePath);
    }
  }, 60000);

  it('invalidates the cache when the JAR signature changes', async () => {
    const { jarPath, cachePath } = stageJar();
    try {
      const svc = new BytecodeIndexService();
      await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/world/level/storage/loot/IntRange',
      ]);
      expect(existsSync(cachePath)).toBe(true);

      // Simulate a rebuilt JAR (new mtime) — the stored size:mtime signature no
      // longer matches, so the stale cache is discarded and rebuilt cleanly.
      const future = new Date(Date.now() + 60_000);
      utimesSync(jarPath, future, future);

      const map = await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/advancements/critereon/StatePropertiesPredicate$RangedMatcher',
      ]);
      expect(
        map.has('net/minecraft/advancements/critereon/StatePropertiesPredicate$RangedMatcher'),
      ).toBe(true);
    } finally {
      cleanup(jarPath, cachePath);
    }
  }, 60000);

  it('clearCache removes the sidecar', async () => {
    const { jarPath, cachePath } = stageJar();
    try {
      const svc = new BytecodeIndexService();
      await svc.getClassBytecode(VERSION, MAPPING, [
        'net/minecraft/world/level/storage/loot/IntRange',
      ]);
      expect(existsSync(cachePath)).toBe(true);

      svc.clearCache(VERSION, MAPPING);
      expect(existsSync(cachePath)).toBe(false);
    } finally {
      cleanup(jarPath, cachePath);
    }
  }, 60000);

  it('throws when the remapped JAR does not exist', async () => {
    const svc = new BytecodeIndexService();
    await expect(
      svc.getClassBytecode('0.0.0-definitely-missing', MAPPING, ['net/minecraft/Foo']),
    ).rejects.toThrow(/Remapped JAR not found/);
  });
});
