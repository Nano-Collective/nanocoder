# k8s

Kubernetes operational helpers for managing clusters, pods, and logs.

## Commands

- **k8s** - Routes Kubernetes operations to a specialized k8s-agent with subcommands for status, logs, and manifest validation

## Tools

- **k8s_pods** - List pods in a Kubernetes namespace (read-only, no approval needed)
- **k8s_logs** - Fetch container logs from a Kubernetes pod (read-only, no approval needed)

## File Watching

Automatically validates Kubernetes YAML manifests when they change. Prompts for confirmation before applying changes.

## Usage

```bash
# List pods in default namespace
k8s status

# List pods in specific namespace
k8s status -n kube-system

# Fetch logs from a pod
k8s logs my-pod -n default

# Validate a manifest
k8s validate ./deployment.yaml
```

## Requirements

- `kubectl` configured with access to your Kubernetes cluster
- Valid kubeconfig context
