import Dockerode from 'dockerode';
import type { ContainerStats } from '../types.js';

const prevNetStats = new Map<string, { rx: number; tx: number; time: number }>();

export async function getContainerStats(
  docker: Dockerode,
  containerId: string,
): Promise<ContainerStats> {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });

  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus || 1;
  const cpu = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

  const memUsage = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
  const memLimit = stats.memory_stats.limit || 1;

  let networkRx = 0;
  let networkTx = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as any[]) {
      networkRx += iface.rx_bytes || 0;
      networkTx += iface.tx_bytes || 0;
    }
  }

  const shortId = containerId.substring(0, 12);
  const now = Date.now();
  const prev = prevNetStats.get(shortId);
  let networkRxRate = 0;
  let networkTxRate = 0;
  if (prev) {
    const elapsed = (now - prev.time) / 1000;
    if (elapsed > 0) {
      networkRxRate = Math.max(0, (networkRx - prev.rx) / elapsed);
      networkTxRate = Math.max(0, (networkTx - prev.tx) / elapsed);
    }
  }
  prevNetStats.set(shortId, { rx: networkRx, tx: networkTx, time: now });

  return {
    id: shortId,
    cpu: Math.round(cpu * 100) / 100,
    memory: memUsage,
    memoryLimit: memLimit,
    networkRx,
    networkTx,
    networkRxRate: Math.round(networkRxRate),
    networkTxRate: Math.round(networkTxRate),
  };
}
