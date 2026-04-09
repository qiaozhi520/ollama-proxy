'use strict';

const express = require('express');
const log = require('../utils/logger');
const DeepSeekAdapter = require('./deepseek');
const MiniMaxAdapter = require('./minimax');

const router = express.Router();
const logger = log.child('openai');

// 创建适配器实例
const adapters = {
  'deepseek': new DeepSeekAdapter(),
  'minimax': new MiniMaxAdapter(),
};

function getAdapter(provider) {
  return adapters[provider?.toLowerCase()] || adapters['deepseek'];
}

// ── POST /v1/chat/completions ───────────────────────────────────────────────
router.post('/chat/completions', async (req, res) => {
  const { model, messages, stream: useStream, tools, options } = req.body;

  if (!model) {
    return res.status(400).json({ 
      error: { 
        message: '"model" is required', 
        type: 'invalid_request_error' 
      } 
    });
  }

  // 解析 provider 和 model
  let provider = 'deepseek'; // 默认
  let targetModel = model;

  // 支持格式: provider/model 或直接 model 名
  if (model.includes('/')) {
    const [p, m] = model.split('/');
    provider = p;
    targetModel = m;
  }

  const adapter = getAdapter(provider);
  if (!adapter) {
    return res.status(400).json({ 
      error: { 
        message: `Unknown provider: ${provider}`, 
        type: 'invalid_request_error' 
      } 
    });
  }

  // 从请求体中提取配置（用于构建目标 API 请求）
  const requestBody = {
    ...req.body,
    model: targetModel,
  };

  // 获取端点
  const endpoint = adapter.getEndpoint({ base_url: getBaseUrl(provider) });
  
  logger.info(`OpenAI compatible request: provider=${provider}, model=${targetModel}, stream=${useStream}`);

  // ── 流式响应 ───────────────────────────────────────────────
  if (useStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getApiKey(provider)}`,
          ...(provider === 'minimax' && { 'Authorization': `Bearer ${getApiKey('minimax')}` }),
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Upstream error: ${response.status} ${error}`);
        return res.status(502).json({ 
          error: { message: `Upstream error: ${response.status}`, type: 'upstream_error' } 
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
                if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
                  res.write('data: [DONE]\n\n');
                }
                continue;
              }

              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                try {
                  const chunk = JSON.parse(jsonStr);
                  
                  // 使用适配器转换 chunk
                  let ollamaChunk;
                  if (provider === 'deepseek') {
                    ollamaChunk = adapter.convertStreamChunk(jsonStr, { name: targetModel });
                  } else {
                    ollamaChunk = adapter.convertStreamChunk(jsonStr, { name: targetModel });
                  }

                  if (ollamaChunk) {
                    // 发送 thinking chunk（如果有）
                    if (ollamaChunk.thinking) {
                      res.write(`data: ${JSON.stringify({
                        model: ollamaChunk.model,
                        created_at: ollamaChunk.created_at,
                        response: ollamaChunk.thinking,
                        done: false,
                      })}\n\n`);
                    }
                    
                    // 发送 content chunk
                    res.write(`data: ${JSON.stringify({
                      model: ollamaChunk.model,
                      created_at: ollamaChunk.created_at,
                      done: ollamaChunk.done,
                      message: ollamaChunk.message,
                    })}\n\n`);
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }
          }
        } catch (err) {
          logger.error(`Stream error: ${err.message}`);
        } finally {
          res.end();
        }
      };

      processLine();
    } catch (err) {
      logger.error(`Stream failed: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: { message: err.message, type: 'upstream_error' } });
      }
    }
    return;
  }

  // ── 非流式响应 ─────────────────────────────────────────────
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey(provider)}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Upstream error: ${response.status} ${error}`);
      return res.status(502).json({ 
        error: { message: `Upstream error: ${response.status}`, type: 'upstream_error' } 
      });
    }

    const data = await response.json();
    
    // 使用适配器转换响应
    const ollamaResponse = adapter.convertResponse(data, { name: targetModel });

    res.json(ollamaResponse);
  } catch (err) {
    logger.error(`Request failed: ${err.message}`);
    res.status(