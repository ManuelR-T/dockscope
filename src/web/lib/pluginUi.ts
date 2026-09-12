import type {
  PluginUiActionResult,
  PluginUiContent,
  PluginUiContext,
  PluginUiExtension,
} from '../../core/plugin-contract/ui';
import { requestJson } from './api';

const bundleCache = new Map<string, Promise<string>>();

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

export function queryPluginUi(
  extension: PluginUiExtension,
  context: PluginUiContext,
  signal?: AbortSignal,
): Promise<PluginUiContent> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', cancel, { once: true });
  }
  const timer = setTimeout(cancel, 15_000);
  const params = new URLSearchParams();
  if (context.node) {
    params.set('nodeId', context.node.id);
  }
  return requestJson<PluginUiContent>(
    `/api/plugins/${encodeURIComponent(extension.pluginId)}/ui/${encodeURIComponent(extension.id)}/query?${params}`,
    { signal: controller.signal },
  ).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  });
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
