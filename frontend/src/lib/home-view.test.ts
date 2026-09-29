import { describe, it, expect } from 'vitest';
import { homeViewFor } from './home-view';
import type { FactionMembership, FactionPermission } from './api-types';

const member = (role: 'admin' | 'member', permissions: FactionPermission[] = []): FactionMembership => ({
  id: 'm', factionId: 'f', role, joinedAt: '', factionName: 'F', factionActive: true,
  factionBrandColor: null, rank: null, permissions,
});

describe('the first screen after signing in', () => {
  it('puts a plain member on My day', () => {
    expect(homeViewFor(member('member'))).toBe('my-day');
  });

  it('keeps a member who works the counter on My day', () => {
    expect(homeViewFor(member('member', ['sell', 'log_shifts', 'log_operations']))).toBe('my-day');
  });

  it('puts an admin on the dashboard', () => {
    expect(homeViewFor(member('admin'))).toBe('dashboard');
  });

  it('puts a rank that looks after the faction on the dashboard', () => {
    expect(homeViewFor(member('member', ['view_reports']))).toBe('dashboard');
    expect(homeViewFor(member('member', ['manage_members']))).toBe('dashboard');
  });

  it('falls back to the dashboard with no membership to go on', () => {
    expect(homeViewFor(undefined)).toBe('dashboard');
  });
});
