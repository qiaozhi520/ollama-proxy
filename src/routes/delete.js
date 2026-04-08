'use strict';

const express = require('express');
const registry = require('../models/registry');
const createRoute = require('./create');
const router = express.Router();

// ── DELETE /api/delete ───────────────────────────────────────
// 删除模型（仅限自定义模型别名）
router.delete('/', (req, res) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: '"model" is required' });
  }

  const customModels = createRoute.getCustomModels();
  
  // 只能删除自定义模型
  if (!customModels.has(model)) {
    // 检查是否是配置文件中的模型
    const configModel = registry.get(model);
    if (configModel) {
      return res.status(403).json({ 
        error: 'cannot delete models from config file',
        hint: 'Only custom models created via /api/create can be deleted'
      });
    }
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  customModels.delete(model);
  res.json({ status: 'success' });
});

module.exports = router;
