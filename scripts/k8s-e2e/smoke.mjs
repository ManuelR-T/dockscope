#!/usr/bin/env node
/**
 * End-to-end check for the official Kubernetes plugin against a real cluster.
 *
 * The plugin's unit tests mock the Kubernetes client, which means they cannot
 * see anything the API server decides. Several shipped bugs were invisible to
 * them and only a live cluster caught them:
 *
 *   - logs looked up (name, namespace) swapped, so every pod 404'd
 *   - every PATCH went out as application/json-patch+json and was rejected 400,
 *     which broke restart, scale and the HPA bounds action
 *   - the HPA edge pointed at pods while claiming to scale a Deployment
 *
 * Each assertion below exists because something in that list got through. Run
 * against a cluster that already has the fixture applied and metrics-server
 * running; the server is started here and torn down at the end.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.DOCKSCOPE_E2E_PORT || 4699);
const BASE = `http://127.0.0.1:${PORT}`;
const PLUGIN_DIR = process.env.DOCKSCOPE_PLUGIN_DIR || 'plugins/official/kubernetes/dist';

const failures = [];
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return true;
  }
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  failures.push(name);
  return false;
}

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** Entity endpoints are keyed by the unscoped resource id, with the scoped node id alongside. */
function entityUrl(resourceId, suffix = '', extra = '') {
  const params = new URLSearchParams({
    sourceId: 'kubernetes',
    nodeId: `kubernetes:${resourceId}`,
  });
  return `/api/entities/${encodeURIComponent(resourceId)}${suffix}?${params}${extra}`;
}

/** Retries until the predicate holds, for things the cluster reports on its own schedule. */
async function waitFor(label, attempt, { attempts = 30, delayMs = 2000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await attempt();
      if (result) {
        return result;
      }
      last = 'predicate not satisfied';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${label} (last: ${last})`);
}

function startServer() {
  const server = spawn(
    process.execPath,
    [
      'dist/cli.js',
      'up',
      '--port',
      String(PORT),
      '--no-open',
      '--plugins',
      PLUGIN_DIR,
      '--plugin-permissions',
      'all',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const log = [];
  server.stdout.on('data', (chunk) => log.push(chunk.toString()));
  server.stderr.on('data', (chunk) => log.push(chunk.toString()));
  return { server, log };
}

async function main() {
  const { server, log } = startServer();
  const stop = () => {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
  };
  process.on('exit', stop);

  try {
    await waitFor('the server to answer', async () => (await api('/api/health')).status === 200, {
      attempts: 40,
      delayMs: 1000,
    });

    console.log('\nGraph');
    const graph = await waitFor('the Kubernetes graph to be collected', async () => {
      const { body } = await api('/api/graph');
      const nodes = body?.nodes ?? [];
      const hasWorkload = nodes.some((node) => node.id.includes('k8s:deployment:default:e2e-web'));
      const hasPods =
        nodes.filter((node) => node.id.includes('k8s:pod:default:e2e-web')).length >= 2;
      return hasWorkload && hasPods ? body : null;
    });

    const ids = graph.nodes.map((node) => node.id);
    const links = graph.links.map((link) => ({
      source: String(link.source?.id ?? link.source),
      target: String(link.target?.id ?? link.target),
      label: link.label,
    }));
    const pods = graph.nodes.filter((node) => node.id.includes('k8s:pod:default:e2e-web'));

    check(
      'the Deployment is a node',
      ids.some((id) => id.endsWith('k8s:deployment:default:e2e-web')),
    );
    check(
      'the DaemonSet is a node',
      ids.some((id) => id.endsWith('k8s:daemonset:default:e2e-agent')),
    );
    check(
      'no ReplicaSet is drawn',
      !ids.some((id) => id.includes('replicaset')),
      'ReplicaSets are an implementation detail between a Deployment and its pods',
    );

    // Counts are derived from the graph rather than hardcoded: this script
    // scales the Deployment further down, so a second run against the same
    // cluster would otherwise fail on a stale expectation.
    const managed = links.filter(
      (link) => link.label === 'manages' && link.source.includes('deployment:default:e2e-web'),
    );
    check(
      'the Deployment manages every one of its pods through the ReplicaSet hop',
      managed.length === pods.length && pods.length >= 2,
      `${managed.length} manages links for ${pods.length} pods: ${JSON.stringify(managed)}`,
    );
    check(
      'the DaemonSet manages its pod',
      links.some(
        (link) => link.label === 'manages' && link.source.includes('daemonset:default:e2e-agent'),
      ),
    );

    // Regression: the HPA edge used to fan out to pods matched by a name
    // heuristic while labelling itself "scales Deployment".
    const hpaLinks = links.filter((link) => link.source.includes('k8s:hpa:default:e2e-web'));
    check(
      'the HPA points at the Deployment, not at pods',
      hpaLinks.length === 1 && hpaLinks[0].target.includes('k8s:deployment:default:e2e-web'),
      JSON.stringify(hpaLinks),
    );

    check(
      'the Ingress points at the Service',
      links.some(
        (link) =>
          link.source.includes('k8s:ingress:default:e2e-web') &&
          link.target.includes('k8s:service:default:e2e-web'),
      ),
    );
    const selected = links.filter(
      (link) => link.label === 'selects' && link.source.includes('k8s:service:default:e2e-web'),
    );
    check(
      'the Service selects its pods',
      selected.length === pods.length,
      `${selected.length} selects links for ${pods.length} pods`,
    );

    const podId = pods[0].id.replace(/^kubernetes:/, '');
    const deploymentId = 'k8s:deployment:default:e2e-web';

    console.log('\nOperations');
    const operations = (await api(entityUrl(podId, '/operations'))).body;
    const operationIds = (operations ?? []).map((operation) => operation.id).sort();
    check(
      'a pod offers every entity operation',
      ['actions', 'exec', 'inspect', 'logStream', 'logs', 'stats'].every((id) =>
        operationIds.includes(id),
      ),
      `got ${JSON.stringify(operationIds)}`,
    );

    console.log('\nLogs');
    // Regression: (name, namespace) were swapped, so this 404'd for every pod.
    const logs = await api(entityUrl(podId, '/logs', '&tail=5'));
    check(
      'a pod returns its logs',
      typeof logs.body?.logs === 'string' && logs.body.logs.includes('web tick'),
      JSON.stringify(logs.body).slice(0, 200),
    );

    console.log('\nStats');
    const stats = await waitFor(
      'metrics-server to report a sample',
      async () => {
        const { body } = await api(entityUrl(podId, '/stats'));
        return typeof body?.memory === 'number' && body.memory > 0 ? body : null;
      },
      { attempts: 45, delayMs: 4000 },
    );
    check('a pod reports memory usage', stats.memory > 0, JSON.stringify(stats));
    check(
      'a pod reports its memory limit',
      stats.memoryLimit === 64 * 1024 * 1024,
      JSON.stringify(stats),
    );
    check('cpu is a number', typeof stats.cpu === 'number', JSON.stringify(stats));

    console.log('\nInspect');
    const inspect = (await api(entityUrl(podId, '/inspect'))).body;
    check(
      'inspect returns the literal env value',
      (inspect?.env ?? []).includes('PLAIN_VALUE=hello'),
    );
    check(
      'inspect shows a secret as a reference, never its value',
      (inspect?.env ?? []).includes('SECRET_VALUE=<secret:e2e-secret/password>') &&
        !JSON.stringify(inspect?.env).includes('not-a-real-password'),
      JSON.stringify(inspect?.env),
    );
    check(
      'inspect resolves a configMap mount to its backing object',
      (inspect?.mounts ?? []).some(
        (mount) =>
          mount.type === 'configMap' &&
          mount.source === 'e2e-config' &&
          mount.destination === '/etc/config' &&
          mount.mode === 'ro',
      ),
      JSON.stringify(inspect?.mounts),
    );

    console.log('\nActions');
    const actions = (await api(entityUrl(deploymentId, '/actions'))).body ?? [];
    const scale = actions.find((action) => action.id === 'scale');
    const deployment = graph.nodes.find((node) => node.id.endsWith(deploymentId));
    check(
      'a Deployment offers restart',
      actions.some((action) => action.id === 'restart'),
    );
    // Regression: the form defaulted to 1 because the bounds were published
    // only as a formatted string, so accepting it silently scaled down.
    check(
      'the scale form pre-fills the current replica count',
      scale?.input?.fields?.[0]?.default === deployment?.metadata?.desiredReplicas,
      `form ${JSON.stringify(scale?.input?.fields)} vs node ${JSON.stringify(deployment?.metadata)}`,
    );

    // Regression: every patch went out as application/json-patch+json and the
    // API server rejected it with 400. Mocked tests accepted any arguments, so
    // this is the assertion that would have caught it.
    const restart = await api(entityUrl(deploymentId, '/actions/official.kubernetes/restart'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    check(
      'a rollout restart is accepted by the API server',
      restart.status === 200 && restart.body?.ok === true,
      `${restart.status} ${JSON.stringify(restart.body).slice(0, 300)}`,
    );

    const scaled = await api(entityUrl(deploymentId, '/actions/official.kubernetes/scale'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { replicas: 3 } }),
    });
    check(
      'a scale is accepted by the API server',
      scaled.status === 200 && scaled.body?.ok === true,
      `${scaled.status} ${JSON.stringify(scaled.body).slice(0, 300)}`,
    );

    const bounds = await api(
      entityUrl('k8s:hpa:default:e2e-web', '/actions/official.kubernetes/set_hpa_constraints'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { minReplicas: 1, maxReplicas: 4 } }),
      },
    );
    check(
      'an HPA bounds change is accepted by the API server',
      bounds.status === 200 && bounds.body?.ok === true,
      `${bounds.status} ${JSON.stringify(bounds.body).slice(0, 300)}`,
    );
  } catch (error) {
    console.log(`\nAborted: ${error instanceof Error ? error.message : String(error)}`);
    failures.push('run completed');
  } finally {
    if (failures.length > 0) {
      console.log('\n--- server output ---');
      console.log(log.join('').slice(-4000));
    }
    stop();
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

await main();
