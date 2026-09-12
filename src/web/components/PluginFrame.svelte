<script lang="ts">
  import { onMount } from 'svelte';
  import type { PluginUiContext, PluginUiExtension } from '../../core/plugin-contract/ui';
  import { loadPluginFrontendSource, queryPluginUi } from '../lib/pluginUi';

  interface Props {
    extension: PluginUiExtension;
    context: PluginUiContext;
    actionAllowed: boolean;
    onAction: (input?: unknown) => Promise<void> | void;
  }

  let { extension, context, actionAllowed, onAction }: Props = $props();
  let frame = $state<HTMLIFrameElement | null>(null);
  let sourceDocument = $state('');
  let error = $state('');
  let frameHeight = $state(180);
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  $effect(() => {
    frameHeight = extension.height ?? 180;
  });

  function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 8192)));
    }
    return btoa(binary);
  }

  function buildDocument(source: string): string {
    const encodedSource = encodeBase64(source);
    const encodedContext = encodeBase64(JSON.stringify(context));
    const pluginId = JSON.stringify(extension.pluginId);
    const extensionId = JSON.stringify(extension.id);
    const view = JSON.stringify(extension.frontendView ?? extension.id);
    const bridgeToken = JSON.stringify(token);
    const scriptClose = '</scr' + 'ipt>';
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'">
<style>:root{color-scheme:dark;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbe7ef;background:transparent}*{box-sizing:border-box}html,body,#plugin-root{margin:0;min-height:100%;background:transparent}body{padding:1px}button,input,select{font:inherit}</style>
</head><body><div id="plugin-root"></div><script type="module">
const decode = (value) => new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
const pluginId = ${pluginId};
const extensionId = ${extensionId};
const token = ${bridgeToken};
const emit = (type, payload = {}) => parent.postMessage({ channel: 'dockscope-plugin-ui-v1', token, pluginId, extensionId, type, ...payload }, '*');
let sequence = 0;
let pendingQuery;
const query = () => {
  if (pendingQuery) return pendingQuery.promise;
  const requestId = ++sequence;
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const timer = setTimeout(() => {
    if (pendingQuery?.requestId === requestId) { pendingQuery = undefined; reject(new Error('Plugin query timed out')); }
  }, 20000);
  pendingQuery = { requestId, promise, resolve, reject, timer };
  emit('query', { requestId });
  return promise;
};
window.addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== parent || !message || message.channel !== 'dockscope-plugin-ui-v1' || message.token !== token || message.pluginId !== pluginId || message.extensionId !== extensionId || message.type !== 'queryResult' || !pendingQuery || message.requestId !== pendingQuery.requestId) return;
  const pending = pendingQuery;
  pendingQuery = undefined;
  clearTimeout(pending.timer);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(deepFreeze(message.content));
});
const api = Object.freeze({
  root: document.getElementById('plugin-root'),
  view: ${view},
  context: deepFreeze(JSON.parse(decode(${JSON.stringify(encodedContext)}))),
  requestAction: (input) => emit('action', { input }),
  query,
  resize: (height) => emit('resize', { height }),
});
try {
  const url = URL.createObjectURL(new Blob([decode(${JSON.stringify(encodedSource)})], { type: 'text/javascript' }));
  const module = await import(url);
  URL.revokeObjectURL(url);
  const mount = module.mount ?? module.default;
  if (typeof mount !== 'function') throw new Error('Frontend bundle must export default or mount');
  await mount(api);
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  document.getElementById('plugin-root').textContent = message;
  emit('error', { message });
}
${scriptClose}</body></html>`;
  }

  onMount(() => {
    let active = true;
    let queryPending = false;
    const controller = new AbortController();
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || typeof event.data !== 'object' || !event.data) {
        return;
      }
      const message = event.data as Record<string, unknown>;
      if (
        message.channel !== 'dockscope-plugin-ui-v1' ||
        message.token !== token ||
        message.pluginId !== extension.pluginId ||
        message.extensionId !== extension.id
      ) {
        return;
      }
      if (message.type === 'action' && actionAllowed) {
        void onAction(message.input);
      } else if (message.type === 'query' && Number.isSafeInteger(message.requestId)) {
        const requestId = message.requestId;
        const reply = (result: Record<string, unknown>) => {
          if (active) {
            frame?.contentWindow?.postMessage(
              {
                channel: 'dockscope-plugin-ui-v1',
                token,
                pluginId: extension.pluginId,
                extensionId: extension.id,
                type: 'queryResult',
                requestId,
                ...result,
              },
              '*',
            );
          }
        };
        if (!extension.query || queryPending) {
          reply({
            error: !extension.query
              ? 'This view does not declare a query'
              : 'A query is already pending',
          });
          return;
        }
        queryPending = true;
        void queryPluginUi(extension, context, controller.signal)
          .then((content) => reply({ content }))
          .catch((cause) =>
            reply({ error: cause instanceof Error ? cause.message : 'Plugin query failed' }),
          )
          .finally(() => {
            queryPending = false;
          });
      } else if (
        message.type === 'resize' &&
        typeof message.height === 'number' &&
        Number.isFinite(message.height)
      ) {
        frameHeight = Math.max(48, Math.min(640, Math.round(message.height)));
      } else if (message.type === 'error' && typeof message.message === 'string') {
        error = message.message;
      }
    };
    window.addEventListener('message', handleMessage);
    loadPluginFrontendSource(extension.pluginId)
      .then((source) => {
        if (active) {
          sourceDocument = buildDocument(source);
        }
      })
      .catch((cause) => {
        if (active) {
          error = cause instanceof Error ? cause.message : 'Plugin frontend failed to load';
        }
      });
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener('message', handleMessage);
    };
  });
</script>

{#if error && !sourceDocument}
  <div class="frame-error">{error}</div>
{:else if sourceDocument}
  <iframe
    bind:this={frame}
    title={`${extension.title} plugin view`}
    sandbox="allow-scripts"
    srcdoc={sourceDocument}
    style:height={`${frameHeight}px`}
  ></iframe>
{:else}
  <div class="frame-loading">Loading view...</div>
{/if}

<style>
  iframe {
    display: block;
    width: 100%;
    min-height: 48px;
    border: 0;
    background: transparent;
  }

  .frame-loading,
  .frame-error {
    min-height: 48px;
    display: grid;
    place-items: center;
    padding: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .frame-error {
    color: var(--accent-red);
  }
</style>
