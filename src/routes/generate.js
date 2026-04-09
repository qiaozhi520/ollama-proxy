'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { request } = require('../utils/net');

const router = express.Router();
const logger = log.child('generate');

// ── POST /api/generate ───────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, prompt, stream, options, tools } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolved = registry.get(model);
  if (!resolved) return res.status(404).json({ error: `model "${model}" not found` });

  const cfg = registry.resolve(resolved);
  const adapter = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);

  // 构建请求（将 prompt 转为 messages）
  const body = {
    messages: prompt ? [{ role: 'user', content: prompt }] : req.body.messages || [],
    stream:   stream !== false,
    options,
    tools,
  };

  const apiBody = adapter.buildRequest(body, cfg);

  try {
    const t = log.timer();
    const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
    const response = adapter.mapResponse(false, data, cfg);

    if (!response) {
      return res.status(502).json({ error: 'invalid upstream response' });
    }

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
