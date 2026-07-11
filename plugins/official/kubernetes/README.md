# DockScope Kubernetes Plugin

External Kubernetes provider for DockScope.

## Capabilities

- Adds Pods, Services, Ingresses, and HPAs to the DockScope graph.
- Links Services to selected Pods, Ingresses to Services, and HPAs to inferred target Pods.
- Reads Pod logs.
- Deletes Kubernetes resources.
- Restarts Pods or backing Pods for Services, Ingresses, and HPAs.
- Updates HPA minimum and maximum replica constraints.
- Advertises contextual actions through DockScope's generic entity action contract.

## Requirements

The plugin calls `kubectl` through DockScope's restricted plugin host API. The machine running DockScope must have `kubectl` installed and configured for the target cluster.

Required permissions:

- `process.exec` to run `kubectl`
- `kubernetes.api` to document cluster API access in plugin review

## Development

```bash
dockscope plugin:dev --plugins plugins/official/kubernetes --plugin-permissions all
```
