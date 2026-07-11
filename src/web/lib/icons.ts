/**
 * Shared SVG icon registry (24x24 viewBox). `fill` icons render solid with
 * currentColor; stroke icons render outlined with the given stroke width.
 * Bodies are static trusted markup injected via {@html} in Icon.svelte.
 */
export interface IconDef {
  body: string;
  fill?: boolean;
  strokeWidth?: number;
}

export const ICONS = {
  play: { body: '<polygon points="6,3 20,12 6,21" />', fill: true },
  pause: {
    body: '<rect x="5" y="4" width="4" height="16" rx="1" /><rect x="15" y="4" width="4" height="16" rx="1" />',
    fill: true,
  },
  stop: { body: '<rect x="4" y="4" width="16" height="16" rx="2" />', fill: true },
  restart: {
    body: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />',
    strokeWidth: 2.5,
  },
  dots: {
    body: '<circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />',
    fill: true,
  },
  camera: {
    body: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />',
    strokeWidth: 2,
  },
  upload: {
    body: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />',
  },
  fit: { body: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />', strokeWidth: 2 },
  focus: {
    body: '<circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />',
    strokeWidth: 2,
  },
  impact: {
    body: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />',
    strokeWidth: 2,
  },
  external: {
    body: '<path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />',
    strokeWidth: 2,
  },
  plug: {
    body: '<path d="M8 3v4M16 3v4M7 7h10v5a5 5 0 0 1-10 0V7Z" /><path d="M12 17v4M8 21h8" />',
    strokeWidth: 2,
  },
  trash: {
    body: '<path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 15H6L5 6" /><path d="M10 11v5M14 11v5" />',
    strokeWidth: 2,
  },
  scale: {
    body: '<path d="M4 7h16M7 4v6M17 4v6M4 17h16M9 14v6M15 14v6" />',
    strokeWidth: 2,
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
