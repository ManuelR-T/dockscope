import type { PluginCapability } from './capabilities.js';
import type { PluginCommandResult } from './plugin-commands.js';
import type { PluginConfigValue } from './plugin-config.js';

export const PLUGIN_UI_SLOTS = [
  'toolbar',
  'navigation',
  'sidebar',
  'nodePanel',
  'nodeAction',
  'graphOverlay',
  'settings',
] as const;

export type PluginUiSlot = (typeof PLUGIN_UI_SLOTS)[number];
export type PluginUiTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface PluginUiTextContent {
  type: 'text' | 'markdown';
  body: string;
}

export interface PluginUiMetricItem {
  label: string;
  value: string | number | boolean;
  unit?: string;
  tone?: PluginUiTone;
}

export interface PluginUiMetricsContent {
  type: 'metrics';
  items: PluginUiMetricItem[];
}

export interface PluginUiKeyValueItem {
  label: string;
  value: string | number | boolean;
}

export interface PluginUiKeyValueContent {
  type: 'keyValue';
  items: PluginUiKeyValueItem[];
}

export type PluginUiContent =
  | PluginUiTextContent
  | PluginUiMetricsContent
  | PluginUiKeyValueContent;

export type PluginUiAction =
  | {
      type: 'open_url';
      url: string;
    }
  | {
      type: 'run_command';
      pluginId?: string;
      commandId: string;
      input?: Record<string, PluginConfigValue>;
      passContext?: boolean;
    };

export interface PluginOpenUrlAction {
  type: 'open_url';
  url: string;
}

export interface PluginUiContextFilter {
  runtimes?: string[];
  kinds?: string[];
  statuses?: string[];
}

export interface PluginUiNodeContext {
  id: string;
  name: string;
  sourceId?: string;
  entityId?: string;
  runtime?: string;
  kind?: string;
  namespace?: string;
  status?: string;
  project?: string;
  host?: string;
}

export interface PluginUiContext {
  node?: PluginUiNodeContext;
}

export interface PluginUiExtensionDeclaration {
  id: string;
  slot: PluginUiSlot;
  title: string;
  description?: string;
  icon?: string;
  order?: number;
  height?: number;
  context?: PluginUiContextFilter;
  content?: PluginUiContent;
  action?: PluginUiAction;
  frontendView?: string;
}

export interface PluginUiExtension extends PluginUiExtensionDeclaration {
  pluginId: string;
}

export interface PluginFrontendBundleDeclaration {
  entry: string;
  slots: PluginUiSlot[];
}

export interface PluginFrontendRoot {
  textContent: string | null;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
}

export interface PluginFrontendApi {
  readonly root: PluginFrontendRoot;
  readonly view: string;
  readonly context: Readonly<PluginUiContext>;
  requestAction(input?: unknown): void;
  resize(height: number): void;
}

export type PluginFrontendMount = (api: PluginFrontendApi) => void | Promise<void>;

export type PluginUiActionResult =
  | { type: 'open_url'; url: string }
  | { type: 'command'; result: PluginCommandResult };

const UI_SLOT_SET = new Set<string>(PLUGIN_UI_SLOTS);
const UI_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
const UI_TONES = new Set<PluginUiTone>(['neutral', 'info', 'success', 'warning', 'danger']);

const UI_CAPABILITY_BY_SLOT: Record<PluginUiSlot, PluginCapability> = {
  toolbar: 'ui.toolbarAction',
  navigation: 'ui.navigation',
  sidebar: 'ui.sidebarPanel',
  nodePanel: 'ui.nodePanel',
  nodeAction: 'ui.nodeAction',
  graphOverlay: 'ui.graphOverlay',
  settings: 'ui.settings',
};

export class PluginUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginUiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new PluginUiError(`Plugin UI field "${field}" must be a non-empty string`);
  }
  return value;
}

function isPluginUiSlot(value: unknown): value is PluginUiSlot {
  return typeof value === 'string' && UI_SLOT_SET.has(value);
}

function scalarValue(value: unknown, field: string): string | number | boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new PluginUiError(`Plugin UI field "${field}" must be a scalar value`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PluginUiError(`Plugin UI field "${field}" must be finite`);
  }
  return value;
}

function validateTone(value: unknown, field: string): PluginUiTone | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !UI_TONES.has(value as PluginUiTone)) {
    throw new PluginUiError(`Plugin UI field "${field}" has an unsupported tone`);
  }
  return value as PluginUiTone;
}

function validatePluginUiContent(raw: unknown, extensionId: string): PluginUiContent | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginUiError(`Plugin UI content for "${extensionId}" must be an object`);
  }
  if (raw.type === 'text' || raw.type === 'markdown') {
    if (!isNonEmptyString(raw.body)) {
      throw new PluginUiError(`Plugin UI content for "${extensionId}" requires a body`);
    }
    return { type: raw.type, body: raw.body };
  }
  if (raw.type === 'metrics') {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw new PluginUiError(`Plugin UI metrics for "${extensionId}" require items`);
    }
    return {
      type: 'metrics',
      items: raw.items.map((item, index) => {
        if (!isRecord(item) || !isNonEmptyString(item.label)) {
          throw new PluginUiError(`Plugin UI metric ${extensionId}.${index} requires a label`);
        }
        return {
          label: item.label,
          value: scalarValue(item.value, `${extensionId}.${index}.value`),
          unit: optionalString(item.unit, `${extensionId}.${index}.unit`),
          tone: validateTone(item.tone, `${extensionId}.${index}.tone`),
        };
      }),
    };
  }
  if (raw.type === 'keyValue') {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw new PluginUiError(`Plugin UI key/value content for "${extensionId}" requires items`);
    }
    return {
      type: 'keyValue',
      items: raw.items.map((item, index) => {
        if (!isRecord(item) || !isNonEmptyString(item.label)) {
          throw new PluginUiError(`Plugin UI row ${extensionId}.${index} requires a label`);
        }
        return {
          label: item.label,
          value: scalarValue(item.value, `${extensionId}.${index}.value`),
        };
      }),
    };
  }
  throw new PluginUiError(`Plugin UI content for "${extensionId}" has an unsupported type`);
}

function validateActionInput(
  value: unknown,
  extensionId: string,
): Record<string, PluginConfigValue> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new PluginUiError(`Plugin UI action input for "${extensionId}" must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scalarValue(item, `${extensionId}.${key}`)]),
  );
}

function validatePluginUiAction(raw: unknown, extensionId: string): PluginUiAction | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" must be an object`);
  }
  if (raw.type === 'run_command') {
    if (!isNonEmptyString(raw.commandId)) {
      throw new PluginUiError(`Plugin UI action for "${extensionId}" requires a commandId`);
    }
    return {
      type: 'run_command',
      pluginId: optionalString(raw.pluginId, `${extensionId}.pluginId`),
      commandId: raw.commandId,
      input: validateActionInput(raw.input, extensionId),
      passContext: raw.passContext === true,
    };
  }
  if (raw.type !== 'open_url') {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" has an unsupported type`);
  }
  if (!isNonEmptyString(raw.url)) {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" requires a url`);
  }
  const parsed = new URL(raw.url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" requires an http(s) url`);
  }
  return { type: raw.type, url: raw.url };
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new PluginUiError(`Plugin UI field "${field}" must be a string array`);
  }
  return [...new Set(value)];
}

function validateContextFilter(
  raw: unknown,
  extensionId: string,
): PluginUiContextFilter | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginUiError(`Plugin UI context for "${extensionId}" must be an object`);
  }
  return {
    runtimes: stringList(raw.runtimes, `${extensionId}.context.runtimes`),
    kinds: stringList(raw.kinds, `${extensionId}.context.kinds`),
    statuses: stringList(raw.statuses, `${extensionId}.context.statuses`),
  };
}

function validatePluginUiExtension(raw: unknown): PluginUiExtensionDeclaration {
  if (!isRecord(raw)) {
    throw new PluginUiError('Plugin UI extensions must be objects');
  }
  if (!isNonEmptyString(raw.id)) {
    throw new PluginUiError('Plugin UI extension field "id" is required');
  }
  if (!UI_ID_PATTERN.test(raw.id)) {
    throw new PluginUiError(`Invalid plugin UI extension id: ${raw.id}`);
  }
  if (!isPluginUiSlot(raw.slot)) {
    throw new PluginUiError(`Unsupported plugin UI slot: ${String(raw.slot)}`);
  }
  if (!isNonEmptyString(raw.title)) {
    throw new PluginUiError(`Plugin UI extension "${raw.id}" requires a title`);
  }
  const order = raw.order;
  if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order))) {
    throw new PluginUiError(`Plugin UI extension "${raw.id}" order must be a number`);
  }
  const height = raw.height;
  if (
    height !== undefined &&
    (typeof height !== 'number' || !Number.isFinite(height) || height < 48 || height > 640)
  ) {
    throw new PluginUiError(`Plugin UI extension "${raw.id}" height must be 48..640`);
  }
  return {
    id: raw.id,
    slot: raw.slot,
    title: raw.title,
    description: optionalString(raw.description, `${raw.id}.description`),
    icon: optionalString(raw.icon, `${raw.id}.icon`),
    order,
    height,
    context: validateContextFilter(raw.context, raw.id),
    content: validatePluginUiContent(raw.content, raw.id),
    action: validatePluginUiAction(raw.action, raw.id),
    frontendView: optionalString(raw.frontendView, `${raw.id}.frontendView`),
  };
}

export function validatePluginUiExtensions(raw: unknown): PluginUiExtensionDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginUiError('Plugin UI extensions must be an array');
  }
  const extensions = raw.map(validatePluginUiExtension);
  const ids = new Set<string>();
  for (const extension of extensions) {
    if (ids.has(extension.id)) {
      throw new PluginUiError(`Duplicate plugin UI extension id: ${extension.id}`);
    }
    ids.add(extension.id);
  }
  return extensions;
}

export function validatePluginFrontendBundle(
  raw: unknown,
): PluginFrontendBundleDeclaration | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw) || !isNonEmptyString(raw.entry)) {
    throw new PluginUiError('Plugin frontend requires an entry');
  }
  if (!Array.isArray(raw.slots) || raw.slots.length === 0 || !raw.slots.every(isPluginUiSlot)) {
    throw new PluginUiError('Plugin frontend slots must be a non-empty UI slot array');
  }
  return { entry: raw.entry, slots: [...new Set(raw.slots)] };
}

export function validatePluginUiContext(raw: unknown): PluginUiContext {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (!isRecord(raw)) {
    throw new PluginUiError('Plugin UI context must be an object');
  }
  if (raw.node === undefined || raw.node === null) {
    return {};
  }
  if (!isRecord(raw.node) || !isNonEmptyString(raw.node.id) || !isNonEmptyString(raw.node.name)) {
    throw new PluginUiError('Plugin UI node context requires id and name');
  }
  return {
    node: {
      id: raw.node.id,
      name: raw.node.name,
      sourceId: optionalString(raw.node.sourceId, 'context.node.sourceId'),
      entityId: optionalString(raw.node.entityId, 'context.node.entityId'),
      runtime: optionalString(raw.node.runtime, 'context.node.runtime'),
      kind: optionalString(raw.node.kind, 'context.node.kind'),
      namespace: optionalString(raw.node.namespace, 'context.node.namespace'),
      status: optionalString(raw.node.status, 'context.node.status'),
      project: optionalString(raw.node.project, 'context.node.project'),
      host: optionalString(raw.node.host, 'context.node.host'),
    },
  };
}

export function pluginUiContextMatches(
  extension: Pick<PluginUiExtensionDeclaration, 'context'>,
  context: PluginUiContext,
): boolean {
  const filter = extension.context;
  if (!filter) {
    return true;
  }
  const node = context.node;
  if (!node) {
    return false;
  }
  return (
    (!filter.runtimes?.length || Boolean(node.runtime && filter.runtimes.includes(node.runtime))) &&
    (!filter.kinds?.length || Boolean(node.kind && filter.kinds.includes(node.kind))) &&
    (!filter.statuses?.length || Boolean(node.status && filter.statuses.includes(node.status)))
  );
}

export function pluginUiSlotCapability(slot: PluginUiSlot): PluginCapability {
  return UI_CAPABILITY_BY_SLOT[slot];
}

export function hydratePluginUiExtension(
  pluginId: string,
  declaration: PluginUiExtensionDeclaration,
): PluginUiExtension {
  return {
    ...declaration,
    pluginId,
  };
}
