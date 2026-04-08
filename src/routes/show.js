'use strict';

const express = require('express');
const registry = require('../models/registry');
const router = express.Router();

// ── POST /api/show ─────────────────────────────────────────────
// 返回指定模型的详细信息（Ollama show 模型名 API）
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '"name" is required' });

  const model = registry.get(name);
  if (!model) return res.status(404).json({ error: `model "${name}" not found` });

  const cfg = registry.resolveConfig(model);

  res.json({
    license:       '',
    modelfile:     `FROM ${model.name}`,
    parameters:    '',
    template:      '',
    details: {
      parent_model:       '',
      format:             'chat',
      family:             model.provider,
      families:           [model.provider],
      parameter_size:     cfg.parameter_size || '',
      quantization_level: cfg.quantization || 'Q4_0',
    },
    model_info: {
      'general.architecture':        'proxy',
      'general.context_length':      model.context_length || 4096,
      'general.parameter_count':     0,
      'general.quantization_version': 2,
    },
    capabilities: {
      completion:   true,
      chat:         true,
      embedding:    model.capabilities?.includes('embedding') || false,
      multi_modal:  model.supports_vision || false,
    },
    modified_at:   new Date().toISOString(),
    size:          cfg.size || 0,
    digest:        'sha256:' + (cfg.api_key || '').slice(0, 12).padEnd(64, '0') || 'proxy',
  });
});

// GET 别名
router.get('/', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '"name" query param required' });
  req.body = { name };
  router.handle(req, res, () => {});
});

module.exports = router;
