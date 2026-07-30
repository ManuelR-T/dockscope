export type PluginSystemStatus = 'connected' | 'disconnected' | 'unknown';

export interface PluginSystemSnapshot {
  id: string;
  pluginId: string;
  label: string;
  runtime?: string;
  status: PluginSystemStatus;
  version?: string;
  os?: string;
  cpuCount?: number;
  memoryBytes?: number;
  workloadsRunning?: number;
  workloadsStopped?: number;
  artifacts?: number;
  metadata?: Record<string, string | number | boolean>;
}

export type PluginSystemDeclaration = Omit<PluginSystemSnapshot, 'pluginId'>;

export interface PluginSystemProvider {
  listSystems(): readonly PluginSystemDeclaration[] | Promise<readonly PluginSystemDeclaration[]>;
}

export class PluginSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginSystemError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginSystemError(`System field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PluginSystemError(`System field "${field}" must be a non-negative number`);
  }
  return value;
}

export function validatePluginSystems(raw: unknown): PluginSystemDeclaration[] {
  if (!Array.isArray(raw)) {
    throw new PluginSystemError('Plugin systems must be an array');
  }
  return raw.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.label !== 'string' ||
      !item.label.trim()
    ) {
      throw new PluginSystemError(`Plugin system ${index} requires id and label`);
    }
    if (
      item.status !== 'connected' &&
      item.status !== 'disconnected' &&
      item.status !== 'unknown'
    ) {
      throw new PluginSystemError(`Plugin system "${item.id}" has an invalid status`);
    }
    const metadata = item.metadata;
    if (
      metadata !== undefined &&
      (!isRecord(metadata) ||
        Object.values(metadata).some(
          (value) =>
            typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean',
        ))
    ) {
      throw new PluginSystemError(`Plugin system "${item.id}" metadata must contain scalar values`);
    }
    return {
      id: item.id,
      label: item.label,
      runtime: optionalString(item.runtime, `${item.id}.runtime`),
      status: item.status,
      version: optionalString(item.version, `${item.id}.version`),
      os: optionalString(item.os, `${item.id}.os`),
      cpuCount: optionalNumber(item.cpuCount, `${item.id}.cpuCount`),
      memoryBytes: optionalNumber(item.memoryBytes, `${item.id}.memoryBytes`),
      workloadsRunning: optionalNumber(item.workloadsRunning, `${item.id}.workloadsRunning`),
      workloadsStopped: optionalNumber(item.workloadsStopped, `${item.id}.workloadsStopped`),
      artifacts: optionalNumber(item.artifacts, `${item.id}.artifacts`),
      metadata: metadata
        ? ({ ...metadata } as Record<string, string | number | boolean>)
        : undefined,
    };
  });
}
