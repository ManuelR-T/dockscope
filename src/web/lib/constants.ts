// --- UI layout ---
export const UI = {
  sidebar: { min: 260, max: 800, default: 480 },
  statusbar: { min: 80, max: 400, default: 230 },
} as const;

// --- Docker polling ---
export const DOCKER = {
  statsInterval: 3000,
  graphRefreshInterval: 10000,
  wsReconnectDelay: 2000,
  logDefaultTail: 200,
  logStreamTail: 100,
  logMaxBuffer: 500_000,
  logTrimTo: 400_000,
  metricsMaxHistory: 100,
} as const;

// --- 3D graph ---
export const GRAPH = {
  node: {
    baseRadius: { running: 2.5, stopped: 1.8 },
    importanceScale: 1.2,
    sphereSegments: { w: 20, h: 16 },
    ringSpriteSegments: 32,
    ringGap: 2.5,
    ringThicknessBase: 0.5,
    ringThicknessScale: 2.5,
    labelHeight: 2.2,
    labelOffset: 2,
    deployStagger: 70,
    deployDuration: 500,
  },
  force: {
    charge: { strength: -65, distanceMax: 200 },
    link: { distance: 55 },
    center: { strength: 0.03 },
    position: { strength: 0.04 },
    cluster: { strength: 0.015 },
  },
  controls: {
    zoomSpeed: 0.3,
    rotateSpeed: 0.4,
    panSpeed: 0.05,
  },
  importance: {
    ports: 0.12,
    connections: 0.18,
    chainDepth: 0.18,
    networkIO: 0.18,
    cpu: 0.12,
    memory: 0.1,
    networks: 0.12,
  },
} as const;

// --- Project cluster palette ---
export const PROJECT_PALETTE = [
  '#00e4ff',
  '#a855f7',
  '#00ff6a',
  '#ff8a2b',
  '#ff2b4e',
  '#ffdd33',
  '#3b82f6',
  '#ec4899',
] as const;
