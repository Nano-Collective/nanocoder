# Context Compression

Nanocoder includes a context compression system to manage token usage during extended conversations. This helps prevent hitting context limits and reduces costs when using paid APIs.

## Overview

As conversations grow longer, the context window fills up with message history. The compression system intelligently compresses older messages while preserving important information like:

- Recent messages (kept at full detail)
- Key decisions and choices made
- File modifications and their outcomes
- Tool execution results

## Manual Compression

Use the `/compact` command to manually compress your conversation history:

```bash
/compact              # Compress with default settings
/compact --preview    # Preview compression without applying
/compact --restore    # Restore from pre-compression backup
```

### Compression Modes

| Mode | Flag | Description |
|------|------|-------------|
| Default | (none) | Balanced compression - good for most cases |
| Conservative | `--conservative` | Preserves more content, less aggressive |
| Aggressive | `--aggressive` | Maximum compression, minimal content retention |

**Examples:**

```bash
/compact --aggressive    # Maximum token savings
/compact --conservative  # Preserve more detail
/compact --preview       # See what would be compressed
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
| `mode` | string | `"conservative"` | Compression mode: `"default"`, `"conservative"`, `"aggressive"` |
| `notifyUser` | boolean | `true` | Show notification when auto-compact runs |

### Session Overrides

Override auto-compact settings for the current session without modifying config files:

```bash
/compact --auto-on           # Enable auto-compact for this session
/compact --auto-off          # Disable auto-compact for this session
/compact --threshold 75      # Set threshold to 75% for this session
```

Session overrides are temporary and reset when you restart Nanocoder.

## How Compression Works

### What Gets Compressed

1. **User messages** - Long messages are summarized
2. **Assistant messages** - Verbose responses are truncated
3. **Tool results** - Detailed outputs are reduced to key information

### What Gets Preserved

1. **System messages** - Always kept intact
2. **Recent messages** - Last 2 messages kept at full detail (configurable)
3. **Tool calls** - Structure preserved for conversation continuity
4. **Error information** - Error types and resolution status retained

### Compression Thresholds

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

1. **Use preview first** - Run `/compact --preview` to see the impact before committing
2. **Start conservative** - Use `--conservative` mode if you're unsure
3. **Set reasonable thresholds** - 60-70% is a good auto-compact threshold
4. **Monitor after compression** - Check that important context wasn't lost

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
2. Consider using `--conservative` mode
3. Increase the threshold to delay compression
4. Disable auto-compact and use manual compression
