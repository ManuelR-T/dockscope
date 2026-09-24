import type { Express } from 'express';
import type { FlightRecorder } from '../flightRecorder.js';

export function setupRecordingRoutes(app: Express, recorder: FlightRecorder): void {
  app.get('/api/recordings/recent', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const recording = recorder.export();
    if (!recording) {
      res
        .status(503)
        .json({ error: 'Flight recorder is waiting for a graph snapshot. Try again shortly.' });
      return;
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dockscope-incident-${recording.startedAt}.json"`,
    );
    res.json(recording);
  });
}
