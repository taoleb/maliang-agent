# 马良 Agent（Maliang Agent）

<p align="center">
  <img src="assets/banner.png" alt="Maliang Agent" width="100%">
</p>

<p align="center">
  <a href="https://github.com/taoleb/maliang-agent">项目仓库</a> ·
  <a href="https://github.com/NousResearch/hermes-agent">上游项目</a> ·
  <a href="README.md">English</a>
</p>

**马良 Agent** 是一个支持工具调用、记忆和自我改进的 AI Agent，可以通过终端
CLI、现代 TUI、原生桌面端、Web Dashboard、消息网关或 ACP 客户端运行。本仓库
是在上游 Agent 核心基础上的当前增强版本，重点加入了面向桌面端的 **马良智囊团**
和 **智囊团编排**。

## 当前能力

- **多种界面**：经典 CLI、Ink TUI、Electron 桌面端、本地 Web Dashboard、消息
  网关和 ACP 服务端。
- **马良智囊团**：四个相互独立的桌面对话窗口。每个窗口可以使用不同的模型、
  Provider 和 Profile，按编号引用其他窗口上下文，并保留自己的会话。
- **智囊团编排**：通过可视化有向图连接多个智能体，为节点配置角色/模型，把上游
  结果传给下游，运行或取消工作流，处理交互式询问，并查看节点转录。
- **工具和运行环境**：终端、文件、浏览器、网页搜索、MCP、代码执行、消息、语音，
  以及可配置的本地、Docker、SSH、Singularity、Modal、Daytona 后端。
- **持久化 Agent 状态**：SQLite 会话和搜索、Profile、上下文文件、记忆 Provider、
  技能、插件、定时任务、Webhook、后台子 Agent、实时进度和委派故障恢复。
- **Provider 灵活切换**：支持 OpenAI 兼容接口、OpenRouter、OpenAI、Anthropic、
  Nous Portal 及其他 Provider，无需修改 Agent 核心代码。

## 环境要求

- Python **3.11–3.13**（不支持 3.14 及以上）
- 推荐使用 [uv](https://docs.astral.sh/uv/) 管理 Python 环境
- 桌面端、TUI 和 Web 开发需要 Node.js **20+**
- Git；部分语音功能需要 `ffmpeg`

## 从源码安装

`bash
git clone https://github.com/taoleb/maliang-agent.git
cd maliang-agent
uv sync --extra all --extra dev
uv run maliang setup
`

以上命令也适用于 Windows PowerShell。项目支持原生 Windows 和 WSL2；只运行
Python CLI 时可以使用 `uv sync` 代替完整 extras。

API Key 和 Token 放在 `~/.maliang/.env`；行为配置放在
`~/.maliang/config.yaml`，使用 `maliang config` 或设置向导管理。

## 第一次运行

`bash
uv run maliang              # 经典交互式 CLI
uv run maliang --tui        # 现代终端 UI
uv run maliang model        # 选择 Provider 和模型
uv run maliang tools        # 配置启用的工具
uv run maliang doctor       # 检查配置和依赖
`

## 常用入口

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 交互式聊天 | `maliang` | 经典 prompt-toolkit 界面 |
| 现代 TUI | `maliang --tui` | 支持流式输出和斜杠命令 |
| 原生桌面端 | `maliang desktop` | 构建并启动当前系统的 Electron 应用 |
| Web Dashboard | `maliang dashboard` | 默认地址 `127.0.0.1:9119` |
| 无头后端 | `maliang serve` | Desktop 和客户端使用的 JSON-RPC/WebSocket 后端 |
| 消息网关 | `maliang gateway` | Telegram、Discord、Slack、WhatsApp、Signal 等 |
| ACP 集成 | `maliang acp` | 接入 VS Code、Zed、JetBrains 等 ACP 客户端 |
| 单次执行 | `maliang -z '总结这个仓库'` | 只输出最终回答，适合脚本 |
| 会话管理 | `maliang sessions list` | 列出、恢复、导出和清理会话 |
| 定时任务 | `maliang cron` | 创建周期性 Agent 任务 |
| 技能/插件 | `maliang skills` / `maliang plugins` | 管理扩展 |
| MCP | `maliang mcp` | 配置外部 MCP 能力 |

桌面应用会自动启动自己的无头 `maliang serve` 后端。直接运行 `serve` 适合
接入其他客户端或调试后端，它不会打开 Dashboard。

## 桌面端

`bash
uv run maliang desktop
uv run maliang desktop --build-only  # 只构建，不启动
uv run maliang desktop --source      # 启动源码 Electron 外壳
`

侧边栏包含：

1. **Chat**：完整 Agent 对话，支持流式响应、工具、文件、项目、会话和权限确认。
2. **马良智囊团**：四路独立、可调整大小的 Agent 窗口，可广播问题，也可以让某个
   窗口查询其他窗口的上下文。
3. **智囊团编排**：创建节点/连线工作流，为每个节点配置角色和模型，运行工作流，
   响应交互式输入，并查看实时或历史转录。

## Dashboard 与消息网关

`bash
uv run maliang dashboard
uv run maliang dashboard --no-open
uv run maliang gateway setup
uv run maliang gateway start
`

对外绑定 Dashboard 时请配置认证 Provider；仅在本机使用时建议保持默认的
`127.0.0.1`。

## 开发与测试

`bash
uv sync --extra all --extra dev
npm install
uv run pytest

cd apps/desktop && npm run typecheck && npm run test:ui
cd ../../ui-tui && npm run check
cd ../web && npm run check
`

在 `apps/desktop` 中，可以使用 `npm run dist:win`、`npm run dist:mac` 或
`npm run dist:linux` 构建对应平台的安装包。

## 目录结构

`text
run_agent.py       Agent 循环和程序化 API
maliang_cli/       CLI、设置向导、配置和子命令
agent/             Provider、记忆、缓存和注册表
tools/             内置工具、委派和运行环境
gateway/           消息网关和平台适配器
tui_gateway/       TUI、Dashboard、Desktop 的 JSON-RPC 后端
ui-tui/            Ink 终端 UI
apps/desktop/      Electron 桌面应用
web/               Dashboard 前端
plugins/           运行时插件
skills/            内置技能
tests/             Python 和集成测试
`

更多文档：

- [Desktop README](apps/desktop/README.md)
- [TUI README](ui-tui/README.md)
- [Web README](web/README.md)
- [项目文档](docs/)
- [开发指南](AGENTS.md)

## 上游与许可证

本项目源自 [Nous Research 的上游 Agent 仓库](https://github.com/NousResearch/hermes-agent)。
上游的 Provider、工具、网关、记忆和技能文档仍然适用；本文档补充说明本仓库的
桌面端智囊团改动。

MIT，详见 [LICENSE](LICENSE)。
