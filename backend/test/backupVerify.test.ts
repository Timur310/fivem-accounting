import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { verifyDump } from '../src/lib/backupVerify.js';
import { toolVersion } from '../src/lib/pgBackup.js';

let w: BasicWorld;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** A real dump of the test database, taken the way the app takes one. */
async function downloadDump(): Promise<Buffer> {
  const res = await api()
    .get('/api/v1/admin/backup/download')
    .set('Cookie', w.superadmin.cookie)
    .responseType('blob');
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

async function toolsInstalled(): Promise<boolean> {
  return (await toolVersion('pg_restore')) !== null;
}

/**
 * The rehearsal, rehearsed.
 *
 * A backup nobody has restored is a file, not a backup — and a verifier nobody
 * has run against a real dump is a script, not a verification. These run the
 * whole thing: take a dump through the app's own endpoint, restore it into a
 * scratch database, count what came back, drop the scratch database.
 *
 * Skipped where the Postgres tools are not installed, like the round trip in
 * backup.test.ts: there is nothing to assert on a host that cannot dump.
 */
describe('verifying a dump', () => {
  it('restores a real dump and counts what came back', async () => {
    if (!await toolsInstalled()) {
      console.warn('[backup] pg_restore not on PATH — verification skipped');
      return;
    }

    const file = path.join(os.tmpdir(), `verify-ok-${Date.now()}.dump`);
    await writeFile(file, await downloadDump());

    try {
      const report = await verifyDump(file, { suffix: 'test1' });

      expect(report.problems).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.archiveEntries).toBeGreaterThan(0);
      expect(report.fileBytes).toBeGreaterThan(1000);

      // The counts are the point. A dump that restores cleanly but brings back
      // four rows of forty thousand has failed in the way that matters.
      expect(report.tableCounts.users).toBeGreaterThanOrEqual(4);
      expect(report.tableCounts.factions).toBeGreaterThanOrEqual(1);
      expect(report.totalRows).toBeGreaterThan(0);
    } finally {
      await unlink(file).catch(() => {});
    }
  }, 180_000);

  // The scratch database is a second copy of every faction's books. It exists
  // for the length of the check and no longer.
  it('leaves no scratch database behind', async () => {
    if (!await toolsInstalled()) return;

    const file = path.join(os.tmpdir(), `verify-drop-${Date.now()}.dump`);
    await writeFile(file, await downloadDump());

    try {
      const report = await verifyDump(file, { suffix: 'test2' });
      const again = await verifyDump(file, { suffix: 'test2' });
      // The same name works twice over, which it could not if the first run
      // had left its database in place and the second refused to create it.
      expect(report.scratchDatabase).toBe(again.scratchDatabase);
      expect(again.ok).toBe(true);
    } finally {
      await unlink(file).catch(() => {});
    }
  }, 240_000);

  it('rejects a file that is not a dump', async () => {
    const file = path.join(os.tmpdir(), `verify-junk-${Date.now()}.dump`);
    await writeFile(file, Buffer.from('this is not a database backup'));

    try {
      const report = await verifyDump(file, { suffix: 'test3' });
      expect(report.ok).toBe(false);
      expect(report.problems[0]).toMatch(/PGDMP/);
      // Nothing was created: the magic check happens before any database is.
      expect(report.tableCounts).toEqual({});
    } finally {
      await unlink(file).catch(() => {});
    }
  }, 60_000);

  it('rejects a truncated dump rather than reporting a clean restore', async () => {
    if (!await toolsInstalled()) return;

    const whole = await downloadDump();
    const file = path.join(os.tmpdir(), `verify-cut-${Date.now()}.dump`);
    // Keeps the magic bytes, loses the rest — the shape a half-finished
    // download or a full disk leaves behind.
    await writeFile(file, whole.subarray(0, Math.floor(whole.length / 2)));

    try {
      const report = await verifyDump(file, { suffix: 'test4' });
      expect(report.ok).toBe(false);
      expect(report.problems.length).toBeGreaterThan(0);
    } finally {
      await unlink(file).catch(() => {});
    }
  }, 120_000);
});
