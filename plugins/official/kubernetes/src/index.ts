import { DockscopePlugin, PluginFactoryContext } from 'dockscope/plugin-sdk';

// const KUBERNETES_SOURCE_ID = 'kubernetes';

export default function createPlugin({ manifest }: PluginFactoryContext): DockscopePlugin {
  //   const _descriptor = {
  //     id: KUBERNETES_SOURCE_ID,
  //     label: 'Kubernetes',
  //     kind: 'kubernetes',
  //     pluginId: manifest.id,
  //     capabilities: manifest.capabilities,
  //     status: 'unknown',
  //   };

  return {
    manifest,
    //     getGraphSources() {
    //       return [
    //         {
    //           describe() {
    //             return descriptor;
    //           },
    //           async collectGraph() {
    //             const resources = await listResources(host);
    //             return {
    //               source: descriptor,
    //               graph: buildGraph(resources),
    //               collectedAt: Date.now(),
    //             };
    //           },
    //         },
    //       ];
    //     },
    //     getLogsProviders() {
    //       return [
    //         {
    //           canHandle(ref) {
    //             try {
    //               return parseResourceId(ref.entityId).kind === 'pod';
    //             } catch {
    //               return false;
    //             }
    //           },
    //           getLogs: (ref, options) => getResourceLogs(host, ref.entityId, options),
    //         },
    //       ];
    //     },
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
