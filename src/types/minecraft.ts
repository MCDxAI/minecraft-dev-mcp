/**
 * Minecraft version metadata from version_manifest_v2.json
 */
export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionInfo[];
}

export interface VersionInfo {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

/**
 * Version-specific JSON (from version URL)
 */
export interface VersionJson {
  id: string;
  type: string;
  time: string;
  releaseTime: string;
  mainClass: string;
  downloads: {
    client?: Download;
    client_mappings?: Download;
    server?: Download;
    server_mappings?: Download;
  };
  libraries: Library[];
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
}

export interface Download {
  sha1: string;
  size: number;
  url: string;
}

export interface Library {
  name: string;
  downloads: {
    artifact?: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
  };
}

/**
 * Mapping types
 */
export type MappingType = 'yarn' | 'mojmap' | 'intermediary';

/**
 * Tiny mapping entry (simplified)
 */
export interface TinyClass {
  intermediary: string;
  named: string;
  fields: TinyField[];
  methods: TinyMethod[];
}

export interface TinyField {
  intermediary: string;
  named: string;
  descriptor: string;
}

export interface TinyMethod {
  intermediary: string;
  named: string;
  descriptor: string;
}

/**
 * Registry data types
 */
export interface RegistryData {
  [registryType: string]: {
    [entryId: string]: RegistryEntry;
  };
}

export interface RegistryEntry {
  protocol_id?: number;
  [key: string]: unknown;
}
