import type {
  FdqlCompileResult,
  FdqlDiagnostic,
  FdqlRunResult,
  FdqlStats,
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
import { AlertTriangle, Play, Square, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';

export const FDQL_SAMPLE_SOURCE = `set readBudget = 5000

alias $orders = fs.collection("orders", ["status", "total"])

from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 25

return fs.id(o) as id, o.status, o.total`;

export interface FdqlSurfaceProps {
  readonly compileResult?: FdqlCompileResult | null;
  readonly isRunning?: boolean;
  readonly onCancel: () => void;
  readonly onRun: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly result?: FdqlRunResult | null;
  readonly source: string;
}

export function FdqlSurface(
  {
    compileResult = null,
    isRunning = false,
    onCancel,
    onRun,
    onSourceChange,
    result = null,
    source,
  }: FdqlSurfaceProps,
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
                language='sql'
                readOnly={isRunning}
                value={source}
                onChange={onSourceChange}
              />
            </PanelBody>
          </Panel>
        </ResizablePanel>
        <ResizableHandle className={isWide ? 'mx-2 h-full w-px' : 'my-2 h-px w-full'} />
        <ResizablePanel defaultSize={isWide ? '52%' : '48%'} minSize={isWide ? '420px' : '240px'}>
          <FdqlOutputPanel
            diagnostics={diagnostics}
            isRunning={isRunning}
            rows={rows}
            stats={result?.stats ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function FdqlOutputPanel(
  { diagnostics, isRunning, rows, stats }: {
    readonly diagnostics: readonly FdqlDiagnostic[];
    readonly isRunning: boolean;
    readonly rows: readonly Record<string, unknown>[];
    readonly stats: FdqlStats | null;
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
      </Panel>
    </Tabs>
  );
}

function ResultsView(
  { isRunning, rows, stats }: {
    readonly isRunning: boolean;
    readonly rows: readonly Record<string, unknown>[];
    readonly stats: FdqlStats | null;
  },
) {
  const columns = useMemo(() => resultColumns(rows), [rows]);
  return (
    <div className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
      <div className='flex flex-wrap items-center gap-2 border-b border-border-subtle px-2 py-1 text-xs text-text-secondary'>
        <span>{rows.length} rows</span>
        <span>{stats?.reads ?? 0} reads</span>
        <span>{stats?.rowsScanned ?? 0} scanned</span>
        <span>{stats?.stoppedReason ?? 'idle'}</span>
      </div>
      <PanelBody className='min-h-0 p-0'>
        {rows.length === 0
          ? (
            <EmptyState
              title={isRunning ? 'Waiting for rows' : 'No rows yet'}
              description={isRunning
                ? 'Rows stream here as FDQL runs.'
                : 'Run a bounded FDQL read.'}
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

function IssuesView({ diagnostics }: { readonly diagnostics: readonly FdqlDiagnostic[]; }) {
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

function statusLabel(stats: FdqlStats | null, isRunning: boolean): string {
  if (isRunning) return 'running';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return stats.stoppedReason;
  if (stats) return 'completed';
  return 'idle';
}

function statusVariant(
  stats: FdqlStats | null,
  isRunning: boolean,
): 'neutral' | 'success' | 'warning' {
  if (isRunning) return 'warning';
  if (stats?.stoppedReason && stats.stoppedReason !== 'completed') return 'warning';
  return stats ? 'success' : 'neutral';
}

function issuesVariant(diagnostics: readonly FdqlDiagnostic[]): 'danger' | 'warning' {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'danger' : 'warning';
}
