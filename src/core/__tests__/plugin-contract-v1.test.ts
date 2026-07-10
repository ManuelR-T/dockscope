import { describe, expect, it } from 'vitest';
import { PLUGIN_CAPABILITIES, PLUGIN_PERMISSIONS } from '../capabilities';
import { DOCKSCOPE_PLUGIN_API_VERSION, validatePluginManifest } from '../plugins';

describe('plugin API v1 contract', () => {
  it('keeps the current plugin API version stable', () => {
    expect(DOCKSCOPE_PLUGIN_API_VERSION).toBe('1');
  });

  it('keeps required v1 capabilities and permissions available', () => {
    expect(PLUGIN_CAPABILITIES).toEqual(
      expect.arrayContaining([
        'source.graph',
        'source.events',
        'ui.command',
        'ui.toolbarAction',
        'ui.settings',
      ]),
    );
    expect(PLUGIN_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'filesystem.read',
        'filesystem.write',
        'process.exec',
        'secrets.read',
      ]),
    );
  });

  it('accepts the v1 data-oriented manifest surface', () => {
    expect(
      validatePluginManifest({
        id: 'contract.v1',
        name: 'Contract V1',
        version: '1.0.0',
        dockscopeApiVersion: '1',
        entry: './plugin.mjs',
        capabilities: ['source.graph', 'source.events', 'ui.command', 'ui.toolbarAction'],
        permissions: ['secrets.read'],
        secrets: [{ key: 'token', label: 'Token' }],
        commands: [{ id: 'migrate', title: 'Migrate' }],
        execution: {
          isolation: 'process',
          commandTimeoutMs: 5000,
          maxStderrBytes: 32_000,
          memoryLimitMb: 128,
        },
        ui: [
          {
            id: 'run',
            slot: 'toolbar',
            title: 'Run',
            action: { type: 'run_command', commandId: 'migrate' },
          },
        ],
        compatibility: {
          minDockscopeVersion: '0.7.1',
          migrations: [{ from: '0.x', to: '1.x', commandId: 'migrate' }],
        },
      }),
    ).toMatchObject({
      id: 'contract.v1',
      dockscopeApiVersion: '1',
      execution: {
        isolation: 'process',
        commandTimeoutMs: 5000,
        maxStderrBytes: 32_000,
        memoryLimitMb: 128,
      },
    });
  });
});
