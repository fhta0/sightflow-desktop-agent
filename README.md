# SightFlow.dev
<img width="1201" height="495" alt="image" src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" />

Official website： [https://sightflow.dev](https://sightflow.dev/)


# 招募共建开发者
我们相信Agent Computer Use 会是未来10年重要AI革命的基建，如果你也希望参与到这个项目迭代，欢迎联系\

[加入Discord](https://discord.com/invite/8H6KpbXq3t)

## 🔑 AI 模型与智能体配置

本项目依赖大语言模型/视觉模型（Vision Language Model）驱动 RPA。
桌面端的配置分为两层：

- **基础配置**：填写火山方舟 API Key，用于视觉定位、内置豆包智能体等基础能力。
- **智能体**：选择负责聊天分析和内容生成的 Provider，并维护各自配置。

### SK Key 的用途
1. **智能对话回复**：由于项目涉及类似微信等的自动抓取，模型会分析聊天界面的截图并生成自然的回复内容（带防止自我循环对话机制）。
2. **VLM 视觉定位引导**：基于屏幕截图和特定 Prompt，让模型自动检测屏幕上的 UI 控件，并返回需要点击的坐标，从而驱动纯视觉的 RPA 流程。

### 如何配置
1. 请前往 [火山引擎控制台 - 方舟原生接口](https://console.volcengine.com/ark) 开通相关服务，并生成/获取你的 API Key。
2. 启动项目后点击主界面右下角的设置按钮，打开独立设置窗口。
3. 在**基础配置**中填写 API Key。默认 Base URL 为 `https://ark.cn-beijing.volces.com/api/plan/v3`，通常无需修改。此密钥同时用于 VLM 视觉定位和 AI 文本回复。
4. 在**智能体**中选择当前使用的 Provider。内置默认智能体为**豆包 Seed**，模型固定为 `doubao-seed-2-0-lite-260428`。

### 界面预览

| 主界面 | 基础配置 | 智能体配置 |
| --- | --- | --- |
| <img width="240" alt="SightFlow 主界面" src="./docs/images/main.png" /> | <img width="360" alt="SightFlow 基础配置" src="./docs/images/settings-base.png" /> | <img width="360" alt="SightFlow 智能体配置" src="./docs/images/settings-provider.png" /> |

## 微信自动驾驶 (WeChat Autopilot)

SightFlow 的核心能力是**微信自动驾驶**：装上即用，全程无人值守，AI 像真人一样看消息、思考、打字、发送。整条链路无需驱动、无需注入 DLL、无需 hook 微信进程——它模拟的是人的操作，而不是机器的接口。

### 自动驾驶如何运转

```
wx-cli (daemon) ──增量消息──▶ glue-layer ──HTTP──▶ SightFlow 引擎 ──RPA──▶ 微信窗口
                                    │                                          │
                              AI Provider 生成回复                       键盘鼠标真实操作
```

- **默认开启**：安装后自动驾驶直接生效，无需手动启动；可在主界面或 `POST /skill/autopilot` 关闭
- **wxid 自动检测**：启动时通过 `wx contacts` 自动识别当前登录用户（回退：先尝试 `wx whoami`，不可用时从联系人列表提取）
- **群聊 @ 触发**：私聊直回；群聊仅在 @ 提及时回复，其余消息记入监控日志不响应
- **防自循环**：自己发出的消息会被回声过滤 + 15 秒静默窗口拦截，避免 AI 跟自己对话
- **限速**：每联系人 3 条/分钟，模拟人类回复节奏
- **视觉接口密钥**：基础配置 API Key 同时驱动 VLM 视觉定位与 AI 文本回复（豆包 Provider 共享）
- **日志查看器**：设置 → 日志 tab 实时显示消息处理日志，支持类型过滤、搜索、暂停/继续

### 拟人化输入（防风控）

微信风控会识别"机器行为"。SightFlow 在键盘鼠标层做了三层拟人化（`src/core/rpa/human-input/`）：

| 维度 | 行为 | 算法 |
|------|------|------|
| **打字** | 逐字符输入，每个字 35–55ms | 剪贴板单字符 + Ctrl/Cmd+V（兼容中文）；`\n` → Shift+Enter |
| **鼠标轨迹** | 曲线移动，非瞬移 | 三次贝塞尔曲线 + ease-in-out 缓动 + 微抖动 |
| **节奏** | 操作间隔不固定 | Box-Muller 正态分布延迟 + 10% 概率长停顿 + 5% 概率加速 |

效果：一条 200 字的 AI 回复，输入耗时约 7–10 秒——和真人打字的节奏一致，而不是 0.5 秒整段粘贴的机器特征。用户剪贴板内容会在打字前后自动备份与恢复。

> 算法细节与单测见 `src/core/rpa/human-input/__tests__/`（vitest，32 个用例）。
> 设计权衡记录见 `docs/superpowers/plans/2026-10-16-human-input-detection-evasion.md`（仓库根）。

### 日志类型

| 类型 | 说明 | 触发时机 |
|------|------|----------|
| 收到 | 收到新消息 | 每条私聊/群聊消息 |
| 回复 | AI 生成并发送回复 | AI 返回非 [SKIP] 回复 |
| 跳过 | AI 决定不回复 | AI 返回 [SKIP] 或无回复 |
| 监控 | 群消息监控（未 @） | 群聊消息无 @提及 |
| 错误 | 处理异常 | 映射表加载失败等 |
| 信息 | 系统信息 | 启动、配置变更等 |
| 心跳 | 轮询状态 | 每 ~60 秒 |

## 目标应用与框选模式

主界面提供**目标应用**快捷配置，用来决定桌面端如何测量聊天窗口布局：

- 微信、企业微信默认使用 VLM 自动识别窗口区域。
- 钉钉、飞书、Slack、Telegram、其他桌面应用默认使用手动框选。
- 当目标应用需要框选时，点击**开始框选**，依次圈出会话列表、聊天内容区、输入框 3 个区域。
- 框选结果会按目标应用保存到本地；后续启动会复用已保存区域，也可以随时重新框选。

VLM 和框选模式只影响“如何测量布局”。运行时截图、内容分析、生成回复和发送消息会消费同一套布局结果。

## 智能体 / Provider Hub

SightFlow 桌面端把“截图分析并生成回复”的聊天能力抽象为独立 Provider。Provider 通过 `manifest.json` 声明配置结构，通过 bundle 入口接收聊天截图并返回 `reply_text`、`skip`、`error` 等事件。

当前应用内置一个简单的 Provider Hub：

- 默认从 `https://sightflow.dev/provider-hub.json` 拉取候选 Provider 列表。
- Hub 只维护 Provider 的 `manifestUrl`，UI 展示字段来自各 Provider 的 manifest。
- 首次加载后会缓存到本地；除非手动点击智能体标题旁的刷新按钮，否则优先使用本地缓存。
- 本地始终保留内置**豆包 Seed**作为默认 Provider，避免远端列表不可用时没有可选项。

外部 Provider 接入说明见：[聊天 Provider 接入文档](./docs/provider.md)。

当前仓库仍保留一个 Doubao / 火山方舟 Provider 示例，供接入文档和本地开发参考：

```text
resources/providers/volcengine-ark/manifest.json
resources/providers/volcengine-ark/provider.bundle.js
```

## 🚀 快速开始 (Project Setup)

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发运行

```bash
npm run dev
```
> **提示**：启动后，应用将打开主界面。请先选择目标应用并完成必要的框选，再进入设置窗口填写 API Key、确认当前启用的 Provider。

### 3. 运行单元测试

```bash
npm test            # 一次性运行（vitest）
npm run test:watch  # 监听模式
```

拟人化输入算法（贝塞尔轨迹 / Box-Muller 延迟 / 逐字打字）均为纯函数，配有独立单测，无需真实鼠标键盘环境。

## 📦 打包构建 (Build)

```bash
# 构建 Windows 版本
npm run build:win

# 构建 macOS 版本
npm run build:mac

```

## 开发环境推荐配置

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
