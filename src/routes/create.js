'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');

const router = express.Router();
const logger = log.child('create');

// 自定义模型存储
const customModels = new Map();

// ── POST /api/create ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, from, modelfile, stream } = req.body;

  if (!name) return res.status(400).json({ error: '"name" is required' });

  // 从 Modelfile 创建
  if (modelfile) {
    const lines = modelfile.split('\n');
    let baseModel = null;
    let systemPrompt = '';
    const parameters = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FROM ')) {
        baseModel = trimmed.slice(5).trim();
      } else if (trimmed.startsWith('SYSTEM ')) {
        systemPrompt = trimmed.slice(7).trim().replace(/^["']|["']$/g, '');
      } else if (trimmed.startsWith('PARAMETER ')) {
        const [key, ...vals] = trimmed.slice(10).split(/\s+/);
        parameters[key] = vals.join(' ');
      }
    }

    if (!baseModel) {
      return res.status(400).json({ error: 'Modelfile must contain FROM directive' });
    }

    const source = registry.get(baseModel);
    if (!source) {
      return res.status(404).json({ error: `source model "${baseModel}" not found` });
    }

    customModels.set(name, {
      name,
      from: baseModel,
      system: systemPrompt,
      parameters,
      created_at: new Date().toISOString(),
    });

    logger.info(`创建模型 "${name}" from "${baseModel}"`);
  } else {
    // 从现有模型创建别名
    if (!from) {
      return res.status(400).json({ error: '"from" or "modelfile" is required' });
    }

    const source = registry.get(from);
    if (!source) {
      return res.status(404).json({ error: `source model "${from}" not found` });
    }

    customModels.set(name, { name, from, created_at: new Date().toISOString() });
    logger.info(`复制模型 "${from}" → "${name}"`);
  }

  // 流式响应（兼容 Ollama）
  if (stream !== false) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ status: 'copying model' }) + '\n');
    res.write(JSON.stringify({ status: 'success' }) + '\n');
    res.end();
  } else {
    res.json({ status: 'success' });
  }
});

// 导出供其他模块使用
router.getCustomModels = () => customModels;
router.getCustomModel = (name) => customModels.get(name);

module.exports = router;
