import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ForgeLoader, ResolvedForgeVersion } from '../downloaders/forge-maven.js';
import { getForgeMaven, resolveKnownVersion } from '../downloaders/forge-maven.js';
import { getNeoFormRuntime } from '../java/nfrt.js';
import { logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';
import { getDecompileService } from './decompile-service.js';

export interface EnsurePatchedSourceResult {
  status: 'ready' | 'built';
  cacheKey: string;
  outputDir: string;
  mode: 'extracted' | 'decompiled';
  durationMs: number;
  resolved: ResolvedForgeVersion;
}

// NFRT result ids (2.0.x names; 1.x called these sourcesWithNeoForge/compiledWithNeoForge)
const SOURCES_RESULT = 'gameSourcesWithNeoForge';
const RECOMP_RESULT = 'gameJarWithNeoForge';

/**
 * Orchestrates the Forge/NeoForge patched-source pipeline:
 *
 *   resolve loader version → NFRT userdev run → extract merged sources into
 *   decompiled/<mc>-<loader>-<ver>/mojmap/ → register the recompiled JAR as the
 *   key's remapped JAR (keeps validate_access_transformer working).
 *
 * The merged sources zip contains BOTH the patched net/minecraft classes and
 * the loader's own sources (net/minecraftforge or net/neoforged), which is why
 * every existing get/search/index/compare tool works on the cache key unchanged.
 */
export class ForgeSourceService {
  private decompile = getDecompileService();

  /** In-flight builds per cache key — concurrent callers await the same promise. */
  private builds = new Map<string, Promise<EnsurePatchedSourceResult>>();

  async resolveVersion(
    mcVersion: string,
    loaderVersion?: string,
    loader: ForgeLoader = 'forge',
  ): Promise<ResolvedForgeVersion> {
    return getForgeMaven().resolveVersion(mcVersion, loaderVersion, loader);
  }

  /**
   * Ensure the patched source tree exists for (mcVersion, loader, loaderVersion).
   * First call runs the NFRT pipeline (minutes); afterwards it's a cache hit.
   * `force` rebuilds the decompiled tree from the cached NFRT artifacts,
   * re-running NFRT only when those artifacts are gone.
   *
   * With an explicit `loaderVersion`, an already-built tree is served from the
   * cache WITHOUT fetching version metadata — reading cached source needs no
   * network. Version validation only happens when a build may be needed.
   */
  async ensurePatchedSource(
    mcVersion: string,
    loaderVersion?: string,
    loader: ForgeLoader = 'forge',
    force = false,
  ): Promise<EnsurePatchedSourceResult> {
    // Offline fast path: explicit coordinates + warm cache → no metadata fetch
    if (loaderVersion && !force) {
      const known = resolveKnownVersion(mcVersion, loaderVersion, loader);
      const inFlight = this.builds.get(known.cacheKey);
      if (inFlight) {
        logger.info(`Patch build for ${known.cacheKey} already in progress; awaiting it`);
        return inFlight;
      }
      if (this.decompile.isDecompiled(known.cacheKey, 'mojmap')) {
        return this.readyResult(known);
      }
    }

    // Cold path: resolve first, which validates the version (or picks a default)
    const resolved = await this.resolveVersion(mcVersion, loaderVersion, loader);

    const inFlight = this.builds.get(resolved.cacheKey);
    if (inFlight) {
      if (force) {
        logger.warn(
          `force was requested for ${resolved.cacheKey} but a build is already running; awaiting it instead of restarting`,
        );
      }
      logger.info(`Patch build for ${resolved.cacheKey} already in progress; awaiting it`);
      return inFlight;
    }

    if (!force && this.decompile.isDecompiled(resolved.cacheKey, 'mojmap')) {
      return this.readyResult(resolved);
    }

    const build = this.build(resolved.cacheKey, resolved, force).finally(() =>
      this.builds.delete(resolved.cacheKey),
    );
    this.builds.set(resolved.cacheKey, build);
    return build;
  }

  private readyResult(resolved: ResolvedForgeVersion): EnsurePatchedSourceResult {
    return {
      status: 'ready',
      cacheKey: resolved.cacheKey,
      outputDir: this.decompile.getDecompiledDir(resolved.cacheKey, 'mojmap'),
      mode: 'extracted',
      durationMs: 0,
      resolved,
    };
  }

  private async build(
    key: string,
    resolved: ResolvedForgeVersion,
    force: boolean,
  ): Promise<EnsurePatchedSourceResult> {
    if (force) {
      logger.info(`Force: clearing cached decompiled source for ${key}`);
      this.decompile.forceClear(key, 'mojmap');
    }

    const artifactDir = join(paths.patchedJars(), key);
    const sourcesJar = join(artifactDir, `${SOURCES_RESULT}.jar`);
    const recompJar = join(artifactDir, `${RECOMP_RESULT}.jar`);

    const started = Date.now();
    if (!existsSync(sourcesJar) || !existsSync(recompJar)) {
      logger.info(
        `No cached NFRT artifacts for ${key}; running the userdev pipeline (downloads Minecraft + decompiles + recompiles; can take several minutes on first run)`,
      );
      await getNeoFormRuntime().run({
        neoforgeArtifact: resolved.artifact,
        extraRepositories: resolved.extraRepositories,
        results: { [SOURCES_RESULT]: sourcesJar, [RECOMP_RESULT]: recompJar },
      });
    } else {
      logger.info(`Reusing cached NFRT artifacts for ${key}`);
    }

    // Sources zip → direct extraction (IDE-equivalent source, no re-decompile
    // loss); the recompiled JAR backs the bytecode validators via the standard
    // remapped-JAR slot.
    const { outputDir, mode } = await this.decompile.decompileLocalJar(sourcesJar, key, 'mojmap');
    this.decompile.registerAsRemappedJar(recompJar, key, 'mojmap');

    return {
      status: 'built',
      cacheKey: key,
      outputDir,
      mode,
      durationMs: Date.now() - started,
      resolved,
    };
  }
}

// Singleton instance
let forgeSourceServiceInstance: ForgeSourceService | undefined;

export function getForgeSourceService(): ForgeSourceService {
  if (!forgeSourceServiceInstance) {
    forgeSourceServiceInstance = new ForgeSourceService();
  }
  return forgeSourceServiceInstance;
}
