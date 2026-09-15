import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const base = () => '/api/v1/admin/backup';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

async function status() {
  const res = await api().get(`${base()}/status`).set('Cookie', w.superadmin.cookie);
  expect(res.status).toBe(200);
  return res.body.data as {
    available: boolean;
    pgDumpVersion: string | null;
    serverVersion: string | null;
    databaseSizeBytes: number | null;
    pooledConnection: boolean;
    maxUploadBytes: number;
    lastBackupAt: string | null;
  };
}

/**
 * Who may touch the database itself.
 *
 * This is the one screen where the answer has to be nobody but the superadmin:
 * a dump is every faction's books and every player's Discord ID in one file,
 * and a restore discards everything entered since whenever the file was made.
 */
describe('backup authorization', () => {
  for (const route of ['/status', '/download'] as const) {
    it(`refuses ${route} without a session`, async () => {
      const res = await api().get(`${base()}${route}`);
      expect(res.status).toBe(401);
    });

    it(`refuses ${route} to a faction admin`, async () => {
      const res = await api().get(`${base()}${route}`).set('Cookie', w.admin.cookie);
      expect(res.status).toBe(403);
    });

    it(`refuses ${route} to a plain member`, async () => {
      const res = await api().get(`${base()}${route}`).set('Cookie', w.member.cookie);
      expect(res.status).toBe(403);
    });
  }

  it('refuses a restore from a faction admin', async () => {
    const res = await api()
      .post(`${base()}/restore?confirm=RESTORE`)
      .set('Cookie', w.admin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('PGDMP anything'));
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/backup/status', () => {
  it('reports whether the tools are installed and what they would talk to', async () => {
    const s = await status();
    expect(typeof s.available).toBe('boolean');
    expect(s.maxUploadBytes).toBeGreaterThan(0);
    // The suite runs against a real database, so the size is measurable.
    expect(s.databaseSizeBytes).toBeGreaterThan(0);
    expect(s.serverVersion).toBeTruthy();
  });

  it('has no last backup until one is taken', async () => {
    expect((await status()).lastBackupAt).toBeNull();
  });
});

/**
 * The guards in front of the restore, each of which has to hold *before* the
 * first DROP runs — a restore that fails halfway through is the failure mode
 * this whole route exists to avoid.
 */
describe('POST /admin/backup/restore — refusals', () => {
  /** Nothing in here may disturb the database. */
  async function expectUntouched() {
    const [row] = await db.select().from(users).where(eq(users.id, w.member.id)).limit(1);
    expect(row).toBeDefined();
  }

  it('refuses without the confirmation phrase', async () => {
    const res = await api()
      .post(`${base()}/restore`)
      .set('Cookie', w.superadmin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('PGDMP something'));
    expect(res.status).toBe(400);
    await expectUntouched();
  });

  it('refuses a wrong confirmation phrase', async () => {
    const res = await api()
      .post(`${base()}/restore?confirm=yes`)
      .set('Cookie', w.superadmin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('PGDMP something'));
    expect(res.status).toBe(400);
    await expectUntouched();
  });

  // A screenshot, a CSV, a plain-SQL dump: all of them would make pg_restore
  // fail, but only after the restore was already under way.
  it('refuses a file that is not a custom-format dump', async () => {
    const res = await api()
      .post(`${base()}/restore?confirm=RESTORE`)
      .set('Cookie', w.superadmin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('-- PostgreSQL database dump\nCREATE TABLE x (i int);\n'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a backup file/i);
    await expectUntouched();
  });

  it('refuses an empty body', async () => {
    const res = await api()
      .post(`${base()}/restore?confirm=RESTORE`)
      .set('Cookie', w.superadmin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
    await expectUntouched();
  });
});

/**
 * The round trip, against the real tools and the real database.
 *
 * Skipped where pg_dump is not installed, which is the state of the backend
 * image before this feature's Dockerfile change — the endpoints answer 503
 * there, and there is nothing else to assert.
 */
describe('backup round trip', () => {
  it('a downloaded dump restores the rows it was taken from', async () => {
    const s = await status();
    if (!s.available) {
      console.warn('[backup] pg_dump/pg_restore not on PATH — round trip skipped');
      return;
    }

    const dump = await api()
      .get(`${base()}/download`)
      .set('Cookie', w.superadmin.cookie)
      .responseType('blob');

    expect(dump.status).toBe(200);
    expect(dump.headers['content-disposition']).toMatch(/faction-accountant-.*\.dump/);
    const file = dump.body as Buffer;
    // Custom format, so it opens with pg_dump's magic and nothing else does.
    expect(file.subarray(0, 5).toString('latin1')).toBe('PGDMP');
    expect(file.length).toBeGreaterThan(1000);

    // The download is the only record that a backup was taken, so it has to
    // leave one — the status screen reads it back.
    expect((await status()).lastBackupAt).not.toBeNull();

    // Change the world, then put it back.
    await db.delete(users).where(eq(users.id, w.outsider.id));
    expect(await db.select().from(users).where(eq(users.id, w.outsider.id))).toHaveLength(0);

    const restore = await api()
      .post(`${base()}/restore?confirm=RESTORE`)
      .set('Cookie', w.superadmin.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(file);

    expect(restore.status).toBe(200);
    expect(restore.body.data.restoredBytes).toBe(file.length);
    expect(restore.body.data.safetyBackup).toMatch(/pre-restore-/);

    const back = await db.select().from(users).where(eq(users.id, w.outsider.id));
    expect(back).toHaveLength(1);
    expect(back[0]!.username).toBe(w.outsider.username);
  }, 120_000);
});
