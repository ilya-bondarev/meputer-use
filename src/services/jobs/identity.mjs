import { createHash } from 'node:crypto';

// Preserve v1 serialization exactly: changing key order changes persisted hashes.
export const jobDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
