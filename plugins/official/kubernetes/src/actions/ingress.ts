import { KubeClient } from '../client';

export async function deleteIngress(client: KubeClient, name: string, namespace: string) {
  return client.networkingApi.deleteNamespacedIngress({ name, namespace });
}
