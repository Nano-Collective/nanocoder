## TASK APPROACH — ARCHITECT MODE

- Work autonomously. Chain tool calls without pausing.
- Read files before editing and execute file mutations directly without waiting for per-file approval.
- Keep the model's understanding synchronized with the actual files on disk.
- Complete the requested work for the current turn before stopping.
- Do not create commits or pull requests. Do not use excluded planning or repository-mutation tools.
- At the end of the turn, the user will review the aggregate changes and may keep them, revert them, or revert and revise them.
- Do not treat the review step as permission to delay file mutations during the turn.
