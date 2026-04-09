import { describe, it, expect, vi, beforeEach } from 'vitest';

const capture = vi.hoisted(() => {
  return { opts: undefined as any };
});

vi.mock('dockerode', () => {
  return {
    default: class FakeDockerode {
      constructor(opts?: any) {
        capture.opts = opts;
      }
      ping() {
        return Promise.resolve();
      }
    },
  };
});

import { initDockerClient } from '../client';

beforeEach(() => {
  capture.opts = undefined;
});

describe('parseDockerHost (via initDockerClient)', () => {
  it('parses tcp:// with explicit port', () => {
    initDockerClient('tcp://192.168.1.10:2375');
    expect(capture.opts).toEqual({ host: '192.168.1.10', port: 2375, protocol: 'http' });
  });

  it('defaults tcp:// port to 2375', () => {
    initDockerClient('tcp://myhost');
    expect(capture.opts).toEqual({ host: 'myhost', port: 2375, protocol: 'http' });
  });

  it('parses http:// same as tcp://', () => {
    initDockerClient('http://docker-host:2375');
    expect(capture.opts).toEqual({ host: 'docker-host', port: 2375, protocol: 'http' });
  });

  it('parses https:// with explicit port', () => {
    initDockerClient('https://secure-host:2376');
    expect(capture.opts).toEqual({ host: 'secure-host', port: 2376, protocol: 'https' });
  });

  it('defaults https:// port to 2376', () => {
    initDockerClient('https://secure-host');
    expect(capture.opts).toEqual({ host: 'secure-host', port: 2376, protocol: 'https' });
  });

  it('parses ssh:// URL', () => {
    initDockerClient('ssh://user@remote-host');
    expect(capture.opts).toEqual({ host: 'ssh://user@remote-host', protocol: 'ssh' });
  });

  it('parses unix:// socket path', () => {
    initDockerClient('unix:///var/run/docker.sock');
    expect(capture.opts).toEqual({ socketPath: '/var/run/docker.sock' });
  });

  it('throws on unsupported protocol', () => {
    expect(() => initDockerClient('ftp://host:21')).toThrow('Unsupported Docker host protocol');
  });

  it('creates default client when no host is provided', () => {
    initDockerClient();
    expect(capture.opts).toBeUndefined();
  });
});
