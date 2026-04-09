'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const { request } = require('../utils/net');

const router = express.Router();
const logger = log.child('embed');

// Embedding 端点配置
const EMBED_ENDPOINTS = {
  openai:  'https://api.openai.com/v1/embeddings',
  silicon: 'https://api.siliconflow.cn/v1/embeddings',
  deepseek:'https://api.deepseek.com/v1/embeddings',
};

// ── POST /api/embeddings ─────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, prompt, input } = req.body;
  const text = prompt || input;

  if (!model) return res.status(400).json({ error: '"model" is required' });
  if (!text)  return res.status(400).json({ error: '"prompt" or "input" is required' });

  const resolved = registry.get(model);
  if (!resolved) return res.status(404).json({ error: `model "${model}" not found` });

  const cfg = registry.resolve(resolved);

  // 检查 embedding 能力
  if (cfg.capabilities && !cfg.capabilities.includes('embedding')) {
    return res.status(400).json({
      error: `model "${model}" does not support embeddings`,
      hint:  'Use an embedding model like text-embedding-3-small, bge-m3, etc.',
    });
  }

  const endpoint = EMBED_ENDPOINTS[cfg.provider];
  if (!endpoint) {
    return res.status(400).json({ error: `provider "${cfg.provider}" does not support embeddings` });
  }

  const apiBody = {
    model: cfg.model_id || cfg.name.split('/').pop(),
    input: text,
    encoding_format: 'float',
  };

  try {
    const t = log.timer();
    const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
    const embedding = data.data?.[0]?.embedding || data.embedding;

    if (!embedding) {
      return res.status(502).json({ error: 'invalid embedding response' });
    }

    logger.debug(`Embedding 完成 (${t.elapsed().toFixed(0)}ms, dim=${embedding.length})`);
    res.json({ embedding, model, created_at: new Date().toISOString() });
  } catch (err) {
    logger.error(`Embedding 失败: ${err.message}`);
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;
