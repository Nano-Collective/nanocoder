---
name: k8s_pods
description: List pods in a Kubernetes namespace.
approval: never
read_only: true
parameters:
  namespace:
    type: string
    description: Kubernetes namespace.
    required: false
    default: default
---

kubectl get pods -n {{ namespace }} -o wide