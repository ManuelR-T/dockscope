import {
  validatePluginConfigSchema,
  type PluginConfig,
  type PluginConfigSchema,
} from './plugin-config.js';
import { isPluginCapability, type PluginCapability } from './capabilities.js';

export type EntityActionPlacement = 'primary' | 'menu';
export type EntityActionTone = 'neutral' | 'success' | 'warning' | 'danger';
export type EntityActionEffect = 'none' | 'refresh' | 'remove';

export interface EntityActionConfirmation {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'warning' | 'danger';
  typeToConfirm?: string;
}

export interface EntityActionDeclaration {
  id: string;
  title: string;
  description?: string;
  capability: PluginCapability;
  icon?: string;
  placement?: EntityActionPlacement;
  tone?: EntityActionTone;
  effect?: EntityActionEffect;
  confirm?: EntityActionConfirmation;
  input?: PluginConfigSchema;
}

export interface EntityAction extends EntityActionDeclaration {
  pluginId: string;
}

export interface EntityActionResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

const ACTION_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
const ACTION_PLACEMENTS = new Set<EntityActionPlacement>(['primary', 'menu']);
const ACTION_TONES = new Set<EntityActionTone>(['neutral', 'success', 'warning', 'danger']);
const ACTION_EFFECTS = new Set<EntityActionEffect>(['none', 'refresh', 'remove']);

export class EntityActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityActionError';
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
    throw new EntityActionError(`Entity action field "${field}" must be a non-empty string`);
  }
  return value;
}

function validateConfirmation(
  value: unknown,
  actionId: string,
): EntityActionConfirmation | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isNonEmptyString(value.title) || !isNonEmptyString(value.message)) {
    throw new EntityActionError(
      `Entity action "${actionId}" confirmation requires title and message`,
    );
  }
  if (value.variant !== undefined && value.variant !== 'warning' && value.variant !== 'danger') {
    throw new EntityActionError(`Entity action "${actionId}" has an invalid confirmation variant`);
  }
  return {
    title: value.title,
    message: value.message,
    confirmLabel: optionalString(value.confirmLabel, `${actionId}.confirmLabel`),
    variant: value.variant,
    typeToConfirm: optionalString(value.typeToConfirm, `${actionId}.typeToConfirm`),
  };
}

function validateEntityAction(raw: unknown): EntityActionDeclaration {
  if (!isRecord(raw) || !isNonEmptyString(raw.id)) {
    throw new EntityActionError('Entity actions require an id');
  }
  if (!ACTION_ID_PATTERN.test(raw.id)) {
    throw new EntityActionError(`Invalid entity action id: ${raw.id}`);
  }
  if (!isNonEmptyString(raw.title)) {
    throw new EntityActionError(`Entity action "${raw.id}" requires a title`);
  }
  if (!isPluginCapability(raw.capability) || !raw.capability.startsWith('action.')) {
    throw new EntityActionError(`Entity action "${raw.id}" requires an action capability`);
  }
  if (
    raw.placement !== undefined &&
    (typeof raw.placement !== 'string' ||
      !ACTION_PLACEMENTS.has(raw.placement as EntityActionPlacement))
  ) {
    throw new EntityActionError(`Entity action "${raw.id}" has an invalid placement`);
  }
  if (
    raw.tone !== undefined &&
    (typeof raw.tone !== 'string' || !ACTION_TONES.has(raw.tone as EntityActionTone))
  ) {
    throw new EntityActionError(`Entity action "${raw.id}" has an invalid tone`);
  }
  if (
    raw.effect !== undefined &&
    (typeof raw.effect !== 'string' || !ACTION_EFFECTS.has(raw.effect as EntityActionEffect))
  ) {
    throw new EntityActionError(`Entity action "${raw.id}" has an invalid effect`);
  }
  return {
    id: raw.id,
    title: raw.title,
    description: optionalString(raw.description, `${raw.id}.description`),
    capability: raw.capability,
    icon: optionalString(raw.icon, `${raw.id}.icon`),
    placement: (raw.placement as EntityActionPlacement | undefined) ?? 'menu',
    tone: (raw.tone as EntityActionTone | undefined) ?? 'neutral',
    effect: (raw.effect as EntityActionEffect | undefined) ?? 'refresh',
    confirm: validateConfirmation(raw.confirm, raw.id),
    input: raw.input === undefined ? undefined : validatePluginConfigSchema(raw.input),
  };
}

export function validateEntityActions(raw: unknown): EntityActionDeclaration[] {
  if (!Array.isArray(raw)) {
    throw new EntityActionError('Entity actions must be an array');
  }
  const actions = raw.map(validateEntityAction);
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) {
      throw new EntityActionError(`Duplicate entity action id: ${action.id}`);
    }
    ids.add(action.id);
  }
  return actions;
}

export function hydrateEntityAction(
  pluginId: string,
  declaration: EntityActionDeclaration,
): EntityAction {
  return { ...declaration, pluginId };
}

export function validateEntityActionResult(raw: unknown): EntityActionResult {
  if (raw === undefined) {
    return { ok: true };
  }
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    throw new EntityActionError('Entity action result requires an ok boolean');
  }
  return {
    ok: raw.ok,
    message: optionalString(raw.message, 'result.message'),
    data: raw.data,
  };
}

export type EntityActionInput = PluginConfig;
