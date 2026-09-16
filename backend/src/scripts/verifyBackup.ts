import { verifyDump } from '../lib/backupVerify.js';

/**
 * Rehearse a restore, on the server that would have to do it for real.
 *
 *   npm run backup:verify -- ./faction-accountant-2026-09-16.dump
 *   npm run backup:verify -- ./latest.dump --keep
 *
 * Download a backup from the Backup page, then run this against the file. It
 * restores into a scratch database of its own, counts what came back, and
 * throws the scratch database away — the live database is never touched, and
 * the script refuses to start if the two names could ever be the same.
 *
 * Run it after any change to the database, the Postgres version, or the host.
 * The answer you want is boring; the day it stops being boring is the day you
 * would otherwise have found out during an outage.
 */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const keep = args.includes('--keep');

if (!file) {
  console.error('Usage: npm run backup:verify -- <dump-file> [--keep]');
  process.exit(2);
}

try {
  const report = await verifyDump(file, { keep });

  const mb = (report.fileBytes / 1_000_000).toFixed(1);
  console.log('');
  console.log(`  File            ${file} (${mb} MB)`);
  console.log(`  Archive entries ${report.archiveEntries}`);
  // Only when one happened. A file that failed its first check never had a
  // database made for it, and saying otherwise sends somebody looking for it.
  if (report.restored) {
    console.log(`  Restored into   ${report.scratchDatabase}${keep ? ' (kept)' : ' (dropped)'}`);
    console.log(`  Restore took    ${report.restoreSeconds}s`);
    console.log(`  Rows            ${report.totalRows.toLocaleString('en-US')} across ${Object.keys(report.tableCounts).length} tables`);
  }
  console.log('');

  // The per-table counts are the part worth reading: a dump that restores
  // cleanly but brought back 4 entries when the app has 40,000 has failed in
  // the way that matters, and only the numbers say so.
  const widest = Math.max(...Object.keys(report.tableCounts).map((n) => n.length), 0);
  for (const [name, count] of Object.entries(report.tableCounts)) {
    console.log(`    ${name.padEnd(widest)}  ${count.toLocaleString('en-US').padStart(10)}`);
  }
  console.log('');

  if (report.ok) {
    console.log('  This backup restores. Check the counts above against what you expect.');
    process.exit(0);
  }

  for (const problem of report.problems) console.error(`  PROBLEM  ${problem}`);
  console.error('');
  console.error('  This backup did NOT verify. Do not rely on it.');
  process.exit(1);
} catch (err) {
  console.error(`  Could not verify: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
