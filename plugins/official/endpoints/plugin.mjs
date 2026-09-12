// @ts-check
import http from 'node:http';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import { randomUUID } from 'node:crypto';

/** @typedef {import('dockscope/plugin-sdk/v1').PluginFactoryContext} FactoryContext */
/** @typedef {import('dockscope/plugin-sdk/v1').DockscopePlugin} Plugin */
/** @typedef {{id: string, label: string, url: string}} Endpoint */
/** @typedef {{checkedAt: number, latency: number, statusCode?: number, expiresAt?: number, error?: string}} Observation */
const INTERVAL_MS = 30_000;
const TIMEOUT_MS = 3_000;
const MAX_ENDPOINTS = 16;
const SOURCE_ID = 'official.endpoints';

/** @param {unknown} raw */
function endpointUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Enter an HTTP or HTTPS URL');
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error('Use an HTTP(S) URL without credentials, query parameters or fragments');
  }
  return url.href;
}

/** @param {Endpoint} endpoint @param {AbortSignal} signal @returns {Promise<Observation>} */
function probe(endpoint, signal) {
  return new Promise((resolve) => {
    const started = performance.now();
    const url = new URL(endpoint.url);
    let done = false;
    /** @param {Partial<Observation>} result */
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        checkedAt: Date.now(),
        latency: Math.round((performance.now() - started) * 100) / 100,
        ...result,
      });
    };
    // A wall-clock deadline also bounds DNS and TLS, not only socket inactivity.
    const timer = setTimeout(() => {
      finish({ error: 'Timed out after 3 seconds' });
      request.destroy();
    }, TIMEOUT_MS);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(
      url,
      {
        signal,
        agent: false,
        maxHeaderSize: 16_384,
        headers: { 'User-Agent': 'DockScope-Endpoint-Monitor/0.1' },
      },
      (response) => {
        const certificate =
          response.socket instanceof TLSSocket ? response.socket.getPeerCertificate() : undefined;
        const expiresAt = certificate?.valid_to ? Date.parse(certificate.valid_to) : undefined;
        finish({
          statusCode: response.statusCode,
          ...(expiresAt !== undefined && Number.isFinite(expiresAt) ? { expiresAt } : {}),
        });
        // Availability is measured at response headers. Never download an unbounded body or follow redirects.
        response.destroy();
        request.destroy();
      },
    );
    request.once('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      finish({ error: code || 'Connection failed' });
    });
  });
}

/** @param {Observation | undefined} observation @returns {'healthy' | 'unhealthy' | 'unknown'} */
function health(observation) {
  if (!observation || Date.now() - observation.checkedAt > INTERVAL_MS * 3) return 'unknown';
  return !observation.error &&
    observation.statusCode !== undefined &&
    observation.statusCode >= 200 &&
    observation.statusCode < 400
    ? 'healthy'
    : 'unhealthy';
}

/** @param {FactoryContext} context @returns {Plugin} */
export default function createPlugin({ manifest, host, logger }) {
  /** @type {Endpoint[]} */
  let endpoints = [];
  /** @type {Map<string, Observation>} */
  const observations = new Map();
  /** @type {Set<AbortController>} */
  const controllers = new Set();
  /** @type {Promise<void> | undefined} */
  let loading;
  /** @type {Promise<void> | undefined} */
  let flight;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let stopped = false;
  let mutations = Promise.resolve();

  function load() {
    loading ??= host.readStorage('endpoints').then((stored) => {
      if (stored === undefined || stored === null) return;
      if (!Array.isArray(stored) || stored.length > MAX_ENDPOINTS)
        throw new Error('Invalid saved endpoints');
      const ids = new Set();
      endpoints = stored.map((item) => {
        if (
          !item ||
          typeof item.id !== 'string' ||
          !/^[a-zA-Z0-9-]+$/.test(item.id) ||
          ids.has(item.id) ||
          typeof item.label !== 'string' ||
          !item.label.trim() ||
          item.label.length > 100
        )
          throw new Error('Invalid saved endpoint');
        ids.add(item.id);
        return { id: item.id, label: item.label, url: endpointUrl(item.url) };
      });
    });
    return loading;
  }

  /** @param {() => Promise<void>} action */
  function mutate(action) {
    const next = mutations.then(action);
    mutations = next.catch(() => {});
    return next;
  }

  async function refresh() {
    await load();
    if (stopped) return;
    if (flight) {
      await flight;
      return refresh();
    }
    const due = endpoints.filter(
      (endpoint) => Date.now() - (observations.get(endpoint.id)?.checkedAt ?? 0) >= INTERVAL_MS,
    );
    if (!due.length) return;
    flight = (async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, due.length) }, async () => {
          while (index < due.length && !stopped) {
            const endpoint = due[index++];
            const controller = new AbortController();
            controllers.add(controller);
            try {
              const result = await probe(endpoint, controller.signal);
              if (!stopped && endpoints.some((item) => item.id === endpoint.id))
                observations.set(endpoint.id, result);
            } finally {
              controllers.delete(controller);
            }
          }
        }),
      );
    })();
    try {
      await flight;
    } finally {
      flight = undefined;
    }
  }

  function schedule() {
    timer = setTimeout(async () => {
      try {
        await refresh();
      } catch (error) {
        logger.warn('Endpoint checks failed', error);
      }
      if (!stopped) schedule();
    }, INTERVAL_MS);
    timer.unref();
  }

  /** @returns {import('dockscope/plugin-sdk/v1').DataSourceDescriptor} */
  const describe = () => ({
    id: SOURCE_ID,
    label: 'Endpoints',
    kind: 'plugin',
    pluginId: manifest.id,
    capabilities: ['source.graph', 'source.metrics'],
    status: 'connected',
  });

  return {
    manifest,
    async start() {
      stopped = false;
      clearTimeout(timer);
      await refresh();
      if (!stopped) schedule();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      for (const controller of controllers) controller.abort();
      await flight;
    },
    getEntitySources: () => [
      {
        describe,
        async collectEntities() {
          await load();
          return {
            collectedAt: Date.now(),
            entities: endpoints.map((endpoint) => {
              const observation = observations.get(endpoint.id);
              /** @type {import('dockscope/plugin-sdk/v1').EntityMetric[]} */
              const metrics = [];
              if (observation && !observation.error) {
                metrics.push({
                  name: 'response_time',
                  label: 'Response time',
                  value: observation.latency,
                  unit: 'ms',
                  observedAt: observation.checkedAt,
                });
                if (observation.expiresAt !== undefined)
                  metrics.push({
                    name: 'certificate_remaining',
                    label: 'Certificate remaining',
                    value: Math.floor((observation.expiresAt - observation.checkedAt) / 86_400_000),
                    unit: 'days',
                    observedAt: observation.checkedAt,
                  });
              }
              return {
                id: endpoint.id,
                name: endpoint.label,
                kind: 'endpoint',
                status: health(observation),
                metadata: { url: endpoint.url },
                metrics,
              };
            }),
          };
        },
      },
    ],
    getConnectionProviders: () => [
      {
        describe: () => ({
          id: 'endpoints',
          label: 'HTTP / HTTPS endpoints',
          description: 'Up to 16 endpoints. Checked every 30 seconds with a 3-second deadline.',
          input: {
            fields: [
              { key: 'label', label: 'Name', type: 'string', required: true },
              { key: 'url', label: 'URL', type: 'string', required: true },
            ],
          },
        }),
        async listConnections() {
          await load();
          return endpoints.map((endpoint) => ({
            id: endpoint.id,
            label: endpoint.label,
            endpoint: endpoint.url,
            removable: true,
            status:
              health(observations.get(endpoint.id)) === 'healthy'
                ? 'connected'
                : health(observations.get(endpoint.id)) === 'unknown'
                  ? 'unknown'
                  : 'disconnected',
          }));
        },
        async addConnection(input) {
          await mutate(async () => {
            await load();
            const url = endpointUrl(input.url);
            if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100)
              throw new Error('Enter a name of 1–100 characters');
            if (endpoints.length >= MAX_ENDPOINTS)
              throw new Error('At most 16 endpoints can be monitored');
            if (endpoints.some((item) => item.url === url))
              throw new Error('This endpoint is already monitored');
            const next = [...endpoints, { id: randomUUID(), label: input.label.trim(), url }];
            await host.writeStorage('endpoints', next);
            endpoints = next;
          });
          await refresh();
        },
        async removeConnection(id) {
          await mutate(async () => {
            await load();
            const next = endpoints.filter((item) => item.id !== id);
            if (next.length === endpoints.length) throw new Error('Endpoint not found');
            await host.writeStorage('endpoints', next);
            endpoints = next;
            observations.delete(id);
          });
        },
      },
    ],
    async queryUi(extensionId, context) {
      await load();
      const endpoint = endpoints.find((item) => item.id === context.node?.entityId);
      if (extensionId !== 'health' || context.node?.sourceId !== SOURCE_ID || !endpoint)
        throw new Error('Endpoint not found');
      const observation = observations.get(endpoint.id);
      return {
        type: 'keyValue',
        items: [
          { label: 'Status', value: health(observation) },
          { label: 'HTTP status', value: observation?.statusCode ?? 'Unavailable' },
          {
            label: 'Last checked',
            value: observation ? new Date(observation.checkedAt).toISOString() : 'Not checked yet',
          },
          {
            label: 'Certificate expires',
            value: observation?.expiresAt
              ? new Date(observation.expiresAt).toISOString()
              : endpoint.url.startsWith('https:')
                ? 'Unavailable'
                : 'Not applicable (HTTP)',
          },
          { label: 'Error', value: observation?.error ?? 'None' },
        ],
      };
    },
  };
}
