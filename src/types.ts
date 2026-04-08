// ── 模型配置类型 ──────────────────────────────────────────────

export interface ModelConfig {
  /** 模型唯一标识，格式：provider/model-name */
  name: string;
  /** 人类可读名称 */
  display_name?: string;
  /** 提供商：openai | anthropic | deepseek | gemini | groq | silicon | together */
  provider: string;
  /** API 端点，留空使用默认值 */
  endpoint?: string;
  /** API Key，支持 ${ENV_VAR} 占位符 */
  api_key?: string;
  /** 后端实际模型 ID（可与 name 不同） */
  model_id?: string;
  /** 上下文窗口大小 */
  context_length?: number;
  /** 是否支持工具调用（Function Calling） */
  supports_tools?: boolean;
  /** 是否支持多模态（图像输入） */
  supports_vision?: boolean;
  /** 是否支持流式输出 */
  supports_streaming?: boolean;
  /** 默认最大 Token 数 */
  default_max_tokens?: number;
  /** 是否启用 */
  enabled?: boolean;
}

// ── Ollama 请求体类型 ─────────────────────────────────────────

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OllamaContentPart[];
  images?: string[]; // base64 data URLs
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

export interface OllamaContentPart {
  type: 'text' | 'image';
  text?: string;
  image?: string;
}

export interface OllamaToolCall {
  id?: string;
  type: 'function';
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
  index?: number;
}

export interface OllamaTool {
  type?: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OllamaRequestOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;   // max_tokens
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface OllamaChatBody {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: OllamaTool[];
  options?: OllamaRequestOptions;
  temperature?: number;
  max_tokens?: number;
}

export interface OllamaGenerateBody {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: OllamaRequestOptions;
  system?: string;
  template?: string;
}

// ── OpenAI 请求体类型 ─────────────────────────────────────────

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | unknown[];
  name?: string;
  images?: string[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAIToolCall {
  id?: string;
  type: 'function';
  function: OpenAIFunction & { arguments: string | Record<string, unknown> };
  index?: number;
}

export interface OpenAIFunctionCall {
  name: string;
  arguments: string | Record<string, unknown>;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

// ── Ollama 响应体类型 ──────────────────────────────────────────

export interface OllamaChatResponse {
  model: string;
  created_at?: string;
  message: OllamaMessage & { tool_calls?: OllamaToolCall[] };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  load_duration?: number;
}

export interface OllamaError {
  error: string;
}

// ── HTTP 错误类型 ─────────────────────────────────────────────

export interface UpstreamError extends Error {
  status?: number;
  type?: string;
  code?: string;
}

// ── 适配器接口 ────────────────────────────────────────────────

export interface Adapter {
  /** 构建后端请求体 */
  buildRequest(ollamaBody: OllamaChatBody, cfg: ResolvedModel): unknown;
  /** 映射流式响应（返回 SSE 格式字符串） */
  mapResponse(isStreaming: boolean, data: unknown, cfg: ResolvedModel): string | null;
  /** 映射非流式响应 */
  mapNonStreaming(data: unknown, cfg: ResolvedModel): OllamaChatResponse | null;
  /** 获取请求端点 URL */
  getEndpoint(cfg: ResolvedModel): string;
}

export interface ResolvedModel extends Omit<ModelConfig, 'api_key' | 'endpoint'> {
  api_key: string;
  endpoint: string;
}

// ── 提供商默认端点 ────────────────────────────────────────────

export const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai:    'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek:  'https://api.deepseek.com/v1',
  gemini:    'https://generativelanguage.googleapis.com/v1beta',
  groq:      'https://api.groq.com/openai/v1',
  silicon:   'https://api.siliconflow.cn/v1',
  together:  'https://api.together.xyz/v1',
};
