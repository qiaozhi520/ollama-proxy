'use strict';

const BaseAdapter = require('./base');

class MiniMaxAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = 'minimax';
    this.baseUrl = 'https://api.minimax.chat/v1';
  }

  getEndpoint(cfg) {
    // MiniMax 使用 OpenAI 兼容的端点格式
    return `${cfg.base_url || this.baseUrl}/text/chatcompletion_v2`;
  }

  buildRequest(body, cfg) {
    // MiniMax 请求格式
    const request = {
      model: body.model || cfg.model_id || body.minimax_model_name || 'MiniMax-Text-01',
      messages: body.messages || [],
      stream: body.stream !== undefined ? body.stream : true,
    };

    // 复制可选参数
    if (body.temperature !== undefined) request.temperature = body.temperature;
    if (body.max_tokens !== undefined) request.max_tokens = body.max_tokens;
    if (body.top_p !== undefined) request.top_p = body.top_p;
    if (body.stop !== undefined) request.stop = body.stop;
    if (body.tools !== undefined) request.tools = body.tools;
    if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice;

    return request;
  }

  /**
   * 转换 MiniMax 流式响应为 Ollama 格式
   * MiniMax 流式格式类似 OpenAI
   */
  convertStreamChunk(chunk, cfg) {
    try {
      // 跳过 [DONE]
      if (chunk === '[DONE]' || chunk === '[DONE]\n') {
        return null;
      }

      const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;

      // MiniMax 可能返回不同格式的 choices
      const choice = data.choices?.[0] || data.delta || {};
      
      const ollamaChunk = {
        model: data.model || cfg.name || 'minimax',
        created_at: new Date().toISOString(),
        done: data.choices?.[0]?.finish_reason === 'stop' || data.choices?.[0]?.finish_reason === 'length',
        message: {
          role: 'assistant',
          content: choice.content || choice.delta?.content || '',
        },
      };

      // MiniMax 不支持 thinking，所以不处理

      return ollamaChunk;
    } catch (err) {
      console.error('MiniMax chunk parse error:', err);
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

      const ollamaResponse = {
        model: data.model || cfg.name || 'minimax',
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

      return ollamaResponse;
    } catch (err) {
      console.error('MiniMax response parse error:', err);
      return data;
    }
  }
}

module.exports = MiniMaxAdapter;
