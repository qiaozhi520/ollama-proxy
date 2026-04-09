'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const createRoute = require('./create');

const router = express.Router();
const logger = log.child('delete');

// ── DELETE /api/delete ───────────────────────────────────────
router.delete('/', (req, res) => {
  const { name, model } = req.body;
  const modelName = name || model;  // 支持 name 或 model 参数

  if (!modelName) return res.status(400).json({ error: '"name" is required' });

  const customModels = createRoute.getCustomModels();

  // 只能删除自定义模型
  if (!customModels.has(modelName)) {
    const configModel = registry.get(modelName);
    if (configModel) {
      return res.status(403).json({
        error: 'cannot delete models from config file',
        hint:  'Only custom models created via /api/create can be deleted',
      });
    }
    return res.status(404).json({ error: `model "${modelName}" not found` });
  }

  customModels.delete(modelName);
  logger.info(`删除模型 "${modelName}"`);
  res.json({ status: 'success' });
});

module.exports = router;
