import { Role, hasPermission } from '@teable/core';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import type { CollaboratorItem } from '@teable/openapi';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  allowed,
  assignable,
  editable,
  loadGrants,
  membersFrom,
  replacement,
  signature,
} from './authority-data';

const grant = (
  role: (typeof Role)[keyof typeof Role],
  resourceType = CollaboratorType.Base,
  userId = 'usr-test'
): CollaboratorItem => ({
  type: PrincipalType.User,
  userId,
  userName: 'Test person',
  email: 'test@example.invalid',
  role,
  resourceType,
  avatar: null,
  createdTime: '2026-11-16T00:00:00.000Z',
});
afterEach(() => vi.unstubAllGlobals());
describe('authority matrix uses native permissions', () => {
  it('combines space and base permissions without collapsing to the highest role', () => {
    const grants = [grant(Role.Commenter, CollaboratorType.Space), grant(Role.Viewer)];
    expect(hasPermission(Role.Commenter, 'base|query_data')).toBe(false);
    expect(allowed(grants, 'base|query_data')).toBe(true);
    expect(allowed(grants, 'record|comment')).toBe(true);
    expect(allowed(grants, 'record|update')).toBe(false);
    expect(membersFrom(grants)).toHaveLength(1);
  });
  it('does not pretend a lower base role revokes inherited space permissions', () => {
    const member = membersFrom([
      grant(Role.Editor, CollaboratorType.Space),
      grant(Role.Creator),
    ])[0];
    expect(allowed(replacement(member, Role.Viewer), 'record|update')).toBe(true);
    expect(allowed(replacement(member, Role.Viewer), 'field|create')).toBe(false);
    expect(signature(member)).not.toEqual(
      signature({ ...member, grants: replacement(member, Role.Viewer) })
    );
  });
  it('protects inherited grants and self access and never offers Owner as a base role', () => {
    expect(
      editable(membersFrom([grant(Role.Owner, CollaboratorType.Space)])[0], 'another', Role.Owner)
    ).toBe(false);
    expect(editable(membersFrom([grant(Role.Editor)])[0], 'usr-test', Role.Owner)).toBe(false);
    expect(editable(membersFrom([grant(Role.Creator)])[0], 'another', Role.Viewer)).toBe(false);
    expect(editable(membersFrom([grant(Role.Viewer)])[0], 'another', Role.Owner)).toBe(true);
    expect(assignable(Role.Owner)).not.toContain(Role.Owner);
    expect(assignable(Role.Viewer)).toEqual([Role.Viewer]);
  });
  it('loads every page and rejects changing totals or duplicated grants', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () =>
          ++call === 1
            ? {
                total: 101,
                collaborators: Array.from({ length: 100 }, (_, i) =>
                  grant(Role.Viewer, CollaboratorType.Base, 'user-' + i)
                ),
              }
            : { total: 101, collaborators: [grant(Role.Editor)] },
      }))
    );
    expect(await loadGrants('base', new AbortController().signal)).toHaveLength(101);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ total: 2, collaborators: [grant(Role.Viewer), grant(Role.Viewer)] }),
      }))
    );
    await expect(loadGrants('base', new AbortController().signal)).rejects.toThrow('Duplicate');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ total: 2, collaborators: [grant(Role.Viewer)] }),
      }))
    );
    await expect(loadGrants('base', new AbortController().signal)).rejects.toThrow('incomplete');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 }))
    );
    await expect(loadGrants('base', new AbortController().signal)).rejects.toThrow(
      'could not be loaded'
    );
  });
});
