import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Orchestration tests for the patched-source pipeline.
 *
 * NFRT, the decompile service and the artifact directory are all mocked, so
 * these cover the branchy parts (offline cache hit, in-flight lock, force
 * rebuild, failure propagation) without network, Java or the real cache.
 */

const mocks = vi.hoisted(() => ({
  resolveVersion: vi.fn(),
  decompile: {
    isDecompiled: vi.fn(),
    getDecompiledDir: vi.fn(() => '/fake/decompiled'),
    forceClear: vi.fn(),
    decompileLocalJar: vi.fn(),
    registerAsRemappedJar: vi.fn(),
  },
  nfrtRun: vi.fn(),
  /** parent dir — the service joins the cache key onto it itself */
  patchedJarsDir: { dir: '' },
}));

vi.mock('../../src/downloaders/forge-maven.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/downloaders/forge-maven.js')>()),
  getForgeMaven: () => ({ resolveVersion: mocks.resolveVersion }),
}));

vi.mock('../../src/services/decompile-service.js', () => ({
  getDecompileService: () => mocks.decompile,
}));

vi.mock('../../src/java/nfrt.js', () => ({
  getNeoFormRuntime: () => ({ run: mocks.nfrtRun }),
}));

vi.mock('../../src/utils/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/paths.js')>()),
  paths: { patchedJars: () => mocks.patchedJarsDir.dir },
}));

const { ForgeSourceService } = await import('../../src/services/forge-source-service.js');

const MC = '1.21.1';
const LOADER_VERSION = '21.1.72';
const KEY = `${MC}-neoforge-${LOADER_VERSION}`;

describe('ForgeSourceService.ensurePatchedSource', () => {
  let service: InstanceType<typeof ForgeSourceService>;
  let workDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workDir = mkdtempSync(join(tmpdir(), 'forge-service-'));
    mocks.patchedJarsDir.dir = workDir; // service joins KEY onto this
    mocks.resolveVersion.mockResolvedValue({
      mcVersion: MC,
      loader: 'neoforge',
      loaderVersion: LOADER_VERSION,
      cacheKey: KEY,
      artifact: `net.neoforged:neoforge:${LOADER_VERSION}:userdev`,
      extraRepositories: [],
    });
    mocks.decompile.decompileLocalJar.mockResolvedValue({
      outputDir: '/fake/decompiled',
      mode: 'extracted',
    });
    service = new ForgeSourceService();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeArtifacts(): void {
    const dir = join(workDir, KEY);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'gameSourcesWithNeoForge.jar'), 'sources');
    writeFileSync(join(dir, 'gameJarWithNeoForge.jar'), 'recomp');
  }

  it('serves a warm cache offline — no metadata fetch when the version is explicit', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(true);
    mocks.resolveVersion.mockRejectedValue(new Error('offline'));

    const result = await service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge');

    expect(result.status).toBe('ready');
    expect(result.cacheKey).toBe(KEY);
    expect(mocks.resolveVersion).not.toHaveBeenCalled();
    expect(mocks.nfrtRun.mock.calls).toHaveLength(0);
  });

  it('validates the version before building when the cache is cold', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(false);
    writeArtifacts();

    const result = await service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge');

    expect(mocks.resolveVersion).toHaveBeenCalledWith(MC, LOADER_VERSION, 'neoforge');
    expect(result.status).toBe('built');
  });

  it('runs NFRT once when artifacts are missing, then extracts + registers', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(false);
    mocks.nfrtRun.mockImplementation(async () => writeArtifacts());

    const result = await service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge');

    expect(mocks.nfrtRun).toHaveBeenCalledTimes(1);
    const artifactDir = join(workDir, KEY);
    expect(mocks.nfrtRun.mock.calls[0][0].results).toEqual({
      gameSourcesWithNeoForge: join(artifactDir, 'gameSourcesWithNeoForge.jar'),
      gameJarWithNeoForge: join(artifactDir, 'gameJarWithNeoForge.jar'),
    });
    expect(mocks.decompile.decompileLocalJar).toHaveBeenCalledWith(
      join(artifactDir, 'gameSourcesWithNeoForge.jar'),
      KEY,
      'mojmap',
    );
    expect(mocks.decompile.registerAsRemappedJar).toHaveBeenCalledWith(
      join(artifactDir, 'gameJarWithNeoForge.jar'),
      KEY,
      'mojmap',
    );
    expect(result.mode).toBe('extracted');
  });

  it('force rebuilds from cached artifacts without re-running NFRT', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(true);
    writeArtifacts();

    const result = await service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge', true);

    expect(mocks.decompile.forceClear).toHaveBeenCalledWith(KEY, 'mojmap');
    expect(mocks.nfrtRun.mock.calls).toHaveLength(0);
    expect(mocks.decompile.decompileLocalJar).toHaveBeenCalled();
    expect(result.status).toBe('built');
  });

  it('propagates extraction failures and does not register a remapped JAR', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(false);
    writeArtifacts();
    mocks.decompile.decompileLocalJar.mockRejectedValue(new Error('corrupt sources zip'));

    await expect(service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge')).rejects.toThrow(
      'corrupt sources zip',
    );
    expect(mocks.decompile.registerAsRemappedJar).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent builds for the same key', async () => {
    mocks.decompile.isDecompiled.mockReturnValue(false);
    mocks.nfrtRun.mockImplementation(async () => writeArtifacts());

    const [a, b] = await Promise.all([
      service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge'),
      service.ensurePatchedSource(MC, LOADER_VERSION, 'neoforge'),
    ]);

    expect(mocks.nfrtRun).toHaveBeenCalledTimes(1);
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});
