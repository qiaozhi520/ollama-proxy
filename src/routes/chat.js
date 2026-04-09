'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { stream, request } = require('../utils/net');

const router = express.Router();
const logger = log.child('chat');

// ── POST /api/chat ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, messages, stream: useStream, tools, options } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolved = registry.get(model);
  if (!resolved) return res.status(404).json({ error: `model "${model}" not found` });

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
          if (out) res.write(out);
        }
      });

      upstream.on('end', () => {
        logger.debug(`流式完成 (${t.elapsed().toFixed(0)}ms)`);
        res.write('data: ' + JSON.stringify({
          model:       cfg.name,
          created:     Math.floor(Date.now() / 1000),
          done:        true,
          done_reason: 'stop',
          message:     { role: 'assistant', content: '' },
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
        res.status(502).json({ error: err.message });
      }
    }
    return;
  }

  // ── 非流式响应 ─────────────────────────────────────────────
  try {
    const t = log.timer();
    const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
    const response = adapter.mapResponse(false, data, cfg);

    if (!response) {
      return res.status(502).json({ error: 'invalid upstream response' });
    }

    logger.debug(`对话完成 (${t.elapsed().toFixed(0)}ms)`);
    res.json(response);
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
