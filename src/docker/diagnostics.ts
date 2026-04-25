import Dockerode from 'dockerode';
import type { CrashDiagnostic } from '../types.js';
import { demuxLogBuffer } from './logs.js';
import { shortId } from '../utils.js';

interface LogPattern {
  pattern: RegExp;
  cause: string;
  detail: string;
}

const LOG_PATTERNS: LogPattern[] = [
  { pattern: /out of memory/i, cause: 'Out of Memory', detail: 'Process exceeded memory limit' },
  { pattern: /OOM/i, cause: 'Out of Memory', detail: 'OOM killer invoked' },
  { pattern: /killed/i, cause: 'Process Killed', detail: 'Process was forcefully terminated' },
  {
    pattern: /EADDRINUSE|address already in use|port.*already.*use/i,
    cause: 'Port Conflict',
    detail: 'Another process is using the required port',
  },
  {
    pattern: /ECONNREFUSED|connection refused/i,
    cause: 'Connection Refused',
    detail: 'Could not connect to a required service',
  },
  {
    pattern: /ECONNRESET|connection reset/i,
    cause: 'Connection Reset',
    detail: 'A network connection was unexpectedly closed',
  },
  {
    pattern: /ENOTFOUND|name.*resolution|DNS/i,
    cause: 'DNS Resolution Failed',
    detail: 'Could not resolve a hostname',
  },
  {
    pattern: /no such file|ENOENT|file not found|not found/i,
    cause: 'Missing File',
    detail: 'A required file or binary was not found',
  },
  {
    pattern: /permission denied|EACCES|access denied/i,
    cause: 'Permission Denied',
    detail: 'Insufficient permissions to access a resource',
  },
  {
    pattern: /undefined variable|not set|required.*env|missing.*env/i,
    cause: 'Missing Environment Variable',
    detail: 'A required environment variable is not set',
  },
  {
    pattern: /segmentation fault|segfault|SIGSEGV/i,
    cause: 'Segmentation Fault',
    detail: 'Process crashed with a memory access violation',
  },
  {
    pattern: /panic|fatal error|unhandled exception|uncaught/i,
    cause: 'Unhandled Error',
    detail: 'Application crashed with an unhandled exception',
  },
  {
    pattern: /timeout|timed out/i,
    cause: 'Timeout',
    detail: 'An operation timed out',
  },
  {
    pattern: /disk.*full|no space|ENOSPC/i,
    cause: 'Disk Full',
    detail: 'No disk space available',
  },
  {
    pattern: /authentication fail|auth.*fail|unauthorized|401/i,
    cause: 'Authentication Failure',
    detail: 'Failed to authenticate with a service',
  },
];

const EXIT_CODE_MAP: Record<number, string> = {
  0: 'Clean exit',
  1: 'General error',
  2: 'Misuse of shell command',
  126: 'Command not executable',
  127: 'Command not found',
  128: 'Invalid exit argument',
  137: 'Killed (SIGKILL / OOM)',
  139: 'Segmentation fault (SIGSEGV)',
  143: 'Terminated (SIGTERM)',
};

export async function analyzeCrash(
  docker: Dockerode,
  containerId: string,
): Promise<CrashDiagnostic | null> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    const exitCode = info.State.ExitCode ?? -1;
    const oomKilled = info.State.OOMKilled ?? false;
    const name =
      info.Config.Labels?.['com.docker.compose.service'] ||
      info.Name?.replace(/^\//, '') ||
      shortId(containerId);

    // Skip clean exits
    if (exitCode === 0 && !oomKilled) {
      return null;
    }

    // Fetch last 50 log lines
    let logLines: string[] = [];
    try {
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: 50,
        timestamps: false,
      });
      const raw = Buffer.isBuffer(logBuffer) ? logBuffer : Buffer.from(logBuffer as any);
      const text = info.Config.Tty ? raw.toString('utf-8') : demuxLogBuffer(raw);
      logLines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      // Container logs may not be available
    }

    // Determine cause
    let cause = EXIT_CODE_MAP[exitCode] || `Exit code ${exitCode}`;
    const details: string[] = [];

    if (oomKilled) {
      cause = 'Out of Memory (OOM Killed)';
      details.push('Container was killed by the kernel OOM killer');
      if (info.HostConfig.Memory) {
        const limitMB = Math.round(info.HostConfig.Memory / 1024 / 1024);
        details.push(`Memory limit: ${limitMB} MB`);
      }
    }

    if (exitCode === 137 && !oomKilled) {
      details.push('Received SIGKILL — may be OOM, manual kill, or Docker stop timeout');
    }

    // Scan logs for known patterns
    const matched = new Set<string>();
    for (const line of logLines) {
      for (const { pattern, cause: patCause, detail } of LOG_PATTERNS) {
        if (pattern.test(line) && !matched.has(patCause)) {
          matched.add(patCause);
          if (!oomKilled || !patCause.includes('Memory')) {
            cause = patCause;
          }
          details.push(detail);
        }
      }
    }

    // Keep last 10 lines for the snippet
    const logSnippet = logLines.slice(-10);

    return {
      containerId: shortId(containerId),
      containerName: name,
      exitCode,
      oomKilled,
      cause,
      details,
      logSnippet,
      time: Date.now(),
    };
  } catch {
    return null;
  }
}
