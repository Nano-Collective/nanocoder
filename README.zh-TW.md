# Nanocoder

[English](README.md)


一個純終端驅動的開源程式設計 Agent，由社群共同打造，不受商業公司控制。模型隨意選擇，程式碼留在本地，告別平台綁定。

Nanocoder 由非營利性 AI 開發者社群 [Nano Collective](https://nanocollective.org) 打造。它能透過你指定的模型來實現 Agentic Coding（智能體程式設計）：既能用 Ollama 跑本地模型，也能接入 OpenRouter、Anthropic、Google 以及各類相容 OpenAI 格式的 API。誰來處理你的程式碼？資料傳送到哪裡？全由你自己決定。這裡沒有閉源黑盒，也沒有把關鍵能力鎖在付費牆後面：**尊重隱私**、**本地優先**、**面向所有人免費開放**。

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

## 快速開始

```bash
npm install -g @nanocollective/nanocoder
nanocoder
```

如果你使用 macOS/Linux，也可以通过 [Homebrew](docs/getting-started/installation.md#homebrew-macoslinux) 或 [Nix Flakes](docs/getting-started/installation.md#nix-flakes) 安裝。

### CLI 參數用法

你可以通過命令列直接指定 Provider、模型以及啟動模式：

```bash
# 指定 Provider 和模型，直接執行一次性任務（非互動模式）
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# 指定 Provider，進入互動模式
nanocoder --provider ollama --model llama3.1

# 參數可以靈活放在 run 命令前面或後面
nanocoder run --provider openrouter "refactor database module"

# 直接以特定模式啟動（normal、auto-accept、yolo、plan）
nanocoder --mode yolo
nanocoder --mode plan run "audit the auth module"
```

## 文件

完整文件可以在 **[docs.nanocollective.org](https://docs.nanocollective.org/nanocoder/docs)** 線上閱讀，也可以直接查看目前倉庫的 [docs/](docs/) 目錄：

- **[快速入門](docs/getting-started/index.md)** - 安裝、設定及上手指南
- **[設定選項](docs/configuration/index.md)** - AI Provider 設定、MCP 伺服器、個人化偏好、記錄與逾時設定
- **[核心功能](docs/features/index.md)** - Skills（指令、子 Agent、工具及事件觸發器）、專案級 Daemon（守護行程）、上下文 Checkpoint（檢查點）、開發模式及任務管理等
- **[指令參考](docs/features/commands.md)** - 內建 Slash（斜線）指令全覽
- **[快捷鍵鍵位](docs/features/keyboard-shortcuts.md)** - 終端快捷鍵速查表
- **[社群指南](docs/community.md)** - 如何貢獻程式碼、加入 Discord 以及參與專案建設

## 為什麼選擇社群驅動

Nanocoder 由社群集體而非商業公司打造，直接決定了它的安全性。這裡沒有付費牆，沒有在後台偷偷上傳你 Prompt 的遙測，也沒有被 KPI 和商業變現綁架的更新路線圖。開發它的人，正是每天在真實工作中使用它的人。

以社群形式開源共建，意味著 Nanocoder 會堅持中立：你不會被某一家大廠的模型生態綁死；同時，Nano Collective 旗下的所有專案都共用同一套程式碼規範、測試標準和發佈流程，這讓程式碼庫保持清晰、易讀，也對開源貢獻者更友好。

這不僅僅是一個趁手的工具。我們正在打造一個真正開放的 AI 工具生態，歡迎看看 [Nano Collective 的其他開源專案](https://nanocollective.org)。現在加入的早期貢獻者，將直接參與塑造這個生態的未來。

## 贊助商

Nanocoder 純為社群而生，不以營利為目的。我們的持續開發離不開贊助商的支持。[成為贊助商](https://nanocollective.org/sponsor)。

### [Atlas Cloud](https://www.atlascloud.ai/console/coding-plan)

<p>
  <a href="https://www.atlascloud.ai/console/coding-plan" title="Atlas Cloud">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://nanocollective.org/sponsors/atlas-cloud-white.png">
      <img alt="Atlas Cloud" height="40" src="https://nanocollective.org/sponsors/atlas-cloud-black.png">
    </picture>
  </a>
</p>

> Atlas Cloud 是一個全模態 AI 推理平台，為開發者提供統一的 API 介面，讓你無縫呼叫影片生成、圖像生成以及各種 LLM 模型。無需再維護繁雜的多廠商鑑權，只需接入一次，即可使用 300 多個跨模態精選模型。

歡迎了解 [Atlas Cloud 新推出的 Coding Plan 優惠](https://www.atlascloud.ai/console/coding-plan)，以更具性價比的預算獲取 API 額度。

## 加入社群

Nano Collective 是一個非營利組織，旨在為開發者社群打造優秀的 AI 工具。非常期待你的加入。

- **提交程式碼**：請查閱 [CONTRIBUTING.md](CONTRIBUTING.md)，了解開發環境設定及 PR 提交規範。
- **了解我們**：[nanocollective.org](https://nanocollective.org) · [官方文件](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **支持專案**：訪問 [支持頁面](https://docs.nanocollective.org/collective/organisation/support) 了解如何捐贈和贊助。
- **財務與激勵章程**：查閱我們的 [經濟章程（Economics Charter）](https://docs.nanocollective.org/collective/organisation/economics-charter)，公開透明地了解自願貢獻原則、有償激勵（bounty）的運作機制以及目前的資金池現況。
- 
