import { readFile } from 'fs/promises';
import { parse } from 'yaml';

export interface ComposeService {
  name: string;
  image: string;
  ports: string[];
  networks: string[];
  dependsOn: string[];
  volumes: string[];
  environment: Record<string, string>;
  labels: Record<string, string>;
  healthcheck: { test: string; interval?: string; timeout?: string; retries?: number } | null;
  resourceLimits: { cpus?: string; memory?: string } | null;
}

export interface ComposeData {
  services: ComposeService[];
  networks: string[];
}

export async function parseComposeFile(filePath: string): Promise<ComposeData> {
  const content = await readFile(filePath, 'utf-8');
  const compose = parse(content);

  if (!compose?.services) {
    return { services: [], networks: [] };
  }

  const services: ComposeService[] = [];

  for (const [name, svc] of Object.entries<any>(compose.services)) {
    const dependsOn = parseDependsOn(svc.depends_on);

    services.push({
      name,
      image: svc.image || `${name}:latest`,
      ports: Array.isArray(svc.ports) ? svc.ports.map(String) : [],
      networks: parseNetworks(svc.networks),
      dependsOn,
      volumes: Array.isArray(svc.volumes) ? svc.volumes.map(String) : [],
      environment: parseEnvironment(svc.environment),
      labels: parseLabels(svc.labels),
      healthcheck: parseHealthcheck(svc.healthcheck),
      resourceLimits: parseResourceLimits(svc.deploy),
    });
  }

  const topLevelNetworks = compose.networks ? Object.keys(compose.networks) : [];

  return { services, networks: topLevelNetworks };
}

function parseDependsOn(dep: unknown): string[] {
  if (!dep) return [];
  // Simple form: depends_on: [db, redis]
  if (Array.isArray(dep)) return dep.map(String);
  // Extended form: depends_on: { db: { condition: service_healthy } }
  if (typeof dep === 'object') return Object.keys(dep);
  return [];
}

function parseNetworks(nets: unknown): string[] {
  if (!nets) return [];
  if (Array.isArray(nets)) return nets.map(String);
  if (typeof nets === 'object') return Object.keys(nets as object);
  return [];
}

function parseEnvironment(env: unknown): Record<string, string> {
  if (!env) return {};
  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const s = String(item);
      const eqIdx = s.indexOf('=');
      if (eqIdx > 0) result[s.substring(0, eqIdx)] = s.substring(eqIdx + 1);
      else result[s] = '';
    }
    return result;
  }
  if (typeof env === 'object') {
    return Object.fromEntries(
      Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    );
  }
  return {};
}

function parseLabels(labels: unknown): Record<string, string> {
  if (!labels) return {};
  if (Array.isArray(labels)) {
    const result: Record<string, string> = {};
    for (const item of labels) {
      const s = String(item);
      const eqIdx = s.indexOf('=');
      if (eqIdx > 0) result[s.substring(0, eqIdx)] = s.substring(eqIdx + 1);
    }
    return result;
  }
  if (typeof labels === 'object') {
    return Object.fromEntries(
      Object.entries(labels as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    );
  }
  return {};
}

function parseHealthcheck(hc: unknown): ComposeService['healthcheck'] {
  if (!hc || typeof hc !== 'object') return null;
  const h = hc as any;
  const test = Array.isArray(h.test) ? h.test.join(' ') : String(h.test || '');
  if (!test) return null;
  return {
    test,
    interval: h.interval,
    timeout: h.timeout,
    retries: h.retries,
  };
}

function parseResourceLimits(deploy: unknown): ComposeService['resourceLimits'] {
  if (!deploy || typeof deploy !== 'object') return null;
  const d = deploy as any;
  const limits = d.resources?.limits;
  if (!limits) return null;
  return {
    cpus: limits.cpus ? String(limits.cpus) : undefined,
    memory: limits.memory ? String(limits.memory) : undefined,
  };
}
