'use strict';

const express = require('express');
const registry = require('../models/registry');

const router = express.Router();

// ── GET /api/tags ────────────────────────────────────────────
router.get('/', (_req, res) => {
  const models = registry.list().map(m => ({
    name:         m.name,
    display_name: m.display_name || m.name,
    provider:     m.provider,
    model_id:     m.model_id || m.name,
    modified_at:  new Date().toISOString(),
    size:         0,
    digest:       String(m.digest || m.model_id || m.name || 'unknown'),
    details: {
      parent_model:       '',
      format:             'proxy',
      family:             m.provider,
      families:           [m.provider],
      parameter_size:     '',
      quantization_level: 'Q4_0',
    },
  }));

  res.json({ models });
});

module.exports = router;
