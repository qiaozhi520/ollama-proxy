'use strict';

/**
 * 模型适配器 — 统一接口
 *
 * 每个适配器实现两个方法：
 *   buildRequest(ollamaBody, resolvedModel) → OpenAI-compatible body
 *   mapResponse(streaming, data, model)     → Ollama-compatible response
 */

const PROVIDERS = {
  openai:   'https://api.openai.com/v1',
  anthropic:'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/v1',
  gemini:   'https://generativelanguage.googleapis.com/v1beta',
  groq:     'https://api.groq.com/openai/v1',
  silicon:  'https://api.siliconflow.cn/v1',
  together: 'https://api.together.xyz/v1',
};

// ── 工具函数 ───────────────────────────────────────────────────

/** 把 Ollama message 格式转成 OpenAI messages 格式 */
function mapMessages(messages) {
  return messages.map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'user',
    content: typeof m.content === 'string' ? m.content : '',
    ...(m.images ? { images: m.images } : {}),
  }));
}

/** 把 Ollama tools 转成 OpenAI tools */
function mapTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.function?.name        || t.name        || '',
      description: t.function?.description || t.description || '',
      parameters:  t.function?.parameters  || t.parameters  || { type: 'object', properties: {} },
    },
  }));
}

/** 提取 stream 选项（Ollama 格式） */
function getStream(options) {
  if (options.stream !== undefined) return options.stream;
  return true;
}

// ─────────────────────────────────────────────────────────────
//  OpenAI 兼容适配器（OpenAI / DeepSeek / Groq / Silicon / Together）
// ─────────────────────────────────────────────────────────────
const openaiAdapter = {
  getEndpoint(model) {
    const base = model.endpoint || PROVIDERS[model.provider] || PROVIDERS.openai;
    return model.model_id ? `${base}/chat/completions` : `${base}/chat/completions`;
  },

  buildRequest(ollamaBody, resolvedModel) {
    const messages = ollamaBody.messages || [];
    const tools    = ollamaBody.tools;
    const options  = ollamaBody.options  || {};

    const req = {
      model:      resolvedModel.model_id || resolvedModel.name,
      messages:   mapMessages(messages),
      stream:     getStream(ollamaBody),
    };

    if (ollamaBody.stream !== false && ollamaBody.stream !== undefined) {
      req.stream = ollamaBody.stream;
    }

    if (tools && tools.length > 0) req.tools = mapTools(tools);
    if (ollamaBody.temperature !== undefined || options.temperature !== undefined)
      req.temperature = ollamaBody.temperature ?? options.temperature;
    if (ollamaBody.max_tokens !== undefined || options.num_predict !== undefined)
      req.max_tokens = ollamaBody.max_tokens ?? options.num_predict;
    if (options.top_p)     req.top_p     = options.top_p;
    if (options.top_k)     req.top_k     = options.top_k;
    if (options.frequency_penalty) req.frequency_penalty = options.frequency_penalty;
    if (options.presence_penalty)  req.presence_penalty  = options.presence_penalty;
    if (options.stop)      req.stop     = Array.isArray(options.stop) ? options.stop : [options.stop];

    return req;
  },

  mapResponse(streaming, data, resolvedModel) {
    if (streaming) {
      // SSE 流式响应
      return data
        .map(chunk => {
          if (!chunk.choices?.[0]) return '';
          const c = chunk.choices[0];
          const toolCalls = c.delta?.tool_calls;
          const base = {
            model:     resolvedModel.name,
            created:   chunk.created || Math.floor(Date.now() / 1000),
            done:      false,
            message: {
              role:    c.delta?.role    || 'assistant',
              content: c.delta?.content || (toolCalls ? '' : ''),
            },
            total_duration: 0,
            eval_count:      0,
          };
          if (toolCalls) {
            base.message.tool_calls = toolCalls.map((tc, i) => ({
              function: {
                name:       tc.function?.name       || '',
                arguments:  typeof tc.function?.arguments === 'string'
                              ? tc.function.arguments
                              : JSON.stringify(tc.function?.arguments || {}),
              },
              index: tc.index ?? i,
            }));
          }
          return 'data: ' + JSON.stringify(base) + '\n\n';
        })
        .join('');
    }

    // 非流式
    const choice = data.choices?.[0];
    if (!choice) return null;
    const msg = choice.message;
    const toolCalls = msg?.tool_calls;

    const response = {
      model:      resolvedModel.name,
      created:    data.created || Math.floor(Date.now() / 1000),
      done:       true,
      done_reason:'stop',
      message: {
        role:    msg.role || 'assistant',
        content: msg.content || '',
      },
      total_duration: 0,
      eval_count:      data.usage?.completion_tokens || 0,
      eval_duration:   0,
      load_duration:   0,
    };

    if (toolCalls) {
      response.message.tool_calls = toolCalls.map((tc, i) => ({
        function: {
          name:       tc.function?.name       || '',
          arguments:  typeof tc.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function?.arguments || {}),
        },
        index: tc.index ?? i,
      }));
    }

    return response;
  },
};

// ─────────────────────────────────────────────────────────────
//  Anthropic 适配器
// ─────────────────────────────────────────────────────────────
const anthropicAdapter = {
  getEndpoint(model) {
    const base = model.endpoint || PROVIDERS.anthropic;
    const version = process.env.ANTHROPIC_VERSION || '2023-06-01';
    return `${base}/v1/messages`;
  },

  buildRequest(ollamaBody, resolvedModel) {
    const messages = ollamaBody.messages || [];
    const options  = ollamaBody.options  || {};
    const tools    = ollamaBody.tools;

    // Anthropic 不支持 system role in messages，同一处理
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMsgs  = messages.filter(m => m.role !== 'system');

    const req = {
      model:       resolvedModel.model_id || resolvedModel.name,
      messages:    chatMsgs.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string'
                  ? m.content
                  : m.content?.map?.(c => c.type === 'text' ? { type: 'text', text: c.text } : c) || m.content || '',
      })),
      stream:      getStream(ollamaBody),
      max_tokens:  ollamaBody.max_tokens || options.num_predict || resolvedModel.default_max_tokens || 4096,
    };

    if (systemMsg) req.system = typeof systemMsg.content === 'string' ? systemMsg.content : '';

    if (ollamaBody.temperature !== undefined || options.temperature !== undefined)
      req.temperature = ollamaBody.temperature ?? options.temperature;
    if (options.top_p)      req.top_p          = options.top_p;
    if (options.top_k)      req.top_k          = options.top_k;

    if (tools && tools.length > 0) {
      req.tools = tools.map(t => ({
        name:        t.function?.name        || t.name        || '',
        description: t.function?.description || t.description || '',
        input_schema: t.function?.parameters  || { type: 'object', properties: {} },
      }));
    }

    return req;
  },

  mapResponse(streaming, data, resolvedModel) {
    if (streaming) {
      return data
        .filter(d => d.type === 'content_block_start' || d.type === 'content_block_delta' || d.type === 'message_delta')
        .map(d => {
          if (d.type === 'content_block_start') {
            const block = d.content_block || {};
            return 'data: ' + JSON.stringify({
              model:       resolvedModel.name,
              created:     Math.floor(Date.now() / 1000),
              done:        false,
              message: { role: 'assistant', content: '', tool_calls: block.type === 'tool_use' ? [{
                function: { name: block.name || '', arguments: '' }, index: d.index || 0,
              }] : undefined },
            }) + '\n\n';
          }
          if (d.type === 'content_block_delta') {
            const base = {
              model:       resolvedModel.name,
              created:     Math.floor(Date.now() / 1000),
              done:        false,
              message: { role: 'assistant', content: d.delta?.text || '' },
            };
            if (d.delta?.type === 'input_json_delta') {
              const idx = d.index ?? 0;
              base.message.tool_calls = [{
                function: { arguments: d.delta.partial_json }, index: idx,
              }];
              base.message.content = '';
            }
            return 'data: ' + JSON.stringify(base) + '\n\n';
          }
          return '';
        })
        .join('');
    }

    const msg = data;
    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content || '' }];
    const textBlock = content.find(c => c.type === 'text');
    const toolBlocks = content.filter(c => c.type === 'tool_use');

    const response = {
      model:      resolvedModel.name,
      created:    Math.floor(Date.now() / 1000),
      done:       true,
      done_reason: msg.stop_reason || 'end_turn',
      message: {
        role:    'assistant',
        content: textBlock?.text || '',
      },
      total_duration: 0,
      eval_count:      msg.usage?.output_tokens || 0,
      eval_duration:   0,
      load_duration:   0,
    };

    if (toolBlocks?.length > 0) {
      response.message.tool_calls = toolBlocks.map((b, i) => ({
        function: {
          name:       b.name || '',
          arguments:  typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
        },
        index: b.index ?? i,
      }));
    }

    return response;
  },
};

// ─────────────────────────────────────────────────────────────
//  Gemini 适配器
// ─────────────────────────────────────────────────────────────
const geminiAdapter = {
  getEndpoint(model) {
    const base   = model.endpoint || PROVIDERS.gemini;
    const version = process.env.GEMINI_VERSION || 'v1beta';
    const modelId = model.model_id || model.name;
    return `${base}/models/${modelId}:generateContent?key=${model.api_key}`;
  },

  buildRequest(ollamaBody, resolvedModel) {
    const messages = ollamaBody.messages || [];
    const options  = ollamaBody.options  || {};
    const tools    = ollamaBody.tools;

    // Gemini 把所有消息合并成一个 contents 结构
    const parts = messages.map(m => {
      if (m.role === 'system') return null;
      const content = typeof m.content === 'string' ? m.content : '';
      const parts2 = [{ text: content }];
      if (m.images) {
        m.images.forEach(img => {
          parts2.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
        });
      }
      return {
        role:  m.role === 'model' ? 'model' : 'user',
        parts: parts2,
      };
    }).filter(Boolean);

    const req = {
      contents: parts,
      generationConfig: {
        temperature:    ollamaBody.temperature ?? options.temperature ?? 0.7,
        maxOutputTokens: ollamaBody.max_tokens ?? options.num_predict ?? resolvedModel.default_max_tokens ?? 8192,
        topP:            options.top_p ?? 0.95,
        topK:            options.top_k ?? 40,
      },
    };

    if (tools && tools.length > 0) {
      req.tools = {
        functionDeclarations: tools.map(t => ({
          name:        t.function?.name        || t.name        || '',
          description: t.function?.description || t.description || '',
          parameters:  t.function?.parameters  || { type: 'object', properties: {} },
        })),
      };
    }

    return req;
  },

  mapResponse(streaming, data, resolvedModel) {
    if (streaming) {
      // Gemini 流式 — 逐块返回
      return data
        .filter(d => d.candidates?.length > 0)
        .map(d => {
          const part = d.candidates?.[0]?.content?.parts?.[0];
          const base = {
            model:     resolvedModel.name,
            created:   Math.floor(Date.now() / 1000),
            done:      d.done === true,
            message: { role: 'assistant', content: part?.text || '' },
          };
          if (part?.functionCall) {
            base.message.tool_calls = [{
              function: {
                name:       part.functionCall.name || '',
                arguments:  JSON.stringify(part.functionCall.args || {}),
              }, index: 0,
            }];
            base.message.content = '';
          }
          return 'data: ' + JSON.stringify(base) + '\n\n';
        })
        .join('');
    }

    const candidates = data?.candidates;
    if (!candidates || candidates.length === 0) {
      return {
        model:      resolvedModel.name,
        created:    Math.floor(Date.now() / 1000),
        done:       true,
        done_reason:'stop',
        message:    { role: 'assistant', content: data.promptFeedback?.blockReason || 'No response' },
        total_duration: 0, eval_count: 0,
      };
    }

    const parts    = candidates[0].content?.parts || [];
    const textPart = parts.find(p => p.text);
    const fcPart   = parts.find(p => p.functionCall);

    const response = {
      model:        resolvedModel.name,
      created:      Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  candidates[0].finishReason || 'stop',
      message: {
        role:    'assistant',
        content: textPart?.text || '',
      },
      total_duration: 0,
      eval_count:      candidates[0].tokenCount || 0,
    };

    if (fcPart?.functionCall) {
      response.message.tool_calls = [{
        function: {
          name:       fcPart.functionCall.name || '',
          arguments:  JSON.stringify(fcPart.functionCall.args || {}),
        }, index: 0,
      }];
      response.message.content = '';
    }

    return response;
  },
};

// ─────────────────────────────────────────────────────────────
//  导出 & 路由
// ─────────────────────────────────────────────────────────────

const ADAPTERS = {
  openai:   openaiAdapter,
  deepseek: openaiAdapter,
  groq:     openaiAdapter,
  silicon:  openaiAdapter,
  together: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini:   geminiAdapter,
};

function getAdapter(provider) {
  return ADAPTERS[provider] || openaiAdapter;
}

module.exports = { getAdapter, PROVIDERS };
