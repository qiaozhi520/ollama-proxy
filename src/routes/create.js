'use strict';

const express = require('express');
const registry = require('../models/registry');
const router = express.Router();

// 存储自定义模型别名
const customModels = new Map();

// ── POST /api/create ─────────────────────────────────────────
// 从现有模型创建自定义模型（实际上是创建别名）
router.post('/', async (req, res) => {
  const { name, from, modelfile, stream } = req.body;

  if (!name) {
    return res.status(400).json({ error: '"name" is required' });
  }

  // 从 Modelfile 创建
  if (modelfile) {
    // 解析 Modelfile
    const lines = modelfile.split('\n');
    let baseModel = null;
    let systemPrompt = '';
    let parameters = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FROM ')) {
        baseModel = trimmed.slice(5).trim();
      } else if (trimmed.startsWith('SYSTEM ')) {
        systemPrompt = trimmed.slice(7).trim().replace(/^["']|["']$/g, '');
      } else if (trimmed.startsWith('PARAMETER ')) {
        const [key, value] = trimmed.slice(10).split(/\s+/);
        parameters[key] = value;
      }
    }

    if (!baseModel) {
      return res.status(400).json({ error: 'Modelfile must contain FROM directive' });
    }

    // 检查源模型是否存在
    const sourceModel = registry.get(baseModel);
    if (!sourceModel) {
      return res.status(404).json({ error: `source model "${baseModel}" not found` });
    }

    // 创建自定义模型
    customModels.set(name, {
      name: name,
      from: baseModel,
      system: systemPrompt,
      parameters,
      created_at: new Date().toISOString()
    });

    if (stream !== false) {
      // 流式响应状态
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ status: 'reading modelfile' }) + '\n');
      res.write(JSON.stringify({ status: 'creating model layer' }) + '\n');
      res.write(JSON.stringify({ status: 'writing layer sha' }) + '\n');
      res.write(JSON.stringify({ status: 'success' }) + '\n');
      res.end();
    } else {
      res.json({ status: 'success' });
    }
    return;
  }

  // 从现有模型创建
  if (!from) {
    return res.status(400).json({ error: '"from" or "modelfile" is required' });
  }

  const sourceModel = registry.get(from);
  if (!sourceModel) {
    return res.status(404).json({ error: `source model "${from}" not found` });
  }

  // 创建别名
  customModels.set(name, {
    name: name,
    from: from,
    created_at: new Date().toISOString()
  });

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
