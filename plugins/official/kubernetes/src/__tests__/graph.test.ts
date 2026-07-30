import { describe, expect, it } from 'vitest';
import type {
  V1HorizontalPodAutoscalerList,
  V1IngressList,
  V1PodList,
  V1ServiceList,
} from '@kubernetes/client-node';
import { buildGraph } from '../graph';
import type { Resources } from '../resources';
import { parseResourceId } from '../utils';

/**
 * buildGraph is a pure function over the API list objects, so the graph shape
 * can be asserted without a cluster or an HTTP mock. This is the coverage the
 * kubectl-era tests provided before the plugin moved to the API client.
 */

function pod(namespace: string, name: string, labels: Record<string, string>, phase = 'Running') {
  return {
    metadata: { namespace, name, labels },
    spec: { containers: [{ image: 'nginx:1.27', ports: [{ containerPort: 80 }] }] },
    status: { phase, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

function resources(overrides: Partial<Resources> = {}): Resources {
  const base = {
    pods: { items: [] } as unknown as V1PodList,
    services: { items: [] } as unknown as V1ServiceList,
    ingresses: { items: [] } as unknown as V1IngressList,
    hpa: { items: [] } as unknown as V1HorizontalPodAutoscalerList,
  };
  return { ...base, ...overrides } as Resources;
}

describe('buildGraph', () => {
  it('turns pods into nodes carrying their namespace, image and ports', () => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'web-abc', { app: 'web' })] } as unknown as V1PodList,
      }),
    );

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      id: 'k8s:pod:default:web-abc',
      name: 'web-abc',
      fullName: 'default/web-abc',
      namespace: 'default',
      runtime: 'kubernetes',
      kind: 'pod',
      image: 'nginx:1.27',
      status: 'running',
      health: 'healthy',
      ports: ['80/tcp'],
    });
  });

  it.each([
    ['Pending', 'pending', 'starting'],
    ['Succeeded', 'exited', 'none'],
    ['Failed', 'dead', 'unhealthy'],
    ['Weird', 'unknown', 'none'],
  ])('maps pod phase %s to status %s', (phase, status, health) => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'p', { app: 'p' }, phase)] } as unknown as V1PodList,
      }),
    );
    expect(graph.nodes[0]).toMatchObject({ status, health });
  });

  it('links a service to the pods its selector matches, and only those', () => {
    const graph = buildGraph(
      resources({
        pods: {
          items: [
            pod('default', 'web-1', { app: 'web' }),
            pod('default', 'other-1', { app: 'other' }),
            // same labels, different namespace: a selector must not cross it
            pod('staging', 'web-1', { app: 'web' }),
          ],
        } as unknown as V1PodList,
        services: {
          items: [{ metadata: { namespace: 'default', name: 'web' }, spec: { selector: { app: 'web' } } }],
        } as unknown as V1ServiceList,
      }),
    );

    const links = graph.links.filter((link) => String(link.source).startsWith('k8s:service:'));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source: 'k8s:service:default:web',
      target: 'k8s:pod:default:web-1',
    });
  });

  it('does not link a service whose selector is empty', () => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'web-1', { app: 'web' })] } as unknown as V1PodList,
        services: {
          items: [{ metadata: { namespace: 'default', name: 'headless' }, spec: {} }],
        } as unknown as V1ServiceList,
      }),
    );
    expect(graph.links).toHaveLength(0);
  });

  it('links an HPA to the pods of its scale target', () => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'web-xyz', { app: 'web' })] } as unknown as V1PodList,
        hpa: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { scaleTargetRef: { kind: 'Deployment', name: 'web' }, minReplicas: 2, maxReplicas: 5 },
            },
          ],
        } as unknown as V1HorizontalPodAutoscalerList,
      }),
    );

    expect(graph.nodes.map((node) => node.id)).toContain('k8s:hpa:default:web');
    expect(graph.links).toContainEqual(
      expect.objectContaining({ source: 'k8s:hpa:default:web', target: 'k8s:pod:default:web-xyz' }),
    );
  });

  it('links an ingress to the service it routes to', () => {
    const graph = buildGraph(
      resources({
        services: {
          items: [{ metadata: { namespace: 'default', name: 'web' }, spec: { selector: { app: 'web' } } }],
        } as unknown as V1ServiceList,
        ingresses: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: {
                rules: [
                  {
                    host: 'web.local',
                    http: { paths: [{ backend: { service: { name: 'web', port: { number: 80 } } } }] },
                  },
                ],
              },
            },
          ],
        } as unknown as V1IngressList,
      }),
    );

    expect(graph.nodes.map((node) => node.id)).toContain('k8s:ingress:default:web');
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: 'k8s:ingress:default:web',
        target: 'k8s:service:default:web',
      }),
    );
  });

  it('returns an empty graph when the cluster has nothing', () => {
    expect(buildGraph(resources())).toEqual({ nodes: [], links: [] });
  });
});

describe('parseResourceId', () => {
  it('reads kind, namespace and name back out', () => {
    expect(parseResourceId('k8s:pod:kube-system:coredns-abc')).toEqual({
      kind: 'pod',
      namespace: 'kube-system',
      name: 'coredns-abc',
    });
  });

  it('keeps colons that belong to the name', () => {
    expect(parseResourceId('k8s:service:default:a:b')).toMatchObject({ name: 'a:b' });
  });

  it.each([
    ['docker:pod:default:web', 'a non-kubernetes prefix'],
    ['k8s:deployment:default:web', 'an unsupported kind'],
    ['k8s:pod:default', 'a missing name'],
    ['', 'an empty id'],
  ])('rejects %s (%s)', (id) => {
    expect(() => parseResourceId(id)).toThrow();
  });
});
