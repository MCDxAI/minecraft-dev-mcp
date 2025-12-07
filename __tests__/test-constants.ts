/**
 * Shared constants for all test files
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_VERSION = '1.21.10';
export const TEST_MAPPING = 'yarn' as const;
export const METEOR_JAR_PATH = join(__dirname, 'fixtures', 'meteor-client-1.21.10-32.jar');
