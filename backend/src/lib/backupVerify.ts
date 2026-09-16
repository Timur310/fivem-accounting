import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

/**
 * Proving a backup file can actually be restored.
 *
 * A backup nobody has restored is a file, not a backup. The app's own restore
 * path is covered by tests, but what those tests prove is that the code works
 * — not that *this* server's dump, taken from *this* database with whatever
 * tool versions that host has, comes back whole. The only way to know that is
 * to restore one and look, and the only safe place to do it is somewhere that
 * is not the live database.
 *
 * So this restores a dump into a scratch database of its own, counts what
 * arrived, and throws the scratch database away. Nothing it does can touch the
 * running app: the scratch name is derived and checked against the live one,
 * and the restore refuses outright if they match.
 */

/**
 * The custom-format dump's first five bytes. Repeated from `pgBackup.ts`
 * rather than imported, along with the connection handling below, so that
 * nothing in this file reaches the app's validated environment.
 *
 * That environment insists on a Discord client ID and a JWT secret, which are
 * exactly what a recovery host does not have: somebody restoring onto a fresh
 * machine at three in the morning has a database and a file, and being told
 * to invent an OAuth secret before they may check the file is the last thing
 * they need. This wants a database URL and nothing else.
 */
const DUMP_MAGIC = 'PGDMP';

interface VerifyTarget {
  connEnv: NodeJS.ProcessEnv;
  database: string;
}

/**
 * The database to work beside, from the environment directly.
 *
 * `BACKUP_DATABASE_URL` first for the same reason `pgBackup.ts` prefers it:
 * it is the direct address, and `DATABASE_URL` may point at a pooler. The
 * password rides in the child's environment rather than argv, where `ps`
 * would show it to every process on the host.
 */
function verifyTarget(): VerifyTarget {
  const raw = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Set DATABASE_URL (or BACKUP_DATABASE_URL) to the database to verify beside');

  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
  const connEnv: NodeJS.ProcessEnv = {
    PGHOST: url.hostname || 'localhost',
    PGPORT: url.port || '5432',
    PGDATABASE: database,
  };
  if (url.username) connEnv.PGUSER = decodeURIComponent(url.username);
  if (url.password) connEnv.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) connEnv.PGSSLMODE = sslmode;

  return { connEnv, database };
}

/** Tables that being empty means the dump is wrong, not that the faction is new. */
const MUST_HAVE_ROWS = ['users', 'factions', 'faction_members'] as const;

export interface VerifyReport {
  ok: boolean;
  /** What went wrong, in the order it was noticed. Empty when ok. */
  problems: string[];
  fileBytes: number;
  /** Objects pg_restore found in the archive's table of contents. */
  archiveEntries: number;
  scratchDatabase: string;
  /** Whether a restore was actually attempted — a bad file never gets that far. */
  restored: boolean;
  tableCounts: Record<string, number>;
  totalRows: number;
  /** Seconds the restore itself took — the number worth knowing in an outage. */
  restoreSeconds: number;
}

function run(
  command: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function tool(name: 'pg_restore' | 'psql'): string {
  const dir = process.env.PG_BIN_DIR;
  return dir ? path.join(dir, name) : name;
}

/** The dump's own magic bytes, read without loading the file. */
async function hasMagic(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(DUMP_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, DUMP_MAGIC.length, 0);
    return bytesRead === DUMP_MAGIC.length && buffer.toString('latin1') === DUMP_MAGIC;
  } finally {
    await handle.close();
  }
}

/**
 * Restore `file` into a scratch database and report what arrived.
 *
 * `keep` leaves the scratch database in place for somebody who wants to open
 * it and look around; the default is to drop it, because a second copy of
 * every faction's books sitting on the same host is the thing this feature is
 * supposed to protect against.
 */
export async function verifyDump(
  file: string,
  options: { keep?: boolean; suffix?: string } = {},
): Promise<VerifyReport> {
  const problems: string[] = [];
  const { connEnv, database } = verifyTarget();

  const scratch = `${database}_verify_${options.suffix ?? Date.now().toString(36)}`;

  // The one refusal that matters. Everything else in this file is a report;
  // this is the line between a rehearsal and an outage.
  if (scratch === database) {
    throw new Error('Refusing to restore into the live database');
  }

  const stat = await open(file, 'r').then(async (h) => {
    try { return await h.stat(); } finally { await h.close(); }
  });

  const report: VerifyReport = {
    ok: false,
    problems,
    fileBytes: stat.size,
    archiveEntries: 0,
    scratchDatabase: scratch,
    restored: false,
    tableCounts: {},
    totalRows: 0,
    restoreSeconds: 0,
  };

  if (!await hasMagic(file)) {
    problems.push('Not a custom-format dump: the file does not start with PGDMP.');
    return report;
  }

  // Reading the table of contents proves the archive is intact and readable by
  // the tools on this host before anything is created.
  const toc = await run(tool('pg_restore'), ['--list', file], connEnv);
  if (toc.code !== 0) {
    problems.push(`pg_restore could not read the archive: ${toc.stderr.trim().split('\n')[0]}`);
    return report;
  }
  report.archiveEntries = toc.stdout
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith(';')).length;

  // Connect to the maintenance database to create the scratch one: you cannot
  // CREATE DATABASE from inside the database you are creating.
  const admin = new pg.Client({
    host: connEnv.PGHOST,
    port: Number(connEnv.PGPORT ?? 5432),
    user: connEnv.PGUSER,
    password: connEnv.PGPASSWORD,
    database: 'postgres',
    ...(connEnv.PGSSLMODE && connEnv.PGSSLMODE !== 'disable'
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });

  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.query(`CREATE DATABASE "${scratch}"`);

    const started = Date.now();
    const restored = await run(tool('pg_restore'), [
      '--dbname', scratch,
      // Ownership and grants belong to the server this is restored onto, and a
      // rehearsal that fails on a missing role has told you nothing about the
      // data.
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      file,
    ], { ...connEnv, PGDATABASE: scratch });
    report.restoreSeconds = Math.round((Date.now() - started) / 100) / 10;
    report.restored = true;

    if (restored.code !== 0) {
      problems.push(`Restore failed: ${restored.stderr.trim().split('\n').slice(-1)[0]}`);
    }

    const scratchClient = new pg.Client({
      host: connEnv.PGHOST,
      port: Number(connEnv.PGPORT ?? 5432),
      user: connEnv.PGUSER,
      password: connEnv.PGPASSWORD,
      database: scratch,
      ...(connEnv.PGSSLMODE && connEnv.PGSSLMODE !== 'disable'
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    });
    await scratchClient.connect();
    try {
      const tables = await scratchClient.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );

      if (tables.rows.length === 0) {
        problems.push('The restored database has no tables at all.');
      }

      for (const { table_name: name } of tables.rows) {
        // The name comes from information_schema on a database this function
        // just created, and is quoted; there is no user input in this path.
        const count = await scratchClient.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM "${name}"`,
        );
        const rows = Number(count.rows[0]?.n ?? 0);
        report.tableCounts[name] = rows;
        report.totalRows += rows;
      }

      for (const name of MUST_HAVE_ROWS) {
        if (report.tableCounts[name] === undefined) {
          problems.push(`The table "${name}" is missing from the dump.`);
        } else if (report.tableCounts[name] === 0) {
          problems.push(`"${name}" restored with no rows — a real deployment always has some.`);
        }
      }
    } finally {
      await scratchClient.end();
    }

    if (!options.keep) {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }

  report.ok = problems.length === 0;
  return report;
}
