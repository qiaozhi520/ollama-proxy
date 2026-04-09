'use strict';

const BaseAdapter = require('./base');

class DeepSeekAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = 'deepseek';
    this.baseUrl = 'https://api.deepseek.com';
  }

  getEndpoint(cfg) {
    return `${cfg.base_url || this.baseUrl}/chat/completions`;
  }

  buildRequest(body, cfg) {
    // DeepSeek 请求格式与 OpenAI 兼容，添加必要的字段
    const request = {
      model: body.model || cfg.model_id || 'deepseek-chat',
      messages: body.messages || [],
      stream: body.stream !== undefined ? body.stream : true,
    };

    // 复制可选参数
    if (body.temperature !== undefined) request.temperature = body.temperature;
    if (body.max_tokens !== undefined) request.max_tokens = body.max_tokens;
    if (body.top_p !== undefined) request.top_p = body.top_p;
    if (body.stop !== undefined) request.stop = body.stop;
    if (body.tools !== undefined) request.tools = body.tools;

    // DeepSeek 特有参数
    if (body.thinking_budget !== undefined) {
      request.thinking_budget = body.thinking_budget;
    }

    return request;
  }

  /**
   * 转换 DeepSeek 流式响应为 Ollama 格式
   * DeepSeek 流式格式:
   * data: {"id":"...","choices":[{"delta":{"role":"assistant","content":"..."}}]}
   * data: {"id":"...","choices":[{"delta":{"thinking":"..."}}]}  <-- thinking chunk
   * data: {"id":"...","choices":[{"delta":{"content":"final answer"}}]}
   * data: [DONE]
   */
  convertStreamChunk(chunk, cfg) {
    try {
      const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
      
      // 跳过 [DONE]
      if (chunk === '[DONE]' || data === '[DONE]') {
        return null;
      }

      const choice = data.choices?.[0];
      if (!choice) return null;

      const delta = choice.delta || {};
      const reasoning = delta.reasoning || delta.thinking || '';

      // 转换为 Ollama 格式
      const ollamaChunk = {
        model: data.model || cfg.name || 'deepseek-chat',
        created_at: new Date().toISOString(),
        done: choice.finish_reason === 'stop' || choice.finish_reason === 'content_filter',
        message: {
          role: 'assistant',
          content: delta.content || '',
        },
      };

      // 如果有 thinking/reasoning 内容，添加到响应
      if (reasoning) {
        ollamaChunk.thinking = reasoning;
      }

      // DeepSeek 可能返回 usage 信息
      if (data.usage) {
        ollamaChunk.total_duration = data.usage.total_tokens * 1000; // 估算
      }

      return ollamaChunk;
    } catch (err) {
      console.error('DeepSeek chunk parse error:', err);
      return null;
    }
  }

  /**
   * 转换非流式响应为 Ollama 格式
   */
  convertResponse(data, cfg) {
    try {
      const choice = data.choices?.[0];
      if (!choice) return data;

      const message = choice.message || {};
      const reasoning = message.reasoning || message.thinking || '';

      const ollamaResponse = {
        model: data.model || cfg.name || 'deepseek-chat',
        created_at: new Date().toISOString(),
        done: true,
        done_reason: choice.finish_reason || 'stop',
        message: {
          role: message.role || 'assistant',
          content: message.content || '',
        },
        total_duration: data.usage?.total_tokens ? data.usage.total_tokens * 1000 : 0,
        load_duration: 0,
        prompt_eval_count: data.usage?.prompt_tokens || 0,
        prompt_eval_duration: 0,
        eval_count: data.usage?.completion_tokens || 0,
        eval_duration: 0,
      };

      // 如果有 thinking/reasoning 内容
      if (reasoning) {
        ollamaResponse.thinking = reasoning;
      }

      return ollamaResponse;
    } catch (err) {
      console.error('DeepSeek response parse error:', err);
      return data;
    }
  }
}

module.exports = DeepSeekAdapter;
