import type { ErrorCategory } from './errors.js';

const statuses: Record<ErrorCategory, number> = {
  validation: 400,
  unauthenticated: 401,
  permission: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
  upstream: 502,
  unavailable: 503,
  timeout: 504,
};

export function errorHttpStatus(category: ErrorCategory): number {
  return statuses[category];
}

/** Compatibility with the existing PluginOperationError(status, message) constructor. */
export function errorCategoryFromStatus(status: number): ErrorCategory {
  return (
    (Object.entries(statuses).find(([, value]) => value === status)?.[0] as
      | ErrorCategory
      | undefined) ?? 'internal'
  );
}
