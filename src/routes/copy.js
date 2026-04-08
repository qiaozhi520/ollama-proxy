'use strict';

const express = require('express');
const registry = require('../models/registry');
const createRoute = require('./create');
const router = express.Router();

// ── POST /api/copy ───────────────────────────────────────────
// 复制模型（创建别名）
router.post('/', (req, res) => {
  const { source, destination } = req.body;

  if (!source || !destination) {
    return res.status(400).json({ error: '"source" and "destination" are required' });
  }

  // 检查源模型是否存在
  const sourceModel = registry.get(source);
  if (!sourceModel) {
    // 检查是否是自定义模型
    const customModel = createRoute.getCustomModel(source);
    if (!customModel) {
      return res.status(404).json({ error: `source model "${source}" not found` });
    }
  }

  // 创建副本
  const customModels = createRoute.getCustomModels();
  customModels.set(destination, {
    name: destination,
    from: source,
    created_at: new Date().toISOString()
  });

  res.json({ status: 'success' });
});

module.exports = router;
