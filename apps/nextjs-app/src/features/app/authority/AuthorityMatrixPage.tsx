import { useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import type { Action, IBaseRole, IRole } from '@teable/core';
import type { CollaboratorItem } from '@teable/openapi';
import { updateBaseCollaborator, PrincipalType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useBasePermission, useSession } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { Check, Minus, RefreshCw, ShieldCheck } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ShareBaseDialog } from '../components/collaborator/share/ShareBaseDialog';
import {
  allowed,
  assignable,
  baseGrant,
  capabilities,
  editable,
  loadGrants,
  membersFrom,
  replacement,
  roleName,
  roles,
  signature,
} from './authority-data';
import type { Member } from './authority-data';
import styles from './authority.module.css';

function Permission({ value }: { value: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {value ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Minus className="text-muted-foreground size-3.5" aria-hidden />
      )}
      {value ? 'Allowed' : 'Not granted'}
    </span>
  );
}
function GrantBadges({ member }: { member: Member }) {
  return (
    <div className="flex flex-wrap gap-1">
      {member.grants.map((g) => (
        <Badge variant="secondary" key={g.resourceType}>
          {g.resourceType === 'space' ? 'Space' : 'Base'} · {roleName(g.role)}
        </Badge>
      ))}
    </div>
  );
}
function ChangeRole({
  member,
  baseId,
  actorRole,
  onClose,
  onSaved,
}: {
  member: Member;
  baseId: string;
  actorRole: IRole;
  onClose: () => void;
  onSaved: () => void;
}) {
  const original = baseGrant(member)!;
  const [role, setRole] = useState(original.role as IBaseRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = replacement(member, role);
  const changes = capabilities.filter(
    (c) => allowed(member.grants, c.action) !== allowed(preview, c.action)
  );
  const inherited = member.grants.some((g) => g.resourceType === 'space');
  const save = async () => {
    setSaving(true);
    setError('');
    let written = false;
    try {
      const fresh = membersFrom(await loadGrants(baseId, AbortSignal.timeout(15000))).find(
        (m) => m.id === member.id
      );
      if (!fresh || signature(fresh) !== signature(member))
        throw new Error(
          'This person’s access changed since you opened the review. Close this review and reload the matrix.'
        );
      await updateBaseCollaborator({
        baseId,
        updateBaseCollaborateRo: {
          principalId: member.id,
          principalType: PrincipalType.User,
          role,
        },
      });
      written = true;
      const verified = membersFrom(await loadGrants(baseId, AbortSignal.timeout(15000))).find(
        (m) => m.id === member.id
      );
      if (!verified || baseGrant(verified)?.role !== role)
        throw new Error('The saved role could not be verified.');
      onSaved();
      onClose();
    } catch (e) {
      setError(
        written
          ? 'The update was sent, but its current state could not be verified. Close this review and reload before making another change.'
          : e instanceof Error && e.message.includes('access changed')
            ? e.message
            : 'The role change was not confirmed. Reload the matrix to check your access before trying again.'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] w-[calc(100%-24px)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change base role</DialogTitle>
          <DialogDescription>
            {member.name} · This changes their role across this base’s tables.
          </DialogDescription>
        </DialogHeader>
        <GrantBadges member={member} />
        <div className="space-y-2">
          <Label htmlFor="new-base-role">New base role</Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as IBaseRole)}
            disabled={saving || !!error}
          >
            <SelectTrigger id="new-base-role" aria-label="New base role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignable(actorRole).map((r) => (
                <SelectItem value={r} key={r}>
                  {roleName(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {inherited && (
          <p className="rounded-md border p-3 text-sm">
            Space access remains in effect. Lowering a base role cannot remove permissions granted
            by the space.
          </p>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">Changes to common capabilities</h3>
          {changes.length ? (
            <ul className="space-y-2">
              {changes.map((c) => (
                <li className="flex justify-between gap-3 text-sm" key={c.action}>
                  <span>{c.label}</span>
                  <span>
                    {allowed(preview, c.action) ? 'Will be allowed' : 'Will no longer be granted'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No change to these common capabilities.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || role === original.role || !!error}
          >
            {saving ? 'Saving…' : 'Save base role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Distinguishes live membership, inherited grants, role comparison and reviewed changes.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function AuthorityMatrixPage() {
  const base = useBase();
  const permission = useBasePermission();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [grants, setGrants] = useState<CollaboratorItem[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [updated, setUpdated] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('people');
  const [editing, setEditing] = useState<Member>();
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setGrants(undefined);
    loadGrants(base.id, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setGrants(rows);
          setUpdated(new Date().toISOString());
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base.id, revision]);
  const members = useMemo(() => membersFrom(grants || []), [grants]);
  const filtered = members.filter((m) =>
    `${m.name} ${m.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const member = filtered.find((m) => m.id === selected) || filtered[0];
  const summaryActions: Action[] = [
    'record|read',
    'record|update',
    'record|delete',
    'table|export',
  ];
  const spaceOwner = grants?.some(
    (g) =>
      g.type === 'user' && g.userId === user.id && g.resourceType === 'space' && g.role === 'owner'
  );
  const saved = () => {
    setSuccess('Base role saved and verified.');
    setRevision((r) => r + 1);
    void queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseCollaboratorList(base.id) });
  };
  return (
    <div className={styles.page}>
      <Head>
        <title>Authority matrix · True Nature Tables</title>
      </Head>
      <header className={styles.header}>
        <h1 className="text-sm font-medium">Authority matrix</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Reload permissions"
            onClick={() => {
              setSuccess('');
              setRevision((r) => r + 1);
            }}
            disabled={loading || !!editing}
          >
            <RefreshCw size={15} />
            <span className="hidden sm:inline">Reload</span>
          </Button>
          {permission?.['base|invite_email'] && (
            <ShareBaseDialog>
              <Button size="sm" variant="outline">
                Manage team
              </Button>
            </ShareBaseDialog>
          )}
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.title}>
          <h2>Team access</h2>
          <p>
            See what each person’s base and space roles allow. Changes use Teable’s existing
            permission checks.
          </p>
        </div>
        <div className={styles.info}>
          <ShieldCheck size={16} className="shrink-0" />
          <p>
            Roles apply across this base. Space permissions carry through to every table. Table,
            field and artist-specific restrictions are not configured here.
          </p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Authority matrix sections">
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="roles">Role guide</TabsTrigger>
          </TabsList>
          <TabsContent value="people" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full max-w-sm space-y-2">
                <Label htmlFor="member-search">Find a person</Label>
                <Input
                  id="member-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name or email…"
                />
              </div>
              <div className="text-muted-foreground text-xs">
                {updated && !loading
                  ? `Checked ${new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
              </div>
            </div>
            {loading && (
              <p role="status" className="text-muted-foreground py-8 text-sm">
                Loading team permissions…
              </p>
            )}
            {error && (
              <div role="alert" className="rounded-lg border p-4 text-sm">
                {error}
                <Button
                  className="ms-3"
                  variant="outline"
                  size="sm"
                  onClick={() => setRevision((r) => r + 1)}
                >
                  Try again
                </Button>
              </div>
            )}
            {success && (
              <p role="status" className="text-sm">
                {success}
              </p>
            )}
            {grants && !loading && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {members.length} {members.length === 1 ? 'person' : 'people'}
                  </Badge>
                  <Badge variant="outline">
                    {grants.filter((g) => g.resourceType === 'space').length} space grants
                  </Badge>
                  <Badge variant="outline">
                    {grants.filter((g) => g.resourceType === 'base').length} base grants
                  </Badge>
                </div>
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead>Role and source</TableHead>
                        {summaryActions.map((a) => (
                          <TableHead key={a}>
                            {capabilities.find((c) => c.action === a)!.label}
                          </TableHead>
                        ))}
                        <TableHead>Manage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((m) => (
                        <TableRow
                          key={m.id}
                          data-state={m.id === member?.id ? 'selected' : undefined}
                        >
                          <TableCell className="min-w-44">
                            <button
                              className="text-start hover:underline"
                              onClick={() => setSelected(m.id)}
                            >
                              <span className="block font-medium">
                                {m.name}
                                {m.id === user.id ? ' (you)' : ''}
                              </span>
                              <span className="text-muted-foreground block text-xs">{m.email}</span>
                            </button>
                          </TableCell>
                          <TableCell className="min-w-44">
                            <GrantBadges member={m} />
                          </TableCell>
                          {summaryActions.map((a) => (
                            <TableCell className="whitespace-nowrap" key={a}>
                              <Permission value={allowed(m.grants, a)} />
                            </TableCell>
                          ))}
                          <TableCell className="min-w-36">
                            {editable(m, user.id, base.role) ? (
                              <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                                Change base role
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {baseGrant(m)
                                  ? 'Managed through team settings'
                                  : 'Inherited from space'}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!filtered.length && (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center">
                            No people match your search.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
                {member && (
                  <Card className="p-4">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="font-medium">Permission details</h3>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Combined grants from the base and its space.
                        </p>
                      </div>
                      <Selector
                        ariaLabel="Person for permission details"
                        className="w-full sm:w-64"
                        selectedId={member.id}
                        candidates={filtered.map((m) => ({ id: m.id, name: m.name }))}
                        onChange={setSelected}
                      />
                    </div>
                    <div className={styles.capabilities}>
                      {capabilities.map((c) => (
                        <div className={styles.capability} key={c.action}>
                          <span>{c.label}</span>
                          <Permission value={allowed(member.grants, c.action)} />
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
                <div className={styles.footnote}>
                  <p>
                    These are direct member grants. Shared links, API tokens and organization-group
                    access are separate. View locks can further restrict changes within a view.
                  </p>
                  {spaceOwner && (
                    <Link
                      href={`/space/${base.spaceId}/setting/collaborator`}
                      className="shrink-0 hover:underline"
                    >
                      Manage inherited space roles ↗
                    </Link>
                  )}
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="roles" className="mt-4 space-y-4">
            <p className="text-muted-foreground text-sm">
              Common capabilities from the same role definitions used by the backend. Owner is a
              space role; the other roles can be assigned to this base.
            </p>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">Capability</TableHead>
                    {roles.map((r) => (
                      <TableHead className="min-w-32" key={r}>
                        {roleName(r)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {capabilities.map((c) => (
                    <TableRow key={c.action}>
                      <TableCell>
                        <span className="block font-medium">{c.label}</span>
                        <span className="text-muted-foreground text-xs">{c.group}</span>
                      </TableCell>
                      {roles.map((r) => (
                        <TableCell key={r}>
                          <Permission value={hasPermission(r, c.action)} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <p className="text-muted-foreground text-sm">
              Viewers can export tables in the current permission model. Invitations are limited by
              the inviter’s role. Reducing a base role does not revoke a stronger space grant.
            </p>
          </TabsContent>
        </Tabs>
      </div>
      {editing && (
        <ChangeRole
          key={editing.id}
          member={editing}
          baseId={base.id}
          actorRole={base.role}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
