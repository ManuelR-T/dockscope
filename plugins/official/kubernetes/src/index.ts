import { DockscopePlugin, PluginFactoryContext, LogsOptions } from 'dockscope/plugin-sdk';
import { KubeConfig } from '@kubernetes/client-node';
import { KubeClient, makeKubeClient } from './client';
import listResources from './resources';
import { buildGraph } from './graph';
import { parseResourceId } from './utils';
import { getLogsForPod } from './resources/pods';

const KUBERNETES_SOURCE_ID = 'kubernetes';

async function getResourceLogs(
  client: KubeClient,
  resourceId: string,
  options?: LogsOptions,
): Promise<string> {
  const resource = parseResourceId(resourceId);
  if (resource.kind !== 'pod') {
    throw new Error('Logs are only available for Pod resources');
  }

  return getLogsForPod(client, resource.namespace, resource.name, options);
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

  kubeConfig.loadFromFile(config['KUBE_CONFIG'] as string);

  const client = makeKubeClient(kubeConfig);

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
          canHandle(ref) {
            try {
              return parseResourceId(ref.entityId).kind === 'pod';
            } catch {
              return false;
            }
          },
          getLogs: (ref, options) => getResourceLogs(client, ref.entityId, options),
        },
      ];
    },
    //     getActionProviders() {
    //       return [
    //         {
    //           canHandle(ref) {
    //             try {
    //               parseResourceId(ref.entityId);
    //               return true;
    //             } catch {
    //               return false;
    //             }
    //           },
    //           listActions: entityActions,
    //           async runAction(ref, actionId, input) {
    //             await runResourceAction(host, ref.entityId, actionId, input);
    //             return { ok: true, message: `${actionId} completed` };
    //           },
    //         },
    //       ];
    //     },
  };
}
