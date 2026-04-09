'use strict';

const express = require('express');
const log = require('../utils/logger');
const registry = require('../models/registry');
const createRoute = require('./create');

const router = express.Router();
const logger = log.child('copy');

// ── POST /api/copy ───────────────────────────────────────────
router.post('/', (req, res) => {
  const { source, destination } = req.body;

  if (!source || !destination) {
    return res.status(400).json({ error: '"source" and "destination" are required' });
  }

  // 检查源模型
  const sourceModel = registry.get(source) || createRoute.getCustomModel(source);
  if (!sourceModel) {
    return res.status(404).json({ error: `source model "${source}" not found` });
  }

  // 创建别名
  const customModels = createRoute.getCustomModels();
  customModels.set(destination, {
    name: destination,
    from: source,
    created_at: new Date().toISOString(),
  });

  logger.info(`复制模型 "${source}" → "${destination}"`);
  res.json({ status: 'success' });
});

module.exports = router;
