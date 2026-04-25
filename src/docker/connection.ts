import Dockerode from 'dockerode';

let docker = new Dockerode();

/** Parse a DOCKER_HOST-style URL into Dockerode constructor options */
function parseDockerHost(host: string): Dockerode.DockerOptions {
  const url = new URL(host);
  switch (url.protocol) {
    case 'tcp:':
    case 'http:':
      return { host: url.hostname, port: parseInt(url.port, 10) || 2375, protocol: 'http' };
    case 'https:':
      return { host: url.hostname, port: parseInt(url.port, 10) || 2376, protocol: 'https' };
    case 'ssh:':
      return { host, protocol: 'ssh' as any };
    case 'unix:':
      return { socketPath: url.pathname };
    default:
      throw new Error(`Unsupported Docker host protocol: ${url.protocol}`);
  }
}

/** Re-initialize the Docker client with a custom host URL */
export function initDockerClient(host?: string): void {
  docker = host ? new Dockerode(parseDockerHost(host)) : new Dockerode();
}

export function getDefaultDockerClient(): Dockerode {
  return docker;
}

export async function checkConnection(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/** Create a Dockerode client for a given host URL (or default local) */
export function createDockerClient(host?: string): Dockerode {
  return host ? new Dockerode(parseDockerHost(host)) : new Dockerode();
}
