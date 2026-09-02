// Keeps the in-app guide in sync with docs/UserGuide.md (the canonical copy).
// The docs folder sits outside the Docker build context for the frontend, so
// a missing source is not an error — the committed public copy is served.
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'docs', 'UserGuide.md');
const dest = join(root, 'frontend', 'public', 'user-guide.md');

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log('[copy-guide] docs/UserGuide.md -> frontend/public/user-guide.md');
} else if (!existsSync(dest)) {
  console.error('[copy-guide] no guide source or committed copy found');
  process.exit(1);
} else {
  console.log('[copy-guide] source not present, keeping committed public copy');
}
