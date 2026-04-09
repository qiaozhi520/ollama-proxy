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
const { StreamingThinkingProcessor } = require('../../utils/thinking');

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

// ── MiniMax 流式思考处理器状态 ─────────────────────────────────
// 每个 MiniMax 模型一个处理器实例（用于流式响应）
const minimaxProcessors = new Map();

function getMiniMaxProcessor(modelName) {
  if (!minimaxProcessors.has(modelName)) {
    minimaxProcessors.set(modelName, new StreamingThinkingProcessor());
  }
  return minimaxProcessors.get(modelName);
}

// ── 工具函数 ─────────────────────────────────────────────────

/**
 * 从 MiniMax 响应中提取思考内容
 * MiniMax 会把思考内容放在 <thinkLalala...ContentLoaded...Lalala...ContentLoaded</thinkLalala...ContentLoaded 标签中
 */
function extractMiniMaxThinking(content) {
  if (!content) return { content: '', thinking: '' };
  
  // 使用正则匹配 <thinkLalala...ContentLoaded...Lalala...ContentLoaded</thinkLalala...ContentLoaded 标签
  const thinkRegex = /<thinkLalala...ContentLoaded([\s\S]*?)<\/thinkLalala...ContentLoaded/g;
  const match = thinkRegex.exec(content);
  
  if (match) {
    const thinking = match[1].trim();
    // 移除 think 标签及其内容
    const cleanContent = content.replace(thinkRegex, '').trim();
    return { content: cleanContent, thinking };
  }
  
  return { content, thinking: '' };
}

/**
 * MiniMax 流式思考处理器
 * 用于处理流式响应中跨 chunk 的 <thinkLalala...ContentLoaded 标签
 */
class MiniMaxThinkingProcessor {
  constructor() {
    this.buffer = '';
    this.inThinking = false;
    this.thinkingContent = '';
    this.outputContent = '';
  }

  process(chunk) {
    this.buffer += chunk;
    const results = [];
    
    while (this.buffer.length > 0) {
      if (this.inThinking) {
        // 在思考标签内，查找结束标签
        const endIdx = this.buffer.indexOf('</thinkLalala...ContentLoaded');
        if (endIdx !== -1) {
          // 找到结束标签
          this.thinkingContent += this.buffer.substring(0, endIdx);
          this.buffer = this.buffer.substring(endIdx + 8); // 跳过 </thinkLalala...ContentLoaded
          this.inThinking = false;
          results.push({ type: 'thinking', content: this.thinkingContent });
          this.thinkingContent = '';
        } else {
          // 没找到结束标签，继续缓冲
          break;
        }
      } else {
        // 不在思考标签内，查找开始标签
        const startIdx = this.buffer.indexOf('<thinkLalala...ContentLoaded');
        if (startIdx !== -1) {
          // 找到开始标签，输出之前的内容
          if (startIdx > 0) {
            const content = this.buffer.substring(0, startIdx);
            if (content) results.push({ type: 'content', content });
          }
          this.buffer = this.buffer.substring(startIdx + 7); // 跳过 <thinkLalala...ContentLoaded
          this.inThinking = true;
        } else {
          // 没找到开始标签
          // 保留最后几个字符以防标签被截断
          const safeLength = Math.max(0, this.buffer.length - 7);
          if (safeLength > 0) {
            const content = this.buffer.substring(0, safeLength);
            results.push({ type: 'content', content });
            this.buffer = this.buffer.substring(safeLength);
          }
          break;
        }
      }
    }
    
    return results;
  }

  flush() {
    const results = [];
    if (this.buffer) {
      // 如果还有缓冲内容，全部作为普通内容输出
      results.push({ type: 'content', content: this.buffer });
      this.buffer = '';
    }
    return results;
  }
}

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
      // MiniMax: 获取或创建流式思考处理器
      const processor = model.provider === 'minimax' ? getMiniMaxProcessor(model.name) : null;
      
      return data.map(chunk => {
        if (!chunk.choices?.[0]) return '';
        const c = chunk.choices[0];
        const tc = c.delta?.tool_calls;
        
        let content = c.delta?.content || '';
        let thinking = c.delta?.reasoning_content || c.delta?.thinking || '';
        
        // MiniMax: 使用流式思考处理器
        if (processor && content) {
          const processed = processor.process(content);
          content = processed.content;
          if (processed.thinking) thinking = processed.thinking;
        }
        
        // 如果是最后一个 chunk (finish_reason 存在)，刷新处理器
        if (processor && c.finish_reason) {
          const flushed = processor.flush();
          // 重置处理器以供下次使用
          processor.reset();
          // 注意：flushed 的内容会在下一个响应中发送
          // 这里我们不处理 flushed 内容，因为 finish_reason 已经标记了结束
        }
        
        const base = {
          model:   model.name,
          created: chunk.created || Math.floor(Date.now() / 1000),
          done:    c.finish_reason === 'stop' || c.finish_reason === 'content_filter',
          message: {
            role:    c.delta?.role || 'assistant',
            content: content || (tc ? '' : ''),
          },
        };
        
        // 添加 thinking/reasoning 数据（如果存在）
        if (thinking) {
          base.thinking = thinking;
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
    
    let content = msg?.content || '';
    let thinking = msg?.reasoning_content || msg?.thinking || '';
    
    // MiniMax: 从 content 中提取 thinking 标签内容
    if (model.provider === 'minimax' && content) {
      const extracted = extractMiniMaxThinking(content);
      content = extracted.content;
      if (extracted.thinking) thinking = extracted.thinking;
    }

    const res = {
      model:        model.name,
      created:      data.created || Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  'stop',
      message: {
        role:    msg.role || 'assistant',
        content: content || '',
      },
      total_duration: 0,
      eval_count:     data.usage?.completion_tokens || 0,
    };
    
    // 添加 thinking/reasoning 数据（如果存在）
    if (thinking) {
      res.thinking = thinking;
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

// ── MiniMax 适配器（M2.5 等使用 Anthropic API 格式支持深度思考）─────────
const minimaxAdapter = {
  getEndpoint(model) {
    // MiniMax M2.5+ 使用 Anthropic 格式端点
    const base = model.endpoint || 'https://api.minimax.chat';
    const groupId = model.group_id || process.env.MINIMAX_GROUP_ID;
    let endpoint = `${base}/anthropic`;
    if (groupId) {
      endpoint += `?GroupId=${groupId}`;
    }
    return endpoint;
  },

  buildRequest(body, model) {
    const { messages = [], options = {}, tools } = body;

    const systemMsg = messages.find(m => m.role === 'system');
    const chatMsgs  = messages.filter(m => m.role !== 'system');

    // MiniMax M2.5+ 使用 Anthropic 格式
    const req = {
      model:      model.model_id || model.name || 'MiniMax-M2.5',
      messages:   chatMsgs.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : '',
      })),
      stream:     body.stream !== false,
      max_tokens: body.max_tokens || options.num_predict || model.default_max_tokens || 8192,
    };

    if (systemMsg) {
      req.system = systemMsg.content;
    }

    if (body.temperature !== undefined || options.temperature !== undefined) {
      req.temperature = body.temperature ?? options.temperature;
    }
    if (options.top_p) req.top_p = options.top_p;

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
      // MiniMax Anthropic 格式的流式响应
      return data
        .filter(d => ['content_block_start', 'content_block_delta', 'message_delta', 'message_stop'].includes(d.type))
        .map(d => {
          // 处理 thinking 内容块
          if (d.type === 'content_block_start' && d.content_block?.type === 'thinking') {
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              thinking: '', // 开始 thinking 块
            }) + '\n\n';
          }
          
          // 处理 thinking delta
          if (d.type === 'content_block_delta' && d.delta?.type === 'thinking') {
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              thinking: d.delta.thinking || '',
            }) + '\n\n';
          }
          
          // 处理 text 内容
          if (d.type === 'content_block_start' && d.content_block?.type === 'text') {
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              message: { role: 'assistant', content: '' },
            }) + '\n\n';
          }
          
          if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    false,
              message: {
                role:    'assistant',
                content: d.delta.text || '',
              },
            }) + '\n\n';
          }
          
          // 处理最终消息
          if (d.type === 'message_delta') {
            return 'data: ' + JSON.stringify({
              model:   model.name,
              created: Math.floor(Date.now() / 1000),
              done:    true,
              done_reason: d.delta?.stop_reason || 'end_turn',
              message: { role: 'assistant', content: '' },
            }) + '\n\n';
          }
          
          return '';
        }).join('');
    }

    // 非流式响应
    const content = Array.isArray(data.content) ? data.content : [];
    const textBlock  = content.find(c => c.type === 'text');
    const thinkingBlock = content.find(c => c.type === 'thinking');

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

    // 添加 thinking 内容（如果存在）
    if (thinkingBlock?.thinking) {
      res.thinking = thinkingBlock.thinking;
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
  minimax:   openaiLike,   // MiniMax 使用 OpenAI 兼容格式
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
