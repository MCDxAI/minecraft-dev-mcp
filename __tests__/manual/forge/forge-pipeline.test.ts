import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getCacheManager } from '../../../src/cache/cache-manager.js';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import {
  handleDecompileForgeMinecraftVersion,
  handleGetForgeSource,
  handleSearchForgeCode,
} from '../../../src/server/tools.js';
import { getForgeSourceService } from '../../../src/services/forge-source-service.js';
import { getDecompiledPath } from '../../../src/utils/paths.js';

/**
 * Manual E2E for the Forge/NeoForge patched-source pipeline (NFRT).
 *
 * Skipped unless FORGE_E2E=1. Needs network + Java 21; the first run executes
 * the full NeoFormRuntime userdev pipeline (downloads Minecraft, decompiles,
 * recompiles — minutes). Configure the target via env:
 *
 *   FORGE_E2E=1 npm run test:manual -- __tests__/manual/forge
 *   FORGE_E2E=1 FORGE_LOADER=neoforge FORGE_MC=1.21.1 FORGE_LOADER_VERSION=21.1.72 ...
 *   FORGE_E2E=1 FORGE_LOADER=forge FORGE_MC=1.20.1 FORGE_LOADER_VERSION=47.3.0 ...
 */

const RUN = process.env.FORGE_E2E === '1';
const MC_VERSION = process.env.FORGE_MC ?? '1.21.1';
const LOADER = (process.env.FORGE_LOADER ?? 'neoforge') as 'forge' | 'neoforge';
const LOADER_VERSION =
  process.env.FORGE_LOADER_VERSION ?? (LOADER === 'neoforge' ? '21.1.72' : '47.3.0');
const CACHE_KEY = `${MC_VERSION}-${LOADER}-${LOADER_VERSION}`;

const LOADER_PACKAGE = LOADER === 'neoforge' ? 'net.neoforged' : 'net.minecraftforge';
// LivingHurtEvent no longer exists in NeoForge 1.20.4+ (damage event rework) —
// pick a class that exists in each loader.
const LOADER_SAMPLE_CLASS =
  LOADER === 'neoforge'
    ? 'net.neoforged.neoforge.event.entity.living.LivingDamageEvent'
    : 'net.minecraftforge.event.entity.living.LivingHurtEvent';
const LOADER_SAMPLE_SIMPLE_NAME = LOADER_SAMPLE_CLASS.slice(
  LOADER_SAMPLE_CLASS.lastIndexOf('.') + 1,
);

function countJavaFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countJavaFiles(join(dir, entry.name));
    else if (entry.name.endsWith('.java')) count++;
  }
  return count;
}

function packageDirHasJava(root: string, packagePrefix: string): boolean {
  // recursive — loader packages (e.g. net/neoforged) rarely hold .java files directly
  const dir = join(root, ...packagePrefix.split('.'));
  if (!existsSync(dir)) return false;
  return countJavaFiles(dir) > 0;
}

describe.skipIf(!RUN)(`Forge patched-source pipeline (${CACHE_KEY})`, () => {
  beforeAll(async () => {
    await verifyJavaVersion();
  }, 60_000);

  it('builds the patched tree via the forge-source service', { timeout: 20 * 60_000 }, async () => {
    const result = await getForgeSourceService().ensurePatchedSource(
      MC_VERSION,
      LOADER_VERSION,
      LOADER,
    );

    expect(['ready', 'built']).toContain(result.status);
    expect(result.cacheKey).toBe(CACHE_KEY);
    expect(existsSync(result.outputDir)).toBe(true);
    expect(countJavaFiles(result.outputDir)).toBeGreaterThan(500);

    const decompiledRoot = getDecompiledPath(CACHE_KEY, 'mojmap');
    // patched vanilla classes + loader sources live in the same tree
    expect(packageDirHasJava(decompiledRoot, 'net.minecraft.world.entity')).toBe(true);
    expect(packageDirHasJava(decompiledRoot, LOADER_PACKAGE)).toBe(true);

    // the recompiled JAR is registered as the remapped JAR (AT validation path)
    expect(getCacheManager().hasRemappedJar(CACHE_KEY, 'mojmap')).toBe(true);
  });

  it(
    'returns the loader event class source via get_forge_source',
    { timeout: 600_000 },
    async () => {
      const res = await handleGetForgeSource({
        mcVersion: MC_VERSION,
        loaderVersion: LOADER_VERSION,
        loader: LOADER,
        className: LOADER_SAMPLE_CLASS,
      });

      const text = (res.content as Array<{ type: string; text: string }>)[0].text;
      expect(res.isError).toBeUndefined();
      expect(text).toContain(
        `package ${LOADER_SAMPLE_CLASS.slice(0, LOADER_SAMPLE_CLASS.lastIndexOf('.'))}`,
      );
      expect(text).toContain(LOADER_SAMPLE_SIMPLE_NAME);
    },
  );

  it('returns a patched vanilla class via get_forge_source', { timeout: 600_000 }, async () => {
    const res = await handleGetForgeSource({
      mcVersion: MC_VERSION,
      loaderVersion: LOADER_VERSION,
      loader: LOADER,
      className: 'net.minecraft.world.entity.Entity',
    });

    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(res.isError).toBeUndefined();
    expect(text).toContain('package net.minecraft.world.entity');
  });

  it('finds loader classes via search_forge_code', { timeout: 600_000 }, async () => {
    const res = await handleSearchForgeCode({
      mcVersion: MC_VERSION,
      loaderVersion: LOADER_VERSION,
      loader: LOADER,
      query: LOADER_SAMPLE_SIMPLE_NAME,
      searchType: 'class',
    });

    const parsed = JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.count).toBeGreaterThan(0);
    expect(
      parsed.results.some((r: { file: string }) =>
        // relative() yields backslashes on Windows — normalize before comparing
        r.file
          .replace(/\\/g, '/')
          .startsWith(LOADER_PACKAGE.replace(/\./g, '/')),
      ),
    ).toBe(true);
  });

  it(
    'decompile_forge_minecraft_version is a cache hit on repeat',
    { timeout: 600_000 },
    async () => {
      const res = await handleDecompileForgeMinecraftVersion({
        mcVersion: MC_VERSION,
        loaderVersion: LOADER_VERSION,
        loader: LOADER,
      });

      const parsed = JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.status).toBe('ready');
      expect(parsed.cacheKey).toBe(CACHE_KEY);
      expect(parsed.mapping).toBe('mojmap');
    },
  );
});
