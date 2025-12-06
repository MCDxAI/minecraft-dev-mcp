import type { VersionManifest, VersionInfo, VersionJson } from '../types/minecraft.js';
import { VersionNotFoundError } from '../utils/errors.js';

export const MOJANG_VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/**
 * Parse version manifest and find specific version
 */
export function findVersion(manifest: VersionManifest, versionId: string): VersionInfo {
  const version = manifest.versions.find((v) => v.id === versionId);
  if (!version) {
    throw new VersionNotFoundError(versionId);
  }
  return version;
}

/**
 * Get latest release version
 */
export function getLatestRelease(manifest: VersionManifest): VersionInfo {
  return findVersion(manifest, manifest.latest.release);
}

/**
 * Get latest snapshot version
 */
export function getLatestSnapshot(manifest: VersionManifest): VersionInfo {
  return findVersion(manifest, manifest.latest.snapshot);
}

/**
 * Filter versions by type
 */
export function filterVersionsByType(
  manifest: VersionManifest,
  type: VersionInfo['type'],
): VersionInfo[] {
  return manifest.versions.filter((v) => v.type === type);
}

/**
 * Get client JAR download info from version JSON
 */
export function getClientDownload(versionJson: VersionJson) {
  if (!versionJson.downloads.client) {
    throw new Error(`No client download available for version ${versionJson.id}`);
  }
  return versionJson.downloads.client;
}

/**
 * Get server JAR download info from version JSON
 */
export function getServerDownload(versionJson: VersionJson) {
  if (!versionJson.downloads.server) {
    throw new Error(`No server download available for version ${versionJson.id}`);
  }
  return versionJson.downloads.server;
}

/**
 * Get client mappings download info from version JSON
 */
export function getClientMappingsDownload(versionJson: VersionJson) {
  if (!versionJson.downloads.client_mappings) {
    throw new Error(`No client mappings available for version ${versionJson.id}`);
  }
  return versionJson.downloads.client_mappings;
}

/**
 * Check if version requires Java 17+
 */
export function requiresJava17(versionJson: VersionJson): boolean {
  return (versionJson.javaVersion?.majorVersion ?? 8) >= 17;
}
