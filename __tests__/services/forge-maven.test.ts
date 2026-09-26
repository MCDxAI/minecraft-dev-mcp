import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ForgeMavenClient,
  buildForgeVersionList,
  buildNeoForgeVersionList,
  neoforgeToMcVersion,
  parseForgeMetadataVersion,
  parseMavenVersions,
  resolveKnownVersion,
  selectDefaultVersion,
} from '../../src/downloaders/forge-maven.js';
import { fetchJson, fetchText } from '../../src/downloaders/http-client.js';

/**
 * Unit tests for the Forge/NeoForge Maven version parsing helpers.
 *
 * The parsing helpers are pure (no network). The client tests mock
 * `http-client` (skill pattern: mock external dependencies) to cover
 * `resolveVersion`'s error paths and default selection without requests.
 */

vi.mock('../../src/downloaders/http-client.js', () => ({
  fetchText: vi.fn(),
  fetchJson: vi.fn(),
  downloadFile: vi.fn(),
}));

const METADATA_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>net.minecraftforge</groupId>
  <artifactId>forge</artifactId>
  <versioning>
    <latest>1.21.1-52.0.63</latest>
    <release>1.21.1-52.0.63</release>
    <versions>
      <version>1.19.4-45.3.0</version>
      <version>1.20.1-47.3.0</version>
      <version>1.20.1-47.4.10</version>
      <version>1.20.1-47.4.23</version>
      <version>1.21.1-52.0.63</version>
      <version>1.7.10-10.13.4.1614-1.7.10</version>
      <version>1.7.10_pre4-10.13.0.1151</version>
    </versions>
  </versioning>
</metadata>`;

describe('neoforgeToMcVersion', () => {
  it('maps known NeoForge versions to their Minecraft versions', () => {
    expect(neoforgeToMcVersion('20.2.12-beta')).toBe('1.20.2');
    expect(neoforgeToMcVersion('20.4.248')).toBe('1.20.4');
    expect(neoforgeToMcVersion('20.6.147')).toBe('1.20.6');
    expect(neoforgeToMcVersion('21.0.103-beta')).toBe('1.21');
    expect(neoforgeToMcVersion('21.1.72')).toBe('1.21.1');
    expect(neoforgeToMcVersion('21.4.123')).toBe('1.21.4');
    expect(neoforgeToMcVersion('26.1.0.5-beta')).toBe('26.1');
    expect(neoforgeToMcVersion('26.3.0.22-beta')).toBe('26.3');
  });

  it('returns null for unrecognized shapes', () => {
    // Early NeoForge 1.20.1 fork versions live under the legacy artifact
    expect(neoforgeToMcVersion('1.20.1-47.1.54')).toBeNull();
    expect(neoforgeToMcVersion('garbage')).toBeNull();
    expect(neoforgeToMcVersion('')).toBeNull();
  });
});

describe('parseMavenVersions', () => {
  it('extracts version entries from maven-metadata.xml', () => {
    expect(parseMavenVersions(METADATA_FIXTURE)).toEqual([
      '1.19.4-45.3.0',
      '1.20.1-47.3.0',
      '1.20.1-47.4.10',
      '1.20.1-47.4.23',
      '1.21.1-52.0.63',
      '1.7.10-10.13.4.1614-1.7.10',
      '1.7.10_pre4-10.13.0.1151',
    ]);
  });
});

describe('parseForgeMetadataVersion', () => {
  it('splits modern entries into mc + build', () => {
    expect(parseForgeMetadataVersion('1.20.1-47.3.0')).toEqual({
      mcVersion: '1.20.1',
      build: '47.3.0',
    });
    expect(parseForgeMetadataVersion('1.21-36.2.39')).toEqual({
      mcVersion: '1.21',
      build: '36.2.39',
    });
  });

  it('rejects legacy shapes', () => {
    expect(parseForgeMetadataVersion('1.7.10-10.13.4.1614-1.7.10')).toBeNull();
    expect(parseForgeMetadataVersion('1.7.10_pre4-10.13.0.1151')).toBeNull();
    expect(parseForgeMetadataVersion('47.3.0')).toBeNull();
  });
});

describe('buildForgeVersionList', () => {
  const entries = parseMavenVersions(METADATA_FIXTURE);

  it('filters by MC version and sorts newest first', () => {
    const list = buildForgeVersionList(entries, '1.20.1');
    expect(list.map((e) => e.loaderVersion)).toEqual(['47.4.23', '47.4.10', '47.3.0']);
    expect(list[0].fullVersion).toBe('1.20.1-forge-47.4.23');
  });

  it('marks the promoted recommended build', () => {
    const list = buildForgeVersionList(entries, '1.20.1', { recommended: '47.4.10' });
    expect(list.find((e) => e.loaderVersion === '47.4.10')?.recommended).toBe(true);
    expect(list.find((e) => e.loaderVersion === '47.4.23')?.recommended).toBeUndefined();
  });

  it('returns an empty list for an MC version Forge never shipped', () => {
    expect(buildForgeVersionList(entries, '1.30.0')).toEqual([]);
  });
});

describe('buildNeoForgeVersionList', () => {
  const entries = [
    '20.2.12-beta',
    '21.0.103-beta',
    '21.1.72',
    '21.1.80-beta',
    '26.1.0.5-beta',
    '1.20.1-47.1.54', // legacy artifact entry — must be dropped
  ];

  it('maps, filters and sorts newest first', () => {
    const list = buildNeoForgeVersionList(entries, '1.21.1');
    expect(list.map((e) => e.loaderVersion)).toEqual(['21.1.80-beta', '21.1.72']);
    expect(list[1].fullVersion).toBe('1.21.1-neoforge-21.1.72');
  });

  it('marks betas as prerelease, stable releases as not', () => {
    const list = buildNeoForgeVersionList(entries, '1.21.1');
    expect(list[0].prerelease).toBe(true);
    expect(list[1].prerelease).toBeUndefined();
  });

  it('sorts a stable release above a beta with the same numbers', () => {
    const list = buildNeoForgeVersionList(['21.1.80-beta', '21.1.80'], '1.21.1');
    expect(list.map((e) => e.loaderVersion)).toEqual(['21.1.80', '21.1.80-beta']);
  });

  it('matches calver Minecraft versions via the 4-segment form', () => {
    const list = buildNeoForgeVersionList(entries, '26.1');
    expect(list.map((e) => e.loaderVersion)).toEqual(['26.1.0.5-beta']);
  });
});

describe('selectDefaultVersion', () => {
  const forgeList = buildForgeVersionList(parseMavenVersions(METADATA_FIXTURE), '1.20.1', {
    recommended: '47.4.10',
  });
  const neoforgeList = buildNeoForgeVersionList(
    ['21.1.72', '21.1.80-beta', '21.0.103-beta'],
    '1.21.1',
  );

  it('prefers the recommended build', () => {
    expect(selectDefaultVersion(forgeList)?.loaderVersion).toBe('47.4.10');
  });

  it('falls back to the highest stable release', () => {
    expect(selectDefaultVersion(neoforgeList)?.loaderVersion).toBe('21.1.72');
  });

  it('falls back to a prerelease when nothing stable exists', () => {
    expect(selectDefaultVersion(neoforgeList.filter((e) => e.prerelease))?.loaderVersion).toBe(
      '21.1.80-beta',
    );
  });
});

const NEOFORGE_METADATA_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <versioning>
    <versions>
      <version>21.0.103-beta</version>
      <version>21.1.72</version>
      <version>21.1.80-beta</version>
    </versions>
  </versioning>
</metadata>`;

const EMPTY_METADATA_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <versioning>
    <versions>
      <version>1.19.4-45.3.0</version>
    </versions>
  </versioning>
</metadata>`;

describe('resolveKnownVersion', () => {
  it('builds the Forge coordinates incl. the Forge Maven repository', () => {
    const resolved = resolveKnownVersion('1.20.1', '47.4.10', 'forge');
    expect(resolved.cacheKey).toBe('1.20.1-forge-47.4.10');
    expect(resolved.artifact).toBe('net.minecraftforge:forge:1.20.1-47.4.10:userdev');
    expect(resolved.extraRepositories).toEqual(['https://maven.minecraftforge.net']);
  });

  it('builds the NeoForge coordinates with no extra repository', () => {
    const resolved = resolveKnownVersion('1.21.1', '21.1.72', 'neoforge');
    expect(resolved.cacheKey).toBe('1.21.1-neoforge-21.1.72');
    expect(resolved.artifact).toBe('net.neoforged:neoforge:21.1.72:userdev');
    expect(resolved.extraRepositories).toEqual([]);
  });

  it('agrees with resolveVersion for an explicit version (offline fast path stays consistent)', async () => {
    const client = new ForgeMavenClient();
    vi.mocked(fetchText).mockResolvedValue(NEOFORGE_METADATA_FIXTURE);
    vi.mocked(fetchJson).mockResolvedValue({ promos: {} });

    const fromNetwork = await client.resolveVersion('1.21.1', '21.1.72', 'neoforge');

    expect(fromNetwork).toEqual(resolveKnownVersion('1.21.1', '21.1.72', 'neoforge'));
  });
});

describe('ForgeMavenClient.resolveVersion (http-client mocked)', () => {
  let client: ForgeMavenClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ForgeMavenClient();
  });

  function mockMetadata(forge: string, neoforge: string) {
    const fetchTextMock = vi.mocked(fetchText);
    fetchTextMock.mockImplementation(async (url: string) =>
      url.includes('maven.minecraftforge.net') ? forge : neoforge,
    );
    vi.mocked(fetchJson).mockResolvedValue({
      promos: { '1.20.1-recommended': '47.4.10' },
    });
  }

  it('defaults to the recommended Forge build and builds the NFRT artifact', async () => {
    mockMetadata(METADATA_FIXTURE, NEOFORGE_METADATA_FIXTURE);

    const resolved = await client.resolveVersion('1.20.1');

    expect(resolved.loaderVersion).toBe('47.4.10'); // from promotions, not the newest 47.4.23
    expect(resolved.cacheKey).toBe('1.20.1-forge-47.4.10');
    expect(resolved.artifact).toBe('net.minecraftforge:forge:1.20.1-47.4.10:userdev');
    expect(resolved.extraRepositories).toEqual(['https://maven.minecraftforge.net']);
  });

  it('resolves an explicit NeoForge version without extra repositories', async () => {
    mockMetadata(METADATA_FIXTURE, NEOFORGE_METADATA_FIXTURE);

    const resolved = await client.resolveVersion('1.21.1', '21.1.72', 'neoforge');

    expect(resolved.cacheKey).toBe('1.21.1-neoforge-21.1.72');
    expect(resolved.artifact).toBe('net.neoforged:neoforge:21.1.72:userdev');
    expect(resolved.extraRepositories).toEqual([]);
  });

  it('rejects an unknown loader version with an actionable message', async () => {
    mockMetadata(METADATA_FIXTURE, NEOFORGE_METADATA_FIXTURE);

    await expect(client.resolveVersion('1.20.1', '99.0.0')).rejects.toThrow(/list_forge_versions/);
  });

  it('rejects an MC version with no Forge builds', async () => {
    mockMetadata(EMPTY_METADATA_FIXTURE, NEOFORGE_METADATA_FIXTURE);

    await expect(client.resolveVersion('1.30.0')).rejects.toThrow(/No forge versions found/);
  });

  it('hints at forge for NeoForge 1.20.1 (legacy artifact, not listed)', async () => {
    mockMetadata(METADATA_FIXTURE, EMPTY_METADATA_FIXTURE);

    await expect(client.resolveVersion('1.20.1', undefined, 'neoforge')).rejects.toThrow(
      /use loader "forge"/,
    );
  });
});
