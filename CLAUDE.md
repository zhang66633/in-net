# in-net — Anthropic ↔ OpenAI API 中继代理

将 Claude Code 的 Anthropic Messages API 格式翻译为 OpenAI Chat Completions 格式，桥接到任何 OpenAI 兼容 API 端点（如 New API、One API 等网关）。

## 项目概述

- **语言/运行时**：TypeScript + Node.js (≥18)
- **框架**：Hono（轻量 HTTP 框架）
- **执行器**：tsx（无需编译，直接运行 TS）
- **依赖**：hono、@hono/node-server

## 架构

```
Claude Code（或 CC Switch）
    │ Anthropic Messages API  POST /v1/messages
    ▼
in-net  127.0.0.1:8787
    │ 格式转换层
    │   request.ts   Anthropic → OpenAI
    │   response.ts  OpenAI → Anthropic
    │   stream.ts    SSE 流式状态机
    ▼
上游 OpenAI-compatible API  https://your-upstream-url/v1/chat/completions
    │ OpenAI Chat Completions API
    ▼
上游模型（DeepSeek V4 Pro / Qwen 等）
```

## 文件结构

```
in-net/
├── package.json              # 项目配置，依赖 hono + @hono/node-server + tsx
├── tsconfig.json             # TypeScript strict 模式
├── .env.example              # 环境变量参考
├── README.md                 # 中文使用文档
└── src/
    ├── index.ts              # CLI 入口：启动 banner、信号处理、优雅关闭
    ├── config.ts             # 配置管理 CLI 参数 + 环境变量 + 默认值
    ├── server.ts             # Hono 路由：/v1/messages、/v1/models、/health
    ├── proxy.ts              # 上游 HTTP 调用 + 自动重试（指数退避）
    ├── logger.ts             # 结构化 JSON 行日志（--debug 开启）
    ├── translate/
    │   ├── request.ts        # Anthropic 请求 → OpenAI 请求
    │   ├── response.ts       # OpenAI 响应 → Anthropic 响应（含 reasoning_content 兼容）
    │   └── stream.ts         # AnthropicStreamEmitter：OpenAI SSE → Anthropic SSE 状态机
    └── types/
        ├── anthropic.ts      # Anthropic Messages API 完整类型
        └── openai.ts         # OpenAI Chat Completions API 完整类型
```

## 配置参数

| 参数 | CLI | 环境变量 | 默认值 | 说明 |
|------|-----|---------|--------|------|
| 端口 | `--port -p` | `IN_NET_PORT` | `8787` | 监听端口 |
| 上游 | `--upstream -u` | `IN_NET_UPSTREAM` | `https://your-upstream-url/v1/chat/completions` | OpenAI 兼容端点 |
| API Key | `--api-key -k` | `IN_NET_API_KEY` | — | 可选，未设则从 x-api-key 头透传 |
| 调试 | `--debug -d` | `IN_NET_DEBUG` | `false` | 开启结构化调试日志 |
| 重试 | `--retry -r` | `IN_NET_RETRY` | `3` | 瞬时错误最大重试次数（0-10） |

优先级：CLI 参数 > 环境变量 > 默认值

## 启动方式

```bash
# 开发模式（热重载）
npm run dev -- --api-key sk-xxx

# 生产模式
npm start -- --api-key sk-xxx

# 完整参数
npm start -- --port 8787 --api-key sk-xxx --debug --retry 5
```

## Claude Code 集成

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1 \
ANTHROPIC_API_KEY=sk-xxx \
claude --model qwen3.6-35b-a3b-fp8
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/messages` | Anthropic Messages API（支持流式/非流式、工具调用） |
| GET | `/v1/models` | 透传上游模型列表 |
| GET | `/health` | 健康检查 |

## 格式转换对照

| 转换项 | Anthropic | OpenAI |
|--------|-----------|--------|
| System 提示词 | 顶层 `system` 字段 | `role: "system"` 消息 |
| 消息内容 | content block 数组 `[{type:"text",...}]` | 纯文本字符串 |
| 工具调用 | `{type:"tool_use", input:{}}` | `tool_calls[]`（arguments 为 JSON 串） |
| 工具结果 | `{type:"tool_result"}` | `role:"tool"` 消息 |
| 工具定义 | `input_schema` | `parameters` |
| 停止原因 | `end_turn` / `max_tokens` / `tool_use` | `stop` / `length` / `tool_calls` |
| Token 用量 | `input_tokens` / `output_tokens` | `prompt_tokens` / `completion_tokens` |
| 流式 | 结构化生命周期 SSE 事件 | 平铺 delta chunk SSE |
| 思考链 | `thinking` 块（暂丢弃） | `reasoning_content` → 合并为 `text` 块 |

## 重试策略

遇到以下瞬时错误自动重试（指数退避 1s / 2s / 4s）：
- 5xx 服务端错误
- 429 频率限制
- 400 + "模型不存在"（算力抢占导致的 New API 渠道争用）

## 已适配的 DeepSeek 特性

DeepSeek V4 Pro 把输出放在非标准 `reasoning_content` 字段（`content` 为空）。代理会自动将 `reasoning_content` 合并为 Anthropic `text` 内容块，确保不会返回空响应。

## 可用模型

| 模型 | 说明 |
|------|------|
| `qwen3.6-35b-a3b-fp8` | Qwen 3.6 35B，稳定可用 |
| `deepseek-v4-pro` | DeepSeek V4 Pro，含思考链，间歇性算力争用 |

---

## 工具使用规范

在 in-net 项目中开发时，遵循以下工具选择规则：

### 查库/框架/API 文档 → Context7 MCP

```
/mcp:context7
```
适用于：React、Next.js、Hono、Node.js、TypeScript、DeepSeek API、New API 等任何第三方库或服务的文档查询。

### 搜索网页内容 → Firecrawl

```
/firecrawl-search
```
适用于：查找技术方案、搜索开源项目、了解工具用法、查 GitHub issue 等需要完整页面内容的搜索。

### 写界面/UI 组件 → UI/UX Pro Max

```
/ui-ux-pro-max
```
适用于：设计页面布局、选择配色方案、挑选字体搭配、实现 UI 组件（按钮/卡片/导航栏/表单/图表）、无障碍优化。

#### UI/UX Pro Max 配置方式

```bash
# 在项目根目录执行（一次性）
npx uipro-cli@latest init --ai claude
```

这会自动创建：

| 文件 | 作用 |
|------|------|
| `.claude/skills/ui-ux-pro-max.md` | 斜杠命令定义，之后可用 `/ui-ux-pro-max` 调用 |
| `.claude/agents/ui-ux-pro-max.md` | Agent 配置 |
| 设计数据库 | 67 种 UI 风格、96 套配色、57 种字体搭配、98 条 UX 指南 |

安装后无需额外配置，直接在对话中 `/ui-ux-pro-max` 即可使用。
