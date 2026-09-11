import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveServerTransport, serverUrls } from '../tls';

const certificatePath = fileURLToPath(new URL('./fixtures/localhost-cert.pem', import.meta.url));
const privateKeyPath = fileURLToPath(new URL('./fixtures/localhost-key.pem', import.meta.url));

describe('resolveServerTransport', () => {
  it('keeps the existing HTTP transport when TLS is not configured', async () => {
    await expect(resolveServerTransport({}, {})).resolves.toEqual({
      protocol: 'http',
      websocketProtocol: 'ws',
    });
  });

  it('loads a configured certificate and private key for HTTPS', async () => {
    const transport = await resolveServerTransport({ certificatePath, privateKeyPath }, {});

    expect(transport).toMatchObject({
      protocol: 'https',
      websocketProtocol: 'wss',
      tls: {
        certificate: expect.stringContaining('BEGIN CERTIFICATE'),
        privateKey: expect.stringContaining('BEGIN PRIVATE KEY'),
      },
    });
  });

  it('loads TLS paths from the environment', async () => {
    const transport = await resolveServerTransport(
      {},
      {
        DOCKSCOPE_TLS_CERT: certificatePath,
        DOCKSCOPE_TLS_KEY: privateKeyPath,
      },
    );

    expect(transport).toMatchObject({
      protocol: 'https',
      websocketProtocol: 'wss',
      tls: {
        certificate: expect.stringContaining('BEGIN CERTIFICATE'),
        privateKey: expect.stringContaining('BEGIN PRIVATE KEY'),
      },
    });
  });

  it('rejects a certificate configured without a private key', async () => {
    await expect(resolveServerTransport({ certificatePath }, {})).rejects.toThrow(
      'TLS requires both a certificate and a private key',
    );
  });

  it('rejects a private key configured without a certificate', async () => {
    await expect(resolveServerTransport({ privateKeyPath }, {})).rejects.toThrow(
      'TLS requires both a certificate and a private key',
    );
  });

  it('lets each command option override its matching environment variable', async () => {
    const fromCertificateOption = await resolveServerTransport(
      { certificatePath },
      {
        DOCKSCOPE_TLS_CERT: '/not/the/certificate.pem',
        DOCKSCOPE_TLS_KEY: privateKeyPath,
      },
    );
    const fromPrivateKeyOption = await resolveServerTransport(
      { privateKeyPath },
      {
        DOCKSCOPE_TLS_CERT: certificatePath,
        DOCKSCOPE_TLS_KEY: '/not/the/private-key.pem',
      },
    );

    expect(fromCertificateOption.protocol).toBe('https');
    expect(fromPrivateKeyOption.protocol).toBe('https');
  });

  it('identifies an unreadable certificate without exposing its contents', async () => {
    const missingCertificate = path.join(
      tmpdir(),
      `dockscope-missing-certificate-${randomUUID()}.pem`,
    );

    await expect(
      resolveServerTransport({ certificatePath: missingCertificate, privateKeyPath }, {}),
    ).rejects.toThrow(`Unable to read TLS certificate file "${missingCertificate}"`);
  });

  it('identifies an unreadable private key', async () => {
    const missingPrivateKey = path.join(
      tmpdir(),
      `dockscope-missing-private-key-${randomUUID()}.pem`,
    );

    await expect(
      resolveServerTransport({ certificatePath, privateKeyPath: missingPrivateKey }, {}),
    ).rejects.toThrow(`Unable to read TLS private key file "${missingPrivateKey}"`);
  });
});

describe('serverUrls', () => {
  it('uses HTTPS and WSS together for a secure listener', () => {
    expect(serverUrls(4681, { protocol: 'https', websocketProtocol: 'wss' })).toEqual({
      dashboard: 'https://localhost:4681',
      api: 'https://localhost:4681/api/graph',
      websocket: 'wss://localhost:4681/ws',
    });
  });

  it('uses HTTP and WS together for the default listener', () => {
    expect(serverUrls(4681, { protocol: 'http', websocketProtocol: 'ws' })).toEqual({
      dashboard: 'http://localhost:4681',
      api: 'http://localhost:4681/api/graph',
      websocket: 'ws://localhost:4681/ws',
    });
  });
});
