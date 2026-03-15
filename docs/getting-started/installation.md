---
title: "Installation"
description: "Install Nanocoder via NPM, Homebrew, or Nix Flakes"
sidebar_order: 2
---

# Installation

## For Users

### NPM

Install globally and use anywhere:

```bash
npm install -g @nanocollective/nanocoder
```

Then run in any directory:

```bash
nanocoder
```

### Homebrew (macOS/Linux)

First, tap the repository:

```bash
brew tap nano-collective/nanocoder https://github.com/Nano-Collective/nanocoder
```

Then install:

```bash
brew install nanocoder
```

Run in any directory:

```bash
nanocoder
```

To update:

```bash
# Update Homebrew's tap cache first (important!)
brew update

# Then upgrade nanocoder
brew upgrade nanocoder
```

> **Note**: If `brew upgrade nanocoder` shows the old version is already installed, run `brew update` first. Homebrew caches tap formulas locally and only refreshes them during `brew update`. Without updating the tap cache, you'll see the cached (older) version even if a newer formula exists in the repository.

### Nix Flakes

Run Nanocoder directly using:

```bash
# If you have flakes enabled in your Nix config:
nix run github:Nano-Collective/nanocoder

# If you don't have flakes enabled:
nix run --extra-experimental-features 'nix-command flakes' github:Nano-Collective/nanocoder
```

Or install from `packages` output:

```nix
# flake.nix
{
  inputs = {
    nanocoder = {
      url = "github:Nano-Collective/nanocoder";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}

# configuration.nix
{ pkgs, inputs, system, ... }: {
  environment.systemPackages = [
    inputs.nanocoder.packages."${system}".default
  ];
}
```

## For Development

If you want to contribute or modify Nanocoder:

**Prerequisites:**

- Node.js 20+
- pnpm

**Setup:**

1. Clone and install dependencies:

```bash
git clone [repo-url]
cd nanocoder
pnpm install
```

2. Build the project:

```bash
pnpm run build
```

3. Run locally:

```bash
pnpm run start
```

Or build and run in one command:

```bash
pnpm run dev
```
