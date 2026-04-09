'use strict';

/**
 * 模型适配器
 *
 * 每个 provider 实现两个方法：
 *   buildRequest(ollamaBody, model) → provider 请求体
 *   mapResponse(streaming, data, model) → Ollama 响应体
 */

const log = require('../../utils/logger');
const logger = log.child('adapter');

// ── Provider 端点 ─────────────────────────────────────────────
const ENDPOINTS = {
  openai:    'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek:  'https://api.deepseek.com/v1',
  minimax:   'https://api.minimax.chat/v1',
  gemini:    'https://generativelanguage.googleapis.com/v1beta',
  groq:      'https://api.groq.com/openai/v1',
  silicon:   'https://api.siliconflow.cn/v1',
  together:  'https://api.together.xyz/v1',
};

// ── 工具函数 ─────────────────────────────────────────────────

function mapMessages(messages = []) {
  const normalized = [];
  let pendingToolCallIds = [];

  for (const message of messages) {
    const role = message.role === 'assistant'
      ? 'assistant'
      : message.role === 'user'
        ? 'user'
        : message.role;

    const mapped = {
      role,
      content: typeof message.content === 'string' ? message.content : '',
    };

    if (message.images) {
      mapped.images = message.images;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      mapped.tool_calls = message.tool_calls.map((toolCall, index) => {
        const id = toolCall.id || `call_${index}`;
        return {
          id,
          type: toolCall.type || 'function',
          function: {
            name: toolCall.function?.name || '',
            arguments: toolCall.function?.arguments || '',
          },
        };
      });
      pendingToolCallIds = mapped.tool_calls.map(toolCall => toolCall.id).filter(Boolean);
    } else if (role === 'assistant') {
      pendingToolCallIds = [];
    }

    if (role === 'tool') {
      const toolCallId = message.tool_call_id || message.toolCallId || pendingToolCallIds.shift();
      if (toolCallId) {
        mapped.tool_call_id = toolCallId;
      }
      if (message.name) {
        mapped.name = message.name;
      }
    }

    normalized.push(mapped);
  }

  return normalized;
}

function mapTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.function?.name || t.name || '',
      description: t.function?.description || t.description || '',
      parameters:  t.function?.parameters || t.parameters || { type: 'object', properties: {} },
    },
  }));
}

// ── OpenAI 兼容适配器 ───────────────────────────────────────
const openaiLike = {
  getEndpoint(model) {
    const base = model.endpoint || ENDPOINTS[model.provider] || ENDPOINTS.openai;
    return `${base}/chat/completions`;
  },

  buildRequest(body, model) {
    const { messages, tools, options = {} } = body;

    const req = {
      model:    model.model_id || model.name,
      messages: mapMessages(messages),
      stream:   body.stream !== false,
    };

    if (tools?.length) req.tools = mapTools(tools);
    if (body.temperature !== undefined || options.temperature !== undefined) {
      req.temperature = body.temperature ?? options.temperature;
    }
    if (body.max_tokens !== undefined || options.num_predict !== undefined) {
      req.max_tokens = body.max_tokens ?? options.num_predict;
    }
    if (options.top_p)    req.top_p = options.top_p;
    if (options.top_k)    req.top_k = options.top_k;
    if (options.frequency_penalty) req.frequency_penalty = options.frequency_penalty;
    if (options.presence_penalty)  req.presence_penalty  = options.presence_penalty;
    if (options.stop)     req.stop = Array.isArray(options.stop) ? options.stop : [options.stop];

    // DeepSeek 特有参数 - thinking budget
    if (model.provider === 'deepseek') {
      if (body.thinking_budget !== undefined) req.thinking_budget = body.thinking_budget;
    }

    return req;
  },

  mapResponse(streaming, data, model) {
    if (streaming) {
      return data.map(chunk => {
        if (!chunk.choices?.[0]) return '';
        const c = chunk.choices[0];
        const tc = c.delta?.tool_calls;
        
        // 提取 reasoning/thinking 内容
        const reasoningContent = c.delta?.reasoning_content || c.delta?.thinking || '';
        
        const base = {
          model:   model.name,
          created: chunk.created || Math.floor(Date.now() / 1000),
          done:    c.finish_reason === 'stop' || c.finish_reason === 'content_filter',
          message: {
            role:    c.delta?.role || 'assistant',
            content: c.delta?.content || (tc ? '' : ''),
          },
        };
        
        // 添加 thinking/reasoning 数据（如果存在）
        if (reasoningContent) {
          base.thinking = reasoningContent;
        }
        
        if (tc) {
          base.message.tool_calls = tc.map((t, i) => ({
            function: {
              name:      t.function?.name || '',
              arguments: typeof t.function?.arguments === 'string'
                ? t.function.arguments
                : JSON.stringify(t.function?.arguments || {}),
            },
            index: t.index ?? i,
          }));
        }
        return 'data: ' + JSON.stringify(base) + '\n\n';
      }).join('');
    }

    // 非流式
    const choice = data.choices?.[0];
    if (!choice) return null;

    const msg = choice.message;
    const tc  = msg?.tool_calls;
    
    // 提取 reasoning/thinking 内容
    const reasoningContent = msg?.reasoning_content || msg?.thinking || '';

    const res = {
      model:        model.name,
      created:      data.created || Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  'stop',
      message: {
        role:    msg.role || 'assistant',
        content: msg.content || '',
      },
      total_duration: 0,
      eval_count:     data.usage?.completion_tokens || 0,
    };
    
    // 添加 thinking/reasoning 数据（如果存在）
    if (reasoningContent) {
      res.thinking = reasoningContent;
    }

    if (tc) {
      res.message.tool_calls = tc.map((t, i) => ({
        function: {
          name:      t.function?.name || '',
          arguments: typeof t.function?.arguments === 'string'
            ? t.function.arguments
            : JSON.stringify(t.function?.arguments || {}),
        },
        index: t.index ?? i,
      }));
    }

    return res;
  },
};

// ── Anthropic 适配器 ─────────────────────────────────────────
const anthropic = {
  getEndpoint(model) {
    const base = model.endpoint || ENDPOINTS.anthropic;
    return `${base}/v1/messages`;
  },

  buildRequest(body, model) {
    const { messages = [], options = {}, tools } = body;

    const systemMsg = messages.find(m => m.role === 'system');
    const chatMsgs  = messages.filter(m => m.role !== 'system');

    const req = {
      model:      model.model_id || model.name,
      messages:   chatMsgs.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : '',
      })),
      stream:     body.stream !== false,
      max_tokens: body.max_tokens || options.num_predict || model.default_max_tokens || 4096,
    };

    if (systemMsg) req.system = systemMsg.content;
    if (body.temperature !== undefined || options.temperature !== undefined) {
      req.temperature = body.temperature ?? options.temperature;
    }
    if (options.top_p) req.top_p = options.top_p;
    if (options.top_k) req.top_k = options.top_k;

    if (tools?.length) {
      req.tools = tools.map(t => ({
        name:         t.function?.name || t.name || '',
        description:  t.function?.description || t.description || '',
        input_schema: t.function?.parameters || { type: 'object', properties: {} },
      }));
    }

    return req;
  },

  mapResponse(streaming, data, model) {
    if (streaming) {
      return data
        .filter(d => ['content_block_start', 'content_block_delta', 'message_delta'].includes(d.type))
        .map(d => {
          if (d.type === 'content_block_start') {
            const block = d.content_block || {};
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              message: {
                role: 'assistant',
                content: '',
                tool_calls: block.type === 'tool_use' ? [{
                  function: { name: block.name || '', arguments: '' },
                  index: d.index || 0,
                }] : undefined,
              },
            }) + '\n\n';
          }
          if (d.type === 'content_block_delta') {
            const base = {
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              message: { role: 'assistant', content: d.delta?.text || '' },
            };
            if (d.delta?.type === 'input_json_delta') {
              base.message.tool_calls = [{
                function: { arguments: d.delta.partial_json },
                index: d.index ?? 0,
              }];
              base.message.content = '';
            }
            return 'data: ' + JSON.stringify(base) + '\n\n';
          }
          return '';
        }).join('');
    }

    const content = Array.isArray(data.content) ? data.content : [{ type: 'text', text: data.content || '' }];
    const textBlock  = content.find(c => c.type === 'text');
    const toolBlocks = content.filter(c => c.type === 'tool_use');

    const res = {
      model:        model.name,
      created:      Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  data.stop_reason || 'end_turn',
      message: {
        role:    'assistant',
        content: textBlock?.text || '',
      },
      total_duration: 0,
      eval_count:     data.usage?.output_tokens || 0,
    };

    if (toolBlocks?.length) {
      res.message.tool_calls = toolBlocks.map((b, i) => ({
        function: {
          name:      b.name || '',
          arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
        },
        index: i,
      }));
    }

    return res;
  },
};

// ── Gemini 适配器 ───────────────────────────────────────────
const gemini = {
  getEndpoint(model) {
    const base = model.endpoint || ENDPOINTS.gemini;
    const id   = model.model_id || model.name;
    return `${base}/models/${id}:generateContent?key=${model.api_key}`;
  },

  buildRequest(body, model) {
    const { messages = [], options = {}, tools } = body;

    const parts = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const p = [{ text: typeof m.content === 'string' ? m.content : '' }];
        if (m.images) {
          m.images.forEach(img => p.push({ inlineData: { mimeType: 'image/jpeg', data: img } }));
        }
        return { role: m.role === 'model' ? 'model' : 'user', parts: p };
      });

    const req = {
      contents: parts,
      generationConfig: {
        temperature:     body.temperature ?? options.temperature ?? 0.7,
        maxOutputTokens: body.max_tokens ?? options.num_predict ?? model.default_max_tokens ?? 8192,
        topP:            options.top_p ?? 0.95,
        topK:            options.top_k ?? 40,
      },
    };

    if (tools?.length) {
      req.tools = {
        functionDeclarations: tools.map(t => ({
          name:        t.function?.name || t.name || '',
          description: t.function?.description || t.description || '',
          parameters:  t.function?.parameters || { type: 'object', properties: {} },
        })),
      };
    }

    return req;
  },

  mapResponse(streaming, data, model) {
    if (streaming) {
      return data
        .filter(d => d.candidates?.length > 0)
        .map(d => {
          const part = d.candidates[0].content?.parts?.[0];
          const base = {
            model:   model.name,
            created: Math.floor(Date.now() / 1000),
            done:    d.done === true,
            message: { role: 'assistant', content: part?.text || '' },
          };
          if (part?.functionCall) {
            base.message.tool_calls = [{
              function: {
                name:      part.functionCall.name || '',
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
              index: 0,
            }];
            base.message.content = '';
          }
          return 'data: ' + JSON.stringify(base) + '\n\n';
        }).join('');
    }

    const candidates = data?.candidates;
    if (!candidates?.length) {
      return {
        model:        model.name,
        created:      Math.floor(Date.now() / 1000),
        done:         true,
        done_reason:  'stop',
        message:      { role: 'assistant', content: data.promptFeedback?.blockReason || 'No response' },
        total_duration: 0,
        eval_count: 0,
      };
    }

    const parts    = candidates[0].content?.parts || [];
    const textPart = parts.find(p => p.text);
    const fcPart   = parts.find(p => p.functionCall);

    const res = {
      model:        model.name,
      created:      Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  candidates[0].finishReason || 'stop',
      message: {
        role:    'assistant',
        content: textPart?.text || '',
      },
      total_duration: 0,
      eval_count:     candidates[0].tokenCount || 0,
    };

    if (fcPart?.functionCall) {
      res.message.tool_calls = [{
        function: {
          name:      fcPart.functionCall.name || '',
          arguments: JSON.stringify(fcPart.functionCall.args || {}),
        },
        index: 0,
      }];
      res.message.content = '';
    }

    return res;
  },
};

// ── 适配器映射 ───────────────────────────────────────────────
const ADAPTERS = {
  openai:    openaiLike,
  deepseek:  openaiLike,
  minimax:   openaiLike,
  groq:      openaiLike,
  silicon:   openaiLike,
  together:  openaiLike,
  anthropic,
  gemini,
};

function getAdapter(provider) {
  const adapter = ADAPTERS[provider] || openaiLike;
  if (!ADAPTERS[provider]) {
    logger.warn(`未知 provider "${provider}"，使用 openai 适配器`);
  }
  return adapter;
}

module.exports = { getAdapter, ENDPOINTS };
