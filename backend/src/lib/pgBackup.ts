import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { env } from './env.js';

/**
 * Running pg_dump and pg_restore against this deployment's database.
 *
 * The two rules that shape this file:
 *
 * 1. **Never go through pgbouncer.** `DATABASE_URL` points at a pooler in
 *    transaction mode. A dump is one session holding one snapshot across
 *    thousands of statements; transaction pooling gives that session to
 *    somebody else between them. `BACKUP_DATABASE_URL` is the direct address.
 * 2. **Never put the password in argv.** Anything on a command line is
 *    readable by every process on the host through `ps`. The connection
 *    travels in the child's environment instead, which is why the URL is
 *    taken apart here rather than passed along whole.
 */

/** The custom-format dump's first five bytes. pg_dump writes them; nothing else does. */
export const DUMP_MAGIC = 'PGDMP';

export interface PgTarget {
  /** Environment for the child process — PGHOST and friends, no argv secrets. */
  connEnv: NodeJS.ProcessEnv;
  /** For display: host:port/database, never the password. */
  label: string;
  database: string;
}

/**
 * Translate a connection URL into the PG* variables libpq reads.
 *
 * Every Postgres client tool accepts these, so the same target works for
 * pg_dump, pg_restore and `--version` probes without a second code path.
 */
export function resolveTarget(): PgTarget {
  const raw = env.BACKUP_DATABASE_URL || env.DATABASE_URL;
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
  const host = url.hostname || 'localhost';
  const port = url.port || '5432';

  const connEnv: NodeJS.ProcessEnv = {
    PGHOST: host,
    PGPORT: port,
    PGDATABASE: database,
  };
  if (url.username) connEnv.PGUSER = decodeURIComponent(url.username);
  if (url.password) connEnv.PGPASSWORD = decodeURIComponent(url.password);

  // sslmode rides along in the query string of most managed-Postgres URLs.
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) connEnv.PGSSLMODE = sslmode;

  return { connEnv, label: `${host}:${port}/${database}`, database };
}

/** Absolute path to a Postgres tool, or its bare name when PATH should find it. */
export function toolPath(tool: 'pg_dump' | 'pg_restore'): string {
  return env.PG_BIN_DIR ? path.join(env.PG_BIN_DIR, tool) : tool;
}

/** Spawn a Postgres tool already pointed at the backup target. */
export function spawnTool(
  tool: 'pg_dump' | 'pg_restore',
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcessWithoutNullStreams {
  const { connEnv } = resolveTarget();
  return spawn(toolPath(tool), args, {
    env: { ...process.env, ...connEnv, ...extraEnv },
    windowsHide: true,
  });
}

/**
 * Whether the tools are installed, and which version.
 *
 * The page asks this before offering the buttons: an image built without
 * postgresql-client should say so plainly rather than fail on the click.
 */
export async function toolVersion(tool: 'pg_dump' | 'pg_restore'): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnTool(tool, ['--version']);
    } catch {
      done(null);
      return;
    }

    // A tool that answers `--version` but never exits would hang the status
    // request, and the status request is what tells the operator anything at
    // all — so it gets a deadline.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(null);
    }, 5_000);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0 ? out.trim() || null : null);
    });
  });
}

/** `faction-accountant-2026-09-15-1432.dump` — sortable, and says what it is. */
export function backupFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`;
  return `faction-accountant-${stamp}.dump`;
}

/**
 * Keep the tail of a tool's stderr for the error message.
 *
 * Capped because pg_restore on a badly wrong file can produce megabytes of
 * complaints, and none of it should reach a JSON response or a log line.
 */
export class StderrTail {
  private text = '';
  constructor(private readonly limit = 4_000) {}

  push(chunk: Buffer | string): void {
    this.text = (this.text + chunk.toString()).slice(-this.limit);
  }

  /** The most useful single line: the last one that says something. */
  lastLine(): string {
    const lines = this.text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines[lines.length - 1] ?? '';
  }

  all(): string {
    return this.text;
  }
}
