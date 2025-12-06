import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logger } from '../utils/logger.js';
import { DownloadError } from '../utils/errors.js';

export interface DownloadOptions {
  maxRetries?: number;
  retryDelay?: number;
  onProgress?: (downloaded: number, total: number) => void;
}

/**
 * Download a file with retry logic
 */
export async function downloadFile(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<void> {
  const { maxRetries = 3, retryDelay = 1000, onProgress } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.info(`Retry attempt ${attempt + 1}/${maxRetries} for ${url}`);
        await sleep(retryDelay * attempt);
      }

      await downloadFileOnce(url, destination, onProgress);
      return;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Download attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw new DownloadError(url, `Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

async function downloadFileOnce(
  url: string,
  destination: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  logger.info(`Downloading ${url} -> ${destination}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const totalSize = Number.parseInt(response.headers.get('content-length') || '0', 10);
  let downloadedSize = 0;

  // Convert Web ReadableStream to Node.js Readable
  const nodeStream = Readable.fromWeb(response.body as never);

  // Track progress
  nodeStream.on('data', (chunk: Buffer) => {
    downloadedSize += chunk.length;
    if (onProgress && totalSize > 0) {
      onProgress(downloadedSize, totalSize);
    }
  });

  // Create write stream
  const fileStream = createWriteStream(destination);

  try {
    await pipeline(nodeStream, fileStream);
    logger.info(`Download complete: ${destination} (${downloadedSize} bytes)`);
  } catch (error) {
    fileStream.destroy();
    throw error;
  }
}

/**
 * Fetch JSON from URL
 */
export async function fetchJson<T>(url: string): Promise<T> {
  logger.debug(`Fetching JSON from ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new DownloadError(url, `HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data as T;
}

/**
 * Fetch text from URL
 */
export async function fetchText(url: string): Promise<string> {
  logger.debug(`Fetching text from ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new DownloadError(url, `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
