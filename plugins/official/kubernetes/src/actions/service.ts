import { KubeClient } from '../client';

export async function deleteService(client: KubeClient, name: string, namespace: string) {
  return client.coreApi.deleteNamespacedService({ name, namespace });
}
