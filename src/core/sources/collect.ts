import { errorMessage } from '../../utils.js';
import { graphToTables, mergeSourceSnapshots, scopeGraphToSource } from './graph.js';
import type {
  GraphSourceAdapter,
  SourceCollectionError,
  SourceGraphCollection,
  SourceGraphSnapshot,
} from './model.js';

interface CollectSourceGraphsOptions {
  timeoutMs?: number;
  scopeIds?: boolean;
  now?: () => number;
}

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function collectOne(
  adapter: GraphSourceAdapter,
  timeoutMs: number | undefined,
  now: () => number,
): Promise<
  { ok: true; snapshot: SourceGraphSnapshot } | { ok: false; error: SourceCollectionError }
> {
  const source = adapter.describe();
  try {
    const snapshot = timeoutMs
      ? await Promise.race([adapter.collectGraph(), rejectAfter<SourceGraphSnapshot>(timeoutMs)])
      : await adapter.collectGraph();
    return {
      ok: true,
      snapshot: {
        ...snapshot,
        source,
        collectedAt: snapshot.collectedAt || now(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        source,
        message: errorMessage(error),
        collectedAt: now(),
      },
    };
  }
}

export async function collectSourceGraphs(
  adapters: readonly GraphSourceAdapter[],
  options: CollectSourceGraphsOptions = {},
): Promise<SourceGraphCollection> {
  const now = options.now ?? Date.now;
  const collected = await Promise.all(
    adapters.map((adapter) => collectOne(adapter, options.timeoutMs, now)),
  );
  const shouldScope = options.scopeIds ?? adapters.length > 1;
  const snapshots = collected.flatMap((result): SourceGraphSnapshot[] => {
    if (!result.ok) {
      return [];
    }
    return [
      {
        ...result.snapshot,
        graph: scopeGraphToSource(result.snapshot.graph, result.snapshot.source.id, shouldScope),
      },
    ];
  });
  const errors = collected.flatMap((result) => (result.ok ? [] : [result.error]));
  const graph = mergeSourceSnapshots(snapshots);

  return {
    snapshots,
    graph,
    tables: graphToTables(graph),
    errors,
    collectedAt: now(),
  };
}
