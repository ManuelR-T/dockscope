import { pathToFileURL } from 'url';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { DockscopePlugin, PluginManifest } from '../../core/plugins';
import type { PluginHostApi, PluginHostExecResult } from '../hostApi';

interface OfficialKubernetesModule {
  default(context: { manifest: PluginManifest; host: PluginHostApi }): DockscopePlugin;
  internals: {
    buildGraph(resources: KubernetesResources): {
      nodes: Array<{
        id: string;
        kind?: string;
        runtime?: string;
        health?: string;
        image?: string;
      }>;
      links: Array<{ source: string; target: string; type: string; label?: string }>;
    };
    hpaPatch(minReplicas: number, maxReplicas: number): unknown[];
    parseResourceId(id: string): { kind: string; namespace: string; name: string };
    podsForRestart(
      resources: KubernetesResources,
      resource: { kind: string; namespace: string; name: string },
    ): unknown[];
  };
}

interface KubernetesList<T> {
  items?: T[];
}

interface KubernetesResources {
  pods: KubernetesList<Record<string, unknown>>;
  services: KubernetesList<Record<string, unknown>>;
  ingresses: KubernetesList<Record<string, unknown>>;
  hpas: KubernetesList<Record<string, unknown>>;
}

const resources: KubernetesResources = {
  pods: {
    items: [
      {
        metadata: {
          name: 'api-7d9f5b8c4-x2k9q',
          namespace: 'prod',
          labels: { app: 'api' },
        },
        spec: {
          containers: [
            { name: 'api', image: 'ghcr.io/example/api:1', ports: [{ containerPort: 8080 }] },
          ],
        },
        status: {
          phase: 'Running',
          conditions: [{ type: 'Ready', status: 'True' }],
        },
      },
    ],
  },
  services: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          type: 'ClusterIP',
          selector: { app: 'api' },
          ports: [{ port: 80, targetPort: 8080 }],
        },
      },
    ],
  },
  ingresses: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          rules: [
            {
              host: 'api.example.test',
              http: {
                paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'api' } } }],
              },
            },
          ],
        },
      },
    ],
  },
  hpas: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          scaleTargetRef: { kind: 'Deployment', name: 'api' },
          minReplicas: 2,
          maxReplicas: 8,
        },
        status: { currentReplicas: 2, desiredReplicas: 4 },
      },
    ],
  },
};

const manifest: PluginManifest = {
  id: 'official.kubernetes',
  name: 'Kubernetes',
  version: '0.2.0',
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
  capabilities: ['source.graph', 'source.logs', 'action.lifecycle', 'action.scale'],
  permissions: ['kubernetes.api', 'process.exec'],
};

async function loadOfficialKubernetes(): Promise<OfficialKubernetesModule> {
  const pluginPath = path.resolve(process.cwd(), 'plugins/official/kubernetes/plugin.mjs');
  return import(
    `${pathToFileURL(pluginPath).href}?v=${Date.now()}`
  ) as Promise<OfficialKubernetesModule>;
}

function createHost(): { host: PluginHostApi; execFile: ReturnType<typeof vi.fn> } {
  const execFile = vi.fn(
    async (_command: string, args: readonly string[] = []): Promise<PluginHostExecResult> => {
      if (args[0] === 'get') {
        const resource = args[1];
        if (resource === 'pods') {
          return { stdout: JSON.stringify(resources.pods), stderr: '' };
        }
        if (resource === 'services') {
          return { stdout: JSON.stringify(resources.services), stderr: '' };
        }
        if (resource === 'ingresses.networking.k8s.io') {
          return { stdout: JSON.stringify(resources.ingresses), stderr: '' };
        }
        if (resource === 'hpa') {
          return { stdout: JSON.stringify(resources.hpas), stderr: '' };
        }
      }
      if (args[0] === 'logs') {
        return { stdout: 'pod log\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    },
  );
  return {
    execFile,
    host: {
      permissions: ['kubernetes.api', 'process.exec'],
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      fetchJson: vi.fn(),
      execFile,
      readSecret: vi.fn(),
      readStorage: vi.fn(),
      writeStorage: vi.fn(),
      deleteStorage: vi.fn(),
      publishEvent: vi.fn(),
    },
  };
}

describe('official Kubernetes plugin', () => {
  it('builds graph nodes and relationships from kubectl resource output', async () => {
    const module = await loadOfficialKubernetes();
    const graph = module.internals.buildGraph(resources);

    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      'hpa',
      'ingress',
      'pod',
      'service',
    ]);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
        runtime: 'kubernetes',
        health: 'healthy',
      }),
    );
    expect(graph.links).toEqual(
      expect.arrayContaining([
        {
          source: 'k8s:service:prod:api',
          target: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
          type: 'kubernetes',
          label: 'selects',
        },
        {
          source: 'k8s:ingress:prod:api',
          target: 'k8s:service:prod:api',
          type: 'depends_on',
          label: 'api.example.test',
        },
        {
          source: 'k8s:hpa:prod:api',
          target: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
          type: 'kubernetes',
          label: 'scales Deployment',
        },
      ]),
    );
  });

  it('collects graph snapshots through the plugin host exec API', async () => {
    const module = await loadOfficialKubernetes();
    const { host, execFile } = createHost();
    const plugin = module.default({ manifest, host });
    const source = plugin.getGraphSources?.()[0];

    await expect(source?.collectGraph()).resolves.toMatchObject({
      source: { id: 'kubernetes', pluginId: 'official.kubernetes' },
      graph: { nodes: expect.arrayContaining([expect.objectContaining({ kind: 'pod' })]) },
    });
    expect(execFile).toHaveBeenCalledWith('kubectl', ['get', 'pods', '-A', '-o', 'json']);
  });

  it('routes logs and Kubernetes actions through kubectl', async () => {
    const module = await loadOfficialKubernetes();
    const { host, execFile } = createHost();
    const plugin = module.default({ manifest, host });
    const logsProvider = plugin.getLogsProviders?.()[0];
    const actionProvider = plugin.getActionProviders?.()[0];
    const podRef = { entityId: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q' };
    const hpaRef = {
      entityId: 'k8s:hpa:prod:api',
      context: {
        nodeId: 'k8s:hpa:prod:api',
        name: 'api',
        metadata: { minReplicas: 2, maxReplicas: 8 },
      },
    };

    await expect(logsProvider?.getLogs(podRef, { tail: 10 })).resolves.toBe('pod log\n');
    expect(await actionProvider?.listActions(hpaRef)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'set_hpa_constraints',
          capability: 'action.scale',
          input: {
            fields: expect.arrayContaining([
              expect.objectContaining({ key: 'minReplicas', default: 2 }),
              expect.objectContaining({ key: 'maxReplicas', default: 8 }),
            ]),
          },
        }),
      ]),
    );
    await actionProvider?.runAction(hpaRef, 'set_hpa_constraints', {
      minReplicas: 2,
      maxReplicas: 5,
    });

    expect(execFile).toHaveBeenCalledWith('kubectl', [
      'logs',
      'api-7d9f5b8c4-x2k9q',
      '-n',
      'prod',
      '--tail=10',
      '--timestamps=true',
    ]);
    expect(execFile).toHaveBeenCalledWith('kubectl', [
      'patch',
      'hpa',
      'api',
      '-n',
      'prod',
      '--type=json',
      '-p',
      JSON.stringify([
        { op: 'add', path: '/spec/minReplicas', value: 2 },
        { op: 'replace', path: '/spec/maxReplicas', value: 5 },
      ]),
    ]);
  });
});
