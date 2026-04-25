// ANSI escape code → HTML span converter
// Handles: standard colors (30-37, 90-97), background (40-47, 100-107),
// bold, dim, italic, underline, reset, and 256-color/RGB sequences.

const ANSI_COLORS: Record<number, string> = {
  30: '#3e4a5c',
  31: '#ff2b4e',
  32: '#00ff6a',
  33: '#ff8a2b',
  34: '#00a0ff',
  35: '#a855f7',
  36: '#00e4ff',
  37: '#e2e8f0',
  90: '#5a6578',
  91: '#ff5c7a',
  92: '#44ff8e',
  93: '#ffaa55',
  94: '#44bbff',
  95: '#c084fc',
  96: '#44eeff',
  97: '#f8fafc',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#1a1a2e',
  41: '#3b0a15',
  42: '#0a2b15',
  43: '#2b1a05',
  44: '#0a1a2b',
  45: '#1f0a2b',
  46: '#0a2b2b',
  47: '#2b2b2b',
  100: '#2a2a3e',
  101: '#4b1a25',
  102: '#1a3b25',
  103: '#3b2a15',
  104: '#1a2a3b',
  105: '#2f1a3b',
  106: '#1a3b3b',
  107: '#3b3b3b',
};

const COLOR_256: string[] = [
  // 0-7: standard
  '#3e4a5c',
  '#ff2b4e',
  '#00ff6a',
  '#ff8a2b',
  '#00a0ff',
  '#a855f7',
  '#00e4ff',
  '#e2e8f0',
  // 8-15: bright
  '#5a6578',
  '#ff5c7a',
  '#44ff8e',
  '#ffaa55',
  '#44bbff',
  '#c084fc',
  '#44eeff',
  '#f8fafc',
];
// 16-231: 6x6x6 color cube
for (let r = 0; r < 6; r++) {
  for (let g = 0; g < 6; g++) {
    for (let b = 0; b < 6; b++) {
      COLOR_256.push(
        `#${(r ? r * 40 + 55 : 0).toString(16).padStart(2, '0')}${(g ? g * 40 + 55 : 0).toString(16).padStart(2, '0')}${(b ? b * 40 + 55 : 0).toString(16).padStart(2, '0')}`,
      );
    }
  }
}
// 232-255: grayscale
for (let i = 0; i < 24; i++) {
  const v = (i * 10 + 8).toString(16).padStart(2, '0');
  COLOR_256.push(`#${v}${v}${v}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shorten Docker log timestamps:
// "2026-03-25T18:43:43.798636408Z" → dimmed "18:43:43"
const DOCKER_TS = /\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z/g;

function shortenTimestamps(text: string): string {
  return text.replace(DOCKER_TS, '<span style="color:#5a6578">$1</span>');
}

export function ansiToHtml(text: string): string {
  if (!text) {
    return '';
  }

  // Fast path: no escape codes at all
  if (!text.includes('\x1b') && !text.includes('\u001b')) {
    return colorLogLevels(shortenTimestamps(escapeHtml(text)));
  }

  const result: string[] = [];
  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let spanOpen = false;

  const pushSpan = () => {
    if (spanOpen) {
      result.push('</span>');
    }
    const styles: string[] = [];
    if (fg) {
      styles.push(`color:${fg}`);
    }
    if (bg) {
      styles.push(`background:${bg}`);
    }
    if (bold) {
      styles.push('font-weight:700');
    }
    if (dim) {
      styles.push('opacity:0.6');
    }
    if (italic) {
      styles.push('font-style:italic');
    }
    if (underline) {
      styles.push('text-decoration:underline');
    }
    if (styles.length > 0) {
      result.push(`<span style="${styles.join(';')}">`);
      spanOpen = true;
    } else {
      spanOpen = false;
    }
  };

  // Split on ANSI escape sequences: ESC [ ... m
  const re = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      result.push(escapeHtml(text.slice(lastIndex, match.index)));
    }
    lastIndex = re.lastIndex;

    const params = match[1] ? match[1].split(';').map(Number) : [0];
    let i = 0;
    while (i < params.length) {
      const code = params[i];

      if (code === 0) {
        // Reset all
        fg = null;
        bg = null;
        bold = false;
        dim = false;
        italic = false;
        underline = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 3) {
        italic = true;
      } else if (code === 4) {
        underline = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 23) {
        italic = false;
      } else if (code === 24) {
        underline = false;
      } else if (code === 39) {
        fg = null;
      } else if (code === 49) {
        bg = null;
      } else if (code >= 30 && code <= 37) {
        fg = ANSI_COLORS[code] || null;
      } else if (code >= 90 && code <= 97) {
        fg = ANSI_COLORS[code] || null;
      } else if (code >= 40 && code <= 47) {
        bg = ANSI_BG_COLORS[code] || null;
      } else if (code >= 100 && code <= 107) {
        bg = ANSI_BG_COLORS[code] || null;
      } else if (code === 38 && params[i + 1] === 5) {
        // 256-color foreground: ESC[38;5;{n}m
        const idx = params[i + 2];
        fg = (idx !== undefined && COLOR_256[idx]) || null;
        i += 2;
      } else if (code === 48 && params[i + 1] === 5) {
        // 256-color background
        const idx = params[i + 2];
        bg = (idx !== undefined && COLOR_256[idx]) || null;
        i += 2;
      } else if (code === 38 && params[i + 1] === 2) {
        // RGB foreground: ESC[38;2;{r};{g};{b}m
        fg = `rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`;
        i += 4;
      } else if (code === 48 && params[i + 1] === 2) {
        // RGB background
        bg = `rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`;
        i += 4;
      }
      i++;
    }
    pushSpan();
  }

  // Push remaining text
  if (lastIndex < text.length) {
    result.push(escapeHtml(text.slice(lastIndex)));
  }

  if (spanOpen) {
    result.push('</span>');
  }
  return colorLogLevels(shortenTimestamps(result.join('')));
}

// Color log lines by level keywords
const LOG_LEVEL_PATTERNS: [RegExp, string][] = [
  [/^(.*(?:ERROR|FATAL|PANIC|CRIT).*)$/gim, '<span class="log-level-error">$1</span>'],
  [/^(.*(?:WARN|WARNING).*)$/gim, '<span class="log-level-warn">$1</span>'],
  [/^(.*(?:DEBUG|TRACE).*)$/gim, '<span class="log-level-debug">$1</span>'],
];

function colorLogLevels(html: string): string {
  // Process line by line to avoid cross-line matching
  return html
    .split('\n')
    .map((line) => {
      for (const [re, replacement] of LOG_LEVEL_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line)) {
          re.lastIndex = 0;
          return line.replace(re, replacement);
        }
      }
      return line;
    })
    .join('\n');
}

// Highlight search matches in HTML (avoids matching inside tags)
export function highlightLogSearch(html: string, query: string): { html: string; count: number } {
  if (!query || !html) {
    return { html, count: 0 };
  }
  let count = 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Replace in text content only (between > and <)
  const result = html.replace(
    new RegExp(`(>|^)([^<]*?)(<|$)`, 'g'),
    (match, before, text, after) => {
      const highlighted = text.replace(new RegExp(escaped, 'gi'), (m: string) => {
        count++;
        return `<mark class="log-highlight">${m}</mark>`;
      });
      return `${before}${highlighted}${after}`;
    },
  );
  return { html: result, count };
}
