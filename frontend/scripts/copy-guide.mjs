// Keeps the in-app guide in sync with docs/UserGuide.md (the canonical copy).
// The docs folder sits outside the Docker build context for the frontend, so
// there the committed public copy (or a placeholder) is used — a missing
// source must never fail the image build.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'docs', 'UserGuide.md');
const dest = join(root, 'frontend', 'public', 'user-guide.md');

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log('[copy-guide] docs/UserGuide.md -> frontend/public/user-guide.md');
} else if (existsSync(dest)) {
  console.log('[copy-guide] source not present, keeping committed public copy');
} else {
  writeFileSync(dest, '# User Guide\n\nThe guide file is missing from this build. See docs/UserGuide.md in the repository.\n');
  console.log('[copy-guide] wrote placeholder guide');
}
