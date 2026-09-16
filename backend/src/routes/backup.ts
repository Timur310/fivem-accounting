import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { sql, desc, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createAuditLog } from '../lib/audit.js';
import { env } from '../lib/env.js';
import {
  DUMP_MAGIC, StderrTail, backupFilename, resolveTarget, spawnTool, toolVersion,
} from '../lib/pgBackup.js';

/**
 * The superadmin's copy of the database.
 *
 * Two operations, both deliberately manual: take a dump and send it to the
 * browser, and take a dump the operator already has and put it back. Nothing
 * is kept on the server — a backup that lives next to the database it protects
 * is not a backup, and this way there is no second copy of every player's
 * Discord ID sitting in a directory waiting to be found.
 *
 * The cost of that choice, stated plainly because the operator has to live
 * with it: a backup is exactly as fresh as the last time somebody clicked.
 *
 * The format is pg_dump's custom format (-Fc) rather than plain SQL. It is
 * compressed, it restores with --clean in one transaction, and it can be
 * inspected or partially restored with pg_restore.
 */
const router = asyncRouter();

router.use(requireAuth, requireSuperadmin);

/**
 * Both operations read or rewrite the entire database, so they get a bucket of
 * their own well below the general one. Six an hour is more than any real use
 * needs and far too few to be worth abusing.
 */
const heavyLimit = rateLimit({
  windowMs: 60 * 60_000,
  maxRequests: 6,
  message: 'Too many backup operations. Please wait before trying again.',
});

/** The phrase the restore endpoint demands, so no single click can reach it. */
const RESTORE_CONFIRMATION = 'RESTORE';

// ── GET /status — can this deployment do it, and to what ──

router.get('/status', async (_req: Request, res: Response) => {
  const target = resolveTarget();
  const [dumpVersion, restoreVersion] = await Promise.all([
    toolVersion('pg_dump'),
    toolVersion('pg_restore'),
  ]);

  let databaseSizeBytes: number | null = null;
  let serverVersion: string | null = null;
  try {
    const sizeRows = await db.execute<{ size: string; version: string }>(sql`
      SELECT pg_database_size(current_database())::text AS size,
             current_setting('server_version') AS version
    `);
    const row = sizeRows.rows[0];
    if (row) {
      databaseSizeBytes = Number(row.size);
      serverVersion = row.version;
    }
  } catch {
    // A status screen that cannot measure the database is still worth showing:
    // the part the operator came for is whether the tools are installed.
  }

  // Backups are not stored, so "when was the last one" can only be answered by
  // the audit log — which is itself the reason every download writes one.
  const [last] = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'database'), eq(auditLogs.action, 'backup')))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  success(res, {
    available: dumpVersion !== null && restoreVersion !== null,
    pgDumpVersion: dumpVersion,
    pgRestoreVersion: restoreVersion,
    serverVersion,
    databaseSizeBytes,
    target: target.label,
    // True when the tools would be talking to the pooler, which they cannot.
    pooledConnection: !env.BACKUP_DATABASE_URL,
    maxUploadBytes: env.BACKUP_MAX_UPLOAD_MB * 1024 * 1024,
    lastBackupAt: last?.createdAt ?? null,
  });
});

// ── GET /download — stream a fresh dump to the browser ──

router.get('/download', heavyLimit, (req: Request, res: Response) => {
  const filename = backupFilename();
  const stderr = new StderrTail();

  const child = spawnTool('pg_dump', [
    '--format=custom',
    '--compress=9',
    // The app's own role owns everything, and a restore into a fresh database
    // should not fail because a role name from the old server is missing.
    '--no-owner',
    '--no-privileges',
  ]);

  /**
   * Headers wait for the first byte.
   *
   * Setting them up front is the obvious way and the wrong one: a missing
   * pg_dump or a refused connection would then arrive as a downloaded file
   * containing an error message, named .dump, indistinguishable from a real
   * backup until the day somebody tried to restore it.
   */
  let started = false;
  let failed = false;

  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  child.on('error', () => {
    failed = true;
    if (!started && !res.headersSent) {
      error(res, 'BACKUP_UNAVAILABLE',
        'pg_dump is not installed on the server. See the deployment notes.', 503);
    }
  });

  child.stdout.on('data', (chunk: Buffer) => {
    if (!started) {
      started = true;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // Nothing about a dump should ever be served from a cache.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Backup-Filename', filename);
    }
    if (!res.write(chunk)) {
      child.stdout.pause();
      res.once('drain', () => child.stdout.resume());
    }
  });

  // The client closing the tab should not leave pg_dump running against the
  // database for however long the rest of the dump would take.
  res.on('close', () => {
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
  });

  child.on('close', (code) => {
    if (failed) return;

    if (code !== 0) {
      if (!started && !res.headersSent) {
        error(res, 'BACKUP_FAILED', stderr.lastLine() || 'pg_dump failed', 500);
        return;
      }
      // Bytes are already on the wire, so there is no way to turn this into an
      // error response. Destroy the connection instead: the browser reports a
      // failed download rather than saving a truncated file that looks whole.
      res.destroy();
      return;
    }

    if (!started) {
      // Exit 0 with no output should not be possible, but an empty file named
      // like a backup is the worst thing this route could produce.
      error(res, 'BACKUP_FAILED', 'pg_dump produced no output', 500);
      return;
    }

    res.end();
    void createAuditLog({
      userId: req.user!.id,
      action: 'backup',
      entityType: 'database',
      details: { filename },
      req,
    }).catch(() => undefined);
  });
});

// ── POST /restore — put an uploaded dump back ──────────

/**
 * The body is the dump file itself, sent as application/octet-stream.
 *
 * Not multipart: that would mean a parser and a dependency to hold a
 * half-gigabyte file in memory or in a second temporary copy, in order to
 * transport one file with no other fields beside it.
 */
router.post('/restore', heavyLimit, async (req: Request, res: Response) => {
  if (req.query.confirm !== RESTORE_CONFIRMATION) {
    error(res, 'VALIDATION_ERROR',
      `Restoring replaces the entire database. Send confirm=${RESTORE_CONFIRMATION}.`, 400);
    return;
  }

  const maxBytes = env.BACKUP_MAX_UPLOAD_MB * 1024 * 1024;
  const dir = await mkdtemp(path.join(tmpdir(), 'fa-restore-'));
  const uploadPath = path.join(dir, 'upload.dump');
  const safetyPath = path.join(dir, `pre-restore-${backupFilename()}`);

  const cleanup = async (keepSafety: boolean) => {
    await unlink(uploadPath).catch(() => undefined);
    if (!keepSafety) await unlink(safetyPath).catch(() => undefined);
  };

  // ── 1. Land the upload on disk ──
  //
  // Streamed to a file rather than restored straight from the socket: the file
  // has to be checked before a single DROP runs, and a network hiccup halfway
  // through must not leave a half-restored database behind.
  let received = 0;
  let tooLarge = false;
  try {
    const sink = createWriteStream(uploadPath);
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes && !tooLarge) {
        tooLarge = true;
        req.destroy();
      }
    });
    await pipeline(req, sink);
  } catch {
    await cleanup(false);
    if (tooLarge) {
      error(res, 'VALIDATION_ERROR',
        `Backup file is larger than the ${env.BACKUP_MAX_UPLOAD_MB} MB limit.`, 413);
    } else {
      error(res, 'VALIDATION_ERROR', 'Upload failed before the file was complete.', 400);
    }
    return;
  }

  // ── 2. Refuse anything that is not a custom-format dump ──
  //
  // pg_restore given a plain-SQL file or a stray screenshot fails anyway, but
  // it fails after the restore has been set in motion. Five bytes answer it
  // beforehand.
  const size = (await stat(uploadPath)).size;
  if (size < 16) {
    await cleanup(false);
    error(res, 'VALIDATION_ERROR', 'That file is empty.', 400);
    return;
  }
  if (await readMagic(uploadPath) !== DUMP_MAGIC) {
    await cleanup(false);
    error(res, 'VALIDATION_ERROR',
      'That is not a backup file. Restore expects the .dump this page produces.', 400);
    return;
  }

  // ── 3. Take a safety copy of what is about to be replaced ──
  //
  // The operator asked to overwrite the database; they did not ask to lose
  // what was in it if the file turns out to be the wrong one. This copy lives
  // in the server's temporary directory, and its path is in the response and
  // in the audit log.
  const safety = await dumpToFile(safetyPath);
  if (!safety.ok) {
    await cleanup(false);
    error(res, 'BACKUP_FAILED',
      `Refusing to restore: the safety backup failed (${safety.message}).`, 500);
    return;
  }

  // Written before the restore, so it is inside the safety copy and so an
  // interrupted restore still leaves a record that somebody tried.
  await createAuditLog({
    userId: req.user!.id,
    action: 'restore_started',
    entityType: 'database',
    details: { bytes: size, safetyBackup: safetyPath },
    req,
  }).catch(() => undefined);

  // ── 4. Restore ──
  const result = await restoreFromFile(uploadPath);
  await cleanup(true);

  if (!result.ok) {
    error(res, 'RESTORE_FAILED',
      `${result.message} The database was left unchanged; the safety backup is at ${safetyPath}.`,
      500);
    return;
  }

  // Best-effort, and it has to be: the users table now holds whatever the
  // backup held, so the account that asked for this may no longer exist and
  // the audit row's foreign key would fail. That is not a failed restore.
  await createAuditLog({
    userId: req.user!.id,
    action: 'restore',
    entityType: 'database',
    details: { bytes: size, safetyBackup: safetyPath },
    req,
  }).catch(() => undefined);

  success(res, {
    restoredBytes: size,
    safetyBackup: safetyPath,
    warnings: result.warnings,
  });
});

// ── helpers ───────────────────────────────────────────

async function readMagic(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(DUMP_MAGIC.length);
    await handle.read(buf, 0, buf.length, 0);
    return buf.toString('latin1');
  } finally {
    await handle.close();
  }
}

/** pg_dump straight to a path on the server, used for the pre-restore copy. */
function dumpToFile(file: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const stderr = new StderrTail();
    const child = spawnTool('pg_dump', [
      '--format=custom', '--compress=9', '--no-owner', '--no-privileges',
      `--file=${file}`,
    ]);
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', () => resolve({ ok: false, message: 'pg_dump is not installed' }));
    child.on('close', (code) =>
      resolve(code === 0
        ? { ok: true, message: '' }
        : { ok: false, message: stderr.lastLine() || `pg_dump exited ${code}` }),
    );
  });
}

/**
 * pg_restore the uploaded file over the live database.
 *
 * `--single-transaction` is the whole safety story: every DROP and every COPY
 * happen in one transaction, so a file that fails halfway leaves the database
 * exactly as it was. It also implies `--exit-on-error`, which is what makes
 * "it printed some warnings" and "it did not work" different outcomes.
 *
 * `lock_timeout` matters because `--clean` needs an exclusive lock on every
 * table while the app is still serving requests. Without it, a restore sitting
 * behind one long-running query waits forever with nothing to see from outside.
 */
function restoreFromFile(
  file: string,
): Promise<{ ok: true; warnings: string[] } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const stderr = new StderrTail();
    const child = spawnTool(
      'pg_restore',
      [
        '--clean', '--if-exists', '--no-owner', '--no-privileges',
        '--single-transaction',
        '--dbname', resolveTarget().database,
        file,
      ],
      { PGOPTIONS: '-c lock_timeout=60s -c statement_timeout=0' },
    );
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', () => resolve({ ok: false, message: 'pg_restore is not installed.' }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, message: stderr.lastLine() || `pg_restore exited ${code}.` });
        return;
      }
      const warnings = stderr
        .all()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(-20);
      resolve({ ok: true, warnings });
    });
  });
}

export default router;
