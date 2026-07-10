import type {
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
} from '../types.js';

export interface EntityRef {
  entityId: string;
  sourceId?: string;
  nodeId?: string;
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
}

export interface ResourceActionOptions {
  minReplicas?: number;
  maxReplicas?: number;
}

export interface EntityProvider {
  canHandle(ref: EntityRef): boolean | Promise<boolean>;
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
  listProjects(): Promise<ProjectSummary[]>;
  runProjectAction(project: string, action: ProjectAction): Promise<string>;
}

export interface ResourceProvider {
  canHandle(resourceId: string): boolean | Promise<boolean>;
  getResourceLogs(resourceId: string, options?: LogsOptions): Promise<string>;
  runResourceAction(
    resourceId: string,
    action: ResourceAction,
    options?: ResourceActionOptions,
  ): Promise<void>;
}
