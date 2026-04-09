'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const createRoute = require('./create');

const router = express.Router();
const logger = log.child('delete');

// ── DELETE /api/delete ───────────────────────────────────────
router.delete('/', (req, res) => {
  const { model } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const customModels = createRoute.getCustomModels();

  // 只能删除自定义模型
  if (!customModels.has(model)) {
    const configModel = registry.get(model);
    if (configModel) {
      return res.status(403).json({
        error: 'cannot delete models from config file',
        hint:  'Only custom models created via /api/create can be deleted',
      });
    }
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  customModels.delete(model);
  logger.info(`删除模型 "${model}"`);
  res.json({ status: 'success' });
});

module.exports = router;
