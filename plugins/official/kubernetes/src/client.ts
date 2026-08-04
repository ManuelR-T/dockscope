import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  Log,
  NetworkingV1Api,
  PatchStrategy,
  setHeaderOptions,
} from '@kubernetes/client-node';
import { ObjectAutoscalingV2Api } from '@kubernetes/client-node/dist/gen/types/ObjectParamAPI';

/**
 * Every patch in this plugin must pass this as the request options.
 *
 * The generated client picks the first media type it advertises, which is
 * `application/json-patch+json`. That expects an RFC 6902 array of ops, so
 * sending the natural `{ spec: { ... } }` object made the API server reject the
 * request with "cannot unmarshal object into Go value of type
 * []handlers.jsonPatchOp". Strategic merge is what kubectl uses and what these
 * bodies are written for.
 */
export const mergePatchOptions = setHeaderOptions(
  'Content-Type',
  PatchStrategy.StrategicMergePatch,
);

export interface KubeClient {
  coreApi: CoreV1Api;
  appsApi: AppsV1Api;
  autoScalingApi: ObjectAutoscalingV2Api;
  networkingApi: NetworkingV1Api;
  logs: Log;
}

export function makeKubeClient(kc: KubeConfig): KubeClient {
  return {
    coreApi: kc.makeApiClient(CoreV1Api),
    appsApi: kc.makeApiClient(AppsV1Api),
    autoScalingApi: kc.makeApiClient(ObjectAutoscalingV2Api),
    networkingApi: kc.makeApiClient(NetworkingV1Api),
    logs: new Log(kc),
  };
}
