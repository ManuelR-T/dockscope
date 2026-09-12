import { pluginUiActionAllowed, type AccessRole } from '../access.js';
import {
  hydratePluginCommand,
  validatePluginCommandResult,
  validatePluginCommands,
  type PluginCommand,
  type PluginCommandDeclaration,
  type PluginCommandResult,
} from './commands.js';
import { type PluginEvent } from './events.js';
import {
  DockscopePlugin,
  PluginOperationError,
  isRecord,
  requireManifestCapabilities,
} from './manifest.js';
import {
  hydratePluginUiExtension,
  pluginUiContextMatches,
  pluginUiSlotCapability,
  validatePluginUiContent,
  validatePluginUiContext,
  validatePluginUiExtensions,
  type PluginUiActionResult,
  type PluginUiContent,
  type PluginUiContext,
  type PluginUiExtension,
} from './ui.js';

interface PluginAccess {
  activePlugins(): DockscopePlugin[];
  requireEnabledPlugin(id: string): DockscopePlugin;
  getPlugin(id: string): DockscopePlugin | undefined;
  publishEvent(pluginId: string, type: string, payload: unknown): PluginEvent;
}

/** Internal command and UI execution over the registry's live plugin set. */
export class RegistryInteractions {
  constructor(private readonly access: PluginAccess) {}

  listUiExtensions(): PluginUiExtension[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => {
        try {
          const manifestExtensions = plugin.manifest.ui ?? [];
          const runtimeExtensions = validatePluginUiExtensions(plugin.getUiExtensions?.() ?? []);
          const extensions = [...manifestExtensions, ...runtimeExtensions];
          for (const extension of extensions) {
            requireManifestCapabilities(
              plugin.manifest,
              [
                pluginUiSlotCapability(extension.slot),
                ...(extension.query ? ['ui.query' as const] : []),
              ],
              `declares UI extension "${extension.id}"`,
            );
          }
          return extensions.map((extension) =>
            hydratePluginUiExtension(plugin.manifest.id, extension),
          );
        } catch {
          return [];
        }
      })
      .sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          a.pluginId.localeCompare(b.pluginId) ||
          a.title.localeCompare(b.title),
      );
  }

  async queryPluginUi(
    pluginId: string,
    extensionId: string,
    rawContext?: unknown,
  ): Promise<PluginUiContent> {
    const extension = this.listUiExtensions().find(
      (item) => item.pluginId === pluginId && item.id === extensionId,
    );
    const plugin = this.access.getPlugin(pluginId);
    if (!extension?.query || !plugin?.queryUi) {
      throw new PluginOperationError(404, `Plugin UI query not found: ${pluginId}/${extensionId}`);
    }
    const context = validatePluginUiContext(rawContext);
    if (!pluginUiContextMatches(extension, context)) {
      throw new PluginOperationError(400, 'Plugin UI query does not match the current context');
    }
    const content = validatePluginUiContent(
      await plugin.queryUi(extensionId, context),
      extensionId,
    );
    if (!content) {
      throw new PluginOperationError(502, 'Plugin UI query returned no content');
    }
    return content;
  }

  async getPluginFrontendBundle(pluginId: string): Promise<string> {
    const plugin = this.access.requireEnabledPlugin(pluginId);
    if (!plugin.manifest.frontend || !plugin.getFrontendBundle) {
      throw new PluginOperationError(404, `Plugin frontend not found: ${pluginId}`);
    }
    return plugin.getFrontendBundle();
  }

  async runPluginUiAction(
    pluginId: string,
    extensionId: string,
    payload: { context?: unknown; input?: unknown } = {},
    options: { accessRole?: AccessRole } = {},
  ): Promise<PluginUiActionResult> {
    const extension = this.listUiExtensions().find(
      (candidate) => candidate.pluginId === pluginId && candidate.id === extensionId,
    );
    if (!extension) {
      throw new PluginOperationError(
        404,
        `Plugin UI extension not found: ${pluginId}/${extensionId}`,
      );
    }
    if (!extension.action) {
      throw new PluginOperationError(
        400,
        `Plugin UI extension has no action: ${pluginId}/${extensionId}`,
      );
    }
    if (!pluginUiActionAllowed(options.accessRole ?? 'operator', extension.action)) {
      throw new PluginOperationError(403, 'Operator access required');
    }
    const context: PluginUiContext = validatePluginUiContext(payload.context);
    if (!pluginUiContextMatches(extension, context)) {
      throw new PluginOperationError(400, `Plugin UI extension does not match the current context`);
    }
    if (extension.action.type === 'open_url') {
      return { type: 'open_url', url: extension.action.url };
    }
    const targetPluginId = extension.action.pluginId ?? pluginId;
    if (targetPluginId !== pluginId) {
      throw new PluginOperationError(400, 'Plugin UI actions cannot invoke another plugin');
    }
    const declaredInput = extension.action.input;
    const requestedInput = payload.input;
    const input =
      isRecord(declaredInput) && isRecord(requestedInput)
        ? { ...declaredInput, ...requestedInput }
        : (requestedInput ?? declaredInput);
    const commandInput = extension.action.passContext
      ? {
          input,
          context,
          ui: { extensionId: extension.id, slot: extension.slot },
        }
      : input;
    return {
      type: 'command',
      result: await this.runPluginCommand(pluginId, extension.action.commandId, commandInput),
    };
  }

  listPluginCommands(): PluginCommand[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => pluginCommands(plugin))
      .sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      );
  }

  async runPluginCommand(
    pluginId: string,
    commandId: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    const plugin = this.access.requireEnabledPlugin(pluginId);
    if (!plugin.runCommand) {
      throw new PluginOperationError(400, `Plugin does not implement commands: ${pluginId}`);
    }
    const command = pluginCommands(plugin).find((candidate) => candidate.id === commandId);
    if (!command) {
      throw new PluginOperationError(404, `Plugin command not found: ${pluginId}/${commandId}`);
    }
    try {
      const result = validatePluginCommandResult(await plugin.runCommand(commandId, input));
      this.access.publishEvent(pluginId, 'command.completed', {
        commandId,
        ok: result.ok,
        message: result.message,
      });
      return result;
    } catch (error) {
      this.access.publishEvent(pluginId, 'command.failed', {
        commandId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async runPluginMigration(
    pluginId: string,
    from: string,
    to: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    const plugin = this.access.getPlugin(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    const migration = plugin.manifest.compatibility?.migrations?.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (!migration) {
      throw new PluginOperationError(404, `Plugin migration not found: ${pluginId} ${from}->${to}`);
    }
    if (!migration.commandId) {
      throw new PluginOperationError(
        400,
        `Plugin migration does not declare a commandId: ${pluginId} ${from}->${to}`,
      );
    }
    return this.runPluginCommand(pluginId, migration.commandId, {
      migration: { from, to },
      input,
    });
  }
}

export function pluginCommands(plugin: DockscopePlugin): PluginCommand[] {
  try {
    const commands = [
      ...(plugin.manifest.commands ?? []),
      ...validatePluginCommands(plugin.getCommands?.() ?? []),
    ];
    requireManifestCapabilities(plugin.manifest, ['ui.command'], 'declares commands');
    const unique = new Map<string, PluginCommandDeclaration>();
    for (const command of commands) {
      unique.set(command.id, command);
    }
    return [...unique.values()].map((command) => hydratePluginCommand(plugin.manifest.id, command));
  } catch {
    return [];
  }
}
