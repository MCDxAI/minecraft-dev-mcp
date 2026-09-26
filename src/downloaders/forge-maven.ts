import { ForgeSourceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { fetchJson, fetchText } from './http-client.js';

/**
 * Forge / NeoForge Maven client.
 *
 * Resolves loader versions for a Minecraft version and produces the NFRT
 * `--neoforge` artifact coordinates the patched-source pipeline
 * (`forge-source-service.ts`) consumes. Version metadata is fetched from the
 * loaders' Maven repositories and cached in-process for 24h.
 */

export type ForgeLoader = 'forge' | 'neoforge';

export interface ForgeVersionEntry {
  /** Loader-only version, e.g. "47.3.0" (forge) or "21.1.72" (neoforge). */
  loaderVersion: string;
  /** Opaque cache key `<mc>-<loader>-<loaderVersion>` — the `version` string every downstream tool accepts. */
  fullVersion: string;
  /** True for the Forge-promoted recommended build of this MC version. */
  recommended?: boolean;
  /** True for pre-release builds (NeoForge `-beta`). */
  prerelease?: boolean;
}

export interface ResolvedForgeVersion {
  mcVersion: string;
  loader: ForgeLoader;
  loaderVersion: string;
  cacheKey: string;
  /** Full artifact coordinates (incl. `userdev` classifier) for NFRT's `--neoforge` flag. */
  artifact: string;
  /** Extra Maven repositories NFRT must be told about (Forge artifacts live on the Forge Maven). */
  extraRepositories: string[];
}

const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net';
const NEOFORGE_MAVEN_BASE = 'https://maven.neoforged.net/releases';
const FORGE_METADATA_URL = `${FORGE_MAVEN_BASE}/net/minecraftforge/forge/maven-metadata.xml`;
const NEOFORGE_METADATA_URL = `${NEOFORGE_MAVEN_BASE}/net/neoforged/neoforge/maven-metadata.xml`;
const FORGE_PROMOTIONS_URL =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without network)
// ---------------------------------------------------------------------------

/** Extract `<version>` entries from a maven-metadata.xml document. */
export function parseMavenVersions(xml: string): string[] {
  const versions: string[] = [];
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    versions.push(match[1]);
  }
  return versions;
}

/**
 * Split a Forge maven-metadata entry like "1.20.1-47.3.0" into its parts.
 * Legacy entries with irregular shapes (e.g. "1.7.10-10.13.4.1614-1.7.10") return null.
 */
export function parseForgeMetadataVersion(
  entry: string,
): { mcVersion: string; build: string } | null {
  const m = entry.match(/^(\d+(?:\.\d+){1,2})-(\d+\.\d+\.\d+)$/);
  return m ? { mcVersion: m[1], build: m[2] } : null;
}

/**
 * Map a NeoForge version to its Minecraft version (official rule:
 * https://docs.neoforged.net/docs/gettingstarted/versioning/).
 *
 * 3-segment versions drop the "1." prefix ("21.1.72" -> "1.21.1",
 * "21.0.103-beta" -> "1.21"); since MC 26.1 (Mojang calver) NeoForge uses
 * 4 segments ("26.1.0.5-beta" -> "26.1").
 *
 * Returns null for unrecognized shapes — notably the early "1.20.1-47.1.x"
 * fork versions, which were published under the old `net.neoforged:forge`
 * artifact and are not listed by this client (use loader `forge` for 1.20.1).
 */
export function neoforgeToMcVersion(version: string): string | null {
  const m = version.match(/^(\d+)\.(\d+)(?:\.\d+)?(?:\.\d+)?(?:-beta)?$/);
  if (!m) return null;
  const [, major, minor] = m;
  const dotCount = (version.match(/\./g) ?? []).length;
  if (dotCount >= 3) return `${major}.${minor}`; // calver: 26.1.0.x -> 26.1
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`;
}

/** Numeric version compare (ascending); stable releases sort above `-beta` at equal numbers. */
function compareLoaderVersions(a: string, b: string): number {
  const pa = a
    .replace(/-beta$/, '')
    .split('.')
    .map(Number);
  const pb = b
    .replace(/-beta$/, '')
    .split('.')
    .map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return (a.endsWith('-beta') ? 0 : 1) - (b.endsWith('-beta') ? 0 : 1);
}

/** Build the sorted (newest first) version list for Forge from raw metadata entries. */
export function buildForgeVersionList(
  entries: string[],
  mcVersion: string,
  promotions?: { recommended?: string },
): ForgeVersionEntry[] {
  return entries
    .map((entry) => parseForgeMetadataVersion(entry))
    .filter(
      (p): p is { mcVersion: string; build: string } => p !== null && p.mcVersion === mcVersion,
    )
    .map(({ build }) => {
      const recommended = promotions?.recommended === build;
      return {
        loaderVersion: build,
        fullVersion: `${mcVersion}-forge-${build}`,
        ...(recommended ? { recommended: true } : {}),
      };
    })
    .sort((a, b) => compareLoaderVersions(b.loaderVersion, a.loaderVersion));
}

/** Build the sorted (newest first) version list for NeoForge from raw metadata entries. */
export function buildNeoForgeVersionList(
  entries: string[],
  mcVersion: string,
): ForgeVersionEntry[] {
  return entries
    .map((entry) => ({ entry, mc: neoforgeToMcVersion(entry) }))
    .filter((x): x is { entry: string; mc: string } => x.mc !== null && x.mc === mcVersion)
    .map(({ entry }) => {
      const prerelease = entry.endsWith('-beta');
      return {
        loaderVersion: entry,
        fullVersion: `${mcVersion}-neoforge-${entry}`,
        ...(prerelease ? { prerelease: true } : {}),
      };
    })
    .sort((a, b) => compareLoaderVersions(b.loaderVersion, a.loaderVersion));
}

/** Default version: recommended build, else highest stable, else newest pre-release. */
export function selectDefaultVersion(entries: ForgeVersionEntry[]): ForgeVersionEntry | undefined {
  return entries.find((e) => e.recommended) ?? entries.find((e) => !e.prerelease) ?? entries[0];
}

function artifactFor(mcVersion: string, loader: ForgeLoader, loaderVersion: string): string {
  return loader === 'forge'
    ? `net.minecraftforge:forge:${mcVersion}-${loaderVersion}:userdev`
    : `net.neoforged:neoforge:${loaderVersion}:userdev`;
}

function extraRepositoriesFor(loader: ForgeLoader): string[] {
  return loader === 'forge' ? [FORGE_MAVEN_BASE] : [];
}

/**
 * Build resolved coordinates from explicit inputs — pure, no network. Lets a
 * cache hit (already-built patched tree) be served without fetching version
 * metadata at all, i.e. offline.
 */
export function resolveKnownVersion(
  mcVersion: string,
  loaderVersion: string,
  loader: ForgeLoader = 'forge',
): ResolvedForgeVersion {
  return {
    mcVersion,
    loader,
    loaderVersion,
    cacheKey: `${mcVersion}-${loader}-${loaderVersion}`,
    artifact: artifactFor(mcVersion, loader, loaderVersion),
    extraRepositories: extraRepositoriesFor(loader),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ForgeMavenClient {
  private metadataCache = new Map<ForgeLoader, { fetchedAt: number; versions: string[] }>();
  private promotionsCache: { fetchedAt: number; promos: Record<string, string> } | null = null;

  /**
   * List loader versions available for a Minecraft version (newest first).
   * `source` reports whether the in-process TTL cache answered.
   */
  async listVersions(
    mcVersion: string,
    loader: ForgeLoader = 'forge',
    forceRefresh = false,
  ): Promise<{ entries: ForgeVersionEntry[]; source: 'maven' | 'cache' }> {
    if (loader === 'neoforge') {
      const { versions, source } = await this.fetchMetadata(
        NEOFORGE_METADATA_URL,
        loader,
        forceRefresh,
      );
      return { entries: buildNeoForgeVersionList(versions, mcVersion), source };
    }

    const [{ versions, source }, promotions] = await Promise.all([
      this.fetchMetadata(FORGE_METADATA_URL, loader, forceRefresh),
      this.fetchPromotions(forceRefresh),
    ]);
    return {
      entries: buildForgeVersionList(versions, mcVersion, {
        recommended: promotions[`${mcVersion}-recommended`],
      }),
      source,
    };
  }

  /**
   * Resolve an explicit loader version, or pick the default one. Throws
   * ForgeSourceError with an actionable message for unknown combinations.
   */
  async resolveVersion(
    mcVersion: string,
    loaderVersion?: string,
    loader: ForgeLoader = 'forge',
  ): Promise<ResolvedForgeVersion> {
    const { entries } = await this.listVersions(mcVersion, loader);
    if (entries.length === 0) {
      const hint =
        loader === 'neoforge' && mcVersion === '1.20.1'
          ? ' Early NeoForge 1.20.1 builds are not published under net.neoforged:neoforge — use loader "forge" for 1.20.1.'
          : '';
      throw new ForgeSourceError(`No ${loader} versions found for Minecraft ${mcVersion}.${hint}`);
    }

    const chosen = loaderVersion
      ? entries.find((e) => e.loaderVersion === loaderVersion)
      : selectDefaultVersion(entries);
    if (!chosen) {
      throw new ForgeSourceError(
        `${loader} version ${loaderVersion} not found for Minecraft ${mcVersion}. Call list_forge_versions for the available versions.`,
      );
    }

    return resolveKnownVersion(mcVersion, chosen.loaderVersion, loader);
  }

  private async fetchMetadata(
    url: string,
    loader: ForgeLoader,
    force: boolean,
  ): Promise<{ versions: string[]; source: 'maven' | 'cache' }> {
    const cached = this.metadataCache.get(loader);
    if (!force && cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) {
      return { versions: cached.versions, source: 'cache' };
    }
    logger.debug(`Fetching ${loader} version metadata from ${url}`);
    const versions = parseMavenVersions(await fetchText(url));
    this.metadataCache.set(loader, { fetchedAt: Date.now(), versions });
    return { versions, source: 'maven' };
  }

  /** promotions_slim.json is advisory (recommended/latest per MC version) — failures are non-fatal. */
  private async fetchPromotions(force: boolean): Promise<Record<string, string>> {
    if (
      !force &&
      this.promotionsCache &&
      Date.now() - this.promotionsCache.fetchedAt < METADATA_TTL_MS
    ) {
      return this.promotionsCache.promos;
    }
    try {
      const data = await fetchJson<{ promos?: Record<string, string> }>(FORGE_PROMOTIONS_URL);
      const promos = data.promos ?? {};
      this.promotionsCache = { fetchedAt: Date.now(), promos };
      return promos;
    } catch (error) {
      logger.warn(
        `Failed to fetch Forge promotions (recommended/latest markers disabled): ${String(error)}`,
      );
      return {};
    }
  }
}

// Singleton instance
let forgeMavenInstance: ForgeMavenClient | undefined;

export function getForgeMaven(): ForgeMavenClient {
  if (!forgeMavenInstance) {
    forgeMavenInstance = new ForgeMavenClient();
  }
  return forgeMavenInstance;
}
