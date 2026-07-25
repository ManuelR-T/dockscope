// Reserved plugin id namespace.
//
// Manifest ids are otherwise unconstrained beyond their character pattern, so
// nothing stops a third party from publishing `official.something` and having
// it presented to users as a first-party DockScope plugin. The catalog and
// package signing machinery already protects the distribution channel; this
// protects the name itself by requiring that anything claiming the reserved
// namespace arrived through a verified package signature.

export const RESERVED_PLUGIN_NAMESPACE = 'official.';

/** Escape hatch for first-party development against unsigned local sources. */
export const RESERVED_NAMESPACE_OVERRIDE_ENV = 'DOCKSCOPE_ALLOW_RESERVED_PLUGIN_NAMESPACE';

export function isReservedPluginId(id: string): boolean {
  return id.trim().toLowerCase().startsWith(RESERVED_PLUGIN_NAMESPACE);
}

export function reservedNamespaceOverrideEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[RESERVED_NAMESPACE_OVERRIDE_ENV] === '1';
}

/**
 * Throws when a plugin claims the reserved namespace without a verified package
 * signature. Installs from a plain directory carry no signature at all, so they
 * are rejected unless the override is set.
 */
export function assertReservedPluginNamespace(params: {
  id: string;
  signatureVerified: boolean | undefined;
  env?: NodeJS.ProcessEnv;
}): void {
  const { id, signatureVerified, env = process.env } = params;
  if (!isReservedPluginId(id)) {
    return;
  }
  if (signatureVerified === true) {
    return;
  }
  if (reservedNamespaceOverrideEnabled(env)) {
    return;
  }
  const suffix = id.trim().slice(RESERVED_PLUGIN_NAMESPACE.length) || 'my-plugin';
  throw new Error(
    `Plugin id "${id}" uses the reserved "${RESERVED_PLUGIN_NAMESPACE}" namespace, ` +
      'which requires a verified package signature. Publish it under your own ' +
      `namespace instead (for example "acme.${suffix}"), or set ` +
      `${RESERVED_NAMESPACE_OVERRIDE_ENV}=1 for first-party development.`,
  );
}
