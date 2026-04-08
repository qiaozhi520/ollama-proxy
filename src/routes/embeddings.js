'use strict';

const express = require('express');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { forwardRequest, handleError } = require('../utils/net');
const router = express.Router();

// ── POST /api/embeddings ─────────────────────────────────────
// 生成文本的嵌入向量
router.post('/', async (req, res) => {
  const { model, prompt, options } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });
  if (!prompt) return res.status(400).json({ error: '"prompt" is required' });

  const resolvedModel = registry.get(model);
  if (!resolvedModel) {
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  const cfg = registry.resolveConfig(resolvedModel);
  
  // 检查模型是否支持 embedding
  if (cfg.capabilities && !cfg.capabilities.includes('embedding')) {
    return res.status(400).json({ 
      error: `model "${model}" does not support embeddings`,
      hint: 'Use an embedding model like nomic-embed-text, all-minilm, etc.'
    });
  }

  const adapter = getAdapter(cfg.provider);
  
  // 构建 embedding 请求
  let endpoint, apiBody;
  
  switch (cfg.provider) {
    case 'openai': {
      endpoint = 'https://api.openai.com/v1/embeddings';
      apiBody = {
        model: cfg.api_model || cfg.name.split('/').pop(),
        input: prompt,
        encoding_format: 'float'
      };
      break;
    }
    case 'silicon': {
      endpoint = 'https://api.siliconflow.cn/v1/embeddings';
      apiBody = {
        model: cfg.api_model || cfg.name.split('/').pop(),
        input: prompt,
        encoding_format: 'float'
      };
      break;
    }
    case 'deepseek': {
      endpoint = 'https://api.deepseek.com/v1/embeddings';
      apiBody = {
        model: cfg.api_model || 'deepseek-embed',
        input: prompt
      };
      break;
    }
    default:
      return res.status(400).json({ 
        error: `provider "${cfg.provider}" does not support embeddings via this proxy`
      });
  }

  try {
    const data = await forwardRequest(endpoint, cfg.api_key, cfg.provider, apiBody, false);
    
    // 转换为 Ollama 格式
    const embedding = data.data?.[0]?.embedding || data.embedding;
    if (!embedding) {
      return res.status(502).json({ error: 'invalid embedding response from upstream' });
    }

    res.json({
      embedding,
      model,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
