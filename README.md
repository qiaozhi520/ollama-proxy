# Ollama Proxy

**让任何 Ollama 兼容客户端（如 Continue.dev、Jan、Cody）直接连接 OpenAI / Anthropic / DeepSeek / Gemini / Groq 等在线大模型。**

---

## 特性

- 🤖 **Ollama 完整 API 兼容** — 支持所有 Ollama REST API 端点
- 🌐 **OpenAI 兼容** — 同时暴露 `/v1/chat/completions`、`/v1/models` 等 OpenAI 风格端点
- 🔧 **多提供商支持** — OpenAI、Anthropic、DeepSeek、Google Gemini、Groq、Silicon Flow、Together AI
- 🛠️ **工具调用（Function Calling）** — 完整支持工具定义与工具调用响应
- 👁️ **多模态** — 支持图像输入的模型（GPT-4o、Claude 3.5、Gemini 等）
- 🔄 **流式输出** — 支持 SSE 流式响应
- 🔢 **向量嵌入** — 支持 embedding 模型（text-embedding-3、BGE-M3 等）
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
curl http://localhost:11434/api/version
```

---

## API 端点

### Ollama 风格（完整实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息 |
| GET | `/api/tags` | 列出所有可用模型 |
| POST | `/api/show` | 查看指定模型详细信息 |
| POST | `/api/chat` | 对话生成（流式/非流式） |
| POST | `/api/generate` | 文本生成（流式/非流式） |
| POST | `/api/embeddings` | 生成文本向量嵌入 |
| POST | `/api/create` | 创建自定义模型 |
| POST | `/api/copy` | 复制模型 |
| DELETE | `/api/delete` | 删除自定义模型 |
| GET | `/api/ps` | 列出运行中的模型 |
| POST | `/api/pull` | 拉取模型（代理模式提示） |
| POST | `/api/push` | 推送模型（代理模式提示） |
| GET | `/api/version` | 获取版本信息 |
| * | `/api/blobs/:digest` | Blob 存储（代理模式不支持） |

### OpenAI 兼容

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/completions` | OpenAI Completions |
| POST | `/v1/embeddings` | OpenAI Embeddings |
| GET | `/v1/models` | 模型列表 |

### 健康检查

```
GET /health
```

---

## 配置模型参数

每个模型在 `config/models.yaml` 中的关键参数说明：

```yaml
- name: "provider/model-name"      # 模型唯一标识（客户端引用时使用）
  display_name: "显示名称"          # 可选，人类可读名称
  provider: "openai"               # 提供商（openai|anthropic|deepseek|gemini|groq|silicon|together）
  endpoint: ""                     # API 端点，留空使用默认值
  api_key: "${OPENAI_API_KEY}"     # 支持 ${ENV_VAR} 占位符
  model_id: "gpt-4o"               # 后端实际模型 ID（可能与 name 不同）
  context_length: 128000           # 上下文窗口大小
  supports_tools: true             # 是否支持工具调用
  supports_vision: true            # 是否支持多模态（图像输入）
  supports_streaming: true         # 是否支持流式输出
  default_max_tokens: 4096         # 默认最大 Token 数
  enabled: true                    # 是否启用该模型
```

### Embedding 模型配置

```yaml
- name: "openai/text-embedding-3-small"
  provider: "openai"
  api_key: "${OPENAI_API_KEY}"
  model_id: "text-embedding-3-small"
  context_length: 8191
  capabilities: ["embedding"]      # 标记为 embedding 模型
  embedding_dimension: 1536        # 向量维度
  enabled: true
```

---

## 内置模型

项目预置了 **20 个模型**：

### 对话模型

| 提供商 | 模型 |
|--------|------|
| OpenAI | GPT-4o, GPT-4o Mini, GPT-4 Turbo |
| Anthropic | Claude Sonnet 4, Claude 3.5 Sonnet, Claude 3.5 Haiku |
| DeepSeek | DeepSeek V3, DeepSeek Coder V2 |
| Google | Gemini 2.5 Pro, Gemini 2.0 Flash |
| Groq | Llama 3.3 70B, Mixtral 8x7B |
| Silicon Flow | Qwen2.5 72B, DeepSeek V3 |
| Together AI | Llama 4 Maverick, Qwen2.5 72B |

### Embedding 模型

| 提供商 | 模型 | 维度 |
|--------|------|------|
| OpenAI | text-embedding-3-small | 1536 |
| OpenAI | text-embedding-3-large | 3072 |
| Silicon Flow | BGE-M3 | 1024 |
| Silicon Flow | Nomic Embed Text | 768 |

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

### Embedding 使用示例

```bash
# Ollama 风格
curl http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/text-embedding-3-small",
    "prompt": "Hello, world!"
  }'

# OpenAI 风格
curl http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/text-embedding-3-small",
    "input": "Hello, world!"
  }'
```

### curl 测试

```bash
# 对话
curl http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "1+1等于几？"}],
    "stream": false
  }'

# 查看模型详情
curl -X POST http://localhost:11434/api/show \
  -H "Content-Type: application/json" \
  -d '{"name": "openai/gpt-4o"}'
```

---

## 目录结构

```
ollama-proxy/
├── config/
│   └── models.yaml         # 📋 所有模型的配置文件
├── src/
│   ├── index.js            # 🚀 入口，启动服务器
│   ├── models/
│   │   ├── registry.js     # 📦 模型注册表
│   │   └── adapters/
│   │       └── adapters.js # 🔌 各提供商适配器
│   ├── routes/
│   │   ├── api.js          # /api/generate
│   │   ├── chat.js         # /api/chat
│   │   ├── tags.js         # /api/tags
│   │   ├── show.js         # /api/show
│   │   ├── embeddings.js   # /api/embeddings
│   │   ├── create.js       # /api/create
│   │   ├── copy.js         # /api/copy
│   │   ├── delete.js       # /api/delete
│   │   ├── ps.js           # /api/ps
│   │   ├── pull.js         # /api/pull
│   │   ├── push.js         # /api/push
│   │   ├── version.js      # /api/version
│   │   └── blobs.js        # /api/blobs
│   └── utils/
│       ├── net.js          # 🌐 HTTP 请求工具
│       └── logger.js       # 📝 日志工具
├── .env.example            # 环境变量示例
└── package.json
```

---

## 添加自定义模型

只需在 `config/models.yaml` 的 `models` 数组中添加一条记录：

```yaml
models:
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

## 代理模式说明

本服务是一个 **代理层**，不本地运行模型：

- ✅ `/api/chat`, `/api/generate` → 转发到在线 LLM API
- ✅ `/api/embeddings` → 转发到在线 Embedding API
- ✅ `/api/create`, `/api/copy` → 创建模型别名（虚拟模型）
- ⚠️ `/api/pull`, `/api/push` → 返回提示，不支持实际拉取/推送
- ⚠️ `/api/blobs` → 不支持 Blob 存储

---

## License

MIT