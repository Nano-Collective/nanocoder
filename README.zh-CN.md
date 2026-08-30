# Nanocoder

[English](README.md)
[繁體中文](README.zh-TW.md)

一个纯终端驱动的开源编程 Agent，由社区共建，不受商业公司控制。模型随意选，代码留在本地，告别平台绑定。

Nanocoder 由非盈利性 AI 开发者社区 [Nano Collective](https://nanocollective.org) 打造。它能通过你指定的模型来实现 Agentic Coding（智能体编程）：既能用 Ollama 跑本地模型，也能接入 OpenRouter、Anthropic、Google 以及各类兼容 OpenAI 格式的 API。谁来处理你的代码？数据发到哪？全由你自己说了算。这里没有闭源黑盒，也没有把关键能力锁在付费墙后面：**尊重隐私**、**本地优先**、**面向所有人免费开放**。

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

如果你使用 macOS/Linux，也可以通过 [Homebrew](docs/getting-started/installation.md#homebrew-macoslinux) 或 [Nix Flakes](docs/getting-started/installation.md#nix-flakes) 安装。

### CLI 参数用法

你可以通过命令行直接指定 Provider、模型以及启动模式：

```bash
# 指定 Provider 和模型，直接运行一次性任务（非交互模式）
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# 指定 Provider，进入交互模式
nanocoder --provider ollama --model llama3.1

# 参数可以灵活放在 run 命令前面或后面
nanocoder run --provider openrouter "refactor database module"

# 直接以特定模式启动（normal、auto-accept、yolo、plan）
nanocoder --mode yolo
nanocoder --mode plan run "audit the auth module"
```

## 文档

完整文档可以在 **[docs.nanocollective.org](https://docs.nanocollective.org/nanocoder/docs)** 在线阅读，也可以直接查看当前仓库的 [docs/](docs/) 目录：

- **[快速入门](docs/getting-started/index.md)** - 安装、配置及上手指南
- **[配置选项](docs/configuration/index.md)** - AI Provider 设置、MCP 服务器、个性化偏好、日志与超时设置
- **[核心功能](docs/features/index.md)** - Skills（命令、子 Agent、工具及事件触发器）、项目级 Daemon（守护进程）、上下文 Checkpoint（检查点）、开发模式及任务管理等
- **[命令参考](docs/features/commands.md)** - 内置 Slash（斜杠）命令全览
- **[快捷键键位](docs/features/keyboard-shortcuts.md)** - 终端快捷键速查表
- **[社区指南](docs/community.md)** - 如何贡献代码、加入 Discord 以及参与项目建设

## 为什么选择社区驱动

Nanocoder 由社区集体而非商业公司打造，直接决定了它的安全性。这里没有付费墙，没有在后台偷偷上传你 Prompt 的遥测，也没有被 KPI 和商业变现绑架的更新路线图。开发它的人，正是每天在真实工作中使用它的人。

以社区形式开源共建，意味着 Nanocoder 会坚持中立：你不会被某一家大厂的模型生态绑死；同时，Nano Collective 旗下的所有项目都共享同一套代码规范、测试标准和发布流程，这让代码库保持清晰、易读，也对开源贡献者更友好。

这不仅仅是一个趁手的工具。我们正在构建一个真正开放的 AI 工具生态，欢迎看看 [Nano Collective 的其他开源项目](https://nanocollective.org)。现在加入的早期贡献者，将直接参与塑造这个生态的未来。

## 赞助商

Nanocoder 纯为社区而生，不以盈利为目的。我们的持续开发离不开赞助商的支持。[成为赞助商](https://nanocollective.org/sponsor)。

### [Atlas Cloud](https://www.atlascloud.ai/console/coding-plan)

<p>
  <a href="https://www.atlascloud.ai/console/coding-plan" title="Atlas Cloud">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://nanocollective.org/sponsors/atlas-cloud-white.png">
      <img alt="Atlas Cloud" height="40" src="https://nanocollective.org/sponsors/atlas-cloud-black.png">
    </picture>
  </a>
</p>

> Atlas Cloud 是一个全模态 AI 推理平台，为开发者提供统一的 API 接口，让你无缝调用视频生成、图像生成以及各种 LLM 模型。无需再维护繁杂的多厂商鉴权，只需接入一次，即可使用 300 多个跨模态精选模型。

欢迎了解 [Atlas Cloud 新推出的 Coding Plan 优惠](https://www.atlascloud.ai/console/coding-plan)，以更具性价比的预算获取 API 额度。

## 加入社区

Nano Collective 是一个非盈利组织，旨在为开发者社区构建优秀的 AI 工具。非常期待你的加入。

- **提交代码**：请查阅 [CONTRIBUTING.md](CONTRIBUTING.md)，了解开发环境配置及 PR 提交规范。
- **了解我们**：[nanocollective.org](https://nanocollective.org) · [官方文档](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **支持项目**：访问 [支持页面](https://docs.nanocollective.org/collective/organisation/support) 了解如何捐赠和赞助。
- **财务与激励章程**：查阅我们的 [经济章程（Economics Charter）](https://docs.nanocollective.org/collective/organisation/economics-charter)，公开透明地了解自愿贡献原则、有偿激励（bounty）的运作机制以及当前的资金池现状。
