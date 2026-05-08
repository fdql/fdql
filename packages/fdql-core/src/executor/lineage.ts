import type {
  FdqlLineageBinding,
  FdqlLineageMode,
  FdqlLineageSource,
  FdqlLineageTraceStep,
  FdqlProviderAggregatePlan,
  FdqlProviderRow,
  FdqlProviderSource,
  FdqlResultRowLineage,
  FdqlStageStats,
} from '../types.ts';
import type { RowRecord } from './types.ts';

export interface FdqlLineageRecorder {
  attach(input: {
    readonly binding: string;
    readonly row: RowRecord;
    readonly sources: readonly FdqlLineageSource[];
    readonly stage: string;
  }): void;
  derive(input: {
    readonly from: RowRecord;
    readonly stage: string;
    readonly to: RowRecord;
  }): void;
  drop(input: { readonly reason: string; readonly row: RowRecord; readonly stage: string; }): void;
  output(input: {
    readonly projected: Record<string, unknown>;
    readonly row: RowRecord;
    readonly stage: string;
  }): FdqlResultRowLineage | undefined;
  source(input: {
    readonly binding: string;
    readonly document: FdqlProviderRow;
    readonly row: RowRecord;
    readonly stage: string;
  }): void;
  stage(input: FdqlStageStats): void;
}

type BindingMap = Map<string, FdqlLineageBinding>;

export function createLineageRecorder(
  mode: FdqlLineageMode,
  stageStats: FdqlStageStats[],
): FdqlLineageRecorder {
  if (mode === 'off') return createNoopLineageRecorder(stageStats);
  return createTrackedLineageRecorder(mode, stageStats);
}

export function lineageSourcesForRows(
  documents: readonly FdqlProviderRow[],
  stage: string,
  readContribution = 1,
): readonly FdqlLineageSource[] {
  return documents.map((document) => lineageSourceForRow(document, stage, readContribution));
}

export function lineageSourceForProviderSource(
  source: FdqlProviderSource,
  stage: string,
  readContribution: number,
): FdqlLineageSource {
  return {
    provider: source.provider,
    readContribution,
    source: source.sourceAlias,
    stage,
  };
}

export function aggregateLineageBindings(
  aggregate: FdqlProviderAggregatePlan,
  sources: readonly FdqlLineageSource[],
): readonly { readonly binding: string; readonly sources: readonly FdqlLineageSource[]; }[] {
  return aggregate.outputs.map((output) => ({ binding: output.alias, sources }));
}

function createNoopLineageRecorder(stageStats: FdqlStageStats[]): FdqlLineageRecorder {
  return {
    attach() {},
    derive() {},
    drop() {},
    output() {
      return undefined;
    },
    source() {},
    stage(input) {
      stageStats.push(input);
    },
  };
}

function createTrackedLineageRecorder(
  mode: Exclude<FdqlLineageMode, 'off'>,
  stageStats: FdqlStageStats[],
): FdqlLineageRecorder {
  const bindingsByRow = new WeakMap<RowRecord, BindingMap>();
  const traceByRow = new WeakMap<RowRecord, readonly FdqlLineageTraceStep[]>();
  const shouldTrace = mode === 'trace';

  function bindingsFor(row: RowRecord): BindingMap {
    const existing = bindingsByRow.get(row);
    if (existing) return existing;
    const bindings = new Map<string, FdqlLineageBinding>();
    bindingsByRow.set(row, bindings);
    return bindings;
  }

  function appendTrace(
    row: RowRecord,
    step: FdqlLineageTraceStep,
    base?: readonly FdqlLineageTraceStep[] | undefined,
  ) {
    if (!shouldTrace) return;
    traceByRow.set(row, [...(base ?? traceByRow.get(row) ?? []), step]);
  }

  return {
    attach(input) {
      const bindings = bindingsFor(input.row);
      bindings.set(input.binding, { binding: input.binding, sources: input.sources });
      appendTrace(input.row, {
        action: 'attach',
        binding: input.binding,
        stage: input.stage,
      });
    },
    derive(input) {
      bindingsByRow.set(input.to, cloneBindings(bindingsFor(input.from)));
      appendTrace(input.to, { action: 'derive', stage: input.stage }, traceByRow.get(input.from));
    },
    drop(input) {
      appendTrace(input.row, { action: 'drop', reason: input.reason, stage: input.stage });
    },
    output(input) {
      const bindings = [...bindingsFor(input.row).values()];
      const sources = uniqueSources(bindings.flatMap((binding) => binding.sources));
      const readContribution = sources.reduce(
        (total, source) => total + source.readContribution,
        0,
      );
      const lineage: FdqlResultRowLineage = {
        bindings,
        mode,
        readContribution,
        sources,
        ...(shouldTrace
          ? {
            trace: [
              ...(traceByRow.get(input.row) ?? []),
              { action: 'output', stage: input.stage },
            ],
          }
          : {}),
      };
      return lineage;
    },
    source(input) {
      const source = lineageSourceForRow(input.document, input.stage);
      bindingsByRow.set(
        input.row,
        new Map([
          [input.binding, { binding: input.binding, sources: [source] }],
        ]),
      );
      appendTrace(input.row, { action: 'source', binding: input.binding, stage: input.stage });
    },
    stage(input) {
      stageStats.push(input);
    },
  };
}

function lineageSourceForRow(
  document: FdqlProviderRow,
  stage: string,
  readContribution = 1,
): FdqlLineageSource {
  return {
    provider: document.provider,
    readContribution,
    rowId: document.id,
    rowPath: document.path,
    source: document.source.sourceAlias,
    stage,
  };
}

function cloneBindings(bindings: BindingMap): BindingMap {
  return new Map(
    [...bindings.entries()].map(([key, value]) => [
      key,
      { binding: value.binding, sources: [...value.sources] },
    ]),
  );
}

function uniqueSources(sources: readonly FdqlLineageSource[]): readonly FdqlLineageSource[] {
  const seen = new Set<string>();
  const unique: FdqlLineageSource[] = [];
  for (const source of sources) {
    const key = [
      source.provider,
      source.source,
      source.rowPath ?? '',
      source.stage,
    ].join('\u001f');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}
