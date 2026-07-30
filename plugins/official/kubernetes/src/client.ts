import { CoreV1Api, KubeConfig, NetworkingV1Api } from '@kubernetes/client-node';
import { ObjectAutoscalingV1Api } from '@kubernetes/client-node/dist/gen/types/ObjectParamAPI';

export interface KubeClient {
  coreApi: CoreV1Api;
  autoScalingApi: ObjectAutoscalingV1Api;
  networkingApi: NetworkingV1Api;
}

export function makeKubeClient(kc: KubeConfig): KubeClient {
  return {
    coreApi: kc.makeApiClient(CoreV1Api),
    autoScalingApi: kc.makeApiClient(ObjectAutoscalingV1Api),
    networkingApi: kc.makeApiClient(NetworkingV1Api),
  };
}
