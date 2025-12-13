/**
 * Test constants for Minecraft 1.19.4
 * Used for manual version-specific testing
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_VERSION = '1.19.4';
export const TEST_MAPPING = 'yarn' as const;
