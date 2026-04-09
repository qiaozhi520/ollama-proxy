'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');

const router = express.Router();
const logger = log.child('show');

// ── POST /api/show ───────────────────────────────────────────
router.post('/', (req, res) => {
  // Ollama API 使用 "model" 参数
  const name = req.body.model || req.body.name;
  if (!name) {
    logger.warn(`缺少 model 参数，请求体: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: '"model" is required', request: req.body });
  }

  const model = registry.get(name);
  if (!model) return res.status(404).json({ error: `model "${name}" not found` });

  const cfg = registry.resolve(model);

  res.json({
    license:    '',
    modelfile:  `FROM ${model.name}`,
    parameters: '',
    template:   '',
    details: {
      parent_model:       '',
      format:             'chat',
      family:             model.provider,
      families:           [model.provider],
      parameter_size:     cfg.parameter_size || '',
      quantization_level: cfg.quantization || 'Q4_0',
    },
    model_info: {
      'general.architecture':         'proxy',
      'general.context_length':       model.context_length || 4096,
      'general.parameter_count':      0,
      'general.quantization_version': 2,
    },
    capabilities: {
      completion:  true,
      chat:        true,
      embedding:   model.capabilities?.includes('embedding') || false,
      multi_modal: model.supports_vision || false,
    },
    modified_at: new Date().toISOString(),
    size:        cfg.size || 0,
    digest:      'sha256:' + (cfg.api_key ? Buffer.from(cfg.api_key).toString('hex').slice(0, 64) : '0'.repeat(64)),
  });
});

module.exports = router;
