'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { stream, request } = require('../utils/net');
const { extractThinkingContent } = require('../utils/thinking');

const router = express.Router();
const logger = log.child('generate');

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

function convertOllamaChatChunkToGenerateChunk(ollamaChunk, modelName) {
  const message = ollamaChunk.message || {};
  const { content, thinking } = extractThinkingContent(message, ollamaChunk);
  return {
    model: modelName,
    created_at: new Date((ollamaChunk.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    response: content || ollamaChunk.response || '',
    done: Boolean(ollamaChunk.done),
    done_reason: ollamaChunk.done_reason || 'stop',
    ...(thinking ? { thinking } : {}),
  };
}

function buildGenerateMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages;
  }

  const messages = [];

  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }

  if (body.prompt) {
    const userMessage = { role: 'user', content: body.prompt };
    if (Array.isArray(body.images) && body.images.length > 0) {
      userMessage.images = body.images;
    }
    messages.push(userMessage);
  }

  return messages;
}

// ── 规范化模型名（去掉 :latest 等标签）───────────────────────
function normalizeModelName(name) {
  if (!name) return name;
  return name.split(':')[0];
}

// ── POST /api/generate ───────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, stream: useStream, options, tools } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  // 规范化模型名
  const normalizedName = normalizeModelName(model);
  if (normalizedName !== model) {
    logger.debug(`模型名规范化: "${model}" -> "${normalizedName}"`);
  }

  const resolved = registry.get(normalizedName);
  if (!resolved) return res.status(404).json({ error: `model "${model}" not found` });

  const cfg = registry.resolve(resolved);
  const adapter = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);

  // 构建请求（将 prompt 转为 messages）
  const body = {
    messages: buildGenerateMessages(req.body),
    stream:   useStream !== false,
    options,
    tools,
  };

  const apiBody = adapter.buildRequest(body, cfg);

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const upstream = await stream(endpoint, cfg.api_key, cfg.provider, apiBody);

      upstream.on('data', (chunk) => {
        const chunkText = chunk.toString();
        const events = [];
        for (const line of chunkText.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try { events.push(JSON.parse(trimmed.slice(6))); } catch {}
          } else if (trimmed.startsWith('{')) {
            try { events.push(JSON.parse(trimmed)); } catch {}
          }
        }

        if (events.length > 0) {
          const out = adapter.mapResponse(true, events, cfg);
          if (out) {
            for (const payload of parseSseJsonPayloads(out)) {
              const generateChunk = convertOllamaChatChunkToGenerateChunk(payload, model);
              res.write(`data: ${JSON.stringify(generateChunk)}\n\n`);
            }
          }
        }
      });

      upstream.on('end', () => {
        res.write('data: ' + JSON.stringify({
          model: model,
          created_at: new Date().toISOString(),
          response: '',
          done: true,
          done_reason: 'stop',
        }) + '\n\n');
        res.write('data: [DONE]\n\n');
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
        res.status(err.status || 502).json({ error: err.message });
      }
    }

    return;
  }

  try {
    const t = log.timer();
    const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
    const chatResponse = adapter.mapResponse(false, data, cfg);

    if (!chatResponse) {
      return res.status(502).json({ error: 'invalid upstream response' });
    }

    // 转换为 Ollama /api/generate 格式
    const response = {
      model:      model,
      created_at: new Date().toISOString(),
      response:   extractThinkingContent(chatResponse.message || {}, chatResponse).content || '',
      done:       true,
      done_reason: 'stop',
      context:    [],
      total_duration: 0,
      load_duration:  0,
      prompt_eval_count: 0,
      eval_count: chatResponse.eval_count || 0,
    };

    logger.debug(`生成完成 (${t.elapsed().toFixed(0)}ms)`);
    res.json(response);
  } catch (err) {
    logger.error(`生成失败: ${err.message}`);
    res.status(err.status || 502).json({
      error: {
        message: err.message || 'Upstream request failed',
        type:    err.type || 'upstream_error',
      },
    });
  }
});

module.exports = router;
