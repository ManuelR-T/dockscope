import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('../cli.ts', import.meta.url));
const certificatePath = fileURLToPath(
  new URL('../server/__tests__/fixtures/localhost-cert.pem', import.meta.url),
);
const privateKeyPath = fileURLToPath(
  new URL('../server/__tests__/fixtures/localhost-key.pem', import.meta.url),
);
const trustedCertificate = readFileSync(certificatePath, 'utf8');

function httpsAuthStatus(port: number): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/auth',
        ca: trustedCertificate,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.once('error', reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error('Timed out waiting for the HTTPS auth status response'));
    });
    request.end();
  });
}

function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  if (await waitForChildExit(child, 3_000)) {
    return;
  }
  child.kill('SIGKILL');
  if (!(await waitForChildExit(child, 3_000))) {
    throw new Error('DockScope CLI child did not exit after SIGKILL');
  }
}

describe('dockscope up', () => {
  it('advertises direct TLS certificate and private-key options', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'up', '--help'],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain('--tls-cert <file>');
    expect(stdout).toContain('--tls-key <file>');
  });

  it('fails clearly before listening when only one TLS path is configured', async () => {
    let failure: unknown;
    try {
      await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          cliPath,
          'up',
          '--tls-cert',
          certificatePath,
          '--no-open',
          '--no-port-check',
          '--port',
          '0',
          '--no-external-plugins',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DOCKSCOPE_AUTH_FILE: path.join(tmpdir(), `dockscope-cli-auth-${randomUUID()}.json`),
            DOCKSCOPE_TLS_CERT: '',
            DOCKSCOPE_TLS_KEY: '',
          },
          timeout: 10_000,
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('TLS requires both a certificate and a private key'),
    });
  });

  it('starts the real CLI on HTTPS and reports matching secure URLs', async () => {
    const testId = randomUUID();
    const stateDir = path.join(tmpdir(), `dockscope-cli-state-${testId}`);
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        cliPath,
        'up',
        '--tls-cert',
        certificatePath,
        '--tls-key',
        privateKeyPath,
        '--no-open',
        '--no-port-check',
        '--port',
        '0',
        '--no-external-plugins',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DOCKER_HOST: `unix://${path.join(tmpdir(), `dockscope-cli-docker-${testId}.sock`)}`,
          DOCKSCOPE_ALLOWED_ORIGINS: '',
          DOCKSCOPE_AUTH_FILE: path.join(stateDir, 'auth.json'),
          DOCKSCOPE_AUTH_PROXY_HEADER: '',
          DOCKSCOPE_BIND: '127.0.0.1',
          DOCKSCOPE_DEV: '',
          DOCKSCOPE_NO_COMPOSE: '1',
          DOCKSCOPE_READ_ONLY_TOKEN: '',
          DOCKSCOPE_STATE_DIR: stateDir,
          DOCKSCOPE_TLS_CERT: '',
          DOCKSCOPE_TLS_KEY: '',
          DOCKSCOPE_TOKEN: '',
          DOCKSCOPE_TRUSTED_PROXIES: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.stdout.off('data', inspectOutput);
          child.off('error', onError);
          child.off('exit', onExit);
          reject(new Error(`Timed out waiting for HTTPS startup. stderr: ${stderr}`));
        }, 10_000);
        const inspectOutput = () => {
          const match = stdout.match(/Dashboard: https:\/\/localhost:(\d+)/);
          if (match?.[1] && stdout.includes(`WebSocket: wss://localhost:${match[1]}/ws`)) {
            clearTimeout(timeout);
            child.stdout.off('data', inspectOutput);
            child.off('error', onError);
            child.off('exit', onExit);
            resolve(Number(match[1]));
          }
        };
        const onError = (error: Error) => {
          clearTimeout(timeout);
          child.stdout.off('data', inspectOutput);
          child.off('exit', onExit);
          reject(error);
        };
        const onExit = (code: number | null) => {
          clearTimeout(timeout);
          child.stdout.off('data', inspectOutput);
          child.off('error', onError);
          reject(new Error(`CLI exited before HTTPS startup (${code}). stderr: ${stderr}`));
        };
        child.stdout.on('data', inspectOutput);
        child.once('error', onError);
        child.once('exit', onExit);
      });

      const authStatus = await httpsAuthStatus(port);

      expect(authStatus.statusCode).toBe(200);
      expect(JSON.parse(authStatus.body)).toMatchObject({
        authenticated: true,
        required: false,
      });
      expect(stdout).toContain(`API:       https://localhost:${port}/api/graph`);
      expect(stdout).toContain(`WebSocket: wss://localhost:${port}/ws`);
    } finally {
      await stopChild(child);
    }
  }, 25_000);
});
