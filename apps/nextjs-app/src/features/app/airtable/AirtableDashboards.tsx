import { Selector } from '@teable/ui-lib/base';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import {
  filterRows,
  groups,
  importedAt,
  loadRows,
  metrics,
  recordUrl,
  settings,
  text,
} from './dashboard-data';
import type { Dashboard, Row } from './dashboard-data';
import styles from './dashboards.module.css';

const date = (value: string) =>
  value
    ? new Date(value.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not set';
const attentionLabels = {
  funding: 'No next action recorded',
  catalog: 'Missing ISRC or audio link',
  contacts: 'No email recorded',
};

function Breakdown({
  rows,
  field,
  onSelect,
}: {
  rows: Row[];
  field: string;
  onSelect?: (name: string) => void;
}) {
  const data = groups(rows, field);
  const max = Math.max(1, ...data.map((r) => r.count));
  if (data.length === 1)
    return (
      <p className="text-sm">
        <strong>{data[0].count}</strong> · {data[0].name}
      </p>
    );
  return (
    <div className={styles.breakdown}>
      {data.map((row) => (
        <button
          key={row.name}
          type="button"
          disabled={!onSelect}
          onClick={() => onSelect?.(row.name)}
          className={styles.barRow}
          aria-label={`${row.name}: ${row.count} records`}
        >
          <span className={styles.barLabel}>{row.name}</span>
          <span className={styles.barTrack}>
            <span style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span>{row.count}</span>
        </button>
      ))}
      {!data.length && (
        <p className="text-muted-foreground text-sm">No records match these filters.</p>
      )}
    </div>
  );
}

function Cell({ row, column, view }: { row: Row; column: string; view: Dashboard }) {
  if (column === 'Name')
    return (
      <Link href={recordUrl(view, row.id)} className="hover:underline">
        {text(row, column)}
      </Link>
    );
  if (column === 'Email recorded') return <>{text(row, 'Email') ? 'Yes' : 'No'}</>;
  if (['Status', 'Stage', 'Source readiness'].includes(column))
    return <Badge variant="secondary">{text(row, column) || 'Not set'}</Badge>;
  if (['Deadline', 'Next action due'].includes(column)) return <>{date(text(row, column))}</>;
  return <span className="whitespace-normal break-words">{text(row, column) || 'Not set'}</span>;
}

// The three views share native controls and explicit source/loading/empty states.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function AirtableDashboards() {
  const router = useRouter();
  const view: Dashboard =
    router.query.view === 'catalog' || router.query.view === 'contacts'
      ? router.query.view
      : 'funding';
  const [rows, setRows] = useState<Row[]>([]);
  const [loadedView, setLoadedView] = useState<Dashboard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setRows([]);
    setLoadedView(undefined);
    loadRows(view, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data);
          setLoadedView(view);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view, revision]);
  useEffect(() => {
    setSearch('');
    setGroup('');
    setAttention(false);
    setPage(0);
  }, [view]);
  useEffect(() => setPage(0), [search, group, attention]);
  const filtered = useMemo(
    () => filterRows(rows, view, search, group, attention),
    [rows, view, search, group, attention]
  );
  const visible = filtered.slice(page * 50, page * 50 + 50);
  const ready = loadedView === view && !loading && !error;
  const config = settings[view];
  const switchView = (value: string) =>
    void router.replace(
      { pathname: router.pathname, query: { baseId: router.query.baseId, view: value } },
      undefined,
      { shallow: true }
    );
  return (
    <div className={styles.page}>
      <Head>
        <title>{config.title} · True Nature Tables</title>
      </Head>
      <header className={styles.header}>
        <h1 className="text-sm font-medium">Airtable dashboards</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevision((r) => r + 1)}
          disabled={loading}
          aria-label="Reload imported records"
        >
          <RefreshCw size={15} />
          <span className="hidden sm:inline">Reload records</span>
        </Button>
      </header>
      <div className={styles.content}>
        <Tabs value={view} onValueChange={switchView}>
          <TabsList aria-label="Airtable dashboard">
            <TabsTrigger value="funding">Funding</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="contacts">Radio contacts</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className={styles.source}>
          <span>Imported from Airtable · {date(importedAt)} · Snapshot, automatic sync off</span>
          <Link href={recordUrl(view)} className="inline-flex items-center gap-1 hover:underline">
            Open Teable table <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className={styles.title}>
          <h2>{config.title}</h2>
          <p>{config.note}</p>
        </div>
        <div className={styles.toolbar}>
          <div>
            <Label htmlFor="dashboard-search">Search records</Label>
            <Input
              id="dashboard-search"
              placeholder={
                view === 'catalog'
                  ? 'Track, artist or ISRC…'
                  : view === 'funding'
                    ? 'Grant, project or action…'
                    : 'Station, country or city…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label>{config.dimension}</Label>
            <Selector
              ariaLabel={config.dimension}
              selectedId={group || '__all'}
              candidates={[
                { id: '__all', name: `All ${config.dimension.toLowerCase()} values` },
                ...groups(rows, config.dimension).map((g) => ({ id: g.name, name: g.name })),
              ]}
              onChange={(id) => setGroup(id === '__all' ? '' : id)}
              searchTip={`Search ${config.dimension.toLowerCase()}…`}
              className="w-full"
            />
          </div>
          <div className={styles.check}>
            <Checkbox
              id="attention"
              checked={attention}
              onCheckedChange={(value) => setAttention(value === true)}
            />
            <Label htmlFor="attention">{attentionLabels[view]}</Label>
          </div>
          {(search || group || attention) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setGroup('');
                setAttention(false);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {loading && (
          <p role="status" className="text-muted-foreground py-8">
            Loading imported records…
          </p>
        )}
        {error && (
          <div role="alert" className="my-4 rounded-lg border p-4">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setRevision((r) => r + 1)}
            >
              Try again
            </Button>
          </div>
        )}
        {ready && (
          <>
            <div className={styles.metrics}>
              {metrics(filtered, view).map(([label, value]) => (
                <Card key={label} className="p-4">
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums" data-metric={label}>
                    {value.toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
            <div className={styles.columns}>
              <Card className="p-4">
                <h3 className={styles.heading}>
                  {view === 'funding'
                    ? 'Applications by Airtable status'
                    : view === 'catalog'
                      ? 'Recording metadata coverage'
                      : 'Station records by country'}
                </h3>
                <Breakdown rows={filtered} field={config.dimension} onSelect={setGroup} />
              </Card>
              <Card className="p-4">
                <h3 className={styles.heading}>
                  {view === 'funding'
                    ? 'Application workflow stages'
                    : view === 'catalog'
                      ? 'Airtable readiness assessment'
                      : 'Radio types recorded'}
                </h3>
                <Breakdown
                  rows={filtered}
                  field={
                    view === 'funding' ? 'Stage' : view === 'catalog' ? 'Source readiness' : 'Type'
                  }
                />
                <p className="text-muted-foreground mt-4 text-xs">
                  {view === 'funding'
                    ? 'Status and workflow stage are separate Airtable fields. Approved does not mean paid; award and payment totals are not available in this import.'
                    : view === 'catalog'
                      ? 'Readiness is the source formula result. An audio link does not confirm delivery or clearance.'
                      : 'Missing contact details remain unknown. Email recorded means a value is present, not that the address has been verified.'}
                </p>
              </Card>
            </div>
            <section className="mt-5" aria-label="Imported records">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className={styles.heading}>
                  Records{' '}
                  <Badge variant="secondary">
                    {filtered.length} of {rows.length}
                  </Badge>
                </h3>
                <span className="text-muted-foreground text-xs">
                  Filters apply to all counts, charts and rows
                </span>
              </div>
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {config.columns.map((c) => (
                        <TableHead key={c}>
                          {c === 'Name'
                            ? view === 'funding'
                              ? 'Grant'
                              : view === 'catalog'
                                ? 'Recording'
                                : 'Station'
                            : c}
                        </TableHead>
                      ))}
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => (
                      <TableRow key={r.id}>
                        {config.columns.map((c, i) => (
                          <TableCell
                            key={c}
                            className={
                              i === 0 ? 'min-w-48 max-w-80 font-medium' : 'min-w-28 max-w-72'
                            }
                          >
                            <Cell row={r} column={c} view={view} />
                          </TableCell>
                        ))}
                        <TableCell>
                          <a
                            href={text(r, 'Airtable URL')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                            aria-label={`Open ${text(r, 'Name')} in Airtable`}
                          >
                            Airtable
                            <ArrowUpRight size={13} />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!visible.length && (
                      <TableRow>
                        <TableCell
                          colSpan={config.columns.length + 1}
                          className="text-muted-foreground h-24 text-center"
                        >
                          No records match these filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  {filtered.length
                    ? `${page * 50 + 1}–${Math.min((page + 1) * 50, filtered.length)} of ${filtered.length}`
                    : '0 records'}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * 50 >= filtered.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
