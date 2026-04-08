# Ollama Proxy

**让任何 Ollama 兼容客户端（如 Continue.dev、Jan、Cody）直接连接 OpenAI / Anthropic / DeepSeek / Gemini / Groq 等在线大模型。**

---

## 特性

- 🤖 **Ollama 原生兼容** — 支持 `/api/chat`、`/api/generate`、`/api/tags`、`/api/show` 等端点，零配置切换客户端
- 🌐 **OpenAI 兼容** — 同时暴露 `/v1/chat/completions`、`/v1/models` 等 OpenAI 风格端点
- 🔧 **多提供商支持** — OpenAI、Anthropic、DeepSeek、Google Gemini、Groq、Silicon Flow、Together AI
- 🛠️ **工具调用（Function Calling）** — 完整支持工具定义与工具调用响应
- 👁️ **多模态** — 支持图像输入的模型（GPT-4o、Claude 3.5、 Gemini 等）
- 🔄 **流式输出** — 支持 SSE 流式响应
- ⚙️ **YAML 配置** — 所有模型参数在 `config/models.yaml` 中声明式管理，无需改代码
- 🔑 **环境变量** — API Key 通过 `.env` 管理，支持 `${ENV_VAR}` 占位符

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Keys
```

### 3. 修改模型配置

编辑 `config/models.yaml`，按需增删模型，设置正确的 API Key 环境变量引用。

### 4. 启动服务

```bash
npm start
```

服务默认监听 **http://localhost:11434**（与 Ollama 端口一致）。

### 5. 验证

```bash
curl http://localhost:11434/api/tags
```

---

## 配置模型参数

每个模型在 `config/models.yaml` 中的关键参数说明：

```yaml
- name: "provider/model-name"      # 模型唯一标识（客户端引用时使用）
  display_name: "显示名称"            # 可选，人类可读名称
  provider: "openai"                 # 提供商（openai|anthropic|deepseek|gemini|groq|silicon|together）
  endpoint: ""                      # API 端点，留空使用默认值
  api_key: "${OPENAI_API_KEY}"      # 支持 ${ENV_VAR} 占位符
  model_id: "gpt-4o"                 # 后端实际模型 ID（可能与 name 不同）
  context_length: 128000             # 上下文窗口大小
  supports_tools: true               # 是否支持工具调用
  supports_vision: true             # 是否支持多模态（图像输入）
  supports_streaming: true          # 是否支持流式输出
  default_max_tokens: 4096          # 默认最大 Token 数
  enabled: true                      # 是否启用该模型
```

---

## API 端点

### Ollama 风格

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息 |
| GET | `/api/tags` | 列出所有可用模型 |
| GET | `/api/show?name=xxx` | 查看指定模型详细信息 |
| POST | `/api/chat` | 对话（流式/非流式） |
| POST | `/api/generate` | 非流式文本生成 |

### OpenAI 风格

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/completions` | OpenAI Completions（降级到 /chat） |
| GET | `/v1/models` | 模型列表 |

### 健康检查

```
GET /health
```

---

## 客户端配置示例

### Continue.dev（VS Code / JetBrains）

```json
{
  "models": [
    {
      "title": "GPT-4o",
      "provider": "ollama",
      "model": "openai/gpt-4o",
      "apiBase": "http://localhost:11434/api/"
    },
    {
      "title": "Claude 3.5 Sonnet",
      "provider": "ollama",
      "model": "anthropic/claude-3-5-sonnet-20241022",
      "apiBase": "http://localhost:11434/api/"
    }
  ]
}
```

### OpenAI 官方 SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="dummy"  # 不验证，直接转发
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### curl 测试

```bash
curl http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "1+1等于几？"}],
    "stream": false
  }'
```

---

## 目录结构

```
ollama-proxy/
├── config/
│   └── models.yaml      # 📋 所有模型的配置文件（修改这里添加/删除模型）
├── src/
│   ├── index.js         # 🚀 入口，启动服务器，注册路由
│   ├── models/
│   │   ├── registry.js  # 📦 模型注册表，从 YAML 加载并验证
│   │   └── adapters/
│   │       └── adapters.js  # 🔌 各提供商的请求/响应适配器
│   ├── routes/
│   │   ├── api.js       # /api/generate
│   │   ├── chat.js      # /api/chat（流式 + 非流式）
│   │   ├── tags.js      # /api/tags
│   │   └── show.js      # /api/show
│   └── utils/
│       ├── net.js       # 🌐 HTTP 请求工具（普通 + 流式）
│       └── logger.js    # 📝 日志工具
├── .env.example         # 环境变量示例
└── package.json
```

---

## 添加自定义模型

只需在 `config/models.yaml` 的 `models` 数组中添加一条记录：

```yaml
models:
  # ... 现有模型 ...

  - name: "my/awesome-model"
    display_name: "我的自定义模型"
    provider: "openai"
    api_key: "${MY_API_KEY}"
    model_id: "my-model-id"
    context_length: 32000
    supports_tools: true
    supports_vision: false
    supports_streaming: true
    default_max_tokens: 4096
    enabled: true
```

重启服务即可生效。

---

## 支持的提供商

| 提供商 | API Key 环境变量 | 默认端点 |
|--------|-----------------|---------|
| OpenAI | `OPENAI_API_KEY` | `api.openai.com/v1` |
| Anthropic | `ANTHROPIC_API_KEY` | `api.anthropic.com` |
| DeepSeek | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| Google Gemini | `GEMINI_API_KEY` | `generativelanguage.googleapis.com/v1beta` |
| Groq | `GROQ_API_KEY` | `api.groq.com/openai/v1` |
| Silicon Flow | `SILICON_API_KEY` | `api.siliconflow.cn/v1` |
| Together AI | `TOGETHER_API_KEY` | `api.together.xyz/v1` |

---

## License

MIT
