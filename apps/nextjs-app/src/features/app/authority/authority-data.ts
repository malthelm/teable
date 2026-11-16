import { canManageRole, hasPermission, Role } from '@teable/core';
import type { Action, IBaseRole, IRole } from '@teable/core';
import { listBaseCollaboratorVoSchema } from '@teable/openapi';
import type { CollaboratorItem } from '@teable/openapi';

export const roles = [Role.Owner, Role.Creator, Role.Editor, Role.Commenter, Role.Viewer];
export const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
export const capabilities: { action: Action; label: string; group: string }[] = [
  { action: 'record|read', label: 'Read records', group: 'Records' },
  { action: 'record|create', label: 'Add records', group: 'Records' },
  { action: 'record|update', label: 'Edit records', group: 'Records' },
  { action: 'record|delete', label: 'Delete records', group: 'Records' },
  { action: 'record|comment', label: 'Comment on records', group: 'Records' },
  { action: 'table|export', label: 'Export tables', group: 'Records' },
  { action: 'view|create', label: 'Create views', group: 'Structure' },
  { action: 'view|share', label: 'Share views', group: 'Structure' },
  { action: 'field|create', label: 'Add fields', group: 'Structure' },
  { action: 'field|delete', label: 'Delete fields', group: 'Structure' },
  { action: 'table|create', label: 'Create tables', group: 'Structure' },
  { action: 'table|delete', label: 'Delete tables', group: 'Structure' },
  { action: 'base|invite_email', label: 'Invite by email', group: 'Access' },
  { action: 'base|invite_link', label: 'Create invitation links', group: 'Access' },
  { action: 'base|delete', label: 'Delete this base', group: 'Access' },
];
export interface Member {
  id: string;
  name: string;
  email: string;
  grants: CollaboratorItem[];
}
export const principalId = (grant: CollaboratorItem) =>
  grant.type === 'user' ? grant.userId : grant.departmentId;
export function membersFrom(grants: CollaboratorItem[]) {
  const map = new Map<string, Member>();
  for (const grant of grants) {
    const id = principalId(grant);
    const key = grant.type + ':' + id;
    const member = map.get(key) || {
      id,
      name: grant.type === 'user' ? grant.userName : grant.departmentName,
      email: grant.type === 'user' ? grant.email : '',
      grants: [],
    };
    member.grants.push(grant);
    map.set(key, member);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// The backend unions grants; taking only the highest role is not equivalent.
export const allowed = (grants: CollaboratorItem[], action: Action) =>
  grants.some((g) => hasPermission(g.role, action));
export const baseGrant = (member: Member) => member.grants.find((g) => g.resourceType === 'base');
export function replacement(member: Member, role: IBaseRole) {
  return member.grants.map((g) => (g.resourceType === 'base' ? { ...g, role } : g));
}
export const signature = (member: Member) =>
  member.grants
    .map((g) => `${g.resourceType}:${g.role}`)
    .sort()
    .join('|');
export function editable(member: Member, actorId: string, actorRole: IRole) {
  const grant = baseGrant(member);
  return (
    !!grant &&
    member.id !== actorId &&
    grant.type === 'user' &&
    (actorRole === Role.Owner || canManageRole(actorRole, grant.role))
  );
}
export const assignable = (actorRole: IRole) =>
  roles.filter(
    (role) => role !== Role.Owner && (role === actorRole || canManageRole(actorRole, role))
  ) as IBaseRole[];
export async function loadGrants(baseId: string, signal: AbortSignal) {
  const grants: CollaboratorItem[] = [];
  let total: number | undefined;
  const seen = new Set<string>();
  for (let skip = 0; skip < 10000; skip += 100) {
    const response = await fetch(`/api/base/${baseId}/collaborators?skip=${skip}&take=100`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error('Team access could not be loaded. Check your session and try again.');
    const page = listBaseCollaboratorVoSchema.parse(await response.json());
    if (total !== undefined && total !== page.total)
      throw new Error('Membership changed while loading. Refresh to see the complete matrix.');
    total = page.total;
    for (const g of page.collaborators) {
      const key = `${g.type}:${principalId(g)}:${g.resourceType}`;
      if (seen.has(key))
        throw new Error('Duplicate membership returned. Refresh before changing access.');
      seen.add(key);
      grants.push(g);
    }
    if (grants.length === total) return grants;
    if (page.collaborators.length < 100)
      throw new Error('The membership list is incomplete. Refresh before changing access.');
  }
  throw new Error('The membership limit was reached. No partial matrix is shown.');
}
