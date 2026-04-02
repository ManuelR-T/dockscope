import { describe, it, expect, afterAll } from 'vitest';
import { parseComposeFile } from '../compose';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = join(tmpdir(), 'dockscope-test-' + Date.now());

function writeTmp(name: string, content: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true });
  } catch {
    /* ignore */
  }
});

describe('parseComposeFile', () => {
  it('parses basic services', async () => {
    const path = writeTmp(
      'basic.yml',
      `
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
  db:
    image: postgres:16
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe('web');
    expect(result.services[0].image).toBe('nginx:latest');
    expect(result.services[0].ports).toEqual(['8080:80']);
    expect(result.services[1].name).toBe('db');
    expect(result.services[1].image).toBe('postgres:16');
  });

  it('parses depends_on array form', async () => {
    const path = writeTmp(
      'deps-array.yml',
      `
services:
  web:
    image: nginx
    depends_on:
      - db
      - redis
  db:
    image: postgres
  redis:
    image: redis
`,
    );
    const result = await parseComposeFile(path);
    const web = result.services.find((s) => s.name === 'web')!;
    expect(web.dependsOn).toEqual(['db', 'redis']);
  });

  it('parses depends_on extended form', async () => {
    const path = writeTmp(
      'deps-extended.yml',
      `
services:
  web:
    image: nginx
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
  db:
    image: postgres
  redis:
    image: redis
`,
    );
    const result = await parseComposeFile(path);
    const web = result.services.find((s) => s.name === 'web')!;
    expect(web.dependsOn).toEqual(['db', 'redis']);
  });

  it('parses networks', async () => {
    const path = writeTmp(
      'networks.yml',
      `
services:
  web:
    image: nginx
    networks:
      - frontend
      - backend
networks:
  frontend:
  backend:
`,
    );
    const result = await parseComposeFile(path);
    const web = result.services.find((s) => s.name === 'web')!;
    expect(web.networks).toEqual(['frontend', 'backend']);
    expect(result.networks).toEqual(['frontend', 'backend']);
  });

  it('parses environment as array', async () => {
    const path = writeTmp(
      'env-array.yml',
      `
services:
  app:
    image: node
    environment:
      - NODE_ENV=production
      - PORT=3000
`,
    );
    const result = await parseComposeFile(path);
    const app = result.services[0];
    expect(app.environment).toEqual({ NODE_ENV: 'production', PORT: '3000' });
  });

  it('parses environment as object', async () => {
    const path = writeTmp(
      'env-obj.yml',
      `
services:
  app:
    image: node
    environment:
      NODE_ENV: production
      PORT: 3000
`,
    );
    const result = await parseComposeFile(path);
    const app = result.services[0];
    expect(app.environment).toEqual({ NODE_ENV: 'production', PORT: '3000' });
  });

  it('parses labels as array', async () => {
    const path = writeTmp(
      'labels-array.yml',
      `
services:
  app:
    image: node
    labels:
      - com.example.desc=my app
      - com.example.env=prod
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services[0].labels).toEqual({
      'com.example.desc': 'my app',
      'com.example.env': 'prod',
    });
  });

  it('parses healthcheck', async () => {
    const path = writeTmp(
      'healthcheck.yml',
      `
services:
  db:
    image: postgres
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 3
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services[0].healthcheck).toEqual({
      test: 'CMD pg_isready',
      interval: '10s',
      timeout: '5s',
      retries: 3,
    });
  });

  it('parses resource limits', async () => {
    const path = writeTmp(
      'resources.yml',
      `
services:
  app:
    image: node
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services[0].resourceLimits).toEqual({
      cpus: '0.5',
      memory: '512M',
    });
  });

  it('handles empty services', async () => {
    const path = writeTmp(
      'empty.yml',
      `
version: "3"
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services).toEqual([]);
  });

  it('defaults image to name:latest when not specified', async () => {
    const path = writeTmp(
      'no-image.yml',
      `
services:
  myapp:
    build: .
`,
    );
    const result = await parseComposeFile(path);
    expect(result.services[0].image).toBe('myapp:latest');
  });
});
