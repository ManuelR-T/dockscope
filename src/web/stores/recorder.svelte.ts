import type { GraphData, WSMessage } from '../../types';
import { downloadText } from '../lib/download';
import { getJson, apiErrorMessage } from '../lib/api';
import {
  MAX_RECORDING_FRAMES,
  RECORDABLE_TYPES,
  REPLAY_SPEEDS,
  formatClock,
  recordingFilename,
  sanitizeGraph,
  validateRecording,
  type Recording,
  type RecordingFrame,
} from '../lib/recording';
import {
  addToast,
  applyReplayMessage,
  getDockerState,
  resetReplayGraph,
  setMessageTap,
  setReplayMode,
} from './docker.svelte';

const docker = getDockerState();

// --- Recording state ---
let isRecording = $state(false);
let recElapsed = $state(0);
let recFrameCount = $state(0);
let recStartedAt = 0;
let recFrames: RecordingFrame[] = [];
let recInitialGraph: GraphData | null = null;
let recTimer: ReturnType<typeof setInterval> | null = null;
let savingIncident = $state(false);

export async function saveRecentIncident() {
  if (savingIncident) {
    return;
  }
  savingIncident = true;
  try {
    const recent = await getJson<Recording>('/api/recordings/recent');
    downloadRecording(recent);
    addToast(`Incident saved — ${formatClock(recent.duration)} captured`, 'success');
  } catch (error) {
    addToast(apiErrorMessage(error) || 'Could not save recent incident', 'error');
  } finally {
    savingIncident = false;
  }
}

// --- Replay state ---
// $state.raw: frames must stay plain objects — deep $state proxies cannot be
// structuredClone'd when replay re-injects them
let recording = $state.raw<Recording | null>(null);
let replaying = $state(false);
let playing = $state(false);
let position = $state(0);
let speed = $state<number>(REPLAY_SPEEDS[0]);
let appliedCount = 0;
let playTimer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;

const PLAY_TICK_MS = 100;

function captureFrame(msg: WSMessage) {
  if (!isRecording || !RECORDABLE_TYPES.has(msg.type)) {
    return;
  }
  // Clone at capture time: the live store may insert these same objects into
  // the graph, where d3/Three.js would pollute them with cyclic fields
  recFrames.push({ t: Date.now() - recStartedAt, msg: structuredClone(msg) });
  recFrameCount = recFrames.length;
  if (recFrames.length >= MAX_RECORDING_FRAMES) {
    stopRecording();
    addToast('Recording reached max size and was stopped', 'error');
  }
}

export function startRecording() {
  if (isRecording || replaying) {
    return;
  }
  recFrames = [];
  recFrameCount = 0;
  recInitialGraph = sanitizeGraph(docker.graph);
  recStartedAt = Date.now();
  recElapsed = 0;
  isRecording = true;
  setMessageTap(captureFrame);
  recTimer = setInterval(() => {
    recElapsed = Date.now() - recStartedAt;
  }, 1000);
  addToast('Recording session — events, graph and metrics are being captured', 'info');
}

export function stopRecording() {
  if (!isRecording) {
    return;
  }
  isRecording = false;
  setMessageTap(null);
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
  const rec: Recording = {
    version: 1,
    app: 'dockscope',
    appVersion: __APP_VERSION__,
    startedAt: recStartedAt,
    duration: Date.now() - recStartedAt,
    initialGraph: recInitialGraph ?? { nodes: [], links: [] },
    frames: recFrames,
  };
  recording = rec;
  downloadRecording(rec);
  addToast(
    `Recording saved — ${rec.frames.length} frames over ${formatClock(rec.duration)}`,
    'success',
  );
}

function downloadRecording(rec: Recording) {
  downloadText(JSON.stringify(rec), 'application/json', recordingFilename(rec.startedAt));
}

export async function loadRecordingFile(file: File): Promise<boolean> {
  if (isRecording) {
    addToast('Stop the current recording before loading one', 'error');
    return false;
  }
  try {
    const rec = validateRecording(JSON.parse(await file.text()));
    if (!rec) {
      throw new Error('invalid');
    }
    recording = rec;
    startReplay();
    return true;
  } catch {
    addToast('Not a valid DockScope recording file', 'error');
    return false;
  }
}

// --- Replay engine ---

export function startReplay() {
  if (!recording || isRecording) {
    return;
  }
  replaying = true;
  setReplayMode(true);
  resetToStart();
  play();
}

function resetToStart() {
  if (!recording) {
    return;
  }
  resetReplayGraph(recording.initialGraph);
  appliedCount = 0;
  position = 0;
}

function applyUpTo(t: number) {
  if (!recording) {
    return;
  }
  const frames = recording.frames;
  while (appliedCount < frames.length && frames[appliedCount].t <= t) {
    applyReplayMessage(frames[appliedCount].msg);
    appliedCount++;
  }
}

function tick() {
  if (!recording) {
    return;
  }
  const now = performance.now();
  const delta = (now - lastTick) * speed;
  lastTick = now;
  position = Math.min(recording.duration, position + delta);
  applyUpTo(position);
  if (position >= recording.duration) {
    pause();
  }
}

export function play() {
  if (!replaying || playing || !recording) {
    return;
  }
  if (position >= recording.duration) {
    resetToStart();
  }
  playing = true;
  lastTick = performance.now();
  playTimer = setInterval(tick, PLAY_TICK_MS);
}

export function pause() {
  playing = false;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

export function togglePlay() {
  playing ? pause() : play();
}

export function seek(t: number) {
  if (!replaying || !recording) {
    return;
  }
  const target = Math.max(0, Math.min(recording.duration, t));
  if (target < position) {
    // Rewind: rebuild state from the start, then fast-forward
    resetToStart();
  }
  applyUpTo(target);
  position = target;
}

export function cycleSpeed() {
  const idx = REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number]);
  speed = REPLAY_SPEEDS[(idx + 1) % REPLAY_SPEEDS.length];
}

export function exitReplay() {
  pause();
  replaying = false;
  setReplayMode(false);
}

export function getRecorderState() {
  return {
    get savingIncident() {
      return savingIncident;
    },
    get isRecording() {
      return isRecording;
    },
    get recElapsed() {
      return recElapsed;
    },
    get recFrameCount() {
      return recFrameCount;
    },
    get recording() {
      return recording;
    },
    get replaying() {
      return replaying;
    },
    get playing() {
      return playing;
    },
    get position() {
      return position;
    },
    get speed() {
      return speed;
    },
    get duration() {
      return recording?.duration ?? 0;
    },
  };
}
