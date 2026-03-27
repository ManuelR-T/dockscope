import type { Express } from 'express';
import {
  buildGraph,
  checkConnection,
  composeAction,
  containerAction,
  getContainerLogs,
  getContainerStats,
  getContainerDiff,
  getContainerTop,
  getSystemInfo,
  inspectContainer,
  listComposeProjects,
  removeContainer,
} from '../docker/client.js';
import type { ServerOptions } from '../types.js';

const VALID_ID = /^[a-f0-9]{12,64}$/i;

export function setupRoutes(
  app: Express,
  opts: ServerOptions,
  metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>,
): void {
  // Validate container ID format
  app.param('id', (req, res, next) => {
    if (!VALID_ID.test(req.params.id as string)) {
      res.status(400).json({ error: 'Invalid container ID format' });
      return;
    }
    next();
  });

  app.get('/api/graph', async (_req, res) => {
    try {
      const graph = await buildGraph();
      res.json(graph);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/logs', async (req, res) => {
    try {
      const tail = parseInt(req.query.tail as string) || 200;
      const logs = await getContainerLogs(req.params.id, tail);
      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/stats', async (req, res) => {
    try {
      const stats = await getContainerStats(req.params.id);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/health', async (_req, res) => {
    const dockerOk = await checkConnection();
    res.json({ status: dockerOk ? 'ok' : 'docker_unavailable' });
  });

  app.post('/api/containers/:id/restart', async (req, res) => {
    try {
      await containerAction(req.params.id, 'restart');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/containers/:id/stop', async (req, res) => {
    try {
      await containerAction(req.params.id, 'stop');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/containers/:id/start', async (req, res) => {
    try {
      await containerAction(req.params.id, 'start');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/containers/:id/pause', async (req, res) => {
    try {
      await containerAction(req.params.id, 'pause');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/containers/:id/unpause', async (req, res) => {
    try {
      await containerAction(req.params.id, 'unpause');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/containers/:id/kill', async (req, res) => {
    try {
      await containerAction(req.params.id, 'kill');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/containers/:id', async (req, res) => {
    try {
      const volumes = req.query.volumes === 'true';
      await removeContainer(req.params.id, volumes);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/top', async (req, res) => {
    try {
      const top = await getContainerTop(req.params.id);
      res.json(top);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/diff', async (req, res) => {
    try {
      const diff = await getContainerDiff(req.params.id);
      res.json(diff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/inspect', async (req, res) => {
    try {
      const info = await inspectContainer(req.params.id);
      res.json(info);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/containers/:id/history', (req, res) => {
    const history = metricHistory.get(req.params.id.substring(0, 12)) || [];
    res.json(history);
  });

  app.get('/api/system', async (_req, res) => {
    try {
      const info = await getSystemInfo();
      res.json(info);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Compose project management
  app.get('/api/projects', async (_req, res) => {
    try {
      const projects = await listComposeProjects();
      res.json(projects);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/projects/:name/:action', async (req, res) => {
    const { name, action } = req.params;
    if (!['up', 'down', 'destroy', 'stop', 'start', 'restart'].includes(action)) {
      res.status(400).json({ error: `Invalid action: ${action}` });
      return;
    }
    try {
      const result = await composeAction(name, action as any);
      res.json({ ok: true, message: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
