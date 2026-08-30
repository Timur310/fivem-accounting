import { describe, it, expect } from 'vitest';
import { resolveAvatarUrl } from '../src/auth/index.js';

describe('resolveAvatarUrl', () => {
  it('uses the custom avatar when one exists', () => {
    expect(resolveAvatarUrl({ id: '416866124991299584', avatar: 'abc123', discriminator: '0' }))
      .toBe('https://cdn.discordapp.com/avatars/416866124991299584/abc123.png');
  });

  it('falls back to a default image instead of returning nothing', () => {
    const url = resolveAvatarUrl({ id: '416866124991299584', avatar: null, discriminator: '0' });
    expect(url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });

  it('derives the index from the user id for migrated accounts', () => {
    // (416866124991299584 >> 22) % 6
    const expected = Number((416866124991299584n >> 22n) % 6n);
    expect(resolveAvatarUrl({ id: '416866124991299584', avatar: null, discriminator: '0' }))
      .toBe(`https://cdn.discordapp.com/embed/avatars/${expected}.png`);
  });

  it('derives the index from the discriminator for legacy accounts', () => {
    // Legacy scheme has five images, chosen by discriminator % 5.
    expect(resolveAvatarUrl({ id: '1', avatar: null, discriminator: '1234' }))
      .toBe('https://cdn.discordapp.com/embed/avatars/4.png');
    expect(resolveAvatarUrl({ id: '1', avatar: null, discriminator: '0005' }))
      .toBe('https://cdn.discordapp.com/embed/avatars/0.png');
  });

  it('treats a missing discriminator as a migrated account', () => {
    const withField = resolveAvatarUrl({ id: '416866124991299584', avatar: null, discriminator: '0' });
    const without = resolveAvatarUrl({ id: '416866124991299584', avatar: null });
    expect(without).toBe(withField);
  });

  it('stays within the six default images for a spread of ids', () => {
    const ids = [
      '80351110224678912', '155149108183695360', '41771983423143937',
      '416866124991299584', '999999999999999999', '4194304',
    ];
    for (const id of ids) {
      const url = resolveAvatarUrl({ id, avatar: null, discriminator: '0' });
      expect(url).toMatch(/embed\/avatars\/[0-5]\.png$/);
    }
  });

  it('never returns null, which is what left members faceless before', () => {
    const url = resolveAvatarUrl({ id: '416866124991299584', avatar: null });
    expect(url).toBeTypeOf('string');
    expect(url.length).toBeGreaterThan(0);
  });
});
