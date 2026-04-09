'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { stream, request } = require('../utils/net');

const router = express.Router();
const logger = log.child('chat');

function parseSseJsonPayloads(sseText) {
  return String(sseText)
    .split(/\n\n+/)
    .flatMap(block => block.split('\n'))
    .map(line => line.trim())
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice(6).trim())
    .filter(payload => payload && payload !== '[DONE]')
    .flatMap(payload => {
      try {
        return [JSON.parse(payload)];
      } catch {
        return [];
      }
    });
}

function convertOllamaChunkToOpenAIChunk(ollamaChunk, modelName) {
  const message = ollamaChunk.message || {};
  const delta = {};

  if (message.role && message.role !== 'assistant') {
    delta.role = message.role;
  }

  if (typeof message.content === 'string' && message.content) {
    delta.content = message.content;
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    delta.tool_calls = message.tool_calls.map((toolCall, index) => ({
      id: toolCall.id || `call_${index}`,
      type: 'function',
      index: toolCall.index ?? index,
      function: {
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '',
      },
    }));
  }

  if (Object.keys(delta).length === 0 && !ollamaChunk.done) {
    delta.role = 'assistant';
  }

  const choice = {
    index: 0,
    delta,
  };

  if (ollamaChunk.done) {
    choice.finish_reason = ollamaChunk.done_reason || 'stop';
  }

  return {
    id: ollamaChunk.id || `chatcmpl-${Date.now().toString(36)}`,
    object: 'chat.completion.chunk',
    created: ollamaChunk.created || Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [choice],
  };
}

function convertOllamaMessageToOpenAIMessage(message = {}) {
  const openaiMessage = {
    role: message.role || 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    openaiMessage.tool_calls = message.tool_calls.map((toolCall, index) => ({
      id: toolCall.id || `call_${index}`,
      type: toolCall.type || 'function',
      function: {
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '',
      },
    }));
  }

  return openaiMessage;
}

// ── 规范化模型名（去掉 :latest 等标签）───────────────────────
function normalizeModelName(name) {
  if (!name) return name;
  // 去掉 :latest 或其他标签
  return name.split(':')[0];
}

// ── POST /api/chat ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, messages, stream: useStream, tools, options } = req.body;
  const openaiFormat = Boolean(req._openaiFormat);

  if (!model) return res.status(400).json({ error: '"model" is required' });

  // 规范化模型名（去掉 :latest 标签）
  const normalizedName = normalizeModelName(model);
  if (normalizedName !== model) {
    logger.debug(`模型名规范化: "${model}" -> "${normalizedName}"`);
  }

  const resolved = registry.get(normalizedName);
  if (!resolved) return res.status(404).json({ error: `model "${normalizedName}" not found` });

  const cfg = registry.resolve(resolved);
  const adapter = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);
  const apiBody = adapter.buildRequest(req.body, cfg);
  const streaming = useStream !== false;

  // ── 流式响应 ───────────────────────────────────────────────
  if (streaming) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const t = log.timer();
      const upstream = await stream(endpoint, cfg.api_key, cfg.provider, apiBody);
      let buffer = '';

      upstream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        const events = [];
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { events.push(JSON.parse(line.slice(6))); } catch {}
          } else if (line.startsWith('{')) {
            try { events.push(JSON.parse(line)); } catch {}
          }
        }

        if (events.length > 0) {
          const out = adapter.mapResponse(true, events, cfg);
          if (out) {
            if (openaiFormat) {
              for (const payload of parseSseJsonPayloads(out)) {
                const openaiChunk = convertOllamaChunkToOpenAIChunk(payload, model || cfg.name);
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
            } else {
              res.write(out);
            }
          }
        }
      });

      upstream.on('end', () => {
        logger.debug(`流式完成 (${t.elapsed().toFixed(0)}ms)`);
        if (openaiFormat) {
          const finalChunk = convertOllamaChunkToOpenAIChunk({ done: true, done_reason: 'stop' }, model || cfg.name);
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
        } else {
          res.write('data: ' + JSON.stringify({
            model:       cfg.name,
            created:     Math.floor(Date.now() / 1000),
            done:        true,
            done_reason: 'stop',
            message:     { role: 'assistant', content: '' },
          }) + '\n\n');
          res.write('data: [DONE]\n\n');
        }
        res.end();
      });

      upstream.on('error', (err) => {
        logger.error(`流式错误: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).json({ error: err.message });
        } else {
          res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
          res.end();
        }
      });
    } catch (err) {
      logger.error(`流式失败: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: err.message });
      }
    }
    return;
  }

  // ── 非流式响应 ─────────────────────────────────────────────
  try {
    const t = log.timer();
    const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
    const ollamaResponse = adapter.mapResponse(false, data, cfg);

    if (!ollamaResponse) {
      return res.status(502).json({ error: 'invalid upstream response' });
    }

    logger.debug(`对话完成 (${t.elapsed().toFixed(0)}ms)`);

    // 如果请求来自 /v1/chat/completions，返回 OpenAI 格式
    if (req._openaiFormat) {
      const openaiResponse = {
        id:      `chatcmpl-${Date.now().toString(36)}`,
        object:  'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model:   model,
        choices: [{
          index:         0,
          message:       convertOllamaMessageToOpenAIMessage(ollamaResponse.message || { role: 'assistant', content: '' }),
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens:     data.usage?.prompt_tokens || 0,
          completion_tokens: data.usage?.completion_tokens || 0,
          total_tokens:      data.usage?.total_tokens || 0,
        },
      };
      return res.json(openaiResponse);
    }

    res.json(ollamaResponse);
  } catch (err) {
    logger.error(`对话失败: ${err.message}`);
    res.status(err.status || 502).json({
      error: {
        message: err.message || 'Upstream request failed',
        type:    err.type || 'upstream_error',
      },
    });
  }
});

module.exports = router;
