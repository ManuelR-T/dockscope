export const ERROR_CATEGORIES = [
  'validation',
  'unauthenticated',
  'permission',
  'not_found',
  'conflict',
  'internal',
  'upstream',
  'unavailable',
  'timeout',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
const categories = new Set<string>(ERROR_CATEGORIES);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
// Official/third-party bundles may contain another copy of the SDK class.
const ERROR_BRAND = Symbol.for('dockscope.error.v1');

export function isErrorCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

export interface DockscopeErrorOptions extends ErrorOptions {
  code: string;
  category: ErrorCategory;
}

/** Non-internal messages must be safe to display. Keep private details in cause. */
export class DockscopeError extends Error {
  readonly [ERROR_BRAND] = true;
  readonly code: string;
  readonly category: ErrorCategory;

  constructor(message: string, options: DockscopeErrorOptions) {
    super(message, { cause: options.cause });
    if (!isErrorCode(options.code) || !categories.has(options.category)) {
      throw new TypeError('Invalid DockScope error classification');
    }
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;
  }
}

/** Recognize SDK instances, not arbitrary objects with a status or code field. */
export function isDockscopeError(error: unknown): error is DockscopeError {
  return (
    error instanceof Error &&
    typeof error.message === 'string' &&
    ERROR_BRAND in error &&
    error[ERROR_BRAND] === true &&
    'code' in error &&
    isErrorCode(error.code) &&
    'category' in error &&
    typeof error.category === 'string' &&
    categories.has(error.category)
  );
}

export interface SerializedDockscopeError {
  version: 1;
  name: string;
  message: string;
  code: string;
  category: ErrorCategory;
}

/** Private IPC envelope, not an HTTP response. Never serialize causes or arbitrary properties. */
export function serializeError(error: unknown): SerializedDockscopeError {
  const classified = isDockscopeError(error);
  return {
    version: 1,
    name: (error instanceof Error && typeof error.name === 'string' ? error.name : 'Error').slice(
      0,
      128,
    ),
    message: (error instanceof Error && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error'
    ).slice(0, 4096),
    code: classified ? error.code : 'INTERNAL_ERROR',
    category: classified ? error.category : 'internal',
  };
}

/** Untrusted worker input. Invalid or older envelopes become unclassified internal failures. */
export function deserializeError(raw: unknown, legacyMessage?: unknown): DockscopeError {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    if (
      value.version === 1 &&
      typeof value.name === 'string' &&
      value.name.length <= 128 &&
      typeof value.message === 'string' &&
      value.message.length <= 4096 &&
      isErrorCode(value.code) &&
      typeof value.category === 'string' &&
      categories.has(value.category)
    ) {
      const error = new DockscopeError(value.message, {
        code: value.code,
        category: value.category as ErrorCategory,
      });
      error.name = value.name;
      return error;
    }
  }
  return new DockscopeError(
    typeof legacyMessage === 'string'
      ? legacyMessage.slice(0, 4096)
      : 'Invalid plugin error response',
    { code: 'INTERNAL_ERROR', category: 'internal' },
  );
}
