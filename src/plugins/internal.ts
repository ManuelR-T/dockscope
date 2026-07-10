import { PluginRegistry } from '../core/plugins.js';
import { createComposePlugin } from '../docker/composePlugin.js';
import { createDockerPlugin } from '../docker/plugin.js';
import { createPluginApprovalStoreFromEnv } from './approvalStore.js';
import { createPluginConfigStoreFromEnv } from './configStore.js';
import { createPluginEventStoreFromEnv } from './eventStore.js';
import { loadExternalPluginsFromEnv } from './loader.js';
import { createPluginSecretStoreFromEnv } from './secretStore.js';
import { createPluginStateStoreFromEnv } from './stateStore.js';

export function createInternalPluginRegistry(registry = new PluginRegistry()): PluginRegistry {
  registry.register(createDockerPlugin());
  registry.register(createComposePlugin());
  return registry;
}

export async function createPluginRegistry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PluginRegistry> {
  const configStore = createPluginConfigStoreFromEnv(env);
  const stateStore = createPluginStateStoreFromEnv(env);
  const secretStore = createPluginSecretStoreFromEnv(env);
  const eventStore = createPluginEventStoreFromEnv(env);
  const approvalStore = createPluginApprovalStoreFromEnv(env);
  const registry = createInternalPluginRegistry(
    new PluginRegistry(
      configStore,
      stateStore,
      secretStore,
      eventStore,
      await eventStore.load(),
      approvalStore,
      await approvalStore.load(),
    ),
  );
  const external = await loadExternalPluginsFromEnv(env, {
    getConfig: (manifest) => configStore.load(manifest.id, manifest.config),
    secretStore,
    publishEvent: (pluginId, type, payload) => registry.publishPluginEvent(pluginId, type, payload),
  });
  for (const error of external.errors) {
    registry.recordLoadError(error);
  }
  for (const plugin of external.plugins) {
    try {
      registry.register(plugin, external.configs.get(plugin.manifest.id), {
        enabled: await stateStore.loadEnabled(plugin.manifest.id),
      });
    } catch (error) {
      registry.recordLoadError({
        id: plugin.manifest.id,
        phase: 'register',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  registry.setReloadHandler(async (pluginId) => {
    const reloaded = await loadExternalPluginsFromEnv(env, {
      getConfig: (manifest) => configStore.load(manifest.id, manifest.config),
      secretStore,
      publishEvent: (reloadedPluginId, type, payload) =>
        registry.publishPluginEvent(reloadedPluginId, type, payload),
      cacheBust: true,
    });
    for (const error of reloaded.errors) {
      registry.recordLoadError(error);
    }
    const plugin = reloaded.plugins.find((candidate) => candidate.manifest.id === pluginId);
    if (!plugin) {
      throw new Error(`Plugin could not be reloaded: ${pluginId}`);
    }
    return {
      plugin,
      config: reloaded.configs.get(pluginId),
    };
  });
  return registry;
}
