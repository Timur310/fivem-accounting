import request from 'supertest';
import jwt from 'jsonwebtoken';
import { db } from '../src/db/index.js';
import {
  users,
  factions,
  factionMembers,
  itemTypes,
  entries,
  payouts,
  quotas,
  memberNotes,
  strikes,
  auditLogs,
} from '../src/db/schema.js';
import { sql } from 'drizzle-orm';
import app from '../src/app.js';
import { COOKIE_NAME } from '../src/auth/index.js';
import { todayDateString } from '../src/lib/date.js';

export const api = () => request(app);

/**
 * Wipe every table between tests.
 *
 * Order matters: audit_logs and the leaf tables reference factions/users
 * without ON DELETE CASCADE, so they have to go first.
 */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      ${auditLogs}, ${strikes}, ${memberNotes}, ${payouts}, ${entries},
      ${quotas}, ${itemTypes}, ${factionMembers}, ${factions}, ${users}
    RESTART IDENTITY CASCADE
  `);
}

let discordSeq = 0;
/** Discord IDs are unique and max 20 chars; keep them short and collision-free. */
function nextDiscordId(): string {
  discordSeq += 1;
  return `9${String(discordSeq).padStart(18, '0')}`;
}

export interface TestUser {
  id: string;
  username: string;
  discordId: string;
  /** Cookie header value, ready to pass to `.set('Cookie', ...)`. */
  cookie: string;
}

export async function createUser(
  username: string,
  role: 'member' | 'faction_admin' | 'superadmin' = 'member',
): Promise<TestUser> {
  const discordId = nextDiscordId();
  const [row] = await db
    .insert(users)
    .values({ discordId, username, role })
    .returning();
  if (!row) throw new Error('failed to create test user');

  const token = jwt.sign({ userId: row.id, role }, process.env.JWT_SECRET!, {
    expiresIn: '1d',
  });
  return { id: row.id, username, discordId, cookie: `${COOKIE_NAME}=${token}` };
}

/** A cookie for a user id that does not exist, to exercise the 401 path. */
export function cookieForUnknownUser(): string {
  const token = jwt.sign(
    { userId: '00000000-0000-0000-0000-000000000000', role: 'member' },
    process.env.JWT_SECRET!,
    { expiresIn: '1d' },
  );
  return `${COOKIE_NAME}=${token}`;
}

export const EXPIRED_COOKIE = `${COOKIE_NAME}=not-a-valid-jwt`;

export interface TestFaction {
  id: string;
  name: string;
}

export async function createFaction(name: string, createdBy: string): Promise<TestFaction> {
  const [row] = await db
    .insert(factions)
    .values({ name, createdBy })
    .returning();
  if (!row) throw new Error('failed to create test faction');
  return { id: row.id, name };
}

export async function addMember(
  factionId: string,
  userId: string,
  role: 'admin' | 'member' = 'member',
): Promise<void> {
  await db.insert(factionMembers).values({ factionId, userId, role });
}

export async function createItemType(
  factionId: string,
  name = 'Cash',
  opts: { unit?: string; isCurrency?: boolean; isActive?: boolean } = {},
): Promise<string> {
  const [row] = await db
    .insert(itemTypes)
    .values({
      factionId,
      name,
      unit: opts.unit ?? '$',
      isCurrency: opts.isCurrency ?? true,
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!row) throw new Error('failed to create item type');
  return row.id;
}

export async function createEntry(
  factionId: string,
  userId: string,
  itemTypeId: string,
  amount = '1000.00',
  entryDate = todayDateString(),
): Promise<string> {
  const [row] = await db
    .insert(entries)
    .values({ factionId, userId, itemTypeId, amount, entryDate })
    .returning();
  if (!row) throw new Error('failed to create entry');
  return row.id;
}

export async function createPayout(
  factionId: string,
  recipientUserId: string,
  createdBy: string,
  itemTypeId: string,
  amount = '500.00',
  status: 'pending' | 'approved' | 'rejected' | 'completed' = 'completed',
): Promise<string> {
  const [row] = await db
    .insert(payouts)
    .values({
      factionId,
      recipientUserId,
      createdBy,
      itemTypeId,
      amount,
      payoutDate: todayDateString(),
      status,
    })
    .returning();
  if (!row) throw new Error('failed to create payout');
  return row.id;
}

export async function createQuota(
  factionId: string,
  itemTypeId: string,
  targetAmount = '10000.00',
  periodType: 'weekly' | 'monthly' = 'monthly',
): Promise<string> {
  const [row] = await db
    .insert(quotas)
    .values({
      factionId,
      itemTypeId,
      targetAmount,
      periodType,
      periodStart: todayDateString(),
    })
    .returning();
  if (!row) throw new Error('failed to create quota');
  return row.id;
}

/**
 * The arrangement most suites need: a faction with an admin, a plain member,
 * an outsider who belongs to no faction, and one currency item type.
 */
export interface BasicWorld {
  admin: TestUser;
  member: TestUser;
  outsider: TestUser;
  superadmin: TestUser;
  faction: TestFaction;
  itemTypeId: string;
}

export async function seedBasicWorld(): Promise<BasicWorld> {
  const admin = await createUser('admin_user', 'faction_admin');
  const member = await createUser('member_user');
  const outsider = await createUser('outsider_user');
  const superadmin = await createUser('super_user', 'superadmin');

  const faction = await createFaction('Test Faction', admin.id);
  await addMember(faction.id, admin.id, 'admin');
  await addMember(faction.id, member.id, 'member');

  const itemTypeId = await createItemType(faction.id);
  return { admin, member, outsider, superadmin, faction, itemTypeId };
}

/** UUID that is well-formed but never present, for 404 checks. */
export const MISSING_UUID = '11111111-2222-3333-4444-555555555555';
