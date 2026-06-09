# Nanocoder Devcontainer

A complete, containerized development environment for Nanocoder - the local-first AI coding assistant.

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/Nano-Collective/nanocoder.git
   cd nanocoder
   ```

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Reopen in Container**
   - When VS Code prompts "Reopen in Container", click **"Reopen in Container"**
   - Or press `F1` and select `Dev Containers: Reopen in Container`

4. **Wait for Setup**
   - The container will build on first use (~2-3 minutes)
   - Dependencies will be installed automatically
   - The project will be built automatically
   - You're ready when you see "✨ Development environment ready!" in the terminal

5. **Start Development**
   ```bash
   # Run development mode with hot reload
   pnpm run dev

   # Run all tests
   pnpm test:all

   # Start the application
   pnpm run start
   ```

## What's Included

### Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 22.x LTS | JavaScript/TypeScript runtime |
| **pnpm** | pinned via `packageManager` (Corepack) | Fast, disk-efficient package manager |
| **Biome** | Latest | Fast formatter and linter |
| **Git** | Latest | Version control |
| **Zsh** + **Oh My Zsh** | Latest | Enhanced shell experience |

### VS Code Extensions

The following extensions are pre-installed:

- **Biome** - Code formatting and linting
- **TypeScript** - Enhanced TypeScript support
- **GitLens** - Git supercharged
- **Prettier** - Code formatting (alternative)

### Pre-configured Settings

- **Biome** is set as the default formatter
- **Format on save** is enabled
- **Organize imports on save** is enabled
- **TypeScript** uses the workspace version
- **Zsh** is configured as the default shell

## Features

### Zero-Setup Development

All dependencies and tools are pre-installed in the container. No manual setup required on your host machine.

### Consistent Environment

Every developer gets the exact same tools and versions, eliminating "works on my machine" issues.

### Fast Dependency Installation

The pnpm store is cached in a named volume, making subsequent `pnpm install` commands much faster.

### Network Access

Full network access is enabled for:
- Testing MCP servers (HTTP/WebSocket/stdio)
- Fetching AI models via APIs
- Installing dependencies from npm registry

### Git Integration

- Git operations work seamlessly inside the container
- Pre-commit hooks (Husky) are configured automatically
- Git credentials can be mounted for authenticated operations

## Development Workflow

### 1. Configure AI Providers

Edit `.env` or `agents.config.json` to add your AI provider credentials:

```bash
# Edit the example .env file created during setup
nano .env
```

```env
# Example: OpenAI
OPENAI_API_KEY=sk-...

# Example: Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Example: OpenAI-compatible
OPENAI_COMPATIBLE_API_KEY=your-key
OPENAI_COMPATIBLE_BASE_URL=https://api.example.com/v1
```

### 2. Development Mode

Run the application with hot reload:

```bash
pnpm run dev
```

### 3. Run Tests

Execute the complete test suite:

```bash
pnpm test:all
```

Individual test commands:

```bash
pnpm test:format    # Biome formatting check
pnpm test:types     # TypeScript type checking
pnpm test:lint      # ESLint
pnpm test:ava       # AVA test runner
pnpm test:knip      # Unused code detection
```

### 4. Build for Production

```bash
pnpm run build
```

### 5. Run Built Application

```bash
pnpm run start
```

## Troubleshooting

### Container Won't Start

**Problem:** Container fails to build or start

**Solutions:**
- Ensure Docker Desktop is running
- Check Docker disk space (Docker > Settings > Resources > Disk image size)
- Try rebuilding: `Dev Containers: Rebuild Container` from command palette

### Dependencies Won't Install

**Problem:** `pnpm install` fails during post-create setup

**Solutions:**
- Check network connectivity
- Try manual install: `pnpm install --frozen-lockfile`
- Clear pnpm cache: `pnpm store prune`

### Git Operations Fail

**Problem:** Cannot push/pull from Git

**Solutions:**
- Configure SSH keys in the container
- Or mount your `.gitconfig` with credential helpers
- Uncomment the Git volume mount in `docker-compose.yml`

### Performance Issues

**Problem:** File operations are slow

**Solutions:**
- Ensure you're using named volumes (not bind mounts) for pnpm cache
- Check Docker Desktop resource limits
- Use `.dockerignore` to exclude unnecessary files

### VS Code Extensions Don't Load

**Problem:** Extensions not available in container

**Solutions:**
- Rebuild the container: `Dev Containers: Rebuild Container`
- Check `.devcontainer/devcontainer.json` for extension list
- Install manually: `Extensions: Install Extensions` command

## Advanced Usage

### Custom Shell Configuration

Edit `/home/vscode/.zshrc` inside the container to customize your shell:

```bash
# Open zsh config in container
code ~/.zshrc
```

### Mounting Git Credentials

To use your host's Git credentials, uncomment this line in `docker-compose.yml`:

```yaml
volumes:
  - ${HOME}/.gitconfig:/home/vscode/.gitconfig:ro
```

### Exposing Additional Ports

Add ports to `docker-compose.yml`:

```yaml
ports:
  - "51820:51820"  # VS Code extension
  - "3000:3000"    # Your custom port
```

### Environment Variables

Add custom environment variables in `docker-compose.yml`:

```yaml
environment:
  NODE_ENV: development
  MY_CUSTOM_VAR: "value"
```

### Connecting to Local Services

To connect to services running on your host machine:

- **macOS/Windows**: Use `host.docker.internal`
- **Linux**: Use `172.17.0.1` (default Docker bridge IP)

Example:
```env
# In .env
API_BASE_URL=http://host.docker.internal:3000
```

### Container Shell Access

Open a terminal inside the container:
- VS Code: `Terminal > Create New Terminal`
- Docker CLI: `docker exec -it nanocoder-dev zsh`

### Cleaning Up

Remove the container and volumes to start fresh:

```bash
# Stop and remove container
docker-compose down

# Remove pnpm cache volume
docker volume rm nanocoder-pnpm-store

# Rebuild from scratch
# In VS Code: Dev Containers: Rebuild Container
```

## Architecture

### Container Image

- **Base**: `mcr.microsoft.com/devcontainers/base:ubuntu-22.04`
- **User**: Non-root `vscode` user for security
- **Size**: ~1.5GB (acceptable for development)

### Volume Mounts

| Mount | Purpose | Persistence |
|-------|---------|-------------|
| `/workspaces/nanocoder` | Project source code | Host filesystem |
| `nanocoder-pnpm-store` | pnpm package cache | Named volume |

### Network

- **Mode**: Bridge (default)
- **Access**: Full network access for MCP testing
- **Ports**: 51820 forwarded to host

## Support

- **Issues**: [GitHub Issues](https://github.com/Nano-Collective/nanocoder/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Nano-Collective/nanocoder/discussions)
- **Documentation**: [Main README](../README.md)

## Related Documentation

- [Contributing Guide](../CONTRIBUTING.md) - Overall contribution guidelines
- [OpenSpec Proposal](../openspec/changes/add-devcontainer-support/) - Design and specs
- [Main README](../README.md) - Project overview and usage
