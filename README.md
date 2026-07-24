# Maliang Agent / 马良 Agent

<p align="center">
  <img src="assets/banner.png" alt="Maliang Agent" width="100%">
</p>

<p align="center">
  <a href="https://github.com/taoleb/maliang-agent">Repository</a> ·
  <a href="https://github.com/NousResearch/hermes-agent">Upstream</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

**Maliang Agent** is a self-improving, tool-calling AI agent that runs through
the CLI, modern TUI, native desktop app, web dashboard, messaging gateway, or
ACP client. This repository is the current customized distribution: it keeps
the upstream agent core and adds the desktop-oriented **Maliang Council** and
**Council Orchestration** features.

## Current capabilities

- **Multiple interfaces:** classic CLI, Ink TUI, Electron desktop, local web
  dashboard, messaging gateway, and ACP server.
- **Maliang Council:** four independent desktop conversation panes. Each pane
  can use its own model, provider, and profile, explicitly reference another
  pane's context, and retain its own session.
- **Council Orchestration:** a visual graph for connecting agents into
  workflows. Configure node roles/models, pass upstream results downstream,
  run or cancel workflows, answer interactive prompts, and inspect node
  transcripts.
- **Tools and environments:** terminal, files, browser, web search, MCP, code
  execution, messaging, voice, and configurable local/Docker/SSH/Singularity/
  Modal/Daytona backends.
- **Persistent agent state:** SQLite transcripts and search, profiles, context
  files, memory providers, procedural skills, plugins, cron jobs, webhooks,
  background subagents, live progress, and durable delegation recovery.
- **Provider flexibility:** OpenAI-compatible endpoints, OpenRouter, OpenAI,
  Anthropic, Nous Portal, and other providers without changing agent code.

## Requirements

- Python **3.11–3.13** (`<3.14`)
- [uv](https://docs.astral.sh/uv/) (recommended)
- Node.js **20+** for desktop, TUI, and web development
- Git; `ffmpeg` for some voice features

## Install from source

`bash
git clone https://github.com/taoleb/maliang-agent.git
cd maliang-agent
uv sync --extra all --extra dev
uv run maliang setup
`

The same commands work in Windows PowerShell. Native Windows and WSL2 are
supported. For a CLI-only environment, use `uv sync` instead of the full
extras.

API keys and tokens belong in `~/.maliang/.env`. Behavioral settings belong in
`~/.maliang/config.yaml`; use `maliang config` or the setup wizard to manage
them.

## First run

`bash
uv run maliang              # Classic interactive CLI
uv run maliang --tui        # Modern terminal UI
uv run maliang model        # Choose a provider and model
uv run maliang tools        # Configure enabled tools
uv run maliang doctor       # Diagnose configuration and dependencies
`

## Main entry points

| Use case | Command | Notes |
| --- | --- | --- |
| Interactive chat | `maliang` | Classic prompt-toolkit interface |
| Modern TUI | `maliang --tui` | Ink terminal interface with streaming and slash commands |
| Native desktop | `maliang desktop` | Builds and launches the current OS Electron app |
| Web dashboard | `maliang dashboard` | Local UI, normally at `127.0.0.1:9119` |
| Headless backend | `maliang serve` | JSON-RPC/WebSocket backend for desktop and clients |
| Messaging gateway | `maliang gateway` | Telegram, Discord, Slack, WhatsApp, Signal, and others |
| ACP integration | `maliang acp` | VS Code, Zed, JetBrains, or another ACP client |
| One-shot execution | `maliang -z 'Summarize this repository'` | Script-friendly final response only |
| Sessions | `maliang sessions list` | List, resume, export, rename, or prune |
| Automation | `maliang cron` | Scheduled agent tasks |
| Extensions | `maliang skills` / `maliang plugins` | Skills and runtime plugins |
| MCP | `maliang mcp` | External MCP capabilities |

The desktop app starts its own headless `maliang serve` backend. Run `serve`
directly for another client or backend testing; it does not open the dashboard.

## Desktop

`bash
uv run maliang desktop
uv run maliang desktop --build-only  # Build without launching
uv run maliang desktop --source      # Launch the source Electron shell
`

The desktop sidebar includes:

1. **Chat:** full agent conversations with streaming, tools, files, projects,
   sessions, and approvals.
2. **Maliang Council:** four resizable independent agent panes. Broadcast a
   prompt or ask one pane to consult another.
3. **Council Orchestration:** reusable node/edge workflows with per-node roles
   and models, live status, interactive prompts, and historical transcripts.

## Dashboard and gateway

`bash
uv run maliang dashboard
uv run maliang dashboard --no-open
uv run maliang gateway setup
uv run maliang gateway start
`

Keep a public dashboard bind behind a configured authentication provider. For
local use, keep the default `127.0.0.1` host.

## Development

`bash
uv sync --extra all --extra dev
npm install
uv run pytest
`

Workspace checks:

`bash
cd apps/desktop && npm run typecheck && npm run test:ui
cd ../../ui-tui && npm run check
cd ../web && npm run check
`

Build desktop installers with `npm run dist:win`, `npm run dist:mac`, or
`npm run dist:linux` from `apps/desktop` on the corresponding platform.

## Repository layout

`text
run_agent.py       Agent loop and programmatic API
maliang_cli/       CLI, setup wizard, configuration, and subcommands
agent/             Providers, memory, caching, and registries
tools/             Built-in tools, delegation, and execution backends
gateway/           Messaging gateway and platform adapters
tui_gateway/       JSON-RPC backend for TUI, dashboard, and desktop
ui-tui/            Ink terminal UI
apps/desktop/      Electron desktop application
web/               Dashboard frontend
plugins/           Runtime-discovered plugins
skills/            Bundled skills
tests/             Python and integration tests
`

Focused documentation:

- [Desktop README](apps/desktop/README.md)
- [TUI README](ui-tui/README.md)
- [Web README](web/README.md)
- [Project docs](docs/)
- [Development guide](AGENTS.md)

## Upstream and license

This project is derived from [Nous Research's upstream agent repository](https://github.com/NousResearch/hermes-agent).
Upstream provider, tool, gateway, memory, and skill documentation remains
useful; this README documents this repository's desktop Council additions.

MIT. See [LICENSE](LICENSE).
