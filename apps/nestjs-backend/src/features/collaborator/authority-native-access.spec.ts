import 'reflect-metadata';
import { Role } from '@teable/core';
import type { IRole } from '@teable/core';
import { CollaboratorType, PrincipalType, updateBaseCollaborateRoSchema } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { CollaboratorService } from './collaborator.service';

// Exercise the real mutation method with an isolated store; no production grants are touched.
function fixture(actorRole: IRole, targetRole: IRole) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const audit = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(CollaboratorService.prototype) as CollaboratorService;
  Object.assign(service, {
    cls: { get: () => 'actor' },
    prismaService: {
      $tx: async (fn: () => Promise<unknown>) => fn(),
      txClient: () => ({ collaborator: { updateMany } }),
    },
    lockSpaceCollaborators: vi.fn().mockResolvedValue('space'),
    getOperatorCollaborators: vi
      .fn()
      .mockResolvedValue({
        currentColl: { roleName: actorRole },
        targetColl: { roleName: targetRole },
      }),
    audit: { emitAtomic: audit },
    eventEmitterService: { emitAsync: vi.fn() },
  });
  const change = (role: IRole) =>
    service.updateCollaborator({
      role,
      principalId: 'target',
      principalType: PrincipalType.User,
      resourceId: 'base',
      resourceType: CollaboratorType.Base,
    });
  return { change, updateMany, audit };
}
describe('native authorization behind the authority matrix', () => {
  it('refuses Viewer promotion even if the browser submits a forged request', async () => {
    const f = fixture(Role.Viewer, Role.Viewer);
    await expect(f.change(Role.Creator)).rejects.toThrow('permission');
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it('refuses Editor changes to a higher-role collaborator', async () => {
    const f = fixture(Role.Editor, Role.Creator);
    await expect(f.change(Role.Viewer)).rejects.toThrow('permission');
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it('allows an Owner to change a direct base grant and records the role change', async () => {
    const f = fixture(Role.Owner, Role.Viewer);
    await f.change(Role.Editor);
    expect(f.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resourceId: 'base', principalId: 'target' }),
        data: expect.objectContaining({ roleName: Role.Editor }),
      })
    );
    expect(f.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ oldRole: Role.Viewer, newRole: Role.Editor }),
      })
    );
  });
  it('rejects Owner in the base role API contract', () => {
    expect(
      updateBaseCollaborateRoSchema.safeParse({
        principalId: 'target',
        principalType: PrincipalType.User,
        role: Role.Owner,
      }).success
    ).toBe(false);
  });
});
