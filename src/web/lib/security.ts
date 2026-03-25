const SENSITIVE_KEYS = /password|secret|token|key|api_key|apikey|auth|credential/i;

export function maskValue(envLine: string, showSecrets: boolean): string {
  const eqIdx = envLine.indexOf('=');
  if (eqIdx === -1) return envLine;
  const key = envLine.substring(0, eqIdx);
  const value = envLine.substring(eqIdx + 1);
  if (SENSITIVE_KEYS.test(key) && !showSecrets) {
    return `${key}=${'*'.repeat(Math.min(value.length, 16))}`;
  }
  return envLine;
}
