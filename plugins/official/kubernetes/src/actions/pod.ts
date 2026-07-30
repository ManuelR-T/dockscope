import { KubeClient } from '../client';

export async function deletePod(client: KubeClient, name: string, namespace: string) {
  return client.coreApi.deleteNamespacedPod({ name, namespace });
}
