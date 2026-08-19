import type { PluginUiAction } from './plugin-contract/ui.js';

export type AccessRole = 'reader' | 'operator';
export type UiIntent = 'observe' | 'mutation' | 'exec' | 'plugin-command';

export interface ApiRequestAccess {
  method: string;
  /** Path relative to the `/api` mount point. */
  path: string;
  /** Resolved declaration for the conditional plugin UI action route. */
  pluginUiAction?: PluginUiAction;
}

const READER_SAFE_POST_PATHS = new Set(['/compare', '/kubernetes/logs']);
const READER_SAFE_READ_PATHS = [
  /^\/(?:graph|health|systems|system|version|sources|hosts|features|projects)$/,
  /^\/connections(?:\/providers)?$/,
  /^\/containers\/[^/]+\/(?:logs|stats|top|diff|inspect|history|diagnostic)$/,
  /^\/entities\/[^/]+\/(?:actions|operations|logs|stats|inspect|top|diff|history|diagnostic)$/,
  /^\/plugins(?:\/(?:errors|warnings|health|ui|commands|events|compatibility|review|catalog|approvals|marketplace|catalogs|config|secrets))?$/,
  /^\/plugins\/[^/]+\/(?:frontend|config)$/,
];

export function pluginUiActionRef(
  path: string,
): { pluginId: string; extensionId: string } | undefined {
  const match = /^\/plugins\/([^/]+)\/ui\/([^/]+)\/action$/.exec(path);
  if (!match) {
    return undefined;
  }
  try {
    return { pluginId: decodeURIComponent(match[1]), extensionId: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

export function pluginUiActionAllowed(
  role: AccessRole | null | undefined,
  action: PluginUiAction | undefined,
): boolean {
  return role === 'operator' || (role === 'reader' && action?.type === 'open_url');
}

/** Whether a plugin-owned surface is safe to present at all for this role. */
export function pluginUiExtensionAllowed(
  role: AccessRole | null | undefined,
  action: PluginUiAction | undefined,
): boolean {
  return role === 'operator' || (role === 'reader' && action?.type !== 'run_command');
}

/**
 * Authorize by operation semantics. Unknown operations deliberately fail
 * closed for readers so a newly added endpoint cannot silently become a
 * mutation or data-exposure escape hatch.
 */
export function apiRequestAllowed(
  role: AccessRole | null | undefined,
  request: ApiRequestAccess,
): boolean {
  if (!role) {
    return false;
  }
  if (role === 'operator') {
    return true;
  }

  const method = request.method.toUpperCase();
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path;
  if (
    (method === 'GET' || method === 'HEAD') &&
    READER_SAFE_READ_PATHS.some((pattern) => pattern.test(path))
  ) {
    return true;
  }
  if (method === 'POST' && READER_SAFE_POST_PATHS.has(path)) {
    return true;
  }
  if (method === 'POST' && pluginUiActionRef(path)) {
    return pluginUiActionAllowed(role, request.pluginUiAction);
  }
  return false;
}

export function allowsUiIntent(role: AccessRole | null | undefined, intent: UiIntent): boolean {
  return role === 'operator' || (role === 'reader' && intent === 'observe');
}
