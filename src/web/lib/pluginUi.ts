import type {
  PluginUiActionResult,
  PluginUiContext,
  PluginUiExtension,
} from '../../core/plugin-ui';
import type { ServiceNode } from '../../types';
import { requestJson } from './api';

const bundleCache = new Map<string, Promise<string>>();

export function pluginUiContextFromNode(node: ServiceNode | null): PluginUiContext {
  if (!node) {
    return {};
  }
  return {
    node: {
      id: node.id,
      name: node.name,
      sourceId: node.host,
      entityId: node.containerId,
      runtime: node.runtime ?? 'docker',
      kind: node.kind ?? 'container',
      namespace: node.namespace,
      status: node.status,
      project: node.project,
      host: node.host,
    },
  };
}

export function invokePluginUiAction(
  extension: PluginUiExtension,
  context: PluginUiContext,
  input?: unknown,
): Promise<PluginUiActionResult> {
  return requestJson<PluginUiActionResult>(
    `/api/plugins/${encodeURIComponent(extension.pluginId)}/ui/${encodeURIComponent(extension.id)}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, input }),
    },
  );
}

export function loadPluginFrontendSource(pluginId: string): Promise<string> {
  const cached = bundleCache.get(pluginId);
  if (cached) {
    return cached;
  }
  const request = fetch(`/api/plugins/${encodeURIComponent(pluginId)}/frontend`).then(
    async (response) => {
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Plugin frontend failed with HTTP ${response.status}`);
      }
      return response.text();
    },
  );
  bundleCache.set(pluginId, request);
  void request.catch(() => bundleCache.delete(pluginId));
  return request;
}

export function clearPluginFrontendCache(pluginId?: string): void {
  if (pluginId) {
    bundleCache.delete(pluginId);
  } else {
    bundleCache.clear();
  }
}
