import type {
  FirestoreSqlCompileResult,
  FirestoreSqlContext,
  FirestoreSqlDiagnostic,
  FirestoreSqlRunResult,
  FirestoreSqlStats,
} from '@firebase-desk/repo-contracts';
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@firebase-desk/ui';
import { AlertTriangle, FileCode2, Play, RefreshCw, Square, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';

export const FIRESTORE_SQL_SAMPLE_SOURCE = `select id(o) as orderId, o.status, o.total, c.email
from orders o
left join customers c on c.name = o.customer
where o.status = "paid"
order by o.total desc
limit 25`;

export interface FirestoreSqlSurfaceProps {
  readonly compileResult?: FirestoreSqlCompileResult | null;
  readonly context: FirestoreSqlContext;
  readonly isRunning?: boolean;
  readonly onCancel: () => void;
  readonly onCompile: () => void;
  readonly onContextChange: (context: FirestoreSqlContext) => void;
  readonly onRun: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly result?: FirestoreSqlRunResult | null;
  readonly source: string;
}

export function FirestoreSqlSurface(
  {
    compileResult = null,
    context,
    isRunning = false,
    onCancel,
    onCompile,
    onContextChange,
    onRun,
    onSourceChange,
    result = null,
    source,
  }: FirestoreSqlSurfaceProps,
) {
  const isWide = useMediaQuery('(min-width: 1040px)');
  const rows = result?.rows ?? [];
  const diagnostics = [
    ...(compileResult?.diagnostics ?? []),
    ...(result?.diagnostics ?? []),
  ];

  return (
    <div className='h-full min-h-0 overflow-hidden p-2'>
      <ResizablePanelGroup
        key={isWide ? 'wide' : 'stacked'}
        className='h-full min-h-0'
        direction={isWide ? 'horizontal' : 'vertical'}
      >
        <ResizablePanel defaultSize={isWide ? '44%' : '48%'} minSize={isWide ? '360px' : '220px'}>
          <Panel className='grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]'>
            <PanelHeader
              actions={
                <>
                  <Button variant='secondary' onClick={onCompile}>
                    <RefreshCw size={13} aria-hidden='true' /> Prepare
                  </Button>
                  <Button
                    variant={isRunning ? 'warning' : 'primary'}
                    onClick={isRunning ? onCancel : onRun}
                  >
                    {isRunning
                      ? (
                        <>
                          <Square size={13} aria-hidden='true' /> Cancel
                        </>
                      )
                      : (
                        <>
                          <Play size={14} aria-hidden='true' /> Run
                        </>
                      )}
                  </Button>
                </>
              }
            >
              Firestore SQL
            </PanelHeader>
            <SqlContextEditor context={context} onContextChange={onContextChange} />
            <PanelBody className='min-h-0 p-0'>
              <CodeEditor
                language='sql'
                readOnly={isRunning}
                value={source}
                onChange={onSourceChange}
              />
            </PanelBody>
          </Panel>
        </ResizablePanel>
        <ResizableHandle className={isWide ? 'mx-2 h-full w-px' : 'my-2 h-px w-full'} />
        <ResizablePanel defaultSize={isWide ? '56%' : '52%'} minSize={isWide ? '420px' : '240px'}>
          <SqlOutputPanel
            diagnostics={diagnostics}
            isRunning={isRunning}
            rows={rows}
            snippet={compileResult?.snippet ?? ''}
            stats={result?.stats ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function SqlContextEditor(
  {
    context,
    onContextChange,
  }: {
    readonly context: FirestoreSqlContext;
    readonly onContextChange: (context: FirestoreSqlContext) => void;
  },
) {
  const [aliasesText, setAliasesText] = useState(formatAliases(context.projectAliases));
  const [aliasesError, setAliasesError] = useState<string | null>(null);

  useEffect(() => {
    setAliasesText(formatAliases(context.projectAliases));
    setAliasesError(null);
  }, [context.projectAliases]);

  function updateDefaultProject(defaultProjectId: string) {
    onContextChange(cleanContext({ ...context, defaultProjectId: defaultProjectId.trim() }));
  }

  function commitAliases(value: string) {
    const parsed = parseAliases(value);
    if (!parsed.ok) {
      setAliasesError(parsed.message);
      return;
    }
    setAliasesError(null);
    onContextChange(cleanContext({ ...context, projectAliases: parsed.aliases }));
  }

  return (
    <div className='grid gap-2 border-b border-border-subtle p-2 text-xs lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'>
      <label className='space-y-1 text-text-muted'>
        <span>Default project</span>
        <input
          className='h-8 w-full rounded border border-border-subtle bg-bg-panel px-2 text-text-primary outline-none focus:border-accent'
          placeholder='Current tab connection'
          value={context.defaultProjectId ?? ''}
          onChange={(event) => updateDefaultProject(event.currentTarget.value)}
        />
      </label>
      <label className='space-y-1 text-text-muted'>
        <span>Aliases</span>
        <textarea
          className='min-h-8 w-full resize-none rounded border border-border-subtle bg-bg-panel px-2 py-1 text-text-primary outline-none focus:border-accent'
          placeholder='prod=prod-project'
          rows={2}
          value={aliasesText}
          onBlur={(event) => commitAliases(event.currentTarget.value)}
          onChange={(event) => {
            setAliasesText(event.currentTarget.value);
            setAliasesError(null);
          }}
        />
        {aliasesError ? <span className='text-status-danger-text'>{aliasesError}</span> : null}
      </label>
    </div>
  );
}

function SqlOutputPanel(
  { diagnostics, isRunning, rows, snippet, stats }: {
    readonly diagnostics: readonly FirestoreSqlDiagnostic[];
    readonly isRunning: boolean;
    readonly rows: readonly Record<string, unknown>[];
    readonly snippet: string;
    readonly stats: FirestoreSqlStats | null;
  },
) {
  return (
    <Tabs defaultValue='results' className='h-full min-h-0'>
      <Panel className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
        <PanelHeader
          actions={
            <TabsList className='border-b-0'>
              <TabsTrigger className='h-7 gap-1.5 border-b-0 px-2' value='results'>
                <Table2 size={14} aria-hidden='true' /> Results
                <Badge
                  className='px-1.5 py-0 text-[10px]'
                  variant={statusVariant(stats, isRunning)}
                >
                  {statusLabel(stats, isRunning)}
                </Badge>
              </TabsTrigger>
              <TabsTrigger className='h-7 gap-1.5 border-b-0 px-2' value='issues'>
                <AlertTriangle size={14} aria-hidden='true' /> Issues
                {diagnostics.length > 0
                  ? (
                    <Badge className='px-1.5 py-0 text-[10px]' variant={issuesVariant(diagnostics)}>
                      {diagnostics.length}
                    </Badge>
                  )
                  : null}
              </TabsTrigger>
              <TabsTrigger className='h-7 gap-1.5 border-b-0 px-2' value='snippet'>
                <FileCode2 size={14} aria-hidden='true' /> JS Query
                <Badge className='px-1.5 py-0 text-[10px]' variant='warning'>beta</Badge>
              </TabsTrigger>
            </TabsList>
          }
        >
          Output
        </PanelHeader>
        <TabsContent className='min-h-0 overflow-hidden' value='results'>
          <ResultsView isRunning={isRunning} rows={rows} stats={stats} />
        </TabsContent>
        <TabsContent className='min-h-0 overflow-hidden' value='issues'>
          <IssuesView diagnostics={diagnostics} />
        </TabsContent>
        <TabsContent className='min-h-0 overflow-hidden' value='snippet'>
          <SnippetView source={snippet} />
        </TabsContent>
      </Panel>
    </Tabs>
  );
}

function ResultsView(
  { isRunning, rows, stats }: {
    readonly isRunning: boolean;
    readonly rows: readonly Record<string, unknown>[];
    readonly stats: FirestoreSqlStats | null;
  },
) {
  const columns = useMemo(() => resultColumns(rows), [rows]);
  return (
    <div className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
      <div className='flex flex-wrap items-center gap-2 border-b border-border-subtle px-2 py-1 text-xs text-text-secondary'>
        <span>{rows.length} rows</span>
        <span>{stats?.reads ?? 0} reads</span>
        <span>{stats?.rowsScanned ?? 0} scanned</span>
        <span>{stats?.joinMisses ?? 0} join misses</span>
      </div>
      <PanelBody className='min-h-0 p-0'>
        {rows.length === 0
          ? (
            <EmptyState
              title={isRunning ? 'Waiting for rows' : 'No rows yet'}
              description={isRunning
                ? 'Rows stream here as the query runs.'
                : 'Run a select query.'}
            />
          )
          : (
            <div className='h-full overflow-auto'>
              <table className='w-full min-w-max border-collapse text-left text-xs'>
                <thead className='sticky top-0 bg-bg-panel text-text-muted'>
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column}
                        className='border-b border-border-subtle px-2 py-1 font-medium'
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className='border-b border-border-subtle/70'>
                      {columns.map((column) => (
                        <td
                          key={column}
                          className='max-w-[340px] truncate px-2 py-1 text-text-secondary'
                        >
                          {formatCell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </PanelBody>
    </div>
  );
}

function cleanContext(context: FirestoreSqlContext): FirestoreSqlContext {
  return {
    ...(context.defaultProjectId ? { defaultProjectId: context.defaultProjectId } : {}),
    ...(context.projectAliases && Object.keys(context.projectAliases).length
      ? { projectAliases: context.projectAliases }
      : {}),
  };
}

function formatAliases(aliases: FirestoreSqlContext['projectAliases']): string {
  return Object.entries(aliases ?? {}).map(([alias, projectId]) => `${alias}=${projectId}`).join(
    '\n',
  );
}

function parseAliases(value: string):
  | { readonly aliases: Record<string, string>; readonly ok: true; }
  | { readonly message: string; readonly ok: false; }
{
  const aliases: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0 || separator === trimmed.length - 1) {
      return { message: 'Use alias=project-id per line.', ok: false };
    }
    aliases[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return { aliases, ok: true };
}

function IssuesView(
  { diagnostics }: { readonly diagnostics: readonly FirestoreSqlDiagnostic[]; },
) {
  return (
    <PanelBody className='h-full min-h-0 space-y-2 overflow-auto text-xs'>
      {diagnostics.length === 0
        ? <p className='text-text-muted'>No issues.</p>
        : diagnostics.map((diagnostic, index) => (
          <div key={`${diagnostic.code}-${index}`} className='space-y-1'>
            <Badge variant={diagnostic.severity === 'error' ? 'danger' : 'warning'}>
              {diagnostic.code}
            </Badge>
            <p className='text-text-secondary'>{diagnostic.message}</p>
          </div>
        ))}
    </PanelBody>
  );
}

function SnippetView({ source }: { readonly source: string; }) {
  return (
    <PanelBody className='h-full min-h-0 p-0'>
      {source
        ? <CodeEditor language='javascript' readOnly value={source} onChange={() => undefined} />
        : <EmptyState title='No snippet' description='Prepare a supported read query.' />}
    </PanelBody>
  );
}

function resultColumns(rows: readonly Record<string, unknown>[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return [...columns];
}

function formatCell(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function statusLabel(stats: FirestoreSqlStats | null, isRunning: boolean): string {
  if (isRunning) return 'running';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return stats.stoppedReason;
  if (stats) return 'completed';
  return 'idle';
}

function statusVariant(
  stats: FirestoreSqlStats | null,
  isRunning: boolean,
): 'neutral' | 'success' | 'warning' {
  if (isRunning) return 'warning';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return 'warning';
  return stats ? 'success' : 'neutral';
}

function issuesVariant(
  diagnostics: readonly FirestoreSqlDiagnostic[],
): 'danger' | 'warning' {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'danger' : 'warning';
}
