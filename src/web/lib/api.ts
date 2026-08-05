export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.body === 'object' && error.body !== null) {
      const body = error.body as { error?: unknown; message?: unknown };
      if (typeof body.error === 'string') {
        return body.error;
      }
      if (typeof body.message === 'string') {
        return body.message;
      }
    }
    return error.message;
  }
  return error instanceof Error ? error.message : '';
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => null);
}

/**
 * Notified whenever the server rejects us as unauthenticated.
 *
 * A hook rather than a direct call into the auth store, which imports this
 * module: the dependency has to point one way.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  if (response.status === 401) {
    onUnauthorized?.();
  }

  const body = await parseResponseBody(response);
  const detail =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : response.statusText || 'Request failed';
  throw new ApiError(detail, response.status, body);
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  await assertOk(response);
  return (await response.json()) as T;
}

export function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return requestJson<T>(url, { ...init, method: init.method || 'GET' });
}

export function postJson<T>(url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const request: RequestInit = { ...init, method: 'POST', headers };
  if (body !== undefined) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
    request.body = JSON.stringify(body);
  }
  return requestJson<T>(url, request);
}

export function deleteJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return requestJson<T>(url, { ...init, method: 'DELETE' });
}
