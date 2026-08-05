# DockScope Kubernetes Plugin

External Kubernetes provider for DockScope. It talks to the cluster API
directly through `@kubernetes/client-node`, so `kubectl` does not need to be
installed.

## What it adds

**On the graph**

- Deployments, StatefulSets, DaemonSets, Pods, Services, Ingresses and
  HorizontalPodAutoscalers, alongside your containers.
- Pods attach to the controller that owns them, resolved through the
  `Pod -> ReplicaSet -> Deployment` chain. The ReplicaSet itself is never drawn.
- Services link to the Pods they select, Ingresses to their Services, and an
  HPA to the workload named by its `scaleTargetRef`.

**Per entity**

| Tab  | What you get                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------- |
| Info | Pod CPU and memory from `metrics.k8s.io`                                                       |
| Env  | Env, labels and volume mounts. Secret and configMap references stay references, never resolved |
| Logs | A tail, or a followed stream                                                                   |
| Exec | An interactive shell in a Pod                                                                  |

**Actions**

| Action                | Applies to                                                          |
| --------------------- | ------------------------------------------------------------------- |
| `restart`             | Deployments, StatefulSets, DaemonSets, as `kubectl rollout restart` |
| `scale`               | Deployments and StatefulSets                                        |
| `set_hpa_constraints` | HPA minimum and maximum replicas                                    |
| `delete`              | Any resource the plugin renders                                     |

There is no restart on a Pod: deleting one just has its controller make an
identical replacement, so rolling the controller is the operation offered.

## Requirements

- A reachable cluster and a kubeconfig. Discovery follows `$KUBECONFIG` then
  `~/.kube/config`; set the **Kubeconfig path** config field to override it.
- metrics-server, for Pod CPU and memory only. Everything else works without it.
- The `kubernetes.api` permission.

The plugin degrades rather than failing: a cluster that refuses a resource kind
(a read-only ServiceAccount with no `apps/v1` access, or a cluster older than
1.23 with no `autoscaling/v2`) still renders everything it can read. Only a
cluster that answers nothing at all is reported as unreachable.

## Development

```bash
dockscope plugin:dev --plugins plugins/official/kubernetes --plugin-permissions all
```

Tests run against fixtures, with no cluster needed:

```bash
npm test
```

CI additionally exercises the plugin against a real kind cluster; see
`scripts/k8s-e2e/`.
