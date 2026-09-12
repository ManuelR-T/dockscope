import { describe, expect, it } from 'vitest';
import type { V1Pod, V1Volume, V1EnvFromSource, V1EnvVarSource } from '@kubernetes/client-node';
import { formatEnvVar, podInspect, volumeType } from '../resources/inspect';

/**
 * The Env tab renders `KEY=value` lines and masks values whose key looks
 * sensitive, so the mapping has to produce that shape. Kubernetes env vars are
 * frequently references rather than literals, which is the interesting case.
 */

describe('formatEnvVar', () => {
  const references: V1EnvVarSource = {
    secretKeyRef: { name: 'secret', key: 'key' },
    configMapKeyRef: { name: 'config', key: 'key' },
    fieldRef: { fieldPath: 'metadata.name' },
    resourceFieldRef: { resource: 'limits.cpu' },
  };

  it('preserves an empty literal even when references are also present', () => {
    expect(formatEnvVar({ name: 'KEY', value: '', valueFrom: references })).toBe('KEY=');
  });

  it.each([
    [references, '<secret:secret/key>'],
    [{ ...references, secretKeyRef: undefined }, '<configMap:config/key>'],
    [
      { ...references, secretKeyRef: undefined, configMapKeyRef: undefined },
      '<field:metadata.name>',
    ],
    [{}, ''],
  ])('preserves reference priority for %j', (valueFrom, expected) => {
    expect(formatEnvVar({ name: 'KEY', valueFrom })).toBe(`KEY=${expected}`);
  });

  it('renders a literal value', () => {
    expect(formatEnvVar({ name: 'PORT', value: '8080' })).toBe('PORT=8080');
  });

  // The reference is what you need when debugging; resolving it would mean
  // reading the Secret and pulling its contents into the UI.
  it.each([
    [
      { name: 'PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } },
      'PASSWORD=<secret:db/password>',
    ],
    [
      { name: 'LEVEL', valueFrom: { configMapKeyRef: { name: 'cfg', key: 'level' } } },
      'LEVEL=<configMap:cfg/level>',
    ],
    [
      { name: 'NODE', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } },
      'NODE=<field:spec.nodeName>',
    ],
    [
      { name: 'LIMIT', valueFrom: { resourceFieldRef: { resource: 'limits.memory' } } },
      'LIMIT=<resource:limits.memory>',
    ],
  ])('renders a reference as its source', (env, expected) => {
    expect(formatEnvVar(env)).toBe(expected);
  });

  it('renders an empty value rather than undefined', () => {
    expect(formatEnvVar({ name: 'EMPTY' })).toBe('EMPTY=');
  });
});

describe('volumeType', () => {
  it.each([
    [{ name: 'data', persistentVolumeClaim: { claimName: 'pvc-1' } }, 'pvc'],
    [{ name: 'cfg', configMap: { name: 'cfg' } }, 'configMap'],
    [{ name: 'sec', secret: { secretName: 'sec' } }, 'secret'],
    [{ name: 'tmp', emptyDir: {} }, 'emptyDir'],
    [{ name: 'host', hostPath: { path: '/var/run' } }, 'hostPath'],
  ])('names the backing storage', (volume, expected) => {
    expect(volumeType(volume)).toBe(expected);
  });

  it('falls back for an unknown or absent volume', () => {
    expect(volumeType(undefined)).toBe('volume');
    expect(volumeType({ name: 'bare' })).toBe('volume');
  });
});

describe('podInspect', () => {
  it.each<[V1EnvFromSource, string]>([
    [{ secretRef: { name: 'secret' } }, '<envFrom secret:secret>'],
    [{ configMapRef: { name: 'config' } }, '<envFrom configMap:config>'],
    [
      { secretRef: { name: 'secret' }, configMapRef: { name: 'config' } },
      '<envFrom secret:secret>',
    ],
    [{}, '<envFrom unknown>'],
  ])('renders whole-source imports %j', (source, expected) => {
    const result = podInspect({ spec: { containers: [{ name: 'app', envFrom: [source] }] } }, 'id');
    expect(result.env).toEqual([expected]);
  });

  it.each<[V1Volume | undefined, string]>([
    [
      {
        name: 'data',
        persistentVolumeClaim: { claimName: 'claim' },
        configMap: { name: 'config' },
      },
      'claim',
    ],
    [{ name: 'data', persistentVolumeClaim: { claimName: '' }, configMap: { name: 'config' } }, ''],
    [{ name: 'data', configMap: { name: 'config' }, secret: { secretName: 'secret' } }, 'config'],
    [{ name: 'data', configMap: {}, secret: { secretName: 'secret' } }, 'data'],
    [{ name: 'data', configMap: { name: '' } }, 'data'],
    [{ name: 'data', secret: { secretName: 'secret' }, hostPath: { path: '/host' } }, 'secret'],
    [{ name: 'data', secret: {}, hostPath: { path: '/host' } }, 'data'],
    [{ name: 'data', secret: { secretName: '' } }, 'data'],
    [{ name: 'data', hostPath: { path: '/host' } }, '/host'],
    [{ name: 'data', hostPath: { path: '' } }, ''],
    [{ name: 'data', emptyDir: {} }, 'data'],
    [undefined, 'data'],
  ])('preserves volume source selection for %j', (volume, expected) => {
    const result = podInspect(
      {
        spec: {
          containers: [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
          volumes: volume ? [volume] : [],
        },
      },
      'id',
    );
    expect(result.mounts[0]?.source).toBe(expected);
  });

  const pod: V1Pod = {
    metadata: {
      namespace: 'default',
      name: 'web-abc',
      labels: { app: 'web' },
      creationTimestamp: new Date('2026-01-02T03:04:05Z'),
    },
    spec: {
      restartPolicy: 'Always',
      volumes: [
        { name: 'data', persistentVolumeClaim: { claimName: 'web-data' } },
        { name: 'cfg', configMap: { name: 'web-config' } },
      ],
      containers: [
        {
          name: 'nginx',
          image: 'nginx:1.27',
          command: ['/bin/sh'],
          args: ['-c', 'nginx -g "daemon off;"'],
          workingDir: '/app',
          env: [
            { name: 'PORT', value: '8080' },
            { name: 'TOKEN', valueFrom: { secretKeyRef: { name: 'api', key: 'token' } } },
          ],
          envFrom: [{ configMapRef: { name: 'shared' } }],
          volumeMounts: [
            { name: 'data', mountPath: '/var/data' },
            { name: 'cfg', mountPath: '/etc/nginx/conf.d', readOnly: true },
          ],
        },
      ],
    },
  };

  it('maps a single-container pod onto the inspect shape', () => {
    expect(podInspect(pod, 'node-1')).toEqual({
      id: 'node-1',
      env: ['PORT=8080', 'TOKEN=<secret:api/token>', '<envFrom configMap:shared>'],
      labels: { app: 'web' },
      mounts: [
        { type: 'pvc', source: 'web-data', destination: '/var/data', mode: 'rw' },
        { type: 'configMap', source: 'web-config', destination: '/etc/nginx/conf.d', mode: 'ro' },
      ],
      restartPolicy: 'Always',
      entrypoint: ['/bin/sh'],
      cmd: ['-c', 'nginx -g "daemon off;"'],
      workingDir: '/app',
      created: '2026-01-02T03:04:05.000Z',
    });
  });

  it('leaves an unmapped volume pointing at its own name', () => {
    const result = podInspect(
      {
        spec: {
          containers: [{ name: 'app', volumeMounts: [{ name: 'scratch', mountPath: '/tmp' }] }],
          volumes: [{ name: 'scratch', emptyDir: {} }],
        },
      } as V1Pod,
      'id',
    );
    expect(result.mounts).toEqual([
      { type: 'emptyDir', source: 'scratch', destination: '/tmp', mode: 'rw' },
    ]);
  });

  // The graph node is the pod, so a sidecar pod's containers are aggregated.
  it('prefixes env with the container name only when there is more than one', () => {
    const sidecars = podInspect(
      {
        spec: {
          containers: [
            { name: 'app', env: [{ name: 'ROLE', value: 'server' }] },
            { name: 'proxy', env: [{ name: 'ROLE', value: 'proxy' }] },
          ],
        },
      } as V1Pod,
      'id',
    );

    expect(sidecars.env).toEqual(['app/ROLE=server', 'proxy/ROLE=proxy']);
  });

  it('lists a volume both sidecars mount only once', () => {
    const result = podInspect(
      {
        spec: {
          volumes: [{ name: 'shared', emptyDir: {} }],
          containers: [
            { name: 'app', volumeMounts: [{ name: 'shared', mountPath: '/shared' }] },
            { name: 'proxy', volumeMounts: [{ name: 'shared', mountPath: '/shared' }] },
          ],
        },
      } as V1Pod,
      'id',
    );

    expect(result.mounts).toHaveLength(1);
  });

  it('survives a pod with nothing set', () => {
    expect(podInspect({} as V1Pod, 'id')).toMatchObject({
      env: [],
      labels: {},
      mounts: [],
      restartPolicy: 'Always',
      entrypoint: null,
      cmd: null,
      workingDir: '',
      created: '',
    });
  });
});
