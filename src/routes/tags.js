'use strict';

const express = require('express');
const registry = require('../models/registry');
const router = express.Router();

// ── GET /api/tags ──────────────────────────────────────────────
// 返回所有已注册模型（兼容 Ollama list models API）
router.get('/', (req, res) => {
  const models = registry.list().map(m => ({
    name:         m.name,
    display_name: m.display_name || m.name,
    provider:     m.provider,
    model_id:     m.model_id     || m.name,
    modified_at:  new Date().toISOString(),
    size:         0,
    digest:       'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    details: {
      parent_model:       '',
      format:             'chat',
      family:             m.provider,
      families:           [m.provider],
      parameter_size:     '',
      quantization_level: 'Q4_0',
    },
  }));

  res.json({ models });
});

module.exports = router;
