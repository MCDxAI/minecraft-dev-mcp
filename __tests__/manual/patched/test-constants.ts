/**
 * Test constants for the patched-Minecraft JAR suite.
 *
 * Driven entirely by environment variables so the same suite covers Forge,
 * NeoForge, and any future patched-MC source. The CI workflow generates a
 * patched JAR via NFRT/ForgeGradle and exports the env vars below.
 *
 * Required:
 *   PATCHED_JAR_PATH      Absolute path to the patched MC JAR
 *   PATCHED_VERSION       Cache key, e.g. 1.21.1-neoforge-21.1.72
 *   PATCHED_MC_VERSION    Vanilla MC version embedded in the patched JAR (e.g. 1.21.1)
 *   PATCHED_LOADER        'forge' or 'neoforge' (controls which loader package we expect)
 */

export const PATCHED_JAR_PATH = process.env.PATCHED_JAR_PATH ?? '';
export const PATCHED_VERSION = process.env.PATCHED_VERSION ?? '';
export const PATCHED_MC_VERSION = process.env.PATCHED_MC_VERSION ?? '';
export const PATCHED_LOADER = (process.env.PATCHED_LOADER ?? 'neoforge').toLowerCase() as
  | 'forge'
  | 'neoforge';
export const PATCHED_MAPPING = 'mojmap' as const;

/**
 * Top-level loader package the test asserts decompiled output for.
 */
export const LOADER_PACKAGE_PREFIX =
  PATCHED_LOADER === 'forge' ? 'net.minecraftforge' : 'net.neoforged';
