import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BytecodeClass } from '../../../src/java/bytecode-dumper.js';
import { getBytecodeDumper } from '../../../src/java/bytecode-dumper.js';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import { getAccessTransformerService } from '../../../src/services/access-transformer-service.js';
import { getBytecodeIndexService } from '../../../src/services/bytecode-index-service.js';
import { getRemapService } from '../../../src/services/remap-service.js';
import { getRemappedJarPath } from '../../../src/utils/paths.js';

/**
 * Real-Minecraft Access Transformer tests (issue #12).
 *
 * The network+Java-heavy counterpart to the deterministic, committed-fixture
 * test in `__tests__/services/access-transformer-service.test.ts`. Everything
 * here validates against genuine downloaded+remapped Mojang bytecode (no fixture,
 * no committed MC IP).
 *
 * The validator itself is version-agnostic: it reads whatever version's remapped
 * bytecode you point it at. To PROVE that across the 1.21.x line, the
 * cross-version block below builds a VERSION-CORRECT access transformer for each
 * MC version from that version's own bytecode (records + their real component
 * accessors) and asserts it validates cleanly — implicit record members found,
 * informational (never "crash") record notes, no bogus "overridable" ctor
 * warning. This is a real per-version regression of the exact issue-#12 fix.
 *
 * (The reporter's verbatim Summoning Rituals AT is 1.21.1-specific — it targets
 * the `advancements.critereon` package, which Mojang renamed to `criterion`
 * later in 1.21.x — so it is exercised only against 1.21.1.)
 *
 * Excluded from default CI (manual dir; network + full remap per version).
 * Run with:
 *   npm run test:manual -- __tests__/manual/access-transformer
 *   AT_MC_VERSIONS=1.21.1,1.21.11 npm run test:manual -- __tests__/manual/access-transformer
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const AT_FILE = join(__dirname, '..', '..', 'fixtures', 'summoningrituals.accesstransformer.cfg');
const STUB_JAR = join(__dirname, '..', '..', 'fixtures', 'summoningrituals-mc-stubs.jar');
const MAPPING = 'mojmap' as const;

// Full 1.21.x line by default; override with AT_MC_VERSIONS (comma-separated).
const VERSIONS = (
  process.env.AT_MC_VERSIONS ??
  '1.21.1,1.21.2,1.21.3,1.21.4,1.21.5,1.21.6,1.21.7,1.21.8,1.21.9,1.21.10,1.21.11'
)
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

// A record-heavy vanilla class present across all of 1.21.x. Only the package
// name drifts (`critereon` -> `criterion`), so we probe both spellings.
const RECORD_SIMPLE_NAMES = [
  'StatePropertiesPredicate$ExactMatcher',
  'StatePropertiesPredicate$PropertyMatcher',
  'StatePropertiesPredicate$RangedMatcher',
];
const PACKAGE_SPELLINGS = [
  'net/minecraft/advancements/criterion',
  'net/minecraft/advancements/critereon',
];

const vis = (flags: string[]): 'public' | 'protected' | 'private' | 'package' =>
  flags.includes('public')
    ? 'public'
    : flags.includes('protected')
      ? 'protected'
      : flags.includes('private')
        ? 'private'
        : 'package';

interface GeneratedAt {
  /** AT file text targeting real members of THIS version. */
  text: string;
  /** Dotted record class names widened (class-level entries). */
  records: string[];
  /** How many widened records have a non-public canonical ctor (== expected notes). */
  expectedCtorNotes: number;
  /** Dotted accessor targets `Class name()desc` we assert resolve. */
  accessorCount: number;
}

/**
 * Build a version-correct AT from a version's real bytecode: widen each of the
 * three matcher records and every one of their real component accessors (names +
 * erased descriptors read straight from the record components). The canonical
 * constructors are intentionally left un-widened, so each widened record yields
 * exactly one informational note.
 */
async function buildRecordAt(version: string): Promise<GeneratedAt> {
  const index = getBytecodeIndexService();
  for (const pkg of PACKAGE_SPELLINGS) {
    const internals = RECORD_SIMPLE_NAMES.map((n) => `${pkg}/${n}`);
    const map = await index.getClassBytecode(version, MAPPING, internals);
    const found = internals.filter((i) => map.get(i)?.isRecord);
    if (found.length === 0) continue;

    const lines: string[] = [];
    const records: string[] = [];
    let expectedCtorNotes = 0;
    let accessorCount = 0;
    for (const internal of found) {
      const bc = map.get(internal) as BytecodeClass;
      const dotted = internal.replace(/\//g, '.');
      lines.push(`public ${dotted}`); // widen the record class
      records.push(dotted);
      for (const comp of bc.recordComponents ?? []) {
        // Record accessor: name == component name, descriptor == ()<component desc>.
        lines.push(`public ${dotted} ${comp.name}()${comp.descriptor}`);
        accessorCount++;
      }
      const canon = bc.canonicalConstructor;
      const ctor = canon
        ? bc.methods.find((m) => m.name === '<init>' && m.desc === canon)
        : undefined;
      if (ctor && vis(ctor.flags) !== 'public') expectedCtorNotes++;
    }
    return { text: lines.join('\n'), records, expectedCtorNotes, accessorCount };
  }
  throw new Error(`No StatePropertiesPredicate matcher records found in MC ${version}`);
}

async function dumpByName(jarPath: string): Promise<Map<string, BytecodeClass>> {
  const dump = await getBytecodeDumper().dump(jarPath);
  return new Map(dump.classes.map((c) => [c.name, c]));
}

describe('Access Transformer vs REAL Minecraft (issue #12)', () => {
  beforeAll(async () => {
    await verifyJavaVersion(17);
  }, 30000);

  // ---- Cross-version support: 1.21.1 -> 1.21.11 (version-correct AT each) ----
  describe.each(VERSIONS)('cross-version support: MC %s', (version) => {
    beforeAll(async () => {
      await getRemapService().getRemappedJar(version, MAPPING);
    }, 600000);

    it('validates a version-correct record AT with zero false positives', async () => {
      const gen = await buildRecordAt(version);
      expect(gen.records.length).toBeGreaterThan(0);
      expect(gen.accessorCount).toBeGreaterThan(0);

      const svc = getAccessTransformerService();
      const at = svc.parseAccessTransformer(gen.text);
      expect(at.parseErrors).toEqual([]);

      const result = await svc.validateAccessTransformer(at, version, MAPPING);

      // Every entry targets a REAL member of this version's bytecode, so there
      // must be zero errors — this is the core issue-#12 guarantee (implicit
      // record accessors + canonical ctors are found, not falsely "not found").
      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);

      // Records are handled: one informational note per widened record whose
      // canonical ctor is non-public, worded as advisory (never "crash").
      const notes = result.warnings.filter((w) => w.message.includes('canonical constructor'));
      expect(notes.length).toBe(gen.expectedCtorNotes);
      expect(notes.every((w) => /INSTANTIATE/.test(w.message))).toBe(true);
      expect(result.warnings.some((w) => /crash/i.test(w.message))).toBe(false);
      // A constructor is never flagged overridable.
      expect(result.warnings.some((w) => w.message.includes('overridable'))).toBe(false);
    }, 600000);

    it('still rejects entries that do NOT exist in this version (no rubber-stamping)', async () => {
      const svc = getAccessTransformerService();
      const at = svc.parseAccessTransformer(
        [
          'public net.minecraft.totally.MadeUpClass',
          'public net.minecraft.world.item.ItemStack thisMethodDoesNotExist()V',
        ].join('\n'),
      );
      const result = await svc.validateAccessTransformer(at, version, MAPPING);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Class 'net.minecraft.totally.MadeUpClass' not found"),
        ),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.message.includes("Method 'thisMethodDoesNotExist' not found")),
      ).toBe(true);
    }, 600000);
  });

  // ---- 1.21.1 flagship: the reporter's verbatim Summoning Rituals AT ----
  describe('1.21.1 — verbatim Summoning Rituals AT', () => {
    beforeAll(async () => {
      await getRemapService().getRemappedJar('1.21.1', MAPPING);
    }, 600000);

    it('validates the real mod AT with zero errors and 3 informational record notes', async () => {
      const svc = getAccessTransformerService();
      const at = svc.parseAccessTransformerFile(AT_FILE);
      expect(at.parseErrors).toEqual([]);
      expect(at.entries).toHaveLength(19);

      const result = await svc.validateAccessTransformer(at, '1.21.1', MAPPING);

      // v1.2.4 reported 7 errors, all false positives. Must be zero.
      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes('overridable'))).toBe(false);

      const recordNotes = result.warnings.filter((w) =>
        w.message.includes('canonical constructor'),
      );
      expect(recordNotes).toHaveLength(3);
      expect(recordNotes.every((w) => /INSTANTIATE/.test(w.message))).toBe(true);
      expect(recordNotes.some((w) => /crash/i.test(w.message))).toBe(false);
      // PositionPredicate is exempt: the AT widens its constructor (line 2).
      const noteClasses = recordNotes.map((w) => w.entry.className);
      expect(noteClasses).not.toContain(
        'net.minecraft.advancements.critereon.LocationPredicate$PositionPredicate',
      );
    }, 600000);

    it('the committed stub reproduces real 1.21.1 bytecode on every validated dimension', async () => {
      // Definitive drift guard: dump the real remapped JAR and the committed stub,
      // then assert they agree on exactly what the validator reads for the mod's AT.
      expect(existsSync(STUB_JAR)).toBe(true);
      const real = await dumpByName(getRemappedJarPath('1.21.1', MAPPING));
      const stub = await dumpByName(STUB_JAR);

      const svc = getAccessTransformerService();
      const at = svc.parseAccessTransformerFile(AT_FILE);
      const targets = [...new Set(at.entries.map((e) => e.className.replace(/\./g, '/')))];

      const nonPublic = (flags: string[]) => !flags.includes('public');
      for (const internal of targets) {
        const r = real.get(internal);
        const s = stub.get(internal);
        expect(r, `real MC missing ${internal}`).toBeDefined();
        expect(s, `stub missing ${internal}`).toBeDefined();
        if (!r || !s) continue;

        expect(s.isRecord, `${internal} isRecord`).toBe(r.isRecord);
        expect(s.canonicalConstructor, `${internal} canonicalConstructor`).toBe(
          r.canonicalConstructor,
        );
        for (const entry of at.entries) {
          if (entry.className.replace(/\./g, '/') !== internal) continue;
          if (entry.memberType === 'method' && entry.memberName && entry.memberDescriptor) {
            const rm = r.methods.find(
              (m) => m.name === entry.memberName && m.desc === entry.memberDescriptor,
            );
            const sm = s.methods.find(
              (m) => m.name === entry.memberName && m.desc === entry.memberDescriptor,
            );
            expect(rm, `real ${internal}#${entry.memberName}`).toBeDefined();
            expect(sm, `stub ${internal}#${entry.memberName}`).toBeDefined();
            if (rm && sm) expect(nonPublic(sm.flags)).toBe(nonPublic(rm.flags));
          }
          if (entry.memberType === 'field' && entry.memberName) {
            expect(r.fields.some((f) => f.name === entry.memberName)).toBe(true);
            expect(s.fields.some((f) => f.name === entry.memberName)).toBe(true);
          }
        }
      }
    }, 600000);
  });
});
