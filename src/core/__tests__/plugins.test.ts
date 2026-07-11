import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  PLUGIN_CRASH_QUARANTINE_THRESHOLD,
  PluginManifestError,
  PluginRegistry,
  validatePluginManifest,
  type PluginConfigWriter,
  type DockscopePlugin,
  type PluginSecretWriter,
  type PluginStateWriter,
} from '../plugins';
import type { GraphSourceAdapter } from '../model';
import type {
  EntityActionProvider,
  EntityExecProvider,
  EntityLogStreamProvider,
  EntityStatsProvider,
  ProjectProvider,
  ResourceProvider,
} from '../operations';
import type { MetricAnalysisProvider } from '../plugin-analysis';
import type { PluginSystemProvider } from '../plugin-system';
import type { PluginConnectionProvider } from '../plugin-connections';

const TEST_API_VERSIONS = {
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
} as const;

function plugin(overrides: Partial<DockscopePlugin> = {}): DockscopePlugin {
  return {
    manifest: {
      id: 'test.plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      ...TEST_API_VERSIONS,
      capabilities: ['source.graph'],
      permissions: [],
    },
    ...overrides,
  };
}

function pluginWithCapabilities(
  capabilities: DockscopePlugin['manifest']['capabilities'],
  overrides: Partial<DockscopePlugin> = {},
): DockscopePlugin {
  return plugin({
    ...overrides,
    manifest: {
      id: 'test.plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      ...TEST_API_VERSIONS,
      capabilities,
      permissions: [],
    },
  });
}

describe('PluginRegistry', () => {
  it('registers plugins and tracks lifecycle state', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const registry = new PluginRegistry();

    registry.register(plugin({ start, stop }));
    expect(registry.listPlugins()[0]).toMatchObject({
      manifest: { id: 'test.plugin', capabilities: ['source.graph'] },
      status: 'registered',
    });

    await registry.startAll();
    expect(start).toHaveBeenCalledOnce();
    expect(registry.listPlugins()[0].status).toBe('started');

    await registry.stopAll();
    expect(stop).toHaveBeenCalledOnce();
    expect(registry.listPlugins()[0].status).toBe('stopped');
  });

  it('quarantines crash-looping external plugins and recovers on explicit enable', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const saveRuntimeState = vi.fn();
    const stateWriter: PluginStateWriter = {
      saveEnabled: vi.fn(),
      saveRuntimeState,
    };
    const registry = new PluginRegistry(undefined, stateWriter);
    registry.register(
      plugin({
        manifest: {
          id: 'test.unstable',
          name: 'Unstable',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['ui.command'],
          permissions: [],
          execution: { isolation: 'process', memoryLimitMb: 64 },
        },
        start,
        stop,
        getRuntimeHealth: async () => ({
          state: 'stopped',
          restartCount: PLUGIN_CRASH_QUARANTINE_THRESHOLD,
          pendingOperations: 0,
          openStreams: 0,
          stderrBytes: 128,
          operationTimeoutMs: 5000,
          memoryLimitMb: 64,
          maxStderrBytes: 1000,
        }),
      }),
    );
    await registry.startAll();

    for (let index = 0; index < PLUGIN_CRASH_QUARANTINE_THRESHOLD; index += 1) {
      await registry.recordRuntimeCrash('test.unstable', {
        message: `crash ${index + 1}`,
        restartCount: index + 1,
        time: 10_000 + index,
      });
    }

    expect(registry.listPlugins()[0]).toMatchObject({
      enabled: false,
      status: 'quarantined',
      crashCount: PLUGIN_CRASH_QUARANTINE_THRESHOLD,
      quarantineReason: '3 crashes within 60s',
    });
    expect(stop).toHaveBeenCalledOnce();
    await expect(registry.listPluginRuntimeHealth()).resolves.toEqual([
      expect.objectContaining({
        pluginId: 'test.unstable',
        state: 'stopped',
        crashCount: PLUGIN_CRASH_QUARANTINE_THRESHOLD,
        restartCount: PLUGIN_CRASH_QUARANTINE_THRESHOLD,
        quarantinedAt: 10_002,
      }),
    ]);
    expect(saveRuntimeState).toHaveBeenLastCalledWith(
      'test.unstable',
      expect.objectContaining({ enabled: false, quarantined: true, crashCount: 3 }),
    );

    await registry.enablePlugin('test.unstable');
    expect(registry.listPlugins()[0]).toMatchObject({
      enabled: true,
      status: 'started',
      crashCount: 0,
      quarantineReason: undefined,
    });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('preserves a persisted crash window when startup itself crashes', async () => {
    const now = Date.now();
    const registry = new PluginRegistry();
    const unstable = plugin({
      manifest: {
        id: 'test.persisted-crashes',
        name: 'Persisted Crashes',
        version: '1.0.0',
        ...TEST_API_VERSIONS,
        capabilities: ['ui.command'],
        permissions: [],
        execution: { isolation: 'process' },
      },
      start: async () => {
        await registry.recordRuntimeCrash('test.persisted-crashes', {
          message: 'startup crash',
          restartCount: 3,
          time: now,
        });
        throw new Error('startup crash');
      },
    });
    registry.register(unstable, undefined, {
      recentCrashTimes: [now - 2000, now - 1000],
      crashCount: 2,
    });

    await expect(registry.startPlugin('test.persisted-crashes')).rejects.toThrow('startup crash');
    expect(registry.listPlugins()[0]).toMatchObject({
      enabled: false,
      status: 'quarantined',
      crashCount: 3,
      lastCrashError: 'startup crash',
    });
  });

  it('rejects duplicate plugin ids', () => {
    const registry = new PluginRegistry();
    registry.register(plugin());

    expect(() => registry.register(plugin())).toThrow('Plugin already registered: test.plugin');
  });

  it('starts and unregisters external plugins at runtime', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const registry = new PluginRegistry();

    registry.register(plugin({ start, stop }));

    await expect(registry.startPlugin('test.plugin')).resolves.toMatchObject({
      status: 'started',
    });
    expect(start).toHaveBeenCalledOnce();

    await expect(registry.unregisterPlugin('test.plugin')).resolves.toEqual({ ok: true });

    expect(stop).toHaveBeenCalledOnce();
    expect(registry.listPlugins()).toEqual([]);
  });

  it('validates manifests before registration', () => {
    const manifest = validatePluginManifest({
      id: 'custom.plugin',
      name: 'Custom Plugin',
      version: '1.2.3',
      description: 'A plugin',
      entry: './plugin.mjs',
      capabilities: ['source.graph', 'source.metrics', 'ui.toolbarAction', 'ui.settings'],
      permissions: ['network.local'],
      config: {
        fields: [
          {
            key: 'enabled',
            label: 'Enabled',
            type: 'boolean',
            default: true,
          },
        ],
      },
      ui: [
        {
          id: 'open',
          slot: 'toolbar',
          title: 'Open',
          action: { type: 'open_url', url: 'https://example.com' },
        },
      ],
    });

    expect(manifest).toMatchObject({
      id: 'custom.plugin',
      capabilities: ['source.graph', 'source.metrics', 'ui.toolbarAction', 'ui.settings'],
      permissions: ['network.local'],
      config: { fields: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: true }] },
      ui: [{ id: 'open', slot: 'toolbar', title: 'Open' }],
    });
  });

  it('rejects invalid manifest capabilities and permissions', () => {
    expect(() =>
      validatePluginManifest({
        id: 'custom.plugin',
        name: 'Custom Plugin',
        version: '1.2.3',
        capabilities: ['source.unknown'],
        permissions: [],
      }),
    ).toThrow(PluginManifestError);

    expect(() =>
      validatePluginManifest({
        id: 'custom.plugin',
        name: 'Custom Plugin',
        version: '1.2.3',
        capabilities: ['source.graph'],
        permissions: ['root.access'],
      }),
    ).toThrow('Unsupported plugin permission: root.access');
  });

  it('rejects unsupported API versions and undeclared secret permissions', () => {
    expect(() =>
      validatePluginManifest({
        id: 'custom.plugin',
        name: 'Custom Plugin',
        version: '1.2.3',
        dockscopeApiVersion: '99',
        capabilities: ['source.graph'],
        permissions: [],
      }),
    ).toThrow('Unsupported DockScope plugin API version: 99');

    expect(() =>
      validatePluginManifest({
        id: 'custom.plugin',
        name: 'Custom Plugin',
        version: '1.2.3',
        capabilities: ['source.graph'],
        permissions: [],
        secrets: [{ key: 'token', label: 'Token' }],
      }),
    ).toThrow('Plugin secrets require permission "secrets.read"');
  });

  it('rejects UI extensions without the matching UI capability', () => {
    expect(() =>
      validatePluginManifest({
        id: 'custom.plugin',
        name: 'Custom Plugin',
        version: '1.2.3',
        capabilities: ['source.graph'],
        permissions: [],
        ui: [{ id: 'open', slot: 'toolbar', title: 'Open' }],
      }),
    ).toThrow('requires capability "ui.toolbarAction"');
  });

  it('requires frontend bundles and slots to declare their capabilities', () => {
    expect(() =>
      validatePluginManifest({
        id: 'custom.frontend',
        name: 'Custom Frontend',
        version: '1.2.3',
        capabilities: ['ui.sidebarPanel'],
        permissions: [],
        frontend: { entry: './frontend.mjs', slots: ['sidebar'] },
      }),
    ).toThrow('Plugin frontend requires capability "ui.frontend"');

    expect(() =>
      validatePluginManifest({
        id: 'custom.frontend',
        name: 'Custom Frontend',
        version: '1.2.3',
        capabilities: ['ui.frontend'],
        permissions: [],
        frontend: { entry: './frontend.mjs', slots: ['sidebar'] },
      }),
    ).toThrow('Plugin frontend slot "sidebar" requires capability "ui.sidebarPanel"');

    expect(() =>
      validatePluginManifest({
        id: 'custom.frontend',
        name: 'Custom Frontend',
        version: '1.2.3',
        capabilities: ['ui.sidebarPanel'],
        permissions: [],
        ui: [
          {
            id: 'overview',
            slot: 'sidebar',
            title: 'Overview',
            frontendView: 'overview',
          },
        ],
      }),
    ).toThrow('declares frontendView without a frontend bundle');
  });

  it('rejects provider methods that were not declared as capabilities', () => {
    const registry = new PluginRegistry();

    expect(() =>
      registry.register(
        plugin({
          manifest: {
            id: 'test.metrics',
            name: 'Metrics',
            version: '1.0.0',
            ...TEST_API_VERSIONS,
            capabilities: ['source.graph', 'ui.settings'],
            permissions: [],
          },
          getStatsProviders: () => [],
        }),
      ),
    ).toThrow('implements getStatsProviders without declaring source.metrics');
  });

  it('records plugin load errors without exposing mutable state', () => {
    const registry = new PluginRegistry();

    registry.recordLoadError({
      id: 'custom.plugin',
      path: '/tmp/plugin.json',
      phase: 'load',
      message: 'boom',
    });

    const errors = registry.listPluginErrors();
    errors[0].message = 'changed';

    expect(registry.listPluginErrors()).toEqual([
      {
        id: 'custom.plugin',
        path: '/tmp/plugin.json',
        phase: 'load',
        message: 'boom',
      },
    ]);
  });

  it('records plugin manifest warnings without exposing mutable state', () => {
    const registry = new PluginRegistry();
    registry.recordLoadWarning({
      id: 'custom.plugin',
      path: '/tmp/plugin.json',
      code: 'host-api-version-defaulted',
      message: 'hostApiVersion is omitted',
    });

    const warnings = registry.listPluginWarnings();
    warnings[0].message = 'changed';

    expect(registry.listPluginWarnings()).toEqual([
      {
        id: 'custom.plugin',
        path: '/tmp/plugin.json',
        code: 'host-api-version-defaulted',
        message: 'hostApiVersion is omitted',
      },
    ]);
  });

  it('marks failed plugins without aborting registry startup', async () => {
    const registry = new PluginRegistry();
    registry.register(
      plugin({
        start: () => {
          throw new Error('start failed');
        },
      }),
    );

    await expect(registry.startAll()).resolves.toBeUndefined();
    expect(registry.listPlugins()[0]).toMatchObject({
      status: 'failed',
      error: 'start failed',
    });
  });

  it('lists UI extensions with plugin ids', () => {
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        manifest: {
          id: 'test.ui',
          name: 'UI Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.toolbarAction'],
          permissions: [],
          ui: [
            {
              id: 'open',
              slot: 'toolbar',
              title: 'Open Plugin',
              description: 'Open the plugin',
            },
          ],
        },
      }),
    );

    expect(registry.listUiExtensions()).toEqual([
      expect.objectContaining({
        pluginId: 'test.ui',
        id: 'open',
        slot: 'toolbar',
        title: 'Open Plugin',
      }),
    ]);
  });

  it('runs contextual UI actions through their owning plugin command', async () => {
    const runCommand = vi.fn().mockResolvedValue({ ok: true, message: 'restarted' });
    const registry = new PluginRegistry();
    registry.register(
      plugin({
        manifest: {
          id: 'test.context-ui',
          name: 'Context UI',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.command', 'ui.nodeAction'],
          permissions: [],
          commands: [{ id: 'restart', title: 'Restart' }],
          ui: [
            {
              id: 'restart-node',
              slot: 'nodeAction',
              title: 'Restart node',
              context: { runtimes: ['docker'] },
              action: {
                type: 'run_command',
                commandId: 'restart',
                input: { force: false },
                passContext: true,
              },
            },
          ],
        },
        runCommand,
      }),
    );

    await expect(
      registry.runPluginUiAction('test.context-ui', 'restart-node', {
        context: {
          node: {
            id: 'local:123',
            name: 'api',
            sourceId: 'local',
            entityId: '123',
            runtime: 'docker',
            status: 'running',
          },
        },
        input: { force: true },
      }),
    ).resolves.toEqual({
      type: 'command',
      result: { ok: true, message: 'restarted', data: undefined },
    });
    expect(runCommand).toHaveBeenCalledWith('restart', {
      input: { force: true },
      context: {
        node: {
          id: 'local:123',
          name: 'api',
          sourceId: 'local',
          entityId: '123',
          runtime: 'docker',
          status: 'running',
          kind: undefined,
          namespace: undefined,
          project: undefined,
          host: undefined,
        },
      },
      ui: { extensionId: 'restart-node', slot: 'nodeAction' },
    });

    await expect(
      registry.runPluginUiAction('test.context-ui', 'restart-node', {
        context: { node: { id: 'pod:api', name: 'api', runtime: 'kubernetes' } },
      }),
    ).rejects.toThrow('does not match the current context');
  });

  it('lists and runs plugin commands with event history', async () => {
    const runCommand = vi.fn().mockResolvedValue({ ok: true, message: 'synced' });
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        manifest: {
          id: 'test.command',
          name: 'Command Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.command'],
          permissions: [],
          commands: [{ id: 'sync', title: 'Sync', description: 'Run sync' }],
        },
        runCommand,
      }),
    );

    expect(registry.listPluginCommands()).toEqual([
      {
        pluginId: 'test.command',
        id: 'sync',
        title: 'Sync',
        description: 'Run sync',
        confirm: false,
      },
    ]);
    await expect(
      registry.runPluginCommand('test.command', 'sync', { force: true }),
    ).resolves.toEqual({
      ok: true,
      message: 'synced',
      data: undefined,
    });
    expect(runCommand).toHaveBeenCalledWith('sync', { force: true });
    expect(registry.listPluginEvents()).toEqual([
      expect.objectContaining({
        pluginId: 'test.command',
        type: 'command.completed',
        payload: { commandId: 'sync', ok: true, message: 'synced' },
      }),
    ]);
  });

  it('reloads external plugins through the configured reload handler', async () => {
    const stop = vi.fn();
    const nextStart = vi.fn();
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        stop,
        manifest: {
          id: 'test.reload',
          name: 'Reload Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph'],
          permissions: [],
        },
      }),
    );
    await registry.startAll();
    registry.setReloadHandler(async () => ({
      plugin: plugin({
        start: nextStart,
        manifest: {
          id: 'test.reload',
          name: 'Reload Plugin',
          version: '2.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph'],
          permissions: [],
        },
      }),
    }));

    await expect(registry.reloadPlugin('test.reload')).resolves.toMatchObject({
      manifest: { id: 'test.reload', version: '2.0.0' },
      status: 'started',
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(nextStart).toHaveBeenCalledOnce();
  });

  it('reports compatibility warnings and migrations', () => {
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        manifest: {
          id: 'test.compat',
          name: 'Compat Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph'],
          permissions: [],
          compatibility: {
            minDockscopeVersion: '99.0.0',
            deprecations: ['legacy option will be removed'],
            migrations: [{ from: '0.x', to: '1.x', notes: 'rename config key' }],
          },
        },
      }),
    );
    registry.register(
      plugin({
        manifest: {
          id: 'core.compat',
          name: 'Core Compat',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          builtin: true,
          capabilities: ['source.graph'],
          permissions: [],
          compatibility: {
            minDockscopeVersion: '99.0.0',
          },
        },
      }),
    );

    expect(registry.listPluginCompatibility('1.0.0')).toEqual([
      expect.objectContaining({
        pluginId: 'test.compat',
        warnings: ['Requires DockScope 99.0.0 or newer'],
        deprecations: ['legacy option will be removed'],
        migrations: [{ from: '0.x', to: '1.x', notes: 'rename config key' }],
      }),
    ]);
  });

  it('runs plugin migrations through declared command ids', async () => {
    const runCommand = vi.fn().mockResolvedValue({ ok: true, message: 'migrated' });
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        manifest: {
          id: 'test.migration',
          name: 'Migration Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.command'],
          permissions: [],
          commands: [{ id: 'migrate', title: 'Migrate' }],
          compatibility: {
            migrations: [{ from: '0.x', to: '1.x', commandId: 'migrate' }],
          },
        },
        runCommand,
      }),
    );

    await expect(registry.runPluginMigration('test.migration', '0.x', '1.x')).resolves.toEqual({
      ok: true,
      message: 'migrated',
      data: undefined,
    });
    expect(runCommand).toHaveBeenCalledWith('migrate', {
      migration: { from: '0.x', to: '1.x' },
      input: undefined,
    });
  });

  it('creates external plugin review reports with risk classification', () => {
    const registry = new PluginRegistry();

    registry.register(
      plugin({
        manifest: {
          id: 'test.review',
          name: 'Review Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.command'],
          permissions: ['process.exec'],
          commands: [{ id: 'run', title: 'Run' }],
          execution: { isolation: 'in-process' },
        },
      }),
    );

    expect(registry.listPluginReviews('1.0.0')).toEqual([
      expect.objectContaining({
        pluginId: 'test.review',
        riskLevel: 'high',
        permissions: ['process.exec'],
        commands: ['run'],
        riskReasons: expect.arrayContaining([
          'requires process.exec',
          'runs plugin code in the main server process',
        ]),
      }),
    ]);
  });

  it('approves and revokes plugin review fingerprints', async () => {
    const writer = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry(undefined, undefined, undefined, undefined, [], writer);

    registry.register(
      plugin({
        manifest: {
          id: 'test.approval',
          name: 'Approval Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph'],
          permissions: [],
        },
      }),
    );

    expect(registry.listPluginReviews('1.0.0')[0]).toMatchObject({
      pluginId: 'test.approval',
      approvalStatus: 'unapproved',
    });

    const approval = await registry.approvePlugin('test.approval');

    expect(registry.listPluginReviews('1.0.0')[0]).toMatchObject({
      approvalStatus: 'approved',
      approvedFingerprint: approval.fingerprint,
    });
    expect(writer.save).toHaveBeenCalledWith([approval]);

    await registry.revokePluginApproval('test.approval');

    expect(registry.listPluginReviews('1.0.0')[0]).toMatchObject({
      approvalStatus: 'unapproved',
    });
    expect(writer.save).toHaveBeenLastCalledWith([]);
  });

  it('validates, saves, and applies plugin config updates', async () => {
    const configure = vi.fn();
    const writer: PluginConfigWriter = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry(writer);

    registry.register(
      plugin({
        manifest: {
          id: 'test.config',
          name: 'Config Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph', 'ui.settings'],
          permissions: [],
          config: {
            fields: [
              { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
              { key: 'limit', label: 'Limit', type: 'number', default: 5 },
            ],
          },
        },
        configure,
      }),
      { enabled: true },
    );

    await expect(registry.updatePluginConfig('test.config', { enabled: false })).resolves.toEqual(
      expect.objectContaining({
        pluginId: 'test.config',
        values: { enabled: false, limit: 5 },
      }),
    );
    expect(configure).toHaveBeenCalledWith({ enabled: false, limit: 5 });
    expect(writer.save).toHaveBeenCalledWith('test.config', { enabled: false, limit: 5 });
  });

  it('toggles external plugins and excludes disabled providers', async () => {
    const source: GraphSourceAdapter = {
      describe: () => ({
        id: 'source-a',
        label: 'Source A',
        kind: 'plugin',
        pluginId: 'test.plugin',
        capabilities: ['source.graph'],
        status: 'connected',
      }),
      collectGraph: async () => ({
        source: source.describe(),
        graph: { nodes: [], links: [] },
        collectedAt: 1,
      }),
    };
    const stateWriter: PluginStateWriter = {
      saveEnabled: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry(undefined, stateWriter);

    registry.register(plugin({ getGraphSources: () => [source] }), undefined, { enabled: false });

    expect(registry.listPlugins()[0]).toMatchObject({ enabled: false, status: 'disabled' });
    expect(registry.listDataSources()).toEqual([]);

    await expect(registry.enablePlugin('test.plugin')).resolves.toMatchObject({
      enabled: true,
      status: 'started',
    });
    expect(registry.listDataSources()).toEqual([source.describe()]);

    await expect(registry.disablePlugin('test.plugin')).resolves.toMatchObject({
      enabled: false,
      status: 'disabled',
    });
    expect(stateWriter.saveEnabled).toHaveBeenLastCalledWith('test.plugin', false);
    expect(registry.listDataSources()).toEqual([]);
  });

  it('lists and updates declared plugin secrets without exposing values', async () => {
    const secretWriter: PluginSecretWriter = {
      has: vi.fn().mockResolvedValue(true),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry(undefined, undefined, secretWriter);

    registry.register(
      plugin({
        manifest: {
          id: 'test.secret',
          name: 'Secret Plugin',
          version: '1.0.0',
          ...TEST_API_VERSIONS,
          capabilities: ['source.graph'],
          permissions: ['secrets.read'],
          secrets: [{ key: 'token', label: 'API token', required: true }],
        },
      }),
    );

    await expect(registry.listPluginSecrets()).resolves.toEqual([
      {
        pluginId: 'test.secret',
        secrets: [{ key: 'token', label: 'API token', required: true, configured: true }],
      },
    ]);

    await registry.updatePluginSecret('test.secret', 'token', 'secret-value');
    expect(secretWriter.set).toHaveBeenCalledWith('test.secret', 'token', 'secret-value');
  });

  it('exposes graph sources from registered plugins', () => {
    const source: GraphSourceAdapter = {
      describe: () => ({
        id: 'source-a',
        label: 'Source A',
        kind: 'plugin',
        pluginId: 'test.plugin',
        capabilities: ['source.graph'],
        status: 'connected',
      }),
      collectGraph: async () => ({
        source: source.describe(),
        graph: { nodes: [], links: [] },
        collectedAt: 1,
      }),
    };
    const registry = new PluginRegistry();

    registry.register(plugin({ getGraphSources: () => [source] }));

    expect(registry.getGraphSources()).toEqual([source]);
    expect(registry.listDataSources()).toEqual([source.describe()]);
  });

  it('routes entity operations to a matching provider', async () => {
    const statsProvider: EntityStatsProvider = {
      canHandle: (ref) => ref.sourceId === 'source-a',
      getStats: vi.fn().mockResolvedValue({
        id: 'entity-a',
        cpu: 1,
        memory: 2,
        memoryLimit: 3,
        networkRx: 4,
        networkTx: 5,
        networkRxRate: 6,
        networkTxRate: 7,
      }),
    };
    const registry = new PluginRegistry();

    registry.register(
      pluginWithCapabilities(['source.graph', 'source.metrics'], {
        getStatsProviders: () => [statsProvider],
      }),
    );

    await expect(
      registry.getStats({ entityId: 'entity-a', sourceId: 'source-a' }),
    ).resolves.toMatchObject({ id: 'entity-a', cpu: 1 });
    expect(statsProvider.getStats).toHaveBeenCalledWith({
      entityId: 'entity-a',
      sourceId: 'source-a',
    });
  });

  it('discovers and runs provider-owned entity actions with typed input', async () => {
    const actionProvider: EntityActionProvider = {
      canHandle: (ref) => ref.sourceId === 'source-a',
      listActions: vi.fn().mockResolvedValue([
        {
          id: 'scale',
          title: 'Scale',
          capability: 'action.scale',
          placement: 'primary',
          input: {
            fields: [{ key: 'replicas', label: 'Replicas', type: 'number', required: true }],
          },
        },
      ]),
      runAction: vi.fn().mockResolvedValue({ ok: true, message: 'scaled' }),
    };
    const registry = new PluginRegistry();
    registry.register(
      pluginWithCapabilities(['source.graph', 'action.scale'], {
        getActionProviders: () => [actionProvider],
      }),
    );
    const ref = { entityId: 'entity-a', sourceId: 'source-a' };

    await expect(registry.listEntityActions(ref)).resolves.toEqual([
      expect.objectContaining({
        pluginId: 'test.plugin',
        id: 'scale',
        capability: 'action.scale',
        placement: 'primary',
      }),
    ]);
    await expect(registry.listEntityOperations(ref)).resolves.toContainEqual({
      id: 'actions',
      pluginId: 'test.plugin',
      capability: 'action.scale',
    });
    await expect(
      registry.runEntityAction(ref, 'test.plugin', 'scale', { replicas: 3 }),
    ).resolves.toEqual({ ok: true, message: 'scaled', data: undefined });
    expect(actionProvider.runAction).toHaveBeenCalledWith(ref, 'scale', { replicas: 3 });
    await expect(
      registry.runEntityAction(ref, 'test.plugin', 'scale', { replicas: 'three' }),
    ).rejects.toThrow('must be a number');
  });

  it('aggregates plugin-owned metric analysis and system inventory', async () => {
    const analysisProvider: MetricAnalysisProvider = {
      canHandle: (ref) => ref.sourceId === 'source-a',
      analyze: vi.fn().mockResolvedValue({ average: 25, threshold: 80, severity: 'warning' }),
    };
    const systemProvider: PluginSystemProvider = {
      listSystems: vi.fn().mockResolvedValue([
        {
          id: 'source-a',
          label: 'Source A',
          runtime: 'demo',
          status: 'connected',
          version: '1.0.0',
        },
      ]),
    };
    const registry = new PluginRegistry();
    registry.register(
      pluginWithCapabilities(['source.graph', 'source.system', 'analysis.anomalies'], {
        getMetricAnalysisProviders: () => [analysisProvider],
        getSystemProviders: () => [systemProvider],
      }),
    );

    await expect(
      registry.analyzeMetric({
        ref: { entityId: 'entity-a', sourceId: 'source-a' },
        metric: 'cpu',
        value: 95,
        history: [20, 25, 30],
      }),
    ).resolves.toEqual([
      {
        pluginId: 'test.plugin',
        metric: 'cpu',
        value: 95,
        average: 25,
        threshold: 80,
        severity: 'warning',
        message: undefined,
      },
    ]);
    await expect(registry.listSystems()).resolves.toEqual([
      expect.objectContaining({ id: 'source-a', pluginId: 'test.plugin', status: 'connected' }),
    ]);
  });

  it('routes connection lifecycle to an exact plugin provider', async () => {
    const connectionProvider: PluginConnectionProvider = {
      describe: () => ({
        id: 'clusters',
        label: 'Clusters',
        input: {
          fields: [{ key: 'endpoint', label: 'Endpoint', type: 'string', required: true }],
        },
      }),
      listConnections: vi
        .fn()
        .mockResolvedValue([
          { id: 'cluster-a', label: 'Cluster A', status: 'connected', removable: true },
        ]),
      addConnection: vi.fn().mockResolvedValue(undefined),
      removeConnection: vi.fn().mockResolvedValue(undefined),
      refreshConnections: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry();
    registry.register(
      pluginWithCapabilities(['source.graph', 'source.connections'], {
        getConnectionProviders: () => [connectionProvider],
      }),
    );

    expect(registry.listConnectionProviders()).toEqual([
      expect.objectContaining({ pluginId: 'test.plugin', id: 'clusters' }),
    ]);
    await expect(registry.listConnections()).resolves.toEqual([
      expect.objectContaining({
        id: 'cluster-a',
        pluginId: 'test.plugin',
        providerId: 'clusters',
      }),
    ]);
    await registry.addConnection('test.plugin', 'clusters', { endpoint: 'https://cluster-a' });
    expect(connectionProvider.addConnection).toHaveBeenCalledWith({
      endpoint: 'https://cluster-a',
    });
    await registry.removeConnection('test.plugin', 'clusters', 'cluster-a');
    expect(connectionProvider.removeConnection).toHaveBeenCalledWith('cluster-a');
    await registry.refreshConnections();
    expect(connectionProvider.refreshConnections).toHaveBeenCalledOnce();
  });

  it('routes stream log operations to a matching provider', async () => {
    const stop = vi.fn();
    const logStreamProvider: EntityLogStreamProvider = {
      canHandle: (ref) => ref.sourceId === 'source-a',
      streamLogs: vi.fn().mockReturnValue(stop),
    };
    const onData = vi.fn();
    const onError = vi.fn();
    const registry = new PluginRegistry();

    registry.register(
      pluginWithCapabilities(['source.graph', 'source.logs'], {
        getLogStreamProviders: () => [logStreamProvider],
      }),
    );

    await expect(
      registry.streamLogs({ entityId: 'entity-a', sourceId: 'source-a' }, onData, onError),
    ).resolves.toBe(stop);
    expect(logStreamProvider.streamLogs).toHaveBeenCalledWith(
      { entityId: 'entity-a', sourceId: 'source-a' },
      onData,
      onError,
    );
  });

  it('routes exec session creation to a matching provider', async () => {
    const stream = new PassThrough();
    const execProvider: EntityExecProvider = {
      canHandle: (ref) => ref.sourceId === 'source-a',
      createExecSession: vi.fn().mockResolvedValue({
        stream,
        inspect: async () => ({ Running: true, ExitCode: 0 }),
      }),
    };
    const registry = new PluginRegistry();

    registry.register(
      pluginWithCapabilities(['source.graph', 'action.exec'], {
        getExecProviders: () => [execProvider],
      }),
    );

    await expect(
      registry.createExecSession({ entityId: 'entity-a', sourceId: 'source-a' }, ['/bin/bash']),
    ).resolves.toMatchObject({ stream });
    expect(execProvider.createExecSession).toHaveBeenCalledWith(
      { entityId: 'entity-a', sourceId: 'source-a' },
      ['/bin/bash'],
    );
  });

  it('returns a typed operation error when no provider matches', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin());

    await expect(registry.getStats({ entityId: 'entity-a', sourceId: 'missing' })).rejects.toThrow(
      'No plugin provider found for source.metrics on missing',
    );
  });

  it('aggregates project providers and routes project actions', async () => {
    const projectProvider: ProjectProvider = {
      listProjects: vi.fn().mockResolvedValue([{ name: 'demo', running: 1, stopped: 0 }]),
      runProjectAction: vi.fn().mockResolvedValue('restart completed'),
    };
    const registry = new PluginRegistry();

    registry.register(
      pluginWithCapabilities(['source.graph', 'source.inventory', 'action.deploy'], {
        getProjectProviders: () => [projectProvider],
      }),
    );

    await expect(registry.listProjects()).resolves.toEqual([
      {
        name: 'demo',
        running: 1,
        stopped: 0,
        pluginId: 'test.plugin',
        providerId: '0',
      },
    ]);
    await expect(registry.runProjectAction('demo', 'restart')).resolves.toBe('restart completed');
    expect(projectProvider.runProjectAction).toHaveBeenCalledWith('demo', 'restart');
  });

  it('routes resource logs and actions to a matching provider', async () => {
    const resourceProvider: ResourceProvider = {
      canHandle: (resourceId) => resourceId.startsWith('k8s:'),
      getResourceLogs: vi.fn().mockResolvedValue('pod log\n'),
      runResourceAction: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new PluginRegistry();

    registry.register(
      pluginWithCapabilities(['source.graph', 'source.logs', 'action.lifecycle'], {
        getResourceProviders: () => [resourceProvider],
      }),
    );

    await expect(registry.getResourceLogs('k8s:pod:default:web', { tail: 10 })).resolves.toBe(
      'pod log\n',
    );
    expect(resourceProvider.getResourceLogs).toHaveBeenCalledWith('k8s:pod:default:web', {
      tail: 10,
    });

    await expect(
      registry.runResourceAction('k8s:hpa:default:web', 'set_hpa_constraints', {
        minReplicas: 2,
        maxReplicas: 5,
      }),
    ).resolves.toBeUndefined();
    expect(resourceProvider.runResourceAction).toHaveBeenCalledWith(
      'k8s:hpa:default:web',
      'set_hpa_constraints',
      { minReplicas: 2, maxReplicas: 5 },
    );
  });
});
