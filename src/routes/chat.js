'use strict';

const express = require('express');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const router = express.Router();

const { forwardRequest } = require('../utils/net');

// ─────────────────────────────────────────────────────────────
//  POST /api/chat (流式 + 非流式)
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const body = req.body;
  const model = body.model;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolvedModel = registry.get(model);
  if (!resolvedModel) {
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  const cfg      = registry.resolveConfig(resolvedModel);
  const adapter  = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);
  const apiBody  = adapter.buildRequest(body, cfg);

  const streaming = body.stream !== false;

  if (streaming) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    flushSSEHeaders(res);

    try {
      const stream = await forwardStream(endpoint, cfg.api_key, cfg.provider, apiBody, cfg);
      let buffer = '';
      let idleTimer;

      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        // Gemini/SSE 分块处理
        const events = [];
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const raw = JSON.parse(line.slice(6));
              events.push(raw);
            } catch {}
          } else if (line.startsWith('{')) {
            try {
              events.push(JSON.parse(line));
            } catch {}
          }
        }

        if (events.length > 0) {
          const out = adapter.mapResponse(true, events, cfg);
          if (out) {
            clearTimeout(idleTimer);
            res.write(out);
            flush(res);
            idleTimer = setTimeout(() => flush(res), 50);
          }
        }
      });

      stream.on('end', () => {
        clearTimeout(idleTimer);
        // 发送结束帧
        const done = adapter.mapResponse(false, { done: true, model: cfg.name }, cfg);
        if (done) {
          res.write('data: ' + JSON.stringify({
            model:     cfg.name,
            created:   Math.floor(Date.now() / 1000),
            done:      true,
            done_reason: 'stop',
            message:   { role: 'assistant', content: '' },
          }) + '\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });

      stream.on('error', (err) => {
        clearTimeout(idleTimer);
        if (!res.headersSent) {
          res.status(502).json({ error: err.message });
        } else {
          res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
          res.end();
        }
      });
    } catch (err) {
      handleErrorStream(res, err);
    }
  } else {
    try {
      const data     = await forwardRequest(endpoint, cfg.api_key, cfg.provider, apiBody, false);
      const response = adapter.mapResponse(false, data, cfg);
      if (!response) return res.status(502).json({ error: 'invalid upstream response' });
      res.json(response);
    } catch (err) {
      handleError(res, err);
    }
  }
});

function flushSSEHeaders(res) {
  res.flushHeaders ? res.flushHeaders() : res.flush();
}

function flush(res) {
  if (res.flush) res.flush();
}

function handleErrorStream(res, err) {
  if (!res.headersSent) {
    res.status(500).json({ error: err.message });
  } else {
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.end();
  }
}

function handleError(res, err) {
  console.error('[chat] upstream error:', err.message);
  const status = err.status || 502;
  res.status(status).json({
    error: {
      message:     err.message || 'Upstream request failed',
      type:        err.type    || 'upstream_error',
      code:        err.code    || undefined,
      status:      status,
    },
  });
}

module.exports = router;
