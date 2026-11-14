---
'@nanocollective/nanocoder': patch
---

Handle server-initiated LSP requests without resolving colliding client requests. Workspace configuration and workspace-folder requests receive appropriate responses; unsupported requests receive a method-not-found error. Advertise workspace-folder support, but not workspace-edit support, which the client does not implement.
