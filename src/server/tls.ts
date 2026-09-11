import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerOptions } from '../types.js';

export interface TlsPathOptions {
  certificatePath?: string;
  privateKeyPath?: string;
}

export type ServerSchemes =
  | { protocol: 'http'; websocketProtocol: 'ws' }
  | { protocol: 'https'; websocketProtocol: 'wss' };

export type ResolvedServerTransport =
  | { protocol: 'http'; websocketProtocol: 'ws' }
  | {
      protocol: 'https';
      websocketProtocol: 'wss';
      tls: NonNullable<ServerOptions['tls']>;
    };

export function serverUrls(
  port: number,
  schemes: ServerSchemes,
): {
  dashboard: string;
  api: string;
  websocket: string;
} {
  const dashboard = `${schemes.protocol}://localhost:${port}`;
  return {
    dashboard,
    api: `${dashboard}/api/graph`,
    websocket: `${schemes.websocketProtocol}://localhost:${port}/ws`,
  };
}

async function readTlsFile(kind: 'certificate' | 'private key', filePath: string): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  try {
    return await readFile(resolvedPath, 'utf8');
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    throw new Error(`Unable to read TLS ${kind} file "${resolvedPath}"${detail}`, { cause });
  }
}

export async function resolveServerTransport(
  options: TlsPathOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedServerTransport> {
  const certificatePath =
    options.certificatePath !== undefined
      ? options.certificatePath.trim()
      : (env.DOCKSCOPE_TLS_CERT ?? '').trim();
  const privateKeyPath =
    options.privateKeyPath !== undefined
      ? options.privateKeyPath.trim()
      : (env.DOCKSCOPE_TLS_KEY ?? '').trim();

  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
    throw new Error(
      'TLS requires both a certificate and a private key; configure --tls-cert/DOCKSCOPE_TLS_CERT together with --tls-key/DOCKSCOPE_TLS_KEY',
    );
  }

  if (certificatePath && privateKeyPath) {
    const [certificate, privateKey] = await Promise.all([
      readTlsFile('certificate', certificatePath),
      readTlsFile('private key', privateKeyPath),
    ]);
    return {
      protocol: 'https',
      websocketProtocol: 'wss',
      tls: { certificate, privateKey },
    };
  }
  return { protocol: 'http', websocketProtocol: 'ws' };
}
