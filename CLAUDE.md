# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Rules

**每次编译前必须增加版本号**：修改 `package.json` 中的 `version` 字段（如 1.0.5 → 1.0.6）。这是强制要求，不要忘记。

## Project Overview

SightFlow Desktop Agent is an AI-powered cross-platform desktop RPA (Robotic Process Automation) client built with Electron. It uses Vision Language Models (VLM) to automate interactions with chat applications like WeChat, DingTalk, Feishu, Slack, and Telegram.

## Architecture

### Three-Process Electron Architecture

- **Main Process** (`src/main/index.ts`): Entry point, window management, IPC handlers, settings persistence via `electron-store`
- **Renderer Process** (`src/renderer/src/`): React + TypeScript UI, runs in isolated browser context
- **Preload Scripts** (`src/preload/index.ts`): Bridge between main and renderer with typed IPC definitions

### Core Abstraction Layers

The architecture follows a layered design from hardware access to business logic:

1. **DesktopDevice Interface** (`src/core/device.ts`): Business atomic operations
   - `RPADevice` (`src/core/rpa-device.ts`): VLM-based layout measurement for WeChat-like apps
   - `BoxSelectDevice` (`src/core/box-select-device.ts`): Manual region selection for other apps

2. **GenericChannelSession** (`src/core/generic-channel-session.ts`): Chat session lifecycle manager
   - Handles state machine transitions (bootstrap → check unread → analyze → reply)
   - Consumes DesktopDevice for automation primitives

3. **RuntimeHost** (`src/core/runtime-host.ts`): Orchestrates Device + Channel + Provider
   - `ProviderAdapter`: Pluggable AI providers for generating replies
   - Built-in Doubao provider + external provider system via manifest.json

### Provider Plugin System

External providers are loaded dynamically:
- `manifest.json` declares metadata, config schema, and entry point
- Bundle file exports `createProvider(context)` returning `{ run(input) }`
- Events: `thinking`, `reply_text`, `skip`, `error`
- Example: `resources/providers/volcengine-ark/`

### Capture Strategies

Two modes for measuring UI layout:
- **VLM**: AI vision model auto-detects regions (WeChat/WeWork only)
- **Box-select**: User manually draws 3 regions (contact list, chat area, input box)
- Strategy is per-app-type configurable in settings

### Box-Select Wizard

Transparent overlay window (`src/renderer/overlay/`) for manual region selection:
- Runs in separate BrowserWindow with `overlay.html` entry
- Electron Vite builds it as isolated bundle via `rollupOptions.input.overlay`

## Build System

Uses `electron-vite` which provides separate Vite configs for main, preload, and renderer:
- Main builds to `out/main/`
- Preload builds to `out/preload/`
- Renderer builds to `out/renderer/`

TypeScript projects:
- `tsconfig.node.json`: Main process and scripts
- `tsconfig.web.json`: Renderer/Preload

## Development Commands

```bash
# Development mode with HMR
npm run dev

# Build for production (includes typecheck)
npm run build

# Platform-specific builds
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux

# Type checking only
npm run typecheck
npm run typecheck:node  # Main process only
npm run typecheck:web   # Renderer only

# Linting
npm run lint

# Formatting
npm run format

# Dev with test modes
npm run dev:test-screenshot  # Test screenshot capture
npm run dev:test-reply       # Test reply generation
npm run dev:test-switch      # Test window switching
```

## Key Configuration

- Settings stored via `electron-store` with schema in `src/main/index.ts`
- Provider Hub URL: `https://sightflow.dev/provider-hub.json` (configurable via env `SIGHTFLOW_PROVIDER_HUB_URL`)
- Volcengine Ark defaults: Model `doubao-seed-2.0-lite`, Base URL `https://ark.cn-beijing.volces.com/api/plan/v3`

## Skill HTTP Server (Remote Control)

A local HTTP API on port 12680 (fallback to 12681 if occupied) enables external control:
- `GET /skill/status` — Query running status
- `POST /skill/start` — Start the engine
- `POST /skill/pause` — Stop the engine
- `GET/POST /skill/autopilot` — Query/set autopilot state (defaults to **enabled**)
- `POST /skill/send-message` — Send message to a contact
- `POST /skill/generate-reply` — Generate AI reply using configured Provider (uses `vision.apiKey` as fallback)
- `GET /skill/logs` — Return buffered log history (last 500 entries, for LogViewer)
- `POST /skill/log` — Receive glue-layer logs and broadcast to UI
- `POST /skill/alert` — Receive glue-layer alerts and broadcast to UI (dedup 5 min)

Used by external tools (e.g., OpenClaw) for automation integration. Defined in `src/main/skill-server.ts`.

## IPC Channel Naming

Channels follow namespace patterns:
- `settings:*` — Configuration persistence (`getAll`, `get`, `set`, `open`)
- `engine:*` — Runtime control (`start`, `stop`, `status`, `updateConfig`, `testConnection`, `log`, `state`)
- `capture:*` — Box-select wizard (`openSetupWizard`, `getRegions`, `resetRegions`, `regions-updated`)
- `provider:*` — Provider installation (`installFromUrl`, `getInstalled`)
- `providerHub:*` — Provider catalog (`getCatalog`, `update`)

## Testing/Debugging

Test scripts in `src/core/rpa/tests/`:
- `test-screenshot.ts`: Screenshot capture diagnostics
- `test-reply.ts`: Provider reply generation
- `test-vlm-parallel.ts`: VLM performance comparison

Test CLI entry: `scripts/test-cli.ts` compiled to `out/main/test-cli.js`

## File Organization

```
src/
  main/          # Electron main process
    skill-server.ts  # HTTP API (:12680) for external control + log buffering
    index.ts         # Entry point, IPC handlers, settings, engine control
  preload/       # Preload scripts with IPC type definitions
  renderer/src/  # React UI components
    App.tsx          # Main app with ControlPanel + SettingsWindow
    LogViewer.tsx    # Settings → 日志 tab (history fetch + real-time IPC)
    OnboardingWizard.tsx  # First-launch setup wizard
    WechatAgentSettings.tsx  # WeChat Agent settings panel
  core/          # Business logic
    rpa/         # RPA utilities (screenshot, window, vision, input)
  core/rpa/types.ts     # Core type definitions (AppType, CaptureStrategy, BoxRegions)
  core/device.ts        # DesktopDevice interface
  core/rpa-device.ts    # VLM-based device implementation
  core/box-select-device.ts  # Manual region device implementation
  core/session-types.ts # Provider and session event types
resources/
  providers/     # Built-in provider examples
```

## Common Patterns

- **IPC Handlers**: Defined in `src/main/index.ts` with `ipcMain.handle('channel:name', ...)`
- **Settings Normalization**: `normalizeSettings()` migrates legacy config shapes
- **Async Generators**: Providers yield events via `async *run()` for streaming UI updates
- **State Machine**: GenericChannelSession uses explicit state transitions with `wait_retry` delays
- **i18n**: Simple locale system in `src/renderer/src/i18n.ts` with `t(key)` function; supports `zh`/`en`
- **Settings Window**: Separate BrowserWindow with query param `?window=settings`, same preload/React bundle
- **wxid Auto-Detection**: `wechat-agent:detectWxid` tries `wx whoami --json` first, falls back to `wx contacts --json` (self user has `display: "192"`). Bundled wx-cli may not support `whoami`.
- **Log Buffering**: skill-server maintains a 500-entry circular buffer (`logBuffer`) for `GET /skill/logs`. LogViewer fetches history on mount, then listens to `wechat-agent:glue-layer-log` IPC for real-time updates.
- **generateReply API Key**: Falls back to `settings.vision.apiKey` when `chatProvider.config.apiKey` is empty — the visual API key is shared with the text reply provider (doubao).
