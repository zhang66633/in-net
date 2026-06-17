# in-net

Anthropic → OpenAI API 中继代理，将 Claude Code 连接到任何 OpenAI 兼容 API 网关（如 [New API](https://github.com/Calcium-Ion/new-api)、One API 等）。

将 **Anthropic Messages API**（`/v1/messages`）格式的请求转换为 **OpenAI Chat Completions**（`/v1/chat/completions`）格式，让 Claude Code 可以使用 OpenAI 兼容端点背后的任何模型。

## 快速开始

```bash
# 安装依赖
npm install

# 使用默认配置启动
npm start

# 带上 API Key
IN_NET_API_KEY=sk-xxx npm start

# 或者通过命令行参数
npm start -- --api-key sk-xxx --debug
```

启动后，让 Claude Code 指向它：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1 \
ANTHROPIC_API_KEY=sk-xxx \
claude --model deepseek-v4-pro
```

或者在 CC Switch 中将 provider URL 设置为 `http://127.0.0.1:8787/v1`。

### Web 管理面板

启动后访问 `http://127.0.0.1:8787/admin` 打开管理面板。

首次启动会自动生成管理员密码并显示在终端，后续启动不再显示（密码存储在 `~/.in-net/runtime.json` 中）。

```bash
# 自己指定密码
npm start -- --admin-password mypassword
```

管理面板功能：
- **Dashboard** — 请求统计、Token 用量、延迟、活跃配置
- **Keys** — 多 API Key 管理（增删改、设默认、加密存储）
- **Upstreams** — 多上游端点管理（增删改、连通性测试、激活切换）
- **Models** — 模型列表浏览和搜索
- **Logs** — 请求历史、分页、按模型/状态筛选

## 配置

| 参数       | CLI 参数         | 环境变量          | 默认值                                           |
|-----------|------------------|------------------|--------------------------------------------------|
| 端口       | `--port`, `-p`   | `IN_NET_PORT`    | `8787`                                           |
| 上游地址   | `--upstream`, `-u` | `IN_NET_UPSTREAM` | `https://your-upstream-url/v1/chat/completions`   |
| API Key   | `--api-key`, `-k` | `IN_NET_API_KEY` | （从请求的 `x-api-key` 头透传）                    |
| 调试模式   | `--debug`, `-d`   | `IN_NET_DEBUG`   | `false`                                          |
| 重试次数   | `--retry`, `-r`   | `IN_NET_RETRY`   | `3`                                              |
| 数据目录   | `--data-dir`      | `IN_NET_DATA_DIR` | `~/.in-net`                                      |
| 管理密码   | `--admin-password` | `IN_NET_ADMIN_PASSWORD` | (首次自动生成)                              |

优先级：CLI 参数 > 环境变量 > 默认值

### API Key 处理

- 如果在启动时设置了 `--api-key`，它会作为兜底值：当请求没有 `x-api-key` 请求头时使用。
- 如果未设置，每个请求**必须**携带 `x-api-key` 请求头（Claude Code 会自动将 `ANTHROPIC_API_KEY` 作为 `x-api-key` 发送）。

## 测试

### 非流式请求

```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "max_tokens": 100,
    "messages": [
      {"role": "user", "content": [{"type": "text", "text": "你好，请用一句话介绍自己"}]}
    ]
  }' | jq .
```

### 流式请求

```bash
curl -sN http://127.0.0.1:8787/v1/messages \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "max_tokens": 100,
    "stream": true,
    "messages": [
      {"role": "user", "content": [{"type": "text", "text": "从1数到5"}]}
    ]
  }'
```

### 工具调用

```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "max_tokens": 200,
    "tools": [
      {
        "name": "get_weather",
        "description": "获取当前天气",
        "input_schema": {
          "type": "object",
          "properties": {
            "city": {"type": "string"}
          },
          "required": ["city"]
        }
      }
    ],
    "messages": [
      {"role": "user", "content": [{"type": "text", "text": "北京今天天气怎么样？"}]}
    ]
  }' | jq .
```

### 健康检查

```bash
curl http://127.0.0.1:8787/health
# {"status":"ok","upstream":"https://your-upstream-url/v1/chat/completions"}
```

## 端点

| 方法   | 路径               | 说明                                 |
|--------|-------------------|--------------------------------------|
| POST   | `/v1/messages`    | Anthropic Messages API — 主端点       |
| GET    | `/health`         | 健康检查                              |
| GET    | `/admin`          | Web 管理面板                           |
| GET/POST/PUT/DELETE | `/api/*`  | 管理 REST API（认证保护）              |

## 架构

```
Claude Code（或 CC Switch）
    │ Anthropic Messages API 格式
    ▼
in-net (127.0.0.1:8787)
    │ 格式转换
    ▼
上游 OpenAI-compatible API (your-upstream-url)
    │
    ▼
上游模型（DeepSeek、Qwen 等）
```

## 格式转换对照

- **System 提示词**：Anthropic 顶层 `system` 字段 → OpenAI `role: "system"` 消息
- **内容块**：Anthropic `[{type: "text", ...}, ...]` → OpenAI 纯文本字符串
- **工具调用**：`{type: "tool_use", input: {}}` ↔ `tool_calls[]`（arguments 为 JSON 字符串）
- **工具结果**：`{type: "tool_result"}` → `role: "tool"` 消息
- **工具定义**：`input_schema` ↔ `parameters`
- **工具选择**：`{type: "auto"/"any"/"tool"}` → `"auto"/"required"/{type:"function",...}`
- **停止原因**：`stop`→`end_turn`、`length`→`max_tokens`、`tool_calls`→`tool_use`
- **Token 用量**：`prompt_tokens`→`input_tokens`、`completion_tokens`→`output_tokens`
- **流式传输**：OpenAI SSE 平铺 delta chunks → Anthropic 结构化 SSE 生命周期事件

## 许可证

MIT
