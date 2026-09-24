import { describe, expect, it } from 'vitest';
import type { GraphData, WSMessage } from '../../types';
import { FlightRecorder } from '../flightRecorder';
import { validateRecording } from '../../web/lib/recording';
import {
  applyReplayMessage,
  getDockerState,
  resetReplayGraph,
} from '../../web/stores/docker.svelte';

const graph = (): WSMessage => ({ type: 'graph', data: { nodes: [], links: [] } });
const event = (actor = 'web'): WSMessage => ({
  type: 'event',
  data: { id: 'abc', type: 'container', action: 'die', actor, time: 1, message: 'container died' },
});

describe('FlightRecorder', () => {
  it('exports a replay-compatible baseline and relative frames without consuming history', () => {
    let now = 1000;
    const recorder = new FlightRecorder('test', { now: () => now });
    expect(recorder.export()).toBeNull();
    recorder.capture(event()); // No graph baseline yet.
    recorder.capture(graph());
    now = 2000;
    recorder.capture(event());
    recorder.capture(graph());
    now = 2500;
    const recording = recorder.export();
    expect(recording).toMatchObject({
      version: 1,
      app: 'dockscope',
      appVersion: 'test',
      startedAt: 1000,
      duration: 1500,
      initialGraph: { nodes: [], links: [] },
      frames: [
        { t: 1000, msg: event() },
        { t: 1000, msg: graph() },
      ],
    });
    expect(validateRecording(recording)).toEqual(recording);
    expect(recorder.export()).toEqual(recording);
  });

  it('detaches captures and exports from subsequent mutations', () => {
    const recorder = new FlightRecorder('test');
    const message = graph();
    recorder.capture(message);
    (message.data as GraphData).links.push({ source: 'a', target: 'b', type: 'network' });
    const first = recorder.export()!;
    expect(first.initialGraph.links).toEqual([]);
    first.initialGraph.links.push({ source: 'x', target: 'y', type: 'network' });
    expect(recorder.export()!.initialGraph.links).toEqual([]);
  });

  it('starts the retained clip at a complete snapshot inside the time window', () => {
    let now = 0;
    const recorder = new FlightRecorder('test', { now: () => now, windowMs: 100 });
    recorder.capture(graph());
    now = 50;
    recorder.capture(event('old'));
    now = 80;
    recorder.capture(graph());
    now = 120;
    recorder.capture(event('recent'));
    expect(recorder.export()).toMatchObject({
      startedAt: 80,
      duration: 40,
      frames: [{ t: 40, msg: event('recent') }],
    });
    now = 181;
    expect(recorder.export()).toBeNull();
  });

  it('evicts whole segments when the frame limit is reached', () => {
    let now = 0;
    const recorder = new FlightRecorder('test', { now: () => now, maxFrames: 3 });
    recorder.capture(graph());
    recorder.capture(event('old'));
    now = 10;
    recorder.capture(graph());
    recorder.capture(event('new'));
    expect(recorder.export()).toMatchObject({
      startedAt: 10,
      frames: [{ t: 0, msg: event('new') }],
    });
  });

  it('bounds payload bytes and resumes at the next graph after an oversized segment', () => {
    const recorder = new FlightRecorder('test', { maxBytes: 200 });
    recorder.capture(graph());
    recorder.capture(event('x'.repeat(300)));
    expect(recorder.export()).toBeNull();
    recorder.capture(event('no baseline'));
    expect(recorder.export()).toBeNull();
    recorder.capture(graph());
    expect(recorder.export()?.initialGraph).toEqual({ nodes: [], links: [] });
  });

  it('excludes subscription logs and control messages', () => {
    const recorder = new FlightRecorder('test');
    recorder.capture(graph());
    recorder.capture({ type: 'log_chunk', data: { containerId: 'abc', text: 'private log' } });
    recorder.capture({ type: 'error', data: { message: 'connection error' } });
    expect(recorder.export()?.frames).toEqual([]);
  });

  it('replays an exported incident through the existing store', () => {
    const recorder = new FlightRecorder('test');
    const initialGraph: GraphData = {
      nodes: [
        {
          id: 'abc',
          containerId: 'abc',
          name: 'web',
          fullName: 'web',
          project: '',
          host: 'local',
          image: 'test',
          status: 'running',
          health: 'none',
          ports: [],
          networks: [],
          volumeCount: 0,
          cpu: 0,
          memory: 0,
          memoryLimit: 0,
          networkRx: 0,
          networkTx: 0,
          networkRxRate: 0,
          networkTxRate: 0,
        },
      ],
      links: [],
    };
    recorder.capture({ type: 'graph', data: initialGraph });
    recorder.capture({
      type: 'stats',
      data: {
        id: 'abc',
        cpu: 92,
        memory: 256,
        memoryLimit: 512,
        networkRx: 0,
        networkTx: 0,
        networkRxRate: 0,
        networkTxRate: 0,
      },
    });
    recorder.capture(event());
    recorder.capture({
      type: 'anomaly',
      data: {
        containerId: 'abc',
        containerName: 'web',
        metric: 'cpu',
        value: 92,
        average: 10,
        threshold: 50,
        time: 1,
      },
    });
    recorder.capture({
      type: 'diagnostic',
      data: {
        containerId: 'abc',
        containerName: 'web',
        exitCode: 137,
        oomKilled: true,
        cause: 'Out of memory',
        details: [],
        logSnippet: ['allocation failed'],
        time: 1,
      },
    });
    const recording = validateRecording(recorder.export())!;
    resetReplayGraph(recording.initialGraph);
    for (const frame of recording.frames) {
      applyReplayMessage(frame.msg);
    }
    const state = getDockerState();
    expect(state.graph.nodes[0]).toMatchObject({ id: 'abc', cpu: 92, memory: 256 });
    expect(state.events[0]).toMatchObject({ action: 'die', actor: 'web' });
    expect(state.anomalies.size).toBe(1);
    expect(state.diagnostics.get('abc')).toMatchObject({ oomKilled: true });
    resetReplayGraph({ nodes: [], links: [] });
  });
});
