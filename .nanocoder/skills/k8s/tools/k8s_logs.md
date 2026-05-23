---
name: k8s_logs
description: Fetch container logs from a Kubernetes pod.
approval: never
read_only: true
parameters:
  pod:
    type: string
    description: Pod name.
    required: true
  namespace:
    type: string
    description: Kubernetes namespace.
    required: false
    default: default
---

kubectl logs {{ pod }} -n {{ namespace }} --tail=100