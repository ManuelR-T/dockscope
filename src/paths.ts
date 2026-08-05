import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Where DockScope keeps state that has to outlive the process: the access
 * token, plugin configuration, approvals, secrets and installed plugins.
 *
 * `DOCKSCOPE_STATE_DIR` exists for containers. The default sits under the home
 * directory, which in an image is part of the writable layer and is discarded
 * with the container, so the published image points this at a declared volume.
 * Every store resolves through here: when only some of them did, mounting the
 * volume saved the token and silently lost the installed plugins.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DOCKSCOPE_STATE_DIR || path.join(homedir(), '.dockscope');
}

/** A file inside the state directory. */
export function statePath(env: NodeJS.ProcessEnv, ...segments: string[]): string {
  return path.join(stateDir(env), ...segments);
}
