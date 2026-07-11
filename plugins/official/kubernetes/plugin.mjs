const KUBERNETES_SOURCE_ID = 'kubernetes';
const EMPTY_LIST = { items: [] };

function namespaceOf(meta) {
  return meta?.namespace || 'default';
}

function nameOf(meta) {
  return meta?.name || 'unknown';
}

function k8sId(kind, namespace, name) {
  return `k8s:${kind}:${namespace}:${name}`;
}

function parseResourceId(id) {
  const [prefix, kind, namespace, ...nameParts] = id.split(':');
  const name = nameParts.join(':');
  if (
    prefix !== 'k8s' ||
    !['pod', 'service', 'ingress', 'hpa'].includes(kind) ||
    !namespace ||
    !name
  ) {
    throw new Error('Invalid Kubernetes resource ID');
  }
  return { kind, namespace, name };
}

function matchesSelector(labels, selector) {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([key, value]) => labels?.[key] === value);
}

function podsForService(pods, service) {
  const namespace = namespaceOf(service.metadata);
  return pods.filter(
    (pod) =>
      namespaceOf(pod.metadata) === namespace &&
      matchesSelector(pod.metadata?.labels, service.spec?.selector),
  );
}

function servicesForIngress(services, ingress) {
  const namespace = namespaceOf(ingress.metadata);
  const serviceNames = new Set();
  for (const rule of ingress.spec?.rules || []) {
    for (const path of rule.http?.paths || []) {
      const serviceName = path.backend?.service?.name;
      if (serviceName) {
        serviceNames.add(serviceName);
      }
    }
  }
  return services.filter(
    (service) =>
      namespaceOf(service.metadata) === namespace && serviceNames.has(nameOf(service.metadata)),
  );
}

function podsForHpa(pods, hpa) {
  const namespace = namespaceOf(hpa.metadata);
  const target = hpa.spec?.scaleTargetRef;
  if (!target?.name) {
    return [];
  }
  return pods.filter((pod) => {
    if (namespaceOf(pod.metadata) !== namespace) {
      return false;
    }
    const labels = pod.metadata?.labels || {};
    return (
      labels.app === target.name ||
      labels['app.kubernetes.io/name'] === target.name ||
      nameOf(pod.metadata).startsWith(`${target.name}-`)
    );
  });
}

function podsForRestart(resources, resource) {
  const pods = resources.pods.items || [];
  const services = resources.services.items || [];
  if (resource.kind === 'pod') {
    return pods.filter(
      (pod) =>
        namespaceOf(pod.metadata) === resource.namespace && nameOf(pod.metadata) === resource.name,
    );
  }
  if (resource.kind === 'service') {
    const service = services.find(
      (item) =>
        namespaceOf(item.metadata) === resource.namespace &&
        nameOf(item.metadata) === resource.name,
    );
    return service ? podsForService(pods, service) : [];
  }
  if (resource.kind === 'ingress') {
    const ingress = (resources.ingresses.items || []).find(
      (item) =>
        namespaceOf(item.metadata) === resource.namespace &&
        nameOf(item.metadata) === resource.name,
    );
    if (!ingress) {
      return [];
    }
    const selectedPods = new Map();
    for (const service of servicesForIngress(services, ingress)) {
      for (const pod of podsForService(pods, service)) {
        selectedPods.set(`${namespaceOf(pod.metadata)}/${nameOf(pod.metadata)}`, pod);
      }
    }
    return [...selectedPods.values()];
  }
  const hpa = (resources.hpas.items || []).find(
    (item) =>
      namespaceOf(item.metadata) === resource.namespace && nameOf(item.metadata) === resource.name,
  );
  return hpa ? podsForHpa(pods, hpa) : [];
}

function podStatus(pod) {
  const phase = (pod.status?.phase || 'Unknown').toLowerCase();
  const ready = pod.status?.conditions?.find((condition) => condition.type === 'Ready')?.status;
  if (phase === 'running') {
    return { status: 'running', health: ready === 'True' ? 'healthy' : 'starting' };
  }
  if (phase === 'pending') {
    return { status: 'pending', health: 'starting' };
  }
  if (phase === 'succeeded') {
    return { status: 'exited', health: 'none' };
  }
  if (phase === 'failed') {
    return { status: 'dead', health: 'unhealthy' };
  }
  return { status: 'unknown', health: 'none' };
}

function baseNode(kind, namespace, name) {
  return {
    id: k8sId(kind, namespace, name),
    name,
    fullName: `${namespace}/${name}`,
    project: namespace,
    host: KUBERNETES_SOURCE_ID,
    runtime: 'kubernetes',
    kind,
    namespace,
    containerId: k8sId(kind, namespace, name),
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
  };
}

function parseJsonList(stdout) {
  if (!stdout.trim()) {
    return EMPTY_LIST;
  }
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed.items) ? parsed : EMPTY_LIST;
}

async function kubectlJson(host, resource) {
  const result = await host.execFile('kubectl', ['get', resource, '-A', '-o', 'json']);
  return parseJsonList(result.stdout);
}

async function kubectl(host, args) {
  return host.execFile('kubectl', args);
}

async function listResources(host) {
  const [pods, services, ingresses, hpas] = await Promise.all([
    kubectlJson(host, 'pods').catch(() => EMPTY_LIST),
    kubectlJson(host, 'services').catch(() => EMPTY_LIST),
    kubectlJson(host, 'ingresses.networking.k8s.io').catch(() => EMPTY_LIST),
    kubectlJson(host, 'hpa').catch(() => EMPTY_LIST),
  ]);
  return { pods, services, ingresses, hpas };
}

function buildGraph(resources) {
  const nodes = [];
  const links = [];
  const pods = resources.pods.items || [];
  const services = resources.services.items || [];

  for (const pod of pods) {
    const namespace = namespaceOf(pod.metadata);
    const name = nameOf(pod.metadata);
    const containers = pod.spec?.containers || [];
    const ports = containers.flatMap((container) =>
      (container.ports || []).map(
        (port) => `${port.containerPort}/${(port.protocol || 'TCP').toLowerCase()}`,
      ),
    );
    nodes.push({
      ...baseNode('pod', namespace, name),
      image:
        containers
          .map((container) => container.image)
          .filter(Boolean)
          .join(', ') || 'Pod',
      ...podStatus(pod),
      ports,
      networks: [namespace],
      volumeCount: 0,
    });
  }

  for (const service of services) {
    const namespace = namespaceOf(service.metadata);
    const name = nameOf(service.metadata);
    const ports = (service.spec?.ports || []).map((port) => {
      const target = port.targetPort ? `:${port.targetPort}` : '';
      return `${port.port}${target}/${(port.protocol || 'TCP').toLowerCase()}`;
    });
    const serviceId = k8sId('service', namespace, name);
    nodes.push({
      ...baseNode('service', namespace, name),
      image: `Service ${service.spec?.type || 'ClusterIP'}`,
      status: 'running',
      health: 'none',
      ports,
      networks: [namespace],
      volumeCount: 0,
    });

    for (const pod of podsForService(pods, service)) {
      links.push({
        source: serviceId,
        target: k8sId('pod', namespace, nameOf(pod.metadata)),
        type: 'kubernetes',
        label: 'selects',
      });
    }
  }

  for (const ingress of resources.ingresses.items || []) {
    const namespace = namespaceOf(ingress.metadata);
    const name = nameOf(ingress.metadata);
    const ingressId = k8sId('ingress', namespace, name);
    const ports =
      ingress.spec?.rules?.flatMap((rule) =>
        (rule.http?.paths || []).map((path) => `${rule.host || '*'}${path.path || '/'}`),
      ) || [];
    nodes.push({
      ...baseNode('ingress', namespace, name),
      image: 'Ingress',
      status: 'running',
      health: 'none',
      ports,
      networks: [namespace],
      volumeCount: 0,
    });

    for (const rule of ingress.spec?.rules || []) {
      for (const path of rule.http?.paths || []) {
        const serviceName = path.backend?.service?.name;
        if (serviceName) {
          links.push({
            source: ingressId,
            target: k8sId('service', namespace, serviceName),
            type: 'depends_on',
            label: rule.host || 'ingress',
          });
        }
      }
    }
  }

  for (const hpa of resources.hpas.items || []) {
    const namespace = namespaceOf(hpa.metadata);
    const name = nameOf(hpa.metadata);
    const current = hpa.status?.currentReplicas ?? 0;
    const desired = hpa.status?.desiredReplicas ?? 0;
    const hpaId = k8sId('hpa', namespace, name);
    nodes.push({
      ...baseNode('hpa', namespace, name),
      image: `HPA ${current}/${desired} replicas`,
      status: 'running',
      health: desired > current ? 'starting' : 'healthy',
      ports: [
        `${current}/${desired} replicas`,
        `${hpa.spec?.minReplicas ?? 1}-${hpa.spec?.maxReplicas ?? '?'} range`,
      ],
      networks: [namespace],
      volumeCount: 0,
      metadata: {
        currentReplicas: current,
        desiredReplicas: desired,
        minReplicas: hpa.spec?.minReplicas ?? 1,
        maxReplicas: hpa.spec?.maxReplicas ?? 1,
      },
    });

    const targetKind = hpa.spec?.scaleTargetRef?.kind || 'target';
    for (const pod of podsForHpa(pods, hpa)) {
      links.push({
        source: hpaId,
        target: k8sId('pod', namespace, nameOf(pod.metadata)),
        type: 'kubernetes',
        label: `scales ${targetKind}`,
      });
    }
  }

  return { nodes, links };
}

function hpaPatch(minReplicas, maxReplicas) {
  if (!Number.isInteger(minReplicas) || !Number.isInteger(maxReplicas)) {
    throw new Error('HPA replica constraints must be whole numbers');
  }
  if (minReplicas < 1) {
    throw new Error('HPA minReplicas must be at least 1');
  }
  if (maxReplicas < minReplicas) {
    throw new Error('HPA maxReplicas must be greater than or equal to minReplicas');
  }
  return [
    { op: 'add', path: '/spec/minReplicas', value: minReplicas },
    { op: 'replace', path: '/spec/maxReplicas', value: maxReplicas },
  ];
}

async function runResourceAction(host, resourceId, action, options = {}) {
  const resource = parseResourceId(resourceId);
  if (!['delete', 'restart', 'set_hpa_constraints'].includes(action)) {
    throw new Error(`Unsupported Kubernetes action: ${action}`);
  }
  if (action === 'set_hpa_constraints') {
    if (resource.kind !== 'hpa') {
      throw new Error('Only HPA resources can have replica constraints changed');
    }
    await kubectl(host, [
      'patch',
      'hpa',
      resource.name,
      '-n',
      resource.namespace,
      '--type=json',
      '-p',
      JSON.stringify(hpaPatch(options.minReplicas, options.maxReplicas)),
    ]);
    return;
  }
  if (action === 'restart') {
    const resources = await listResources(host);
    const pods = podsForRestart(resources, resource);
    if (pods.length === 0) {
      throw new Error(`No backing pods found for ${resource.kind} "${resource.name}"`);
    }
    await Promise.all(
      pods.map((pod) =>
        kubectl(host, ['delete', 'pod', nameOf(pod.metadata), '-n', namespaceOf(pod.metadata)]),
      ),
    );
    return;
  }
  const kind = resource.kind === 'hpa' ? 'hpa' : resource.kind;
  await kubectl(host, ['delete', kind, resource.name, '-n', resource.namespace]);
}

async function getResourceLogs(host, resourceId, options = {}) {
  const resource = parseResourceId(resourceId);
  if (resource.kind !== 'pod') {
    throw new Error('Logs are only available for Pod resources');
  }
  const result = await kubectl(host, [
    'logs',
    resource.name,
    '-n',
    resource.namespace,
    `--tail=${options.tail ?? 200}`,
    '--timestamps=true',
  ]);
  return result.stdout;
}

function numericMetadata(ref, key, fallback) {
  const value = ref.context?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function entityActions(ref) {
  const resource = parseResourceId(ref.entityId);
  const name = ref.context?.name || resource.name;
  const fullName = `${resource.namespace}/${resource.name}`;
  const actions = [
    {
      id: 'restart',
      title: 'Restart',
      capability: 'action.lifecycle',
      icon: 'restart',
      placement: 'primary',
      confirm: {
        title: resource.kind === 'pod' ? 'Restart Pod' : 'Restart Backing Pods',
        message:
          resource.kind === 'pod'
            ? `Restart pod ${name}? Kubernetes will recreate the current pod.`
            : `Restart backing pods for ${fullName}? Kubernetes will recreate the selected pods.`,
        confirmLabel: 'Restart',
        variant: 'warning',
      },
    },
  ];
  if (resource.kind === 'hpa') {
    actions.push({
      id: 'set_hpa_constraints',
      title: 'Set replica bounds',
      capability: 'action.scale',
      icon: 'scale',
      input: {
        fields: [
          {
            key: 'minReplicas',
            label: 'Min replicas',
            type: 'number',
            required: true,
            default: numericMetadata(ref, 'minReplicas', 1),
          },
          {
            key: 'maxReplicas',
            label: 'Max replicas',
            type: 'number',
            required: true,
            default: numericMetadata(ref, 'maxReplicas', 1),
          },
        ],
      },
    });
  }
  actions.push({
    id: 'delete',
    title: 'Delete',
    capability: 'action.lifecycle',
    icon: 'trash',
    tone: 'danger',
    effect: 'remove',
    confirm: {
      title: `Delete ${resource.kind}`,
      message: `Delete ${fullName}? This removes the Kubernetes ${resource.kind} resource.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      typeToConfirm: name,
    },
  });
  return actions;
}

export default function createPlugin({ manifest, host }) {
  const descriptor = {
    id: KUBERNETES_SOURCE_ID,
    label: 'Kubernetes',
    kind: 'kubernetes',
    pluginId: manifest.id,
    capabilities: manifest.capabilities,
    status: 'unknown',
  };

  return {
    manifest,
    getGraphSources() {
      return [
        {
          describe() {
            return descriptor;
          },
          async collectGraph() {
            const resources = await listResources(host);
            return {
              source: descriptor,
              graph: buildGraph(resources),
              collectedAt: Date.now(),
            };
          },
        },
      ];
    },
    getLogsProviders() {
      return [
        {
          canHandle(ref) {
            try {
              return parseResourceId(ref.entityId).kind === 'pod';
            } catch {
              return false;
            }
          },
          getLogs: (ref, options) => getResourceLogs(host, ref.entityId, options),
        },
      ];
    },
    getActionProviders() {
      return [
        {
          canHandle(ref) {
            try {
              parseResourceId(ref.entityId);
              return true;
            } catch {
              return false;
            }
          },
          listActions: entityActions,
          async runAction(ref, actionId, input) {
            await runResourceAction(host, ref.entityId, actionId, input);
            return { ok: true, message: `${actionId} completed` };
          },
        },
      ];
    },
  };
}

export const internals = {
  buildGraph,
  hpaPatch,
  entityActions,
  parseResourceId,
  podsForRestart,
};
