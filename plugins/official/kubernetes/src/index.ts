import { DockscopePlugin, PluginFactoryContext, LogsOptions } from 'dockscope/plugin-sdk';
import { KubeConfig } from '@kubernetes/client-node';
import { KubeClient, makeKubeClient } from './client';
import listResources from './resources';
import { buildGraph } from './graph';
import { parseResourceId } from './utils';
import { getLogsForPod, streamPodLogs } from './resources/pods';
import { PodMetricsCache } from './resources/metrics';
import { inspectPod } from './resources/inspect';
import { createPodExecSession } from './resources/exec';
import { entityActions, runResourceAction } from './actions';

const KUBERNETES_SOURCE_ID = 'kubernetes';

/**
 * Logs, stats, inspect and exec all belong to a pod. Anything else in the
 * graph is a controller or a routing object with nothing of its own to read.
 */
function podRefOf(entityId: string): { namespace: string; name: string } | undefined {
  try {
    const resource = parseResourceId(entityId);
    return resource.kind === 'pod' ? resource : undefined;
  } catch {
    return undefined;
  }
}

function requirePodRef(entityId: string, operation: string) {
  const pod = podRefOf(entityId);
  if (!pod) {
    throw new Error(`${operation} are only available for Pod resources`);
  }
  return pod;
}

async function getResourceLogs(
  client: KubeClient,
  resourceId: string,
  options?: LogsOptions,
): Promise<string> {
  return getLogsForPod(client, requirePodRef(resourceId, 'Logs'), options);
}

export default function createPlugin({ manifest, config }: PluginFactoryContext): DockscopePlugin {
  const descriptor = {
    id: KUBERNETES_SOURCE_ID,
    label: 'Kubernetes',
    kind: 'kubernetes' as const,
    pluginId: manifest.id,
    capabilities: manifest.capabilities,
    status: 'unknown' as const,
  };

  const kubeConfig = new KubeConfig();

  // Default discovery honours $KUBECONFIG and ~/.kube/config, which is what
  // kubectl did before this plugin talked to the API directly. The explicit
  // path is only an override: loadFromFile(undefined) throws, so reaching for
  // it unconditionally made the plugin fail to load whenever it was unset.
  const kubeConfigPath = config['KUBE_CONFIG'];
  if (typeof kubeConfigPath === 'string' && kubeConfigPath.trim() !== '') {
    kubeConfig.loadFromFile(kubeConfigPath);
  } else {
    kubeConfig.loadFromDefault();
  }

  const client = makeKubeClient(kubeConfig);
  const metrics = new PodMetricsCache(client, client.metrics);

  return {
    manifest,
    getGraphSources() {
      return [
        {
          describe() {
            return descriptor;
          },
          async collectGraph() {
            const resources = await listResources(client);
            return {
              source: descriptor,
              graph: buildGraph(resources),
              collectedAt: Date.now(),
            };
          },
        },
      ];
    },
    getLogsProviders() {
      return [
        {
          canHandle: (ref) => Boolean(podRefOf(ref.entityId)),
          getLogs: (ref, options) => getResourceLogs(client, ref.entityId, options),
        },
      ];
    },
    getLogStreamProviders() {
      return [
        {
          canHandle: (ref) => Boolean(podRefOf(ref.entityId)),
          streamLogs: (ref, onData, onError) =>
            streamPodLogs(client, requirePodRef(ref.entityId, 'Logs'), onData, onError),
        },
      ];
    },
    getStatsProviders() {
      return [
        {
          // Only pods report usage: a Deployment's consumption is the sum of
          // its pods, which the graph already shows individually.
          canHandle: (ref) => Boolean(podRefOf(ref.entityId)),
          async getStats(ref) {
            const { namespace, name } = requirePodRef(ref.entityId, 'Stats');
            return { id: ref.nodeId ?? ref.entityId, ...(await metrics.statsFor(namespace, name)) };
          },
        },
      ];
    },
    getInspectProviders() {
      return [
        {
          canHandle: (ref) => Boolean(podRefOf(ref.entityId)),
          inspect: (ref) =>
            inspectPod(client, requirePodRef(ref.entityId, 'Inspect'), ref.nodeId ?? ref.entityId),
        },
      ];
    },
    getExecProviders() {
      return [
        {
          canHandle: (ref) => Boolean(podRefOf(ref.entityId)),
          createExecSession: (ref, command) =>
            createPodExecSession(client, requirePodRef(ref.entityId, 'Exec sessions'), command),
        },
      ];
    },
    getActionProviders() {
      return [
        {
          canHandle(ref) {
            try {
              parseResourceId(ref.entityId);
              return true;
            } catch {
              return false;
            }
          },
          listActions: entityActions,
          async runAction(ref, actionId, input) {
            await runResourceAction(client, ref.entityId, actionId, input);
            return { ok: true, message: `${actionId} completed` };
          },
        },
      ];
    },
  };
}
