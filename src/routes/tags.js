'use strict';

const express = require('express');
const registry = require('../models/registry');
const log = require('../utils/logger').child('tags');

const router = express.Router();

// ── GET /api/tags ────────────────────────────────────────────
router.get('/', (_req, res) => {
  const models = registry.list().map(m => {
    // 确保 name 包含 :latest 标签（Ollama 标准格式）
    const modelName = m.name.includes(':') ? m.name : `${m.name}:latest`;
    
    return {
      name:         modelName,
      model:        modelName,  // Ollama 标准格式需要 model 字段
      modified_at:  new Date().toISOString(),
      size:         m.size || 0,
      digest:       String(m.digest || m.model_id || m.name || 'unknown'),
      details: {
        format:             'gguf',  // Ollama 标准格式
        family:             m.provider,
        families:           [m.provider],
        parameter_size:     m.parameter_size || '',
        quantization_level: 'Q4_K_M',  // Ollama 标准格式
      },
    };
  });

  log.info('返回模型列表', { 
    count: models.length, 
    names: models.map(m => m.name) 
  });

  res.json({ models });
});

module.exports = router;
