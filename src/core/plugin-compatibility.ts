import type { PluginManifest } from './plugins.js';

export interface PluginMigration {
  from: string;
  to: string;
  notes?: string;
  commandId?: string;
}

export interface PluginCompatibility {
  minDockscopeVersion?: string;
  maxDockscopeVersion?: string;
  deprecations?: readonly string[];
  migrations?: readonly PluginMigration[];
}

export interface PluginCompatibilityReport {
  pluginId: string;
  name: string;
  version: string;
  minDockscopeVersion?: string;
  maxDockscopeVersion?: string;
  warnings: string[];
  deprecations: string[];
  migrations: PluginMigration[];
}

export class PluginCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginCompatibilityError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new PluginCompatibilityError(
      `Plugin compatibility field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function validateStringList(raw: unknown, field: string): string[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCompatibilityError(`Plugin compatibility field "${field}" must be an array`);
  }
  return raw.map((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new PluginCompatibilityError(
        `Plugin compatibility field "${field}.${index}" must be a non-empty string`,
      );
    }
    return item;
  });
}

function validateMigrations(raw: unknown): PluginMigration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCompatibilityError('Plugin compatibility field "migrations" must be an array');
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      throw new PluginCompatibilityError(
        `Plugin compatibility migration "${index}" must be an object`,
      );
    }
    if (!isNonEmptyString(item.from) || !isNonEmptyString(item.to)) {
      throw new PluginCompatibilityError(
        `Plugin compatibility migration "${index}" requires from and to`,
      );
    }
    return {
      from: item.from,
      to: item.to,
      notes: optionalString(item.notes, `migrations.${index}.notes`),
      commandId: optionalString(item.commandId, `migrations.${index}.commandId`),
    };
  });
}

export function validatePluginCompatibility(raw: unknown): PluginCompatibility | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginCompatibilityError('Plugin compatibility must be an object');
  }
  return {
    minDockscopeVersion: optionalString(raw.minDockscopeVersion, 'minDockscopeVersion'),
    maxDockscopeVersion: optionalString(raw.maxDockscopeVersion, 'maxDockscopeVersion'),
    deprecations: validateStringList(raw.deprecations, 'deprecations'),
    migrations: validateMigrations(raw.migrations),
  };
}

function versionParts(version: string): number[] {
  return version
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function pluginCompatibilityWarnings(
  compatibility: PluginCompatibility | undefined,
  currentVersion: string,
): string[] {
  const warnings: string[] = [];
  if (compatibility?.minDockscopeVersion) {
    if (compareVersions(currentVersion, compatibility.minDockscopeVersion) < 0) {
      warnings.push(`Requires DockScope ${compatibility.minDockscopeVersion} or newer`);
    }
  }
  if (compatibility?.maxDockscopeVersion) {
    if (compareVersions(currentVersion, compatibility.maxDockscopeVersion) > 0) {
      warnings.push(`Validated up to DockScope ${compatibility.maxDockscopeVersion}`);
    }
  }
  return warnings;
}

export function createPluginCompatibilityReport(
  manifest: PluginManifest,
  currentVersion: string,
): PluginCompatibilityReport {
  const compatibility = manifest.compatibility;
  return {
    pluginId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    minDockscopeVersion: compatibility?.minDockscopeVersion,
    maxDockscopeVersion: compatibility?.maxDockscopeVersion,
    warnings: pluginCompatibilityWarnings(compatibility, currentVersion),
    deprecations: [...(compatibility?.deprecations ?? [])],
    migrations: (compatibility?.migrations ?? []).map((migration) => ({ ...migration })),
  };
}
