import type {
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
} from '../types.js';
import type {
  EntityActionDeclaration,
  EntityActionInput,
  EntityActionResult,
} from './entity-actions.js';

export interface EntityContext {
  nodeId: string;
  name: string;
  runtime?: string;
  kind?: string;
  status?: string;
  health?: string;
  metadata?: Record<string, string | number | boolean>;
}

export type EntityOperationId =
  | 'actions'
  | 'stats'
  | 'logs'
  | 'logStream'
  | 'inspect'
  | 'top'
  | 'diff'
  | 'diagnostic'
  | 'exec';

export interface EntityOperationDescriptor {
  id: EntityOperationId;
  pluginId: string;
  capability: string;
}

export interface EntityRef {
  entityId: string;
  sourceId?: string;
  nodeId?: string;
  context?: EntityContext;
}

export interface LogsOptions {
  tail?: number;
}

export interface RemoveOptions {
  volumes?: boolean;
}

export type LifecycleAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill';
export type ProjectAction = 'up' | 'down' | 'destroy' | 'stop' | 'start' | 'restart';
export type ResourceAction = 'delete' | 'restart' | 'set_hpa_constraints';

export interface ProjectSummary {
  name: string;
  running: number;
  stopped: number;
  pluginId?: string;
  providerId?: string;
}

export interface ResourceActionOptions {
  minReplicas?: number;
  maxReplicas?: number;
}

export interface EntityProvider {
  canHandle(ref: EntityRef): boolean | Promise<boolean>;
}

export interface EntityActionProvider extends EntityProvider {
  listActions(
    ref: EntityRef,
  ): readonly EntityActionDeclaration[] | Promise<readonly EntityActionDeclaration[]>;
  runAction(
    ref: EntityRef,
    actionId: string,
    input?: EntityActionInput,
  ): Promise<EntityActionResult | void>;
}

export interface EntityStatsProvider extends EntityProvider {
  getStats(ref: EntityRef): Promise<ContainerStats>;
}

export interface EntityLogsProvider extends EntityProvider {
  getLogs(ref: EntityRef, options?: LogsOptions): Promise<string>;
}

export interface EntityLogStreamProvider extends EntityProvider {
  streamLogs(
    ref: EntityRef,
    onData: (text: string) => void,
    onError?: (error: Error) => void,
  ): (() => void) | Promise<() => void>;
}

export interface EntityLifecycleProvider extends EntityProvider {
  runLifecycleAction(ref: EntityRef, action: LifecycleAction): Promise<void>;
  removeEntity(ref: EntityRef, options?: RemoveOptions): Promise<void>;
}

export interface EntityInspectProvider extends EntityProvider {
  inspect(ref: EntityRef): Promise<ContainerInspect>;
}

export interface EntityFilesystemProvider extends EntityProvider {
  getTop(ref: EntityRef): Promise<ContainerTopResult>;
  getDiff(ref: EntityRef): Promise<ContainerDiffEntry[]>;
}

export interface EntityDiagnosticProvider extends EntityProvider {
  diagnose(ref: EntityRef): Promise<CrashDiagnostic | null>;
}

export interface EntityExecSession {
  stream: NodeJS.ReadWriteStream;
  inspect: () => Promise<{ Running: boolean; ExitCode: number }>;
}

export interface EntityExecProvider extends EntityProvider {
  createExecSession(ref: EntityRef, command?: string[]): Promise<EntityExecSession>;
}

export interface ProjectProvider {
  id?: string;
  canHandle?(project: string): boolean | Promise<boolean>;
  listProjects(): Promise<ProjectSummary[]>;
  runProjectAction(project: string, action: ProjectAction): Promise<string>;
}

/** @deprecated Implement EntityLogsProvider and EntityActionProvider instead. */
export interface ResourceProvider {
  canHandle(resourceId: string): boolean | Promise<boolean>;
  getResourceLogs(resourceId: string, options?: LogsOptions): Promise<string>;
  runResourceAction(
    resourceId: string,
    action: ResourceAction,
    options?: ResourceActionOptions,
  ): Promise<void>;
}
