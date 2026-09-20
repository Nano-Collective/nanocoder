---
title: "Context Compression"
description: "Manage token usage during extended conversations with intelligent compression"
sidebar_order: 3
---

# Context Compression

Every message in your conversation takes up space in the model's context window. In long sessions, you'll eventually hit the limit — the AI loses access to earlier messages and starts losing track of what you've discussed. Context compression solves this by intelligently condensing older messages while keeping the important parts.

This matters most when you're on extended coding sessions or using paid APIs where token usage affects cost.

## How It Works

Nanocoder has two compaction strategies, both available manually (`/compact`) and for auto-compact:

- **`llm` (default)** — Calls the active model to write a structured markdown summary of the older messages (context, decisions, files modified, tools used, open questions). The older messages are replaced with a single synthetic summary message, while the most recent messages are kept verbatim. Higher fidelity at the cost of one extra round-trip.
- **`mechanical`** — Truncates each older message individually using regex heuristics. No network call, faster, lower fidelity. Used automatically as a fallback if the LLM path fails (network error, empty response, summary larger than original, etc.).

Either way, the system preserves:

- Recent messages (kept at full detail)
- Tool calls and their structure
- File modifications and tool results

## Manual Compression

Use the `/compact` command to manually compress your conversation history:

```bash
/compact              # Compress using the current strategy (LLM by default)
/compact --preview    # Preview compression without applying
/compact --restore    # Restore from pre-compression backup
```

### Strategy Flags

| Strategy | Flag | Description |
|----------|------|-------------|
| LLM (default) | `--llm` | Force LLM summarisation for this invocation |
| Mechanical | `--mechanical` | Force mechanical (regex) compression for this invocation |
| Session-wide | `--strategy llm` / `--strategy mechanical` | Persist strategy for the current session |

### Mechanical Compression Modes

These only apply to the mechanical strategy:

| Mode | Flag | Description |
|------|------|-------------|
| Default | (none) | Balanced compression — good for most cases |
| Conservative | `--conservative` | Preserves more content, less aggressive |
| Aggressive | `--aggressive` | Maximum compression, minimal content retention |

**Examples:**

```bash
/compact                              # LLM summary (default)
/compact --mechanical --aggressive    # Mechanical maximum token savings
/compact --mechanical --conservative  # Mechanical preserving more detail
/compact --preview                    # See what would be compressed
/compact --strategy mechanical        # Switch this session to mechanical
```

### Restore from Backup

Before compression is applied, a backup is automatically created. You can restore to the pre-compression state:

```bash
/compact --restore
```

> **Note:** Only one backup is stored at a time. A new compression overwrites the previous backup.

## Auto-Compact

Nanocoder can automatically compress the context when it reaches a certain percentage of the model's context limit.

### Configuration

Add auto-compact settings to your `agents.config.json`:

```json
{
  "nanocoder": {
    "autoCompact": {
      "enabled": true,
      "threshold": 60,
      "strategy": "llm",
      "mode": "conservative",
      "notifyUser": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable auto-compact |
| `threshold` | number | `60` | Context usage percentage to trigger compression (50-95) |
| `strategy` | string | `"llm"` | Compaction strategy: `"llm"` or `"mechanical"` |
| `mode` | string | `"conservative"` | Mechanical compression mode: `"default"`, `"conservative"`, `"aggressive"` (ignored when strategy is `"llm"`) |
| `notifyUser` | boolean | `true` | Show notification when auto-compact runs |

### Session Overrides

Override auto-compact settings for the current session without modifying config files:

```bash
/compact --auto-on              # Enable auto-compact for this session
/compact --auto-off             # Disable auto-compact for this session
/compact --threshold 75         # Set threshold to 75% for this session
/compact --strategy llm         # Use LLM summaries for this session
/compact --strategy mechanical  # Use mechanical compression for this session
```

Session overrides are temporary and reset when you restart Nanocoder.

## How Compression Works

### LLM Strategy (default)

The older portion of the conversation is serialised as a transcript and sent to the active model with a focused summariser prompt. The model returns a structured markdown summary covering:

- **Context** — what the user is working on and current state
- **Decisions** — choices made by the user or agent that should not be revisited
- **Files modified** — each touched file and what changed
- **Tools used** — notable tool invocations and their outcomes
- **Open questions / TODO** — anything unresolved or deferred

The synthetic summary replaces the older messages while the most recent ones are kept verbatim. During the LLM round-trip, the input is locked so you can't accidentally submit a new message mid-compaction.

If the model errors, returns nothing, or somehow produces a summary larger than the original, Nanocoder automatically falls back to the mechanical strategy for that invocation.

### Mechanical Strategy

Each older message is truncated individually using regex heuristics:

1. **User messages** — Long messages are summarized
2. **Assistant messages** — Verbose responses are truncated
3. **Tool results** — Detailed outputs are reduced to key information

While preserving:

1. **System messages** — Always kept intact
2. **Recent messages** — Last 2 messages kept at full detail (configurable)
3. **Tool calls** — Structure preserved for conversation continuity
4. **Error information** — Error types and resolution status retained

#### Mechanical Compression Thresholds

| Content Type | Default Mode | Aggressive Mode | Conservative Mode |
|--------------|--------------|-----------------|-------------------|
| User messages | >500 chars | >500 chars | >1000 chars |
| Assistant messages | >500 chars | >500 chars | Preserved |
| Assistant w/ tools | >300 chars | >300 chars | Preserved |

## Viewing Context Usage

Use `/status` or `/usage` to see your current context utilization:

```bash
/status    # Shows context usage along with other status info
/usage     # Visual display of context usage
```

## Best Practices

1. **Use preview first** — Run `/compact --preview` to see the impact before committing
2. **Stick with LLM by default** — Higher fidelity than mechanical and falls back automatically if the model is unreachable
3. **Switch to mechanical** for offline/local models without tool-grade summarisation, or when you want zero extra API cost
4. **Set reasonable thresholds** — 60-70% is a good auto-compact threshold
5. **Monitor after compression** — Check that important context wasn't lost

## Troubleshooting

### "No backup available to restore"

This means either:
- No compression has been performed yet
- The backup was already restored and cleared
- Nanocoder was restarted (backups don't persist across sessions)

### Auto-compact not triggering

Check that:
1. Auto-compact is enabled in config or via `--auto-on`
2. Threshold is set appropriately (default is 60%)
3. Current usage is above the threshold (check with `/status`)

### Compression removed important context

1. Use `/compact --restore` immediately if backup is available
2. If you were on the mechanical strategy, try `/compact --strategy llm` for higher fidelity
3. Consider using `--conservative` mode (mechanical only)
4. Increase the threshold to delay compression
5. Disable auto-compact and use manual compression

### LLM compaction always falls back to mechanical

If you see "LLM summary unavailable - falling back to mechanical compaction." every time, the summariser call is failing. Check:

1. The active provider/model is reachable and responding
2. The model's context window is large enough to fit the compressible segment (the summariser call sends the older messages as a transcript)
3. Provider isn't rate-limiting the request
