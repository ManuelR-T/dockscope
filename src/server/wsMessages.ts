export interface InboundEntityRef {
  entityId: string;
  sourceId?: string;
  nodeId?: string;
}

export type InboundWSMessage =
  | { type: 'subscribe_logs'; data: InboundEntityRef }
  | { type: 'unsubscribe_logs' }
  | { type: 'exec_start'; data: InboundEntityRef & { cmd?: string[] } }
  | { type: 'exec_input'; data: { text: string } }
  | { type: 'exec_resize'; data: Record<string, unknown> }
  | { type: 'exec_stop' };

const VALID_ENTITY_ID = /^[^\s/?#]{1,512}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function boundedString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
}

function parseEntityRef(value: unknown): InboundEntityRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawEntityId = value.entityId ?? value.containerId;
  if (typeof rawEntityId !== 'string' || !VALID_ENTITY_ID.test(rawEntityId)) {
    return null;
  }
  const sourceId = boundedString(value.sourceId ?? value.host);
  const nodeId = boundedString(value.nodeId);
  if (sourceId === null || nodeId === null) {
    return null;
  }
  return {
    entityId: rawEntityId,
    ...(sourceId ? { sourceId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

export function parseInboundWSMessage(raw: string): InboundWSMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  switch (parsed.type) {
    case 'subscribe_logs': {
      const ref = parseEntityRef(parsed.data);
      return ref ? { type: 'subscribe_logs', data: ref } : null;
    }
    case 'unsubscribe_logs':
      return { type: 'unsubscribe_logs' };
    case 'exec_start': {
      const ref = parseEntityRef(parsed.data);
      if (!ref || !isRecord(parsed.data)) {
        return null;
      }
      if (parsed.data.cmd !== undefined && !isStringArray(parsed.data.cmd)) {
        return null;
      }
      return {
        type: 'exec_start',
        data: { ...ref, cmd: parsed.data.cmd },
      };
    }
    case 'exec_input': {
      if (!isRecord(parsed.data) || typeof parsed.data.text !== 'string') {
        return null;
      }
      return { type: 'exec_input', data: { text: parsed.data.text } };
    }
    case 'exec_resize': {
      if (!isRecord(parsed.data)) {
        return null;
      }
      return { type: 'exec_resize', data: parsed.data };
    }
    case 'exec_stop':
      return { type: 'exec_stop' };
    default:
      return null;
  }
}
