import { KubeClient, mergePatchOptions } from '../client';

export interface HpaPatchActionOptions {
  minReplicas: number;
  maxReplicas: number;
}

export type HpaActionOptions = HpaPatchActionOptions;

export async function hpaPatch(
  client: KubeClient,
  name: string,
  namespace: string,
  { minReplicas, maxReplicas }: Partial<HpaPatchActionOptions>,
) {
  if (!minReplicas || !maxReplicas) {
    throw new Error('Missing options minReplicas and / or maxReplicas');
  }

  return client.autoScalingApi.patchNamespacedHorizontalPodAutoscaler(
    {
      namespace,
      name,
      body: {
        spec: {
          minReplicas,
          maxReplicas,
        },
      },
    },
    mergePatchOptions,
  );
}

export async function deleteHpa(client: KubeClient, name: string, namespace: string) {
  return client.autoScalingApi.deleteNamespacedHorizontalPodAutoscaler({ name, namespace });
}
