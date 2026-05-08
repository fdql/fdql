import { FDQL_LANGUAGE_ID } from '@firebase-desk/fdql-language';
import type {
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlResultRowLineage,
  FdqlRunCommandResult,
  FdqlRunResult,
  FdqlStats,
  FirestoreDocumentResult,
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
import {
  AlertTriangle,
  Braces,
  Copy,
  ExternalLink,
  GitBranch,
  Play,
  Square,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';
import { JsonPreview } from '../../json-preview/index.ts';
import { formatFirestoreValue } from '../firestore/FirestoreValueCell.tsx';
import { toggleSet, TREE_VALUE_CHILD_BATCH_SIZE } from '../firestore/resultModel.tsx';
import { ResultTreeView } from '../firestore/ResultTreeView.tsx';
import { formatDuration } from '../js-query/duration.ts';

export const FDQL_SAMPLE_SOURCE = `set fdql.readBudget = 5000

alias $orders = fs.collection("orders", ["status", "total"])

from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 25

return fs.id(o) as id, o.status, o.total`;

type FdqlResultView = 'json' | 'table' | 'tree';

const FDQL_TREE_QUERY_PATH = 'FDQL results';

export interface FdqlSurfaceProps {
  readonly compileResult?: FdqlCompileResult | null;
  readonly isRunning?: boolean;
  readonly onCancel: () => void;
  readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  readonly onRun: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly result?: FdqlRunResult | null;
  readonly runId?: string | null | undefined;
  readonly source: string;
}

export function FdqlSurface(
  {
    compileResult = null,
    isRunning = false,
    onCancel,
    onOpenDocumentInNewTab,
    onRun,
    onSourceChange,
    result = null,
    runId = null,
    source,
  }: FdqlSurfaceProps,
) {
  const isWide = useMediaQuery('(min-width: 1040px)');
  const rows = result?.rows ?? [];
  const diagnostics = [
    ...(compileResult?.diagnostics ?? []),
    ...(result?.diagnostics ?? []),
  ];
  const [issueCursorTarget, setIssueCursorTarget] = useState<
    {
      readonly column: number;
      readonly key: number;
      readonly line: number;
    } | null
  >(null);

  function revealIssue(diagnostic: FdqlDiagnostic) {
    if (!diagnostic.line) return;
    setIssueCursorTarget((current) => ({
      column: diagnostic.column ?? 1,
      key: (current?.key ?? 0) + 1,
      line: diagnostic.line!,
    }));
  }

  return (
    <div className='h-full min-h-0 overflow-hidden p-2'>
      <ResizablePanelGroup
        key={isWide ? 'wide' : 'stacked'}
        className='h-full min-h-0'
        direction={isWide ? 'horizontal' : 'vertical'}
      >
        <ResizablePanel defaultSize={isWide ? '48%' : '52%'} minSize={isWide ? '360px' : '220px'}>
          <Panel className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
            <PanelHeader
              actions={
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
              }
            >
              FDQL
            </PanelHeader>
            <PanelBody className='min-h-0 p-0'>
              <CodeEditor
                language={FDQL_LANGUAGE_ID}
                readOnly={isRunning}
                revealCursorTarget={issueCursorTarget}
                value={source}
                onChange={onSourceChange}
              />
            </PanelBody>
          </Panel>
        </ResizablePanel>
        <ResizableHandle className={isWide ? 'mx-2 h-full w-px' : 'my-2 h-px w-full'} />
        <ResizablePanel defaultSize={isWide ? '52%' : '48%'} minSize={isWide ? '420px' : '240px'}>
          <FdqlOutputPanel
            command={result?.command ?? null}
            diagnostics={diagnostics}
            durationMs={result?.durationMs ?? 0}
            isRunning={isRunning}
            onIssueClick={revealIssue}
            onOpenDocumentInNewTab={onOpenDocumentInNewTab}
            rowLineages={result?.rowLineages ?? []}
            rows={rows}
            runId={runId}
            stats={result?.stats ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function FdqlOutputPanel(
  {
    command,
    diagnostics,
    durationMs,
    isRunning,
    onIssueClick,
    onOpenDocumentInNewTab,
    rowLineages,
    rows,
    runId,
    stats,
  }: {
    readonly command: FdqlRunCommandResult | null;
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly durationMs: number;
    readonly isRunning: boolean;
    readonly onIssueClick: (diagnostic: FdqlDiagnostic) => void;
    readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
    readonly rowLineages: readonly FdqlResultRowLineage[];
    readonly rows: readonly Record<string, unknown>[];
    readonly runId: string | null;
    readonly stats: FdqlStats | null;
  },
) {
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  useEffect(() => {
    setSelectedRowIndex(0);
  }, [runId]);
  const selectedLineage = rowLineages[selectedRowIndex] ?? null;

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
                  variant={statusVariant(stats, isRunning, command)}
                >
                  {statusLabel(stats, isRunning, command)}
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
              <TabsTrigger className='h-7 gap-1.5 border-b-0 px-2' value='lineage'>
                <GitBranch size={14} aria-hidden='true' /> Lineage
              </TabsTrigger>
            </TabsList>
          }
        >
          Output
        </PanelHeader>
        <TabsContent className='min-h-0 overflow-hidden' value='results'>
          <ResultsView
            command={command}
            durationMs={durationMs}
            isRunning={isRunning}
            rowLineages={rowLineages}
            rows={rows}
            runId={runId}
            selectedRowIndex={selectedRowIndex}
            stats={stats}
            onSelectRow={setSelectedRowIndex}
          />
        </TabsContent>
        <TabsContent className='min-h-0 overflow-hidden' value='issues'>
          <IssuesView diagnostics={diagnostics} onIssueClick={onIssueClick} />
        </TabsContent>
        <TabsContent className='min-h-0 overflow-hidden' value='lineage'>
          <LineageView
            lineage={selectedLineage}
            stats={stats}
            onOpenDocumentInNewTab={onOpenDocumentInNewTab}
          />
        </TabsContent>
      </Panel>
    </Tabs>
  );
}

function ResultsView(
  {
    command,
    durationMs,
    isRunning,
    rowLineages,
    rows,
    runId,
    selectedRowIndex,
    stats,
    onSelectRow,
  }: {
    readonly command: FdqlRunCommandResult | null;
    readonly durationMs: number;
    readonly isRunning: boolean;
    readonly rowLineages: readonly FdqlResultRowLineage[];
    readonly rows: readonly Record<string, unknown>[];
    readonly runId: string | null;
    readonly selectedRowIndex: number;
    readonly stats: FdqlStats | null;
    readonly onSelectRow: (index: number) => void;
  },
) {
  const columns = useMemo(() => resultColumns(rows), [rows]);
  const [resultView, setResultView] = useState<FdqlResultView>('table');
  const treeRows = useMemo(() => treeDocumentsForRows(rows), [rows]);
  const defaultExpandedTreeIds = useMemo(() => defaultFdqlTreeExpansion(treeRows), [treeRows]);
  const treeResetKey = runId ?? 'idle';
  const [treeState, setTreeState] = useState(() => ({
    expandedIds: defaultExpandedTreeIds,
    resetKey: treeResetKey,
    seededRows: rows.length > 0,
    userTouched: false,
    valueChildLimits: new Map<string, number>(),
  }));

  useEffect(() => {
    setTreeState((current) =>
      current.resetKey === treeResetKey
        ? current
        : {
          expandedIds: defaultExpandedTreeIds,
          resetKey: treeResetKey,
          seededRows: rows.length > 0,
          userTouched: false,
          valueChildLimits: new Map(),
        }
    );
  }, [defaultExpandedTreeIds, rows.length, treeResetKey]);

  useEffect(() => {
    if (rows.length === 0) return;
    setTreeState((current) =>
      current.resetKey === treeResetKey && !current.seededRows && !current.userTouched
        ? { ...current, expandedIds: defaultExpandedTreeIds, seededRows: true }
        : current
    );
  }, [defaultExpandedTreeIds, rows.length, treeResetKey]);

  function toggleTreeNode(id: string) {
    setTreeState((current) => ({
      ...current,
      expandedIds: toggleSet(current.expandedIds, id),
      userTouched: true,
    }));
  }

  function showMoreTreeValueChildren(id: string) {
    setTreeState((current) => {
      const next = new Map(current.valueChildLimits);
      next.set(
        id,
        (current.valueChildLimits.get(id) ?? TREE_VALUE_CHILD_BATCH_SIZE)
          + TREE_VALUE_CHILD_BATCH_SIZE,
      );
      return { ...current, userTouched: true, valueChildLimits: next };
    });
  }

  return (
    <Tabs
      className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'
      value={resultView}
      onValueChange={(value) => setResultView(value as FdqlResultView)}
    >
      <div className='flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-2 py-1'>
        <div className='flex flex-wrap items-center gap-2 text-xs text-text-secondary'>
          <span>{rows.length} rows</span>
          <span>{stats?.reads ?? 0} reads</span>
          {stats?.aggregateReads
            ? <span>{pluralLabel(stats.aggregateReads, 'aggregate', 'aggregates')}</span>
            : null}
          <span>{stats?.rowsScanned ?? 0} scanned</span>
          {cacheStatLabels(stats).map((label) => <span key={label}>{label}</span>)}
          <span title={`${durationMs}ms`}>{formatDuration(durationMs)} elapsed</span>
          <span>{stats?.stoppedReason ?? 'idle'}</span>
        </div>
        <TabsList className='rounded-md border border-border-subtle bg-bg-subtle p-0.5'>
          <TabsTrigger className='h-7 gap-1 rounded-sm border-b-0 px-2' value='table'>
            <Table2 size={13} aria-hidden='true' /> Table
          </TabsTrigger>
          <TabsTrigger className='h-7 gap-1 rounded-sm border-b-0 px-2' value='tree'>
            <GitBranch size={13} aria-hidden='true' /> Tree
          </TabsTrigger>
          <TabsTrigger className='h-7 gap-1 rounded-sm border-b-0 px-2' value='json'>
            <Braces size={13} aria-hidden='true' /> JSON
          </TabsTrigger>
        </TabsList>
      </div>
      <PanelBody className='min-h-0 p-0'>
        {rows.length === 0
          ? (
            <EmptyState
              title={command ? 'Cache cleared' : isRunning ? 'Waiting for rows' : 'No rows yet'}
              description={command?.message
                ?? (isRunning ? 'Rows stream here as FDQL runs.' : 'Run a bounded FDQL read.')}
            />
          )
          : (
            <div className='grid h-full min-h-0 overflow-hidden'>
              <TabsContent
                className='col-start-1 row-start-1 m-0 h-full min-h-0 overflow-auto data-[state=inactive]:hidden'
                value='table'
              >
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
                      <tr
                        key={index}
                        className={[
                          'cursor-default border-b border-border-subtle/70',
                          rowLineages[index] && index === selectedRowIndex
                            ? 'bg-action-selected'
                            : 'hover:bg-action-ghost-hover',
                        ].join(' ')}
                        onClick={() => onSelectRow(index)}
                      >
                        {columns.map((column) => {
                          const cell = formatCell(row[column]);
                          return (
                            <td
                              key={column}
                              className='max-w-[340px] truncate px-2 py-1 text-text-secondary'
                              title={cell.title}
                            >
                              {cell.value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>
              <TabsContent
                className='col-start-1 row-start-1 m-0 h-full min-h-0 overflow-auto data-[state=inactive]:hidden'
                value='tree'
              >
                <ResultTreeView
                  expandedIds={treeState.expandedIds}
                  hasMore={false}
                  isFetchingMore={false}
                  queryPath={FDQL_TREE_QUERY_PATH}
                  rows={treeRows}
                  subcollectionStates={{}}
                  valueChildLimits={treeState.valueChildLimits}
                  onLoadMore={() => undefined}
                  onShowMoreValueChildren={showMoreTreeValueChildren}
                  onToggleNode={toggleTreeNode}
                />
              </TabsContent>
              <TabsContent
                className='col-start-1 row-start-1 m-0 h-full min-h-0 overflow-hidden data-[state=inactive]:hidden'
                value='json'
              >
                <JsonPreview
                  active={resultView === 'json'}
                  ariaLabel='FDQL JSON results'
                  mode='textarea'
                  value={rows}
                />
              </TabsContent>
            </div>
          )}
      </PanelBody>
    </Tabs>
  );
}

function LineageView(
  { lineage, stats, onOpenDocumentInNewTab }: {
    readonly lineage: FdqlResultRowLineage | null;
    readonly stats: FdqlStats | null;
    readonly onOpenDocumentInNewTab?: ((documentPath: string) => void) | undefined;
  },
) {
  return (
    <PanelBody className='h-full min-h-0 space-y-3 overflow-auto text-xs'>
      <section className='space-y-1'>
        <h3 className='text-sm font-semibold text-text-primary'>Stage stats</h3>
        {stats?.stageStats.length
          ? (
            <div className='divide-y divide-border-subtle rounded-md border border-border-subtle'>
              {stats.stageStats.map((stage, index) => (
                <div
                  key={`${stage.stage}-${index}`}
                  className='grid grid-cols-[1fr_auto] gap-3 px-2 py-1.5'
                >
                  <span className='font-medium text-text-primary'>{stage.stage}</span>
                  <span className='text-text-muted'>
                    {stage.inputRows} in · {stage.outputRows} out · {stage.droppedRows} dropped
                    {stage.reads ? ` · ${stage.reads} reads` : ''}
                    {stage.aggregateReads ? ` · ${stage.aggregateReads} aggregates` : ''}
                  </span>
                </div>
              ))}
            </div>
          )
          : <p className='text-text-muted'>No stage stats yet.</p>}
      </section>
      <section className='space-y-2'>
        <h3 className='text-sm font-semibold text-text-primary'>Selected row</h3>
        {!lineage
          ? <p className='text-text-muted'>Lineage disabled for this run.</p>
          : (
            <>
              <p className='text-text-muted'>
                {lineage.mode} · {lineage.readContribution} read contribution
              </p>
              <div className='space-y-2'>
                {lineage.sources.length
                  ? lineage.sources.map((source, index) => (
                    <div
                      key={`${source.provider}-${source.source}-${source.rowPath ?? index}`}
                      className='rounded-md border border-border-subtle px-2 py-1.5'
                    >
                      <div className='flex flex-wrap items-center justify-between gap-2'>
                        <span className='font-medium text-text-primary'>
                          {source.provider} · {source.source}
                        </span>
                        {source.provider === 'fs' && source.rowPath
                          ? (
                            <div className='flex gap-1'>
                              <Button
                                size='xs'
                                variant='ghost'
                                onClick={() => copyText(source.rowPath ?? '')}
                              >
                                <Copy size={12} aria-hidden='true' /> Copy path
                              </Button>
                              {onOpenDocumentInNewTab
                                ? (
                                  <Button
                                    size='xs'
                                    variant='ghost'
                                    onClick={() => onOpenDocumentInNewTab(source.rowPath ?? '')}
                                  >
                                    <ExternalLink size={12} aria-hidden='true' /> Open
                                  </Button>
                                )
                                : null}
                            </div>
                          )
                          : null}
                      </div>
                      <p className='truncate text-text-muted' title={source.rowPath}>
                        {source.rowPath ?? source.stage}
                      </p>
                    </div>
                  ))
                  : <p className='text-text-muted'>No document source for this row.</p>}
              </div>
              {lineage.trace?.length
                ? (
                  <div className='space-y-1'>
                    <h4 className='font-medium text-text-primary'>Trace</h4>
                    {lineage.trace.map((step, index) => (
                      <p key={`${step.stage}-${step.action}-${index}`} className='text-text-muted'>
                        {step.stage}: {step.action}
                        {step.binding ? ` ${step.binding}` : ''}
                        {step.reason ? ` (${step.reason})` : ''}
                      </p>
                    ))}
                  </div>
                )
                : null}
            </>
          )}
      </section>
    </PanelBody>
  );
}

function IssuesView(
  { diagnostics, onIssueClick }: {
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly onIssueClick: (diagnostic: FdqlDiagnostic) => void;
  },
) {
  return (
    <PanelBody className='h-full min-h-0 select-text space-y-2 overflow-auto text-xs'>
      {diagnostics.length === 0
        ? <p className='text-text-muted'>No issues.</p>
        : diagnostics.map((diagnostic, index) => (
          <div key={`${diagnostic.code}-${index}`} className='space-y-1'>
            <Badge variant={diagnostic.severity === 'error' ? 'danger' : 'warning'}>
              {diagnostic.code}
            </Badge>
            {diagnostic.line
              ? (
                <button
                  className='block text-left text-text-muted underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'
                  type='button'
                  onClick={() => onIssueClick(diagnostic)}
                >
                  Line {diagnostic.line}
                  {diagnostic.column ? `, column ${diagnostic.column}` : ''}
                </button>
              )
              : null}
            {diagnostic.context
              ? <p className='break-words text-text-muted'>{diagnosticContextLabel(diagnostic)}</p>
              : null}
            <p className='break-words text-text-secondary'>{diagnostic.message}</p>
          </div>
        ))}
    </PanelBody>
  );
}

function diagnosticContextLabel(diagnostic: FdqlDiagnostic): string {
  const context = diagnostic.context;
  if (!context) return '';
  return [
    context.provider ? `provider ${context.provider}` : null,
    context.source ? `source ${context.source}` : null,
    context.stage ? `stage ${context.stage}` : null,
    context.rowAlias ? `row ${context.rowAlias}` : null,
    context.rowPath ? `path ${context.rowPath}` : null,
  ].filter(Boolean).join(' · ');
}

function resultColumns(rows: readonly Record<string, unknown>[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return [...columns];
}

function formatCell(
  value: unknown,
): { readonly title?: string | undefined; readonly value: string; } {
  if (value === undefined) return { value: '' };
  const title = typedTimestampTitle(value);
  return {
    ...(title ? { title } : {}),
    value: formatFirestoreValue(value),
  };
}

function typedTimestampTitle(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = record['__fdqlType'] ?? record['__type__'];
  return type === 'timestamp' && typeof record['value'] === 'string' ? record['value'] : undefined;
}

function copyText(value: string): void {
  void globalThis.navigator?.clipboard?.writeText(value).catch(() => {});
}

function treeDocumentsForRows(
  rows: readonly Record<string, unknown>[],
): readonly FirestoreDocumentResult[] {
  return rows.map((row, index) => ({
    data: row,
    hasSubcollections: false,
    id: `row_${index + 1}`,
    path: `fdql-results/row_${index + 1}`,
  }));
}

function defaultFdqlTreeExpansion(
  rows: readonly FirestoreDocumentResult[],
): ReadonlySet<string> {
  const rootId = `root:${FDQL_TREE_QUERY_PATH}`;
  const first = rows[0];
  if (!first) return new Set([rootId]);
  const documentId = `doc:${first.path}`;
  return new Set([rootId, documentId, `${documentId}:fields`]);
}

function statusLabel(
  stats: FdqlStats | null,
  isRunning: boolean,
  command: FdqlRunCommandResult | null,
): string {
  if (isRunning) return 'running';
  if (command) return 'completed';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return stats.stoppedReason;
  if (stats) return 'completed';
  return 'idle';
}

function statusVariant(
  stats: FdqlStats | null,
  isRunning: boolean,
  command: FdqlRunCommandResult | null,
): 'neutral' | 'success' | 'warning' {
  if (isRunning) return 'warning';
  if (command) return 'success';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return 'warning';
  return stats ? 'success' : 'neutral';
}

function cacheStatLabels(stats: FdqlStats | null): readonly string[] {
  if (
    !stats
    || stats.cacheHits + stats.cacheMisses + stats.cacheWrites + stats.cacheEvictions === 0
  ) {
    return [];
  }
  const labels = [
    pluralLabel(stats.cacheHits, 'cache hit', 'cache hits'),
    pluralLabel(stats.cacheMisses, 'cache miss', 'cache misses'),
  ];
  if (stats.cacheWrites > 0) {
    labels.push(pluralLabel(stats.cacheWrites, 'cache write', 'cache writes'));
  }
  if (stats.cacheEvictions > 0) {
    labels.push(pluralLabel(stats.cacheEvictions, 'cache eviction', 'cache evictions'));
  }
  return labels;
}

function pluralLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function issuesVariant(diagnostics: readonly FdqlDiagnostic[]): 'danger' | 'warning' {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'danger' : 'warning';
}
