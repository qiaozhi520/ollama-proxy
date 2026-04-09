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

function normalizeEmbeddingInputs(input, prompt) {
  const value = input ?? prompt;
  if (value == null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item !== 'string') {
        throw new Error('OpenAI embeddings array input must contain strings');
      }
      return item;
    });
  }

  return [String(value)];
}

// ── POST /api/embeddings ─────────────────────────────────────
router.post('/', async (req, res) => {
  const { model, prompt, input } = req.body;
  let texts;

  try {
    texts = normalizeEmbeddingInputs(input, prompt);
  } catch (err) {
    return res.status(400).json({ error: err.message, request: req.body });
  }

  if (!model) {
    logger.warn(`缺少 model 参数，请求体: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: '"model" is required', request: req.body });
  }
  if (texts.length === 0) {
    logger.warn(`缺少 prompt/input 参数，请求体: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: '"prompt" or "input" is required', request: req.body });
  }

  // 规范化模型名
  const normalizedName = model.split(':')[0];
  if (normalizedName !== model) {
    logger.debug(`模型名规范化: "${model}" -> "${normalizedName}"`);
  }

  const resolved = registry.get(normalizedName);
  if (!resolved) return res.status(404).json({ error: `model "${normalizedName}" not found` });

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

  try {
    const t = log.timer();
    const embeddings = [];

    for (const text of texts) {
      const apiBody = {
        model: cfg.model_id || cfg.name.split('/').pop(),
        input: text,
        encoding_format: 'float',
      };

      const data = await request(endpoint, cfg.api_key, cfg.provider, apiBody);
      const embedding = data.data?.[0]?.embedding || data.embedding;

      if (!embedding) {
        return res.status(502).json({ error: 'invalid embedding response' });
      }

      embeddings.push(embedding);
    }

    if (embeddings.length === 0) {
      return res.status(502).json({ error: 'invalid embedding response' });
    }

    logger.debug(`Embedding 完成 (${t.elapsed().toFixed(0)}ms, count=${embeddings.length})`);
    res.json({
      object: 'list',
      data: embeddings.map((embedding, index) => ({
        object: 'embedding',
        index,
        embedding,
      })),
      model,
      usage: {
        prompt_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (err) {
    logger.error(`Embedding 失败: ${err.message}`);
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;
