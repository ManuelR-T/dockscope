import { describe, expect, it, vi } from 'vitest';
import type { Writable } from 'stream';
import type { KubeClient } from '../client';
import { getLogsForPod } from '../resources/pods';
import { entityActions, runResourceAction } from '../actions';

/**
 * The graph is pure and well covered; the provider surface (logs and actions)
 * is where the plugin actually talks to the cluster, and it was the untested
 * half. Both bugs these tests pin down shipped because `name` and `namespace`
 * are both strings, so a swap type-checks.
 */

interface FakeCall {
  namespace: string;
  name: string;
  container: string;
}

function fakeClient(pods: { namespace: string; name: string; container: string }[]) {
  const logCalls: FakeCall[] = [];

  const client = {
    coreApi: {
      listNamespacedPod: vi.fn(async ({ namespace }: { namespace: string }) => ({
        items: pods
          .filter((pod) => pod.namespace === namespace)
          .map((pod) => ({
            metadata: { namespace: pod.namespace, name: pod.name },
            spec: { containers: [{ name: pod.container }] },
          })),
      })),
      deleteNamespacedPod: vi.fn(async () => ({})),
    },
    autoScalingApi: {
      patchNamespacedHorizontalPodAutoscaler: vi.fn(async () => ({})),
    },
    logs: {
      log: vi.fn(async (namespace: string, name: string, container: string, stream: Writable) => {
        logCalls.push({ namespace, name, container });
        stream.write(`logs of ${namespace}/${name}`);
        stream.end();
      }),
    },
  } as unknown as KubeClient;

  return { client, logCalls };
}

describe('getLogsForPod', () => {
  const pods = [{ namespace: 'default', name: 'web-abc', container: 'nginx' }];

  it('reads the log stream of the requested pod', async () => {
    const { client, logCalls } = fakeClient(pods);

    const logs = await getLogsForPod(client, { namespace: 'default', name: 'web-abc' });

    expect(logs).toBe('logs of default/web-abc');
    // Regression: the caller passed (namespace, name) into a (name, namespace)
    // signature, so every pod looked up namespace "web-abc" and 404'd.
    expect(logCalls).toEqual([{ namespace: 'default', name: 'web-abc', container: 'nginx' }]);
  });

  it('passes the tail option through to the API', async () => {
    const { client } = fakeClient(pods);

    await getLogsForPod(client, { namespace: 'default', name: 'web-abc' }, { tail: 12 });

    expect(client.logs.log).toHaveBeenCalledWith(
      'default',
      'web-abc',
      'nginx',
      expect.anything(),
      expect.objectContaining({ tailLines: 12 }),
    );
  });

  it('names the pod it could not find', async () => {
    const { client } = fakeClient(pods);

    await expect(getLogsForPod(client, { namespace: 'default', name: 'missing' })).rejects.toThrow(
      'default/missing',
    );
  });
});

describe('entityActions', () => {
  function hpaRef(metadata: Record<string, string | number | boolean>) {
    return {
      entityId: 'k8s:hpa:default:web',
      context: { name: 'web', metadata },
    };
  }

  it('pre-fills the replica bounds from the node metadata', () => {
    const actions = entityActions(hpaRef({ minReplicas: 2, maxReplicas: 5 }));
    const scale = actions.find((action) => action.id === 'set_hpa_constraints');

    // Regression: these defaulted to 1/1 because the bounds were only published
    // as a "2-5" string, so accepting the form scaled a 2-5 autoscaler down.
    expect(scale?.input?.fields).toEqual([
      expect.objectContaining({ key: 'minReplicas', default: 2 }),
      expect.objectContaining({ key: 'maxReplicas', default: 5 }),
    ]);
  });

  it('offers the scale action only on autoscalers', () => {
    const ids = (id: string) =>
      entityActions({ entityId: id, context: { name: 'x', metadata: {} } }).map((a) => a.id);

    expect(ids('k8s:hpa:default:web')).toContain('set_hpa_constraints');
    expect(ids('k8s:pod:default:web-abc')).not.toContain('set_hpa_constraints');
    expect(ids('k8s:pod:default:web-abc')).toContain('delete');
  });

  it('guards deletion behind typing the resource name', () => {
    const remove = entityActions(hpaRef({})).find((action) => action.id === 'delete');
    expect(remove?.confirm).toMatchObject({ typeToConfirm: 'web', variant: 'danger' });
  });
});

describe('runResourceAction', () => {
  it('patches the autoscaler with the requested bounds', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:hpa:default:web', 'set_hpa_constraints', {
      minReplicas: 3,
      maxReplicas: 9,
    });

    expect(client.autoScalingApi.patchNamespacedHorizontalPodAutoscaler).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        name: 'web',
        body: { spec: { minReplicas: 3, maxReplicas: 9 } },
      }),
    );
  });

  it('deletes the pod the id points at', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:pod:kube-system:coredns-abc', 'delete');

    expect(client.coreApi.deleteNamespacedPod).toHaveBeenCalledWith({
      namespace: 'kube-system',
      name: 'coredns-abc',
    });
  });

  it('rejects an action it does not implement', async () => {
    const { client } = fakeClient([]);
    await expect(runResourceAction(client, 'k8s:pod:default:web', 'restart')).rejects.toThrow(
      'Unsupported',
    );
  });

  it('refuses to scale anything that is not an autoscaler', async () => {
    const { client } = fakeClient([]);
    await expect(
      runResourceAction(client, 'k8s:pod:default:web', 'set_hpa_constraints', {
        minReplicas: 1,
        maxReplicas: 2,
      }),
    ).rejects.toThrow('Only HPA');
  });
});
