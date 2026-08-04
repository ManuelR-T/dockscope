import { describe, expect, it, vi } from 'vitest';
import type { Writable } from 'stream';
import type { EntityRef } from 'dockscope';
import type { KubeClient } from '../client';
import { mergePatchOptions } from '../client';
import { getLogsForPod, streamPodLogs } from '../resources/pods';
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
  const streams: Writable[] = [];

  const client = {
    coreApi: {
      readNamespacedPod: vi.fn(async ({ namespace, name }: { namespace: string; name: string }) => {
        const pod = pods.find((entry) => entry.namespace === namespace && entry.name === name);
        if (!pod) {
          // The real API 404s rather than returning an empty result.
          throw new Error('HTTP-Code: 404');
        }
        return {
          metadata: { namespace: pod.namespace, name: pod.name },
          spec: { containers: [{ name: pod.container }] },
        };
      }),
      deleteNamespacedPod: vi.fn(async () => ({})),
    },
    autoScalingApi: {
      patchNamespacedHorizontalPodAutoscaler: vi.fn(async () => ({})),
    },
    appsApi: {
      patchNamespacedDeployment: vi.fn(async () => ({})),
      patchNamespacedStatefulSet: vi.fn(async () => ({})),
      patchNamespacedDaemonSet: vi.fn(async () => ({})),
      deleteNamespacedDeployment: vi.fn(async () => ({})),
    },
    logs: {
      log: vi.fn(
        async (
          namespace: string,
          name: string,
          container: string,
          stream: Writable,
          options?: { follow?: boolean },
        ) => {
          logCalls.push({ namespace, name, container });
          stream.write(`logs of ${namespace}/${name}`);
          // A follow stream stays open; a one-shot read ends so the caller's
          // promise can resolve.
          if (!options?.follow) {
            stream.end();
          }
          streams.push(stream);
          return new AbortController();
        },
      ),
    },
  } as unknown as KubeClient;

  return { client, logCalls, streams };
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

  it('asks for timestamps, which the client shortens for display', async () => {
    const { client } = fakeClient(pods);

    await getLogsForPod(client, { namespace: 'default', name: 'web-abc' });

    expect(client.logs.log).toHaveBeenCalledWith(
      'default',
      'web-abc',
      'nginx',
      expect.anything(),
      expect.objectContaining({ timestamps: true }),
    );
  });
});

describe('streamPodLogs', () => {
  const pods = [{ namespace: 'default', name: 'web-abc', container: 'nginx' }];

  it('follows the pod and forwards each chunk', async () => {
    const { client } = fakeClient(pods);
    const chunks: string[] = [];

    await streamPodLogs(client, { namespace: 'default', name: 'web-abc' }, (text) =>
      chunks.push(text),
    );

    expect(chunks).toEqual(['logs of default/web-abc']);
    expect(client.logs.log).toHaveBeenCalledWith(
      'default',
      'web-abc',
      'nginx',
      expect.anything(),
      expect.objectContaining({ follow: true, timestamps: true }),
    );
  });

  it('aborts the request when the subscriber tears down', async () => {
    const { client } = fakeClient(pods);
    const controller = new AbortController();
    vi.mocked(client.logs.log).mockImplementation(async () => controller);

    const stop = await streamPodLogs(client, { namespace: 'default', name: 'web-abc' }, () => {});
    expect(controller.signal.aborted).toBe(false);

    stop();
    expect(controller.signal.aborted).toBe(true);
  });

  // Aborting is not instantaneous, so a chunk can still arrive afterwards. It
  // must not reach a subscriber that has already gone away.
  it('drops chunks that land after teardown', async () => {
    const { client, streams } = fakeClient(pods);
    const chunks: string[] = [];

    const stop = await streamPodLogs(client, { namespace: 'default', name: 'web-abc' }, (text) =>
      chunks.push(text),
    );
    stop();
    streams[0]!.write('late line');

    expect(chunks).toEqual(['logs of default/web-abc']);
  });

  it('refuses a pod it cannot read', async () => {
    const { client } = fakeClient(pods);
    await expect(
      streamPodLogs(client, { namespace: 'default', name: 'missing' }, () => {}),
    ).rejects.toThrow('default/missing');
  });
});

/** The host always supplies a node id alongside the entity id. */
function entityRef(
  entityId: string,
  metadata: Record<string, string | number | boolean> = {},
  name = 'web',
): EntityRef {
  return { entityId, nodeId: entityId, context: { nodeId: entityId, name, metadata } };
}

describe('entityActions', () => {
  function hpaRef(metadata: Record<string, string | number | boolean>) {
    return entityRef('k8s:hpa:default:web', metadata);
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
    const ids = (id: string) => entityActions(entityRef(id, {}, 'x')).map((a) => a.id);

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
      mergePatchOptions,
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
    await expect(runResourceAction(client, 'k8s:pod:default:web', 'cordon')).rejects.toThrow(
      'Unsupported',
    );
  });

  // Deleting a pod is not a restart: its ReplicaSet immediately makes an
  // identical replacement. Only the controller can actually roll pods.
  it('refuses to restart anything that is not a controller', async () => {
    const { client } = fakeClient([]);
    await expect(runResourceAction(client, 'k8s:pod:default:web', 'restart')).rejects.toThrow(
      'not a pod',
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

  it('restarts a Deployment by stamping its pod template, as kubectl does', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:deployment:default:web', 'restart');

    const patch = vi.mocked(client.appsApi.patchNamespacedDeployment).mock.calls[0]![0]!;
    expect(patch).toMatchObject({ namespace: 'default', name: 'web' });
    const annotations = (
      patch.body as {
        spec: { template: { metadata: { annotations: Record<string, string> } } };
      }
    ).spec.template.metadata.annotations;
    expect(annotations['kubectl.kubernetes.io/restartedAt']).toEqual(expect.any(String));
  });

  it('routes a restart to the API of the controller kind', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:statefulset:db:pg', 'restart');
    await runResourceAction(client, 'k8s:daemonset:kube-system:kube-proxy', 'restart');

    expect(client.appsApi.patchNamespacedStatefulSet).toHaveBeenCalledOnce();
    expect(client.appsApi.patchNamespacedDaemonSet).toHaveBeenCalledOnce();
    expect(client.appsApi.patchNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('scales a Deployment to the requested replica count', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:deployment:default:web', 'scale', { replicas: 4 });

    expect(client.appsApi.patchNamespacedDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ body: { spec: { replicas: 4 } } }),
      mergePatchOptions,
    );
  });

  it('refuses to scale a DaemonSet, which runs one pod per node', async () => {
    const { client } = fakeClient([]);
    await expect(
      runResourceAction(client, 'k8s:daemonset:kube-system:kube-proxy', 'scale', { replicas: 2 }),
    ).rejects.toThrow('Only Deployments and StatefulSets');
  });

  it.each([-1, 1.5, undefined])('rejects %s as a replica count', async (replicas) => {
    const { client } = fakeClient([]);
    await expect(
      runResourceAction(client, 'k8s:deployment:default:web', 'scale', {
        replicas: replicas as number,
      }),
    ).rejects.toThrow('non-negative whole number');
  });

  it('deletes a Deployment through the apps API', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:deployment:default:web', 'delete');

    expect(client.appsApi.deleteNamespacedDeployment).toHaveBeenCalledWith({
      namespace: 'default',
      name: 'web',
    });
  });

  /**
   * Regression: every patch body in this plugin is a merge object, but the
   * generated client defaults to `application/json-patch+json`, which expects
   * an array of RFC 6902 ops. The API server rejected all of them with 400
   * "cannot unmarshal object into Go value of type []handlers.jsonPatchOp".
   * Mocks accept any arguments, so only asserting the options catches it.
   */
  it.each([
    ['k8s:deployment:default:web', 'restart', undefined, 'patchNamespacedDeployment'],
    ['k8s:statefulset:db:pg', 'restart', undefined, 'patchNamespacedStatefulSet'],
    ['k8s:daemonset:kube-system:kp', 'restart', undefined, 'patchNamespacedDaemonSet'],
    ['k8s:deployment:default:web', 'scale', { replicas: 2 }, 'patchNamespacedDeployment'],
  ])('sends %s %s as a strategic merge patch', async (id, action, options, method) => {
    const { client } = fakeClient([]);

    await runResourceAction(client, id, action, options);

    const call = vi.mocked(
      client.appsApi[method as keyof typeof client.appsApi] as unknown as ReturnType<typeof vi.fn>,
    ).mock.calls[0]!;
    expect(call[1]).toBe(mergePatchOptions);
  });

  it('sends the HPA bounds patch as a strategic merge patch', async () => {
    const { client } = fakeClient([]);

    await runResourceAction(client, 'k8s:hpa:default:web', 'set_hpa_constraints', {
      minReplicas: 1,
      maxReplicas: 3,
    });

    const call = vi.mocked(client.autoScalingApi.patchNamespacedHorizontalPodAutoscaler).mock
      .calls[0]!;
    expect(call[1]).toBe(mergePatchOptions);
  });
});

describe('workload action declarations', () => {
  function actionsFor(entityId: string, metadata: Record<string, string | number | boolean> = {}) {
    return entityActions(entityRef(entityId, metadata));
  }

  it('offers restart on controllers and never on a pod', () => {
    expect(actionsFor('k8s:deployment:default:web').map((a) => a.id)).toContain('restart');
    expect(actionsFor('k8s:daemonset:kube-system:kp').map((a) => a.id)).toContain('restart');
    expect(actionsFor('k8s:pod:default:web-abc').map((a) => a.id)).not.toContain('restart');
    expect(actionsFor('k8s:service:default:web').map((a) => a.id)).not.toContain('restart');
  });

  it('offers scale on scalable controllers only', () => {
    expect(actionsFor('k8s:deployment:default:web').map((a) => a.id)).toContain('scale');
    expect(actionsFor('k8s:statefulset:db:pg').map((a) => a.id)).toContain('scale');
    expect(actionsFor('k8s:daemonset:kube-system:kp').map((a) => a.id)).not.toContain('scale');
  });

  it('pre-fills the scale form with the current replica count', () => {
    const scale = actionsFor('k8s:deployment:default:web', { desiredReplicas: 3 }).find(
      (action) => action.id === 'scale',
    );
    expect(scale?.input?.fields?.[0]).toMatchObject({ key: 'replicas', default: 3 });
  });
});
