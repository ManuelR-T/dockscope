import { apiErrorMessage, deleteJson, getJson, postJson } from '../lib/api';
import type { AccessRole } from '../../core/access';

export type SetupAvailability = 'available' | 'configured' | 'declined' | 'window-closed';

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  role?: AccessRole | null;
  managedByEnv?: boolean;
  /** An identity proxy already authenticated this request. */
  viaProxy?: boolean;
  setup?: SetupAvailability;
  minTokenLength?: number;
}

let required = $state(false);
let authenticated = $state(true);
let role = $state<AccessRole | null>(null);
let setup = $state<SetupAvailability>('declined');
let managedByEnv = $state(false);
let viaProxy = $state(false);
let minTokenLength = $state(16);
let resolved = $state(false);
let submitting = $state(false);
let error = $state('');

export function getAuthState() {
  return {
    /** Whether the server is configured with an access token at all. */
    get required() {
      return required;
    },
    get authenticated() {
      return authenticated;
    },
    get role() {
      return role;
    },
    /** Whether first-run setup can still be offered, and if not, why. */
    get setup() {
      return setup;
    },
    get managedByEnv() {
      return managedByEnv;
    },
    get viaProxy() {
      return viaProxy;
    },
    get minTokenLength() {
      return minTokenLength;
    },
    /** False until the first status check answers, so the UI can hold off. */
    get resolved() {
      return resolved;
    },
    get submitting() {
      return submitting;
    },
    get error() {
      return error;
    },
    get panelOpen() {
      return panelOpen;
    },
  };
}

/**
 * Dismissing the first-run screen is deliberately not persisted: it lasts for
 * this page load only. The permanent choice lives in the security panel, where
 * it can be undone.
 */
let dismissed = $state(false);

export function dismissSetup() {
  dismissed = true;
}

/**
 * Open state for the security panel, held here rather than in the status bar
 * so the panel can render at the top of the app. The status bar sets
 * `backdrop-filter`, which makes it a containing block for fixed-position
 * children, and an overlay rendered inside it is clipped to the event log.
 */
let panelOpen = $state(false);

export function openSecurityPanel() {
  clearAuthError();
  panelOpen = true;
}

export function closeSecurityPanel() {
  panelOpen = false;
}

/** The gate is shown either to claim an open instance or to unlock a closed one. */
export function gateMode(): 'setup' | 'login' | null {
  if (!resolved || viaProxy) {
    // A proxy already handled the login; asking for a second credential on top
    // of it would be nonsense.
    return null;
  }
  if (required) {
    return authenticated ? null : 'login';
  }
  return setup === 'available' && !dismissed ? 'setup' : null;
}

function apply(status: AuthStatus) {
  required = status.required;
  authenticated = status.authenticated;
  role = status.role ?? (status.authenticated ? 'operator' : null);
  setup = status.setup ?? 'declined';
  managedByEnv = status.managedByEnv ?? false;
  viaProxy = status.viaProxy ?? false;
  minTokenLength = status.minTokenLength ?? minTokenLength;
}

export async function checkAuth(): Promise<AuthStatus> {
  try {
    const status = await getJson<AuthStatus>('/api/auth');
    apply(status);
    return status;
  } catch {
    // An unreachable server is not an auth failure; let the normal connection
    // handling surface it rather than showing a prompt over a dead API.
    apply({ required: false, authenticated: true, role: 'operator', setup: 'declined' });
    return { required: false, authenticated: true, role: 'operator' };
  } finally {
    resolved = true;
  }
}

export async function submitToken(token: string): Promise<boolean> {
  submitting = true;
  error = '';
  try {
    apply(await postJson<AuthStatus>('/api/auth/session', { token }));
    authenticated = true;
    return true;
  } catch (caught) {
    error = apiErrorMessage(caught) || 'Could not verify that token';
    authenticated = false;
    role = null;
    return false;
  } finally {
    submitting = false;
  }
}

/** Claim an unconfigured instance by choosing its token. */
export async function createToken(token: string): Promise<boolean> {
  submitting = true;
  error = '';
  try {
    apply(await postJson<AuthStatus>('/api/auth/setup', { token }));
    // The server signs the setter in, so the page keeps working.
    authenticated = true;
    return true;
  } catch (caught) {
    error = apiErrorMessage(caught) || 'Could not set that token';
    return false;
  } finally {
    submitting = false;
  }
}

/** Remove the token, returning the instance to an open state. */
export async function clearToken(): Promise<boolean> {
  submitting = true;
  error = '';
  try {
    apply(await deleteJson<AuthStatus>('/api/auth/token'));
    dismissed = true;
    return true;
  } catch (caught) {
    error = apiErrorMessage(caught) || 'Could not remove the token';
    return false;
  } finally {
    submitting = false;
  }
}

/** Turn the first-run reminder on or off. The choice is reversible. */
export async function setReminderDeclined(declined: boolean): Promise<boolean> {
  submitting = true;
  error = '';
  try {
    apply(await postJson<AuthStatus>('/api/auth/reminder', { declined }));
    return true;
  } catch (caught) {
    error = apiErrorMessage(caught) || 'Could not save that choice';
    return false;
  } finally {
    submitting = false;
  }
}

export function clearAuthError() {
  error = '';
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/session', { method: 'DELETE' });
  } finally {
    authenticated = false;
    role = null;
  }
}
