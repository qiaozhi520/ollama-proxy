'use strict';

const express = require('express');

const router = express.Router();

// ── GET /api/ps ──────────────────────────────────────────────
// 代理模式下无本地运行模型
router.get('/', (_req, res) => {
  res.json({ models: [] });
});

module.exports = router;
