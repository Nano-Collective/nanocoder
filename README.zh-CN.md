# Nanocoder

[English](README.md)

一个面向终端的开放式编程 Agent，由社区集体而不是公司打造。你可以使用自己选择的模型，让代码留在自己的机器上，也不必被任何平台绑定。

Nanocoder 由 [Nano Collective](https://nanocollective.org) 构建。Nano Collective 是一个为社区而建、不以盈利为目的的 AI 工具社区集体。Nanocoder 可以在你选择的模型上运行 Agentic Coding：既可以通过 Ollama 使用本地模型，也可以接入 OpenRouter、Anthropic、Google 等 OpenAI 兼容 API。由哪个提供商运行你的代码、数据流向哪里，都由你决定。没有闭源特性，也没有把实用能力锁在付费层后面：**尊重隐私**、**本地优先**、**面向所有人开放**。

![Example](./.github/assets/example-preview.gif)

---
![Build Status](https://github.com/Nano-Collective/nanocoder/raw/main/badges/build.svg)
![Coverage](https://github.com/Nano-Collective/nanocoder/raw/main/badges/coverage.svg)
![Version](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-version.svg)
![NPM Downloads](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-downloads-monthly.svg)
![NPM License](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-license.svg)
![Repo Size](https://github.com/Nano-Collective/nanocoder/raw/main/badges/repo-size.svg)
![Stars](https://github.com/Nano-Collective/nanocoder/raw/main/badges/stars.svg)
![Forks](https://github.com/Nano-Collective/nanocoder/raw/main/badges/forks.svg)

## 快速开始

```bash
npm install -g @nanocollective/nanocoder
nanocoder
```

也可以通过 [Homebrew](docs/getting-started/installation.md#homebrew-macoslinux) 和 [Nix Flakes](docs/getting-started/installation.md#nix-flakes) 安装。

### CLI 参数

你可以直接指定提供商、模型和启动模式：

```bash
# 使用指定提供商/模型进入非交互模式
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# 使用指定提供商启动交互模式
nanocoder --provider ollama --model llama3.1

# 参数可以放在 run 命令之前或之后
nanocoder run --provider openrouter "refactor database module"

# 直接进入某个开发模式（normal、auto-accept、yolo、plan）
nanocoder --mode yolo
nanocoder --mode plan run "audit the auth module"
```

## 文档

完整文档可以在 **[docs.nanocollective.org](https://docs.nanocollective.org/nanocoder/docs)** 在线阅读，也可以查看仓库中的 [docs/](docs/) 目录：

- **[快速入门](docs/getting-started/index.md)** - 安装、设置和第一步
- **[配置](docs/configuration/index.md)** - AI 提供商、MCP 服务器、偏好设置、日志和超时配置
- **[功能](docs/features/index.md)** - Skills（命令、子 Agent、工具、事件触发器）、项目级守护进程、检查点、开发模式、任务管理等
- **[命令参考](docs/features/commands.md)** - 内置斜杠命令的完整列表
- **[键盘快捷键](docs/features/keyboard-shortcuts.md)** - 完整快捷键参考
- **[社区](docs/community.md)** - 贡献方式、Discord 和参与项目的方法

## 为什么是集体

Nanocoder 由 Nano Collective 而不是公司构建，这一点也塑造了工具本身。这里没有付费层级，没有悄悄把你的提示词发往远端的遥测，也没有由商业变现优先级驱动的路线图。构建它的人，也是使用它的人。以集体的方式开放构建，意味着 Nanocoder 在原则上保持多提供商支持：你永远不会被锁定到某一家模型厂商；同时，所有 Nano Collective 项目共享一致的规范、测试和发布标准，让工作保持清晰、可理解、也更容易参与贡献。

它也不只是一个工具。这个集体正在构建一个开放的 AI 工具生态，欢迎了解 [Nano Collective 的其他项目](https://nanocollective.org)。现在加入的贡献者，也会参与塑造这个生态未来的样子。

## 赞助商

Nanocoder 不以盈利为目的，而是为社区而建；这项工作由赞助商支持。[成为赞助商](https://nanocollective.org/sponsor)。

### [Atlas Cloud](https://www.atlascloud.ai/console/coding-plan)

<p>
  <a href="https://www.atlascloud.ai/console/coding-plan" title="Atlas Cloud">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://nanocollective.org/sponsors/atlas-cloud-white.png">
      <img alt="Atlas Cloud" height="40" src="https://nanocollective.org/sponsors/atlas-cloud-black.png">
    </picture>
  </a>
</p>

> Atlas Cloud 是一个全模态 AI 推理平台，为开发者提供统一的 AI API，用于访问视频生成、图像生成和 LLM API。你不再需要维护多个厂商集成，只需接入一次，就可以统一使用覆盖多种模态的 300 多个精选模型。

欢迎查看 [Atlas Cloud 新推出的 Coding Plan 促销](https://www.atlascloud.ai/console/coding-plan)，以更实惠的预算获得 API 访问能力。

## 社区

Nano Collective 是一个为社区构建 AI 工具的社区集体，不以盈利为目的。我们欢迎你的帮助。

- **参与贡献**：查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境设置和贡献指南。
- **了解集体**：[nanocollective.org](https://nanocollective.org) · [文档](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **支持这项工作**：[支持页面](https://docs.nanocollective.org/collective/organisation/support) 介绍了捐赠和赞助方式。
- **有偿贡献**：[经济章程](https://docs.nanocollective.org/collective/organisation/economics-charter) 说明了有范围约定的付费 bounty 如何运作。
