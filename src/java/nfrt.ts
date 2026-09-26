import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { getJavaResourceDownloader } from '../downloaders/java-resources.js';
import { ForgeSourceError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { executeJavaProcess } from './java-process.js';

export interface NfrtRunOptions {
  /** Full artifact coordinates incl. classifier, e.g. `net.neoforged:neoforge:21.1.72:userdev` or `net.minecraftforge:forge:1.20.1-47.3.0:userdev`. */
  neoforgeArtifact: string;
  /** Distribution to generate (default `joined` — the merged client+server source set mod developers see). */
  dist?: string;
  /** Additional Maven repositories (`--add-repository`); Forge artifacts live on the Forge Maven. */
  extraRepositories?: string[];
  /** NFRT results to materialize: result id -> absolute output path. */
  results: Record<string, string>;
}

/**
 * NeoFormRuntime (NFRT) wrapper — runs the NeoForm/Forge userdev pipeline that
 * produces patched Minecraft artifacts (decompile + MCPConfig patches + loader
 * patches + recompile). One `run` computes the whole execution graph, so every
 * needed result is requested in a single invocation.
 */
export class NeoFormRuntimeWrapper {
  private jarPath: string | null = null;

  /** Ensure the NFRT fat JAR is downloaded */
  private async ensureJar(): Promise<string> {
    if (!this.jarPath) {
      const downloader = getJavaResourceDownloader();
      this.jarPath = await downloader.getNfrtJar();
    }
    return this.jarPath;
  }

  /**
   * Run the pipeline and write the requested results to their paths.
   * Requires Java 21+. First run downloads Minecraft and can take several minutes.
   */
  async run(options: NfrtRunOptions): Promise<void> {
    const jarPath = await this.ensureJar();
    for (const dest of Object.values(options.results)) {
      ensureDir(dirname(dest));
    }

    const args = [
      'run',
      `--dist=${options.dist ?? 'joined'}`,
      `--neoforge=${options.neoforgeArtifact}`,
    ];
    for (const repo of options.extraRepositories ?? []) {
      args.push(`--add-repository=${repo}`);
    }
    for (const [id, dest] of Object.entries(options.results)) {
      args.push(`--write-result=${id}:${dest}`);
    }

    logger.info(`Running NeoFormRuntime: ${args.join(' ')}`);

    try {
      await executeJavaProcess(jarPath, args, {
        maxMemory: '4G',
        minMemory: '1G',
        timeout: 60 * 60 * 1000, // full pipeline: download + decompile + patch + recompile
        onStdout: (data) => {
          if (data.trim()) logger.debug(`nfrt: ${data.trim()}`);
        },
        onStderr: (data) => {
          if (data.trim()) logger.warn(`nfrt: ${data.trim()}`);
        },
      });
      logger.info('NeoFormRuntime pipeline completed');
    } catch (error) {
      // A killed/failed run can leave a truncated results file behind, and the
      // caller treats "results file exists" as "reusable without re-running" —
      // drop whatever partial output this attempt produced.
      for (const dest of Object.values(options.results)) {
        rmSync(dest, { force: true });
      }
      const detail = error instanceof Error ? error.message : String(error);
      // Bound the message — NFRT failures can dump the whole execution-graph log.
      throw new ForgeSourceError(
        `NeoFormRuntime pipeline failed for ${options.neoforgeArtifact}. Last output:\n${detail.slice(-2000)}`,
      );
    }
  }
}

// Singleton instance
let nfrtInstance: NeoFormRuntimeWrapper | undefined;

export function getNeoFormRuntime(): NeoFormRuntimeWrapper {
  if (!nfrtInstance) {
    nfrtInstance = new NeoFormRuntimeWrapper();
  }
  return nfrtInstance;
}
