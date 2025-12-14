/**
 * Shared constants for all test files
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_VERSION = '1.21.11';
export const TEST_MAPPING = 'yarn' as const;
export const METEOR_JAR_PATH = join(__dirname, 'fixtures', 'meteor-client-1.21.10-32.jar');
