import type { PluginCommandDeclaration } from '../core/plugin-commands.js';
import type { PluginConfig } from '../core/plugin-config.js';
import type { PluginManifest } from '../core/plugins.js';
import type { PluginUiExtensionDeclaration } from '../core/plugin-ui.js';
import type { DataSourceDescriptor } from '../core/model.js';
import type { EntityActionInput } from '../core/entity-actions.js';
import type { MetricAnalysisSample } from '../core/plugin-analysis.js';
import type { PluginConnectionProviderDeclaration } from '../core/plugin-connections.js';
import type {
  EntityRef,
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
} from '../core/operations.js';

export interface SandboxBootstrap {
  entryPath: string;
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
}

export type SandboxEntityProviderKind =
  | 'action'
  | 'metricAnalysis'
  | 'stats'
  | 'logs'
  | 'logStream'
  | 'lifecycle'
  | 'inspect'
  | 'filesystem'
  | 'diagnostic'
  | 'exec';

export interface SandboxProviderCounts {
  action: number;
  metricAnalysis: number;
  stats: number;
  logs: number;
  logStream: number;
  lifecycle: number;
  inspect: number;
  filesystem: number;
  diagnostic: number;
  exec: number;
  project: number;
  resource: number;
  system: number;
}

export interface SandboxGraphSourceDescriptor {
  descriptor: DataSourceDescriptor;
  supportsEvents: boolean;
}

export interface SandboxPluginDescriptor {
  manifest: PluginManifest;
  graphSources: SandboxGraphSourceDescriptor[];
  providers: SandboxProviderCounts;
  commands: PluginCommandDeclaration[];
  ui: PluginUiExtensionDeclaration[];
  connectionProviders: PluginConnectionProviderDeclaration[];
}

export type SandboxRequestOperation =
  | { type: 'initialize'; bootstrap: SandboxBootstrap }
  | { type: 'configure'; config: PluginConfig }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'runCommand'; commandId: string; input?: unknown }
  | { type: 'runtimeMetrics' }
  | { type: 'collectGraph'; sourceId: string }
  | { type: 'listSystems'; providerIndex: number }
  | { type: 'listConnections'; providerIndex: number }
  | { type: 'addConnection'; providerIndex: number; input: PluginConfig }
  | { type: 'removeConnection'; providerIndex: number; connectionId: string }
  | { type: 'refreshConnections'; providerIndex: number }
  | {
      type: 'canHandleEntity';
      provider: SandboxEntityProviderKind;
      providerIndex: number;
      ref: EntityRef;
    }
  | { type: 'getStats'; providerIndex: number; ref: EntityRef }
  | { type: 'analyzeMetric'; providerIndex: number; sample: MetricAnalysisSample }
  | { type: 'listEntityActions'; providerIndex: number; ref: EntityRef }
  | {
      type: 'runEntityAction';
      providerIndex: number;
      ref: EntityRef;
      actionId: string;
      input?: EntityActionInput;
    }
  | { type: 'getLogs'; providerIndex: number; ref: EntityRef; options?: LogsOptions }
  | {
      type: 'runLifecycleAction';
      providerIndex: number;
      ref: EntityRef;
      action: LifecycleAction;
    }
  | {
      type: 'removeEntity';
      providerIndex: number;
      ref: EntityRef;
      options?: RemoveOptions;
    }
  | { type: 'inspect'; providerIndex: number; ref: EntityRef }
  | { type: 'getTop'; providerIndex: number; ref: EntityRef }
  | { type: 'getDiff'; providerIndex: number; ref: EntityRef }
  | { type: 'diagnose'; providerIndex: number; ref: EntityRef }
  | { type: 'listProjects'; providerIndex: number }
  | { type: 'canHandleProject'; providerIndex: number; project: string }
  | {
      type: 'runProjectAction';
      providerIndex: number;
      project: string;
      action: ProjectAction;
    }
  | { type: 'canHandleResource'; providerIndex: number; resourceId: string }
  | {
      type: 'getResourceLogs';
      providerIndex: number;
      resourceId: string;
      options?: LogsOptions;
    }
  | {
      type: 'runResourceAction';
      providerIndex: number;
      resourceId: string;
      action: ResourceAction;
      options?: ResourceActionOptions;
    }
  | { type: 'startGraphEvents'; sourceId: string; streamId: string }
  | {
      type: 'startLogStream';
      providerIndex: number;
      ref: EntityRef;
      streamId: string;
    }
  | {
      type: 'startExecSession';
      providerIndex: number;
      ref: EntityRef;
      command?: string[];
      streamId: string;
    }
  | { type: 'inspectExecSession'; streamId: string }
  | { type: 'stopStream'; streamId: string };

export type SandboxNotificationOperation =
  | { type: 'execInput'; streamId: string; data: string | Uint8Array }
  | { type: 'stopStream'; streamId: string };

export interface SandboxRequestMessage {
  type: 'request';
  requestId: string;
  operation: SandboxRequestOperation;
}

export interface SandboxNotificationMessage {
  type: 'notification';
  operation: SandboxNotificationOperation;
}

export type SandboxParentMessage =
  | SandboxRequestMessage
  | SandboxNotificationMessage
  | SandboxHostResultMessage;

export interface SandboxResultMessage {
  type: 'result';
  requestId: string;
  result?: unknown;
}

export interface SandboxErrorMessage {
  type: 'error';
  requestId: string;
  message: string;
}

export interface SandboxEventMessage {
  type: 'event';
  eventType: string;
  payload: unknown;
}

export interface SandboxStreamMessage {
  type: 'stream';
  streamId: string;
  event: 'data' | 'error' | 'end';
  data?: unknown;
  message?: string;
}

export interface SandboxLogMessage {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  args: unknown[];
}

export type SandboxHostCall =
  | { method: 'readTextFile'; relativePath: string }
  | { method: 'writeTextFile'; relativePath: string; contents: string }
  | { method: 'fetchJson'; url: string; init?: RequestInit }
  | { method: 'execFile'; command: string; args: string[] }
  | { method: 'readSecret'; key: string }
  | { method: 'readStorage'; key: string }
  | { method: 'writeStorage'; key: string; value: unknown }
  | { method: 'deleteStorage'; key: string }
  | { method: 'publishEvent'; eventType: string; payload: unknown };

export interface SandboxHostCallMessage {
  type: 'hostCall';
  callId: string;
  call: SandboxHostCall;
}

export interface SandboxHostResultMessage {
  type: 'hostResult';
  callId: string;
  result?: unknown;
  error?: string;
}

export type SandboxWorkerMessage =
  | SandboxResultMessage
  | SandboxErrorMessage
  | SandboxEventMessage
  | SandboxStreamMessage
  | SandboxLogMessage
  | SandboxHostCallMessage;
